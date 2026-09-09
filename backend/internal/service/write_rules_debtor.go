package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// Debtor write rules (ADR-0005). Upserts carry no cross-entity rules
// (live-name uniqueness is enforced by the REST unique index and
// pre-checked under the sync advisory lock - two mechanisms, one outcome
// sentinel). The write rule is the DELETE guard: a debtor with live debt
// operations cannot be deleted. The postgres DeleteDebtor enforces the
// identical rule inside its transaction (REST atomicity); this module is
// the canonical statement, executed against the sync batch tx.

// DebtorDeleteReads is the dependants-reading seam; the sync tx contract
// satisfies it structurally.
type DebtorDeleteReads interface {
	HasLiveDebtOperationsForDebtor(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
}

// ValidateDebtorDelete returns ErrDebtorHasOperations when live debt
// operations reference the debtor, nil when nothing blocks.
func ValidateDebtorDelete(
	ctx context.Context,
	reads DebtorDeleteReads,
	scope domain.Scope, id uuid.UUID,
) error {
	operations, err := reads.HasLiveDebtOperationsForDebtor(ctx, scope, id)
	if err != nil {
		return err
	}
	if operations {
		return domain.ErrDebtorHasOperations
	}
	return nil
}
