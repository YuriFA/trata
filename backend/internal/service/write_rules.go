package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// Shared reference-reading seam of the write rules modules (ADR-0005). The
// entity rule files (write_rules_<entity>.go) validate against this seam so
// the REST services and the sync push adapters run the same rules over the
// same read semantics: accounts are live-only (a tombstoned account reads as
// not found), categories are live but ARCHIVED rows are returned (archival
// is a rule, not a read filter) and a missing category reads as
// domain.ErrCategoryNotFound.

// RefReads is the seam both surfaces adapt their reads to.
type RefReads interface {
	AccountExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	// Currency of the (live) account - the cross-currency transfer rule's
	// input. Call sites map a missing account to their own not-found sentinel.
	AccountCurrency(ctx context.Context, scope domain.Scope, id uuid.UUID) (string, error)
	Category(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
}

// liveRefSource is the minimal live-read surface every sync tx contract
// exposes; the per-entity tx interfaces satisfy it structurally.
type liveRefSource interface {
	LiveAccountExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	LiveAccountCurrency(ctx context.Context, scope domain.Scope, id uuid.UUID) (string, error)
	LiveCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
}

// repoRefReads adapts the full REST repositories to the seam. GetCategory
// already reads exactly what the seam wants (live, archived included,
// ErrCategoryNotFound when missing), so it delegates as-is.
type repoRefReads struct {
	accounts   repository.AccountRepository
	categories repository.CategoryRepository
}

func (r repoRefReads) AccountExists(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (bool, error) {
	if _, err := r.accounts.GetAccount(ctx, scope, id); err != nil {
		if errors.Is(err, domain.ErrAccountNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r repoRefReads) Category(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	return r.categories.GetCategory(ctx, scope, id)
}

func (r repoRefReads) AccountCurrency(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (string, error) {
	a, err := r.accounts.GetAccount(ctx, scope, id)
	if err != nil {
		return "", err
	}
	return a.Currency, nil
}

// syncRefReads adapts the sync batch-tx live reads to the seam.
type syncRefReads struct {
	src liveRefSource
}

func (r syncRefReads) AccountExists(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (bool, error) {
	return r.src.LiveAccountExists(ctx, scope, id)
}

func (r syncRefReads) AccountCurrency(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (string, error) {
	return r.src.LiveAccountCurrency(ctx, scope, id)
}

func (r syncRefReads) Category(
	ctx context.Context, scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	return r.src.LiveCategory(ctx, scope, id)
}
