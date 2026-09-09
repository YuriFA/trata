package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// DebtOperationService owns debt-operation business rules. The debtor
// reference must be a LIVE debtor of the same household (a tombstoned debtor
// is "not found"); direction and kind are immutable, so an update never
// revalidates references. householdID (scoping) and the acting userID
// (authorship) are always passed explicitly from the transport layer. The
// repository handles the optimistic-concurrency version check (returns
// ErrDebtOperationVersionConflict on mismatch).
type DebtOperationService struct {
	operations repository.DebtOperationRepository
	debtors    repository.DebtorRepository
}

func NewDebtOperationService(
	operations repository.DebtOperationRepository,
	debtors repository.DebtorRepository,
) *DebtOperationService {
	return &DebtOperationService{operations: operations, debtors: debtors}
}

func (s *DebtOperationService) Create(
	ctx context.Context,
	scope domain.Scope,
	params domain.CreateDebtOperationParams,
) (*domain.DebtOperation, error) {
	const op = "service.debtOperation.Create"

	if err := ValidateDebtOperationWrite(
		ctx, repoDebtorRefReads{debtors: s.debtors}, scope, params.DebtorID,
	); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	params.HouseholdID, params.UserID = scope.HouseholdID, scope.ActorID
	o, err := s.operations.CreateDebtOperation(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return o, nil
}

func (s *DebtOperationService) Update(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateDebtOperationParams,
) (*domain.DebtOperation, error) {
	const op = "service.debtOperation.Update"

	if params.Amount == nil && params.Note == nil && params.OccurredAt == nil {
		return nil, ErrNoFieldsToUpdate
	}

	o, err := s.operations.UpdateDebtOperation(ctx, scope, id, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return o, nil
}

func (s *DebtOperationService) Delete(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	const op = "service.debtOperation.Delete"
	if err := s.operations.DeleteDebtOperation(ctx, scope, id); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *DebtOperationService) Get(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.DebtOperation, error) {
	const op = "service.debtOperation.Get"
	o, err := s.operations.GetDebtOperation(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return o, nil
}

func (s *DebtOperationService) List(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetDebtOperationsParams,
) ([]domain.DebtOperation, error) {
	const op = "service.debtOperation.List"
	o, err := s.operations.GetDebtOperations(ctx, scope, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return o, nil
}
