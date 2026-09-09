package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// Debt operation write rules (ADR-0005): the single home of the rules a
// debt-operation write must satisfy. Both surfaces call
// ValidateDebtOperationWrite: the REST service on create (update never
// revalidates - the references are immutable), the sync push adapter on
// every upsert (full state). Shape checks (amount, direction/kind enums)
// stay per-surface: REST gets them from the OpenAPI request validator, sync
// keeps its per-item shape guard.

// DebtorRefReads is the debtor-reading seam of the debt operation write
// rules. Both read styles have identical semantics: live-only (a
// tombstoned debtor reads as not found).
type DebtorRefReads interface {
	DebtorExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
}

// debtLiveSource is the minimal live-read surface the sync tx contract
// exposes; debtOperationTx satisfies it structurally.
type debtLiveSource interface {
	LiveDebtorExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
}

// repoDebtorRefReads adapts the full REST debtor repository to the seam.
type repoDebtorRefReads struct {
	debtors repository.DebtorRepository
}

func (r repoDebtorRefReads) DebtorExists(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (bool, error) {
	if _, err := r.debtors.GetDebtor(ctx, scope, id); err != nil {
		if errors.Is(err, domain.ErrDebtorNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// syncDebtorRefReads adapts the sync batch-tx live read to the seam.
type syncDebtorRefReads struct {
	src debtLiveSource
}

func (r syncDebtorRefReads) DebtorExists(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (bool, error) {
	return r.src.LiveDebtorExists(ctx, scope, id)
}

// ValidateDebtOperationWrite checks the debtor reference is a LIVE debtor of
// the household. Returns domain sentinels (wire specs in
// domain.ErrorSpecFor); infrastructure read errors are returned as-is.
func ValidateDebtOperationWrite(
	ctx context.Context,
	reads DebtorRefReads,
	scope domain.Scope, debtorID uuid.UUID,
) error {
	exists, err := reads.DebtorExists(ctx, scope, debtorID)
	if err != nil {
		return err
	}
	if !exists {
		return domain.ErrDebtOperationDebtorNotFound
	}
	return nil
}

// ValidateDebtOperationImmutable enforces the debtor/direction/kind
// immutability rule. REST update cannot violate it (the update params omit
// those fields); the sync push adapter calls this from its engine hook.
func ValidateDebtOperationImmutable(
	cur *domain.DebtOperation, next domain.DebtOperationFullState,
) error {
	if cur.DebtorID != next.DebtorID || cur.Direction != next.Direction || cur.Kind != next.Kind {
		return domain.ErrDebtOperationImmutable
	}
	return nil
}
