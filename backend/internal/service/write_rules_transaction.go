package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// Transaction write rules (ADR-0005): the single home of the
// transport-agnostic rules a transaction write must satisfy. Both surfaces
// call ValidateTransactionWrite with the EFFECTIVE full state of the record:
//
//   - the REST service merges a PATCH into the current row first;
//   - the sync push adapter passes the wire-decoded full state.
//
// What stays out: the entity-invalid-data guard (a malformed type enum) and
// the engine's immutability hook keep their protocol-shaped error surface in
// the adapter, and REST update cannot change the type at all (structural
// immutability: the update params omit it). The write path itself (create vs
// replace vs tombstone) is decided by the callers, not here.

// TransactionWriteState is the effective full state of a transaction write.
type TransactionWriteState struct {
	Type   domain.TransactionType
	Amount int64
	// Per-type reference set (cashflow: accountID + categoryID; transfer:
	// from/to; adjustment: accountID). Income/expense MAY be account-less
	// (a nil AccountID skips the account checks); the category is required
	// regardless.
	AccountID     *uuid.UUID
	CategoryID    *uuid.UUID
	FromAccountID *uuid.UUID
	ToAccountID   *uuid.UUID
	// Cross-currency transfer credit (positive, in the destination account's
	// currency). Nil is valid only when the two accounts share a currency.
	DestinationAmount *int64
	// PrevCategoryID is the category on the record BEFORE this write
	// (nil = fresh assignment): an archived category may be kept, never
	// newly assigned.
	PrevCategoryID *uuid.UUID
}

// ValidateTransactionWrite checks the amount sign rule and the per-type
// reference rules. It returns domain sentinels (wire specs in
// domain.ErrorSpecFor); infrastructure read errors are returned as-is so the
// caller can fail the request / batch item without a machine code.
func ValidateTransactionWrite(
	ctx context.Context,
	reads RefReads,
	scope domain.Scope,
	state TransactionWriteState,
) error {
	if err := ValidateAmount(state.Type, state.Amount); err != nil {
		return err
	}
	switch state.Type {
	case domain.TransactionTypeIncome, domain.TransactionTypeExpense:
		if state.FromAccountID != nil || state.ToAccountID != nil || state.CategoryID == nil {
			return domain.ErrInvalidRefs
		}
		return validateCashflowWriteRefs(ctx, reads, scope, state)
	case domain.TransactionTypeTransfer:
		if state.AccountID != nil || state.CategoryID != nil ||
			state.FromAccountID == nil || state.ToAccountID == nil {
			return domain.ErrInvalidRefs
		}
		return validateTransferWriteRefs(
			ctx,
			reads,
			scope,
			*state.FromAccountID,
			*state.ToAccountID,
			state.DestinationAmount,
		)
	case domain.TransactionTypeAdjustment:
		if state.CategoryID != nil || state.FromAccountID != nil || state.ToAccountID != nil ||
			state.AccountID == nil {
			return domain.ErrInvalidRefs
		}
		return validateAdjustmentWriteRefs(ctx, reads, scope, *state.AccountID)
	}
	return nil
}

// ValidateAmount enforces the per-type amount sign rule: positive for
// income/expense/transfer, nonzero signed for adjustment (the reconciliation
// delta may lower or raise the balance).
func ValidateAmount(typ domain.TransactionType, amount int64) error {
	if typ == domain.TransactionTypeAdjustment {
		if amount == 0 {
			return domain.ErrInvalidAmount
		}
		return nil
	}
	if amount < 1 {
		return domain.ErrInvalidAmount
	}
	return nil
}

// ValidateTransactionTypeImmutable enforces the type immutability rule. REST
// update cannot violate it (the update params omit the type); the sync push
// adapter calls this from its engine hook.
func ValidateTransactionTypeImmutable(cur, next domain.TransactionType) error {
	if cur != next {
		return domain.ErrTransactionTypeImmutable
	}
	return nil
}

// writeAccountExists maps the seam's account read to the sentinel of the
// from/to/plain call site.
func writeAccountExists(
	ctx context.Context, reads RefReads, scope domain.Scope, id uuid.UUID, notFound error,
) error {
	exists, err := reads.AccountExists(ctx, scope, id)
	if err != nil {
		return err
	}
	if !exists {
		return notFound
	}
	return nil
}

func validateCashflowWriteRefs(
	ctx context.Context,
	reads RefReads,
	scope domain.Scope,
	state TransactionWriteState,
) error {
	if state.AccountID != nil {
		if err := writeAccountExists(
			ctx, reads, scope, *state.AccountID, domain.ErrTransactionAccountNotFound,
		); err != nil {
			return err
		}
	}
	cat, err := reads.Category(ctx, scope, *state.CategoryID)
	if err != nil {
		if errors.Is(err, domain.ErrCategoryNotFound) {
			return domain.ErrTransactionCategoryNotFound
		}
		return err
	}
	if cat == nil {
		return domain.ErrTransactionCategoryNotFound
	}
	if cat.Type != state.Type {
		return domain.ErrCategoryTypeMismatch
	}
	if cat.Archived() &&
		(state.PrevCategoryID == nil || *state.PrevCategoryID != *state.CategoryID) {
		return domain.ErrCategoryArchived
	}
	return nil
}

func validateTransferWriteRefs(
	ctx context.Context,
	reads RefReads,
	scope domain.Scope, fromAccountID, toAccountID uuid.UUID, destinationAmount *int64,
) error {
	if err := writeAccountExists(
		ctx, reads, scope, fromAccountID, domain.ErrTransactionFromAccountNotFound,
	); err != nil {
		return err
	}
	if err := writeAccountExists(
		ctx, reads, scope, toAccountID, domain.ErrTransactionToAccountNotFound,
	); err != nil {
		return err
	}
	if fromAccountID == toAccountID {
		return domain.ErrSameAccountTransfer
	}

	// Cross-currency iff-rule (multi-currency change): the destination amount
	// is REQUIRED when the two accounts' currencies differ and FORBIDDEN when
	// they match. The credit must be positive. Currency reads happen after
	// the existence checks, so a not-found here cannot be the first failure.
	fromCurrency, err := reads.AccountCurrency(ctx, scope, fromAccountID)
	if err != nil {
		return err
	}
	toCurrency, err := reads.AccountCurrency(ctx, scope, toAccountID)
	if err != nil {
		return err
	}
	crossCurrency := fromCurrency != toCurrency
	switch {
	case crossCurrency && destinationAmount == nil:
		return domain.ErrTransferDestinationAmountRequired
	case crossCurrency:
		if *destinationAmount <= 0 {
			return domain.ErrInvalidAmount
		}
	case destinationAmount != nil:
		return domain.ErrTransferDestinationAmountForbidden
	}
	return nil
}

func validateAdjustmentWriteRefs(
	ctx context.Context,
	reads RefReads,
	scope domain.Scope, accountID uuid.UUID,
) error {
	return writeAccountExists(ctx, reads, scope, accountID, domain.ErrTransactionAccountNotFound)
}
