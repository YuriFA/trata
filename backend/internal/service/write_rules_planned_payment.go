package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// Planned payment write rules (ADR-0005): the single home of the rules a
// plan write must satisfy. Both surfaces call ValidatePlannedPaymentWrite:
// the REST service with the request's (possibly effective) references, the
// sync push adapter with the wire-decoded full state. Shape checks (enums,
// amount, non-zero dates) stay per-surface: REST gets them from the OpenAPI
// request validator, sync keeps its per-item shape guard.
//
// Unlike transactions, an archived category is NEVER valid for a plan, even
// on an unchanged assignment: archiving is blocked while live plans
// reference a category (REST rule), so an archived reference on a push is
// always a new assignment.

// ValidatePlannedPaymentWrite checks the reference rules: the account must
// be live, the category live, and its type must match the plan type. An
// archived category is rejected outright. Returns domain sentinels (wire
// specs in domain.ErrorSpecFor); infrastructure read errors are returned
// as-is.
func ValidatePlannedPaymentWrite(
	ctx context.Context,
	reads RefReads,
	scope domain.Scope, accountID, categoryID uuid.UUID,
	typ domain.TransactionType,
) error {
	exists, err := reads.AccountExists(ctx, scope, accountID)
	if err != nil {
		return err
	}
	if !exists {
		return domain.ErrPlannedPaymentAccountNotFound
	}
	cat, err := reads.Category(ctx, scope, categoryID)
	if err != nil {
		if errors.Is(err, domain.ErrCategoryNotFound) {
			return domain.ErrPlannedPaymentCategoryNotFound
		}
		return err
	}
	if cat == nil {
		return domain.ErrPlannedPaymentCategoryNotFound
	}
	if cat.Type != typ {
		return domain.ErrPlannedPaymentCategoryTypeMismatch
	}
	// A plan is a future obligation: an archived category is never a valid
	// reference.
	if cat.Archived() {
		return domain.ErrPlannedPaymentCategoryArchived
	}
	return nil
}

// ValidatePlannedPaymentTypeImmutable enforces the plan-type immutability
// rule. REST update cannot violate it (the update params omit the type);
// the sync push adapter calls this from its engine hook.
func ValidatePlannedPaymentTypeImmutable(cur, next domain.TransactionType) error {
	if cur != next {
		return domain.ErrPlannedPaymentTypeImmutable
	}
	return nil
}
