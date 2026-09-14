package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// DebtorService owns household debtor business rules. householdID (scoping)
// and the acting userID (authorship) are always passed explicitly from the
// transport layer. The repository handles the optimistic-concurrency version
// check (returns ErrDebtorVersionConflict on mismatch) and the live-name
// uniqueness (per-household partial unique index).
type DebtorService struct {
	debtors repository.DebtorRepository
}

func NewDebtorService(debtors repository.DebtorRepository) *DebtorService {
	return &DebtorService{debtors: debtors}
}

func (s *DebtorService) Create(
	ctx context.Context,
	scope domain.Scope,
	params domain.CreateDebtorParams,
) (*domain.Debtor, error) {
	const op = "service.debtor.Create"
	params.HouseholdID, params.UserID = scope.HouseholdID, scope.ActorID
	d, err := s.debtors.CreateDebtor(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return d, nil
}

func (s *DebtorService) Update(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateDebtorParams,
) (*domain.Debtor, error) {
	const op = "service.debtor.Update"
	if params.Name == nil && params.Note == nil {
		return nil, ErrNoFieldsToUpdate
	}
	d, err := s.debtors.UpdateDebtor(ctx, scope, id, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return d, nil
}

func (s *DebtorService) Delete(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	const op = "service.debtor.Delete"
	if err := s.debtors.DeleteDebtor(ctx, scope, id); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *DebtorService) Get(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Debtor, error) {
	const op = "service.debtor.Get"
	d, err := s.debtors.GetDebtor(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return d, nil
}

func (s *DebtorService) List(ctx context.Context, scope domain.Scope) ([]domain.Debtor, error) {
	const op = "service.debtor.List"
	d, err := s.debtors.GetDebtors(ctx, scope)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return d, nil
}
