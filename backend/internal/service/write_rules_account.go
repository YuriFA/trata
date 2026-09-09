package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// Account write rules (ADR-0005). Upserts carry no cross-entity rules (the
// shape lives in the OpenAPI request validator / the sync shape guard);
// the write rule is the DELETE guard: an account with live dependants
// cannot be deleted. The postgres DeleteAccount enforces the identical
// rule inside its locked transaction (REST atomicity); this module is the
// canonical statement, executed against the sync batch tx.

// AccountDeleteReads is the dependants-reading seam; both the sync tx
// contract and any other caller satisfy it structurally.
type AccountDeleteReads interface {
	HasLiveTransactionsForAccount(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	HasLivePlannedPaymentsForAccount(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
}

// ValidateAccountDelete returns the sentinel of the first relation that
// blocks the delete (live transactions, then live planned payments - the
// REST order; the message names the relation that fired), nil when the
// account has no live dependants.
func ValidateAccountDelete(
	ctx context.Context,
	reads AccountDeleteReads,
	scope domain.Scope, id uuid.UUID,
) error {
	transactions, err := reads.HasLiveTransactionsForAccount(ctx, scope, id)
	if err != nil {
		return err
	}
	if transactions {
		return domain.ErrAccountHasTransactions
	}
	plans, err := reads.HasLivePlannedPaymentsForAccount(ctx, scope, id)
	if err != nil {
		return err
	}
	if plans {
		return domain.ErrAccountHasPlannedPayments
	}
	return nil
}
