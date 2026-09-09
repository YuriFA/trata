package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// Category write rules (ADR-0005). Upserts carry no cross-entity rules
// (the type enum is the per-surface shape guard; live-name uniqueness is
// enforced by the REST unique index and pre-checked under the sync
// advisory lock - two mechanisms, one outcome sentinel). The write rule
// is the DELETE guard: a category with live dependants cannot be deleted
// unless the delete cascades (the cascade removes the referencing
// transactions). The postgres DeleteCategory enforces the identical rule
// inside its locked transaction (REST atomicity); this module is the
// canonical statement, executed against the sync batch tx.

// CategoryDeleteReads is the dependants-reading seam; the sync tx
// contract satisfies it structurally.
type CategoryDeleteReads interface {
	HasLiveTransactionsForCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	HasLivePlannedPaymentsForCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
}

// ValidateCategoryDelete returns the sentinel of the first relation that
// blocks a plain (non-cascading) delete (live transactions, then live
// planned payments - the REST order), nil when nothing blocks.
func ValidateCategoryDelete(
	ctx context.Context,
	reads CategoryDeleteReads,
	scope domain.Scope, id uuid.UUID,
) error {
	transactions, err := reads.HasLiveTransactionsForCategory(ctx, scope, id)
	if err != nil {
		return err
	}
	if transactions {
		return domain.ErrCategoryHasTransactions
	}
	plans, err := reads.HasLivePlannedPaymentsForCategory(ctx, scope, id)
	if err != nil {
		return err
	}
	if plans {
		return domain.ErrCategoryHasPlannedPayments
	}
	return nil
}

// ValidateCategoryDeleteUnderCascade is the reduced guard for a cascading
// delete: the referencing transactions are removed by the cascade itself,
// so only live planned payments still block.
func ValidateCategoryDeleteUnderCascade(
	ctx context.Context,
	reads CategoryDeleteReads,
	scope domain.Scope, id uuid.UUID,
) error {
	plans, err := reads.HasLivePlannedPaymentsForCategory(ctx, scope, id)
	if err != nil {
		return err
	}
	if plans {
		return domain.ErrCategoryHasPlannedPayments
	}
	return nil
}
