package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// PlannedPaymentService owns planned-payment business rules. The account and
// category references must be LIVE records of the same household, and the category
// type must match the plan type; `next_due` may be in the past (a plan can
// start out overdue). Type is immutable. The repository handles the
// optimistic-concurrency version check (returns
// ErrPlannedPaymentVersionConflict on mismatch).
type PlannedPaymentService struct {
	plans      repository.PlannedPaymentRepository
	accounts   repository.AccountRepository
	categories repository.CategoryRepository
}

func NewPlannedPaymentService(
	plans repository.PlannedPaymentRepository,
	accounts repository.AccountRepository,
	categories repository.CategoryRepository,
) *PlannedPaymentService {
	return &PlannedPaymentService{plans: plans, accounts: accounts, categories: categories}
}

// refReads adapts the service's repositories to the write-rules seam.
func (s *PlannedPaymentService) refReads() RefReads {
	return repoRefReads{accounts: s.accounts, categories: s.categories}
}

func (s *PlannedPaymentService) Create(
	ctx context.Context,
	scope domain.Scope,
	params domain.CreatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	const op = "service.plannedPayment.Create"

	if err := ValidatePlannedPaymentWrite(
		ctx, s.refReads(), scope, params.AccountID, params.CategoryID, params.Type,
	); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	params.HouseholdID, params.UserID = scope.HouseholdID, scope.ActorID
	p, err := s.plans.CreatePlannedPayment(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return p, nil
}

func (s *PlannedPaymentService) Update(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	const op = "service.plannedPayment.Update"

	if params.Amount == nil && params.Name == nil && params.Note == nil &&
		params.AccountID == nil && params.CategoryID == nil && params.NextDue == nil &&
		params.Regularity == nil && params.ConfirmMode == nil && params.Reminder == nil {
		return nil, ErrNoFieldsToUpdate
	}

	if params.AccountID != nil || params.CategoryID != nil {
		// Type is immutable and comes from the stored plan; re-reading also
		// surfaces not-found before any ref work.
		current, err := s.plans.GetPlannedPayment(ctx, scope, id)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", op, err)
		}
		accountID := current.AccountID
		if params.AccountID != nil {
			accountID = *params.AccountID
		}
		categoryID := current.CategoryID
		if params.CategoryID != nil {
			categoryID = *params.CategoryID
		}
		if err := ValidatePlannedPaymentWrite(
			ctx, s.refReads(), scope, accountID, categoryID, current.Type,
		); err != nil {
			return nil, fmt.Errorf("%s: %w", op, err)
		}
	}

	p, err := s.plans.UpdatePlannedPayment(ctx, scope, id, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return p, nil
}

func (s *PlannedPaymentService) Delete(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	const op = "service.plannedPayment.Delete"
	if err := s.plans.DeletePlannedPayment(ctx, scope, id); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *PlannedPaymentService) Get(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.PlannedPayment, error) {
	const op = "service.plannedPayment.Get"
	p, err := s.plans.GetPlannedPayment(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return p, nil
}

func (s *PlannedPaymentService) List(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetPlannedPaymentsParams,
) ([]domain.PlannedPayment, error) {
	const op = "service.plannedPayment.List"
	p, err := s.plans.GetPlannedPayments(ctx, scope, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return p, nil
}
