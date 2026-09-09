package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// transactionTx is the transaction push path's slice of the batch tx
// (ADR-0003): the shared core, its own contract, and the live account/
// category reference reads the per-type validation needs (declared inline so
// the adapter sees exactly the reads it uses, not those contracts' writes).
// The compile-time check pins the contract to the full repository.SyncTx the
// applier hands in.
type transactionTx interface {
	repository.SyncCore
	repository.TransactionSyncTx
	LiveAccountExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	LiveCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
}

var _ transactionTx = repository.SyncTx(nil)

// transactionAdapter is the transaction's half of the push engine: the
// type/amount shape rules before the current-row read, the per-type
// reference rules (cashflow vs transfer vs adjustment, against LIVE
// accounts/categories) after it, the type immutability guard, and no delete
// guard (transactions tombstone unconditionally).
type transactionAdapter struct {
	syncAdapterDefaults[transactionTx, *domain.Transaction, domain.TransactionFullState]
}

func (transactionAdapter) entity() string { return domain.SyncEntityTransaction }
func (transactionAdapter) label() string {
	return catalogSyncEntityLabel(domain.SyncEntityTransaction)
}

func (transactionAdapter) decode(raw json.RawMessage) (domain.TransactionFullState, error) {
	var data domain.TransactionFullState
	err := decodeSyncData(raw, &data)
	return data, err
}

func (transactionAdapter) invalidDataMessage() string {
	return catalogSyncEntityInvalidDataMessage(domain.SyncEntityTransaction)
}

// preValidate checks the malformed-type guard before the current-row read;
// the amount sign rule runs with the reference rules in postReadValidate
// (ValidateTransactionWrite checks amount first, so the error precedence is
// unchanged: malformed type > amount > references).
func (transactionAdapter) preValidate(
	_ context.Context, _ transactionTx, _ domain.Scope, _ domain.SyncOperation, data domain.TransactionFullState,
) (string, string, error) {
	switch data.Type {
	case domain.TransactionTypeIncome,
		domain.TransactionTypeExpense,
		domain.TransactionTypeTransfer,
		domain.TransactionTypeAdjustment:
		return "", "", nil
	default:
		return "VALIDATION_FAILED", (transactionAdapter{}).invalidDataMessage(), nil
	}
}

// postReadValidate runs the write rules (ADR-0005) on the effective refs of
// the full state with the sync-tx live reads, mapping the domain sentinel to
// the shared wire spec (domain.ErrorSpecFor) - the same code + message the
// REST surface answers with.
func (transactionAdapter) postReadValidate(
	ctx context.Context,
	t transactionTx,
	scope domain.Scope,
	op domain.SyncOperation,
	data domain.TransactionFullState,
) (string, string, error) {
	var prevCategoryID *uuid.UUID
	if current, found, err := (transactionAdapter{}).getAny(ctx, t, scope, op.ID); err != nil {
		return "", "", err
	} else if found && !current.Deleted() {
		prevCategoryID = current.CategoryID
	}
	err := ValidateTransactionWrite(ctx, syncRefReads{src: t}, scope, TransactionWriteState{
		Type: data.Type, Amount: data.Amount,
		AccountID: data.AccountID, CategoryID: data.CategoryID,
		FromAccountID: data.FromAccountID, ToAccountID: data.ToAccountID,
		PrevCategoryID: prevCategoryID,
	})
	if err != nil {
		if spec, ok := domain.ErrorSpecFor(err); ok {
			return spec.Code, spec.Message, nil
		}
		return "", "", err
	}
	return "", "", nil
}

func (transactionAdapter) immutable(cur *domain.Transaction, data domain.TransactionFullState) (string, string) {
	if err := ValidateTransactionTypeImmutable(cur.Type, data.Type); err != nil {
		if spec, ok := domain.ErrorSpecFor(err); ok {
			return spec.Code, spec.Message
		}
	}
	return "", ""
}

func (transactionAdapter) version(tr *domain.Transaction) int   { return tr.Version }
func (transactionAdapter) fullState(tr *domain.Transaction) any { return tr.FullState() }
func (transactionAdapter) isWriteRace(err error) bool {
	return errors.Is(err, domain.ErrTransactionVersionConflict) || errors.Is(err, domain.ErrRecordDeleted)
}

func (transactionAdapter) getAny(
	ctx context.Context, t transactionTx, scope domain.Scope, id uuid.UUID,
) (*domain.Transaction, bool, error) {
	tr, err := t.GetTransactionAny(ctx, scope, id)
	if err != nil || tr == nil {
		return nil, false, err
	}
	return tr, true, nil
}

func (transactionAdapter) create(
	ctx context.Context, t transactionTx, scope domain.Scope, id uuid.UUID, data domain.TransactionFullState,
) (*domain.Transaction, error) {
	return t.CreateTransaction(ctx, domain.CreateTransactionParams{
		ID: id, HouseholdID: scope.HouseholdID, UserID: scope.ActorID,
		Type: data.Type, Amount: data.Amount, Description: data.Description, OccurredAt: data.OccurredAt,
		AccountID: data.AccountID, CategoryID: data.CategoryID,
		FromAccountID: data.FromAccountID, ToAccountID: data.ToAccountID,
	})
}

func (transactionAdapter) replace(
	ctx context.Context,
	t transactionTx,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	data domain.TransactionFullState,
) (*domain.Transaction, error) {
	return t.ReplaceTransaction(ctx, scope, id, baseVersion, data)
}

func (transactionAdapter) tombstone(
	ctx context.Context, t transactionTx, scope domain.Scope, id uuid.UUID,
) (*domain.Transaction, error) {
	return t.TombstoneTransaction(ctx, scope, id)
}
