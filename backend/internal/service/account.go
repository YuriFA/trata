package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// AccountService owns account business rules. householdID (scoping) and the
// acting userID (authorship) are always passed explicitly from the transport
// layer (never from a request body).
type AccountService struct {
	accounts repository.AccountRepository
}

func NewAccountService(accounts repository.AccountRepository) *AccountService {
	return &AccountService{accounts: accounts}
}

func (s *AccountService) Create(
	ctx context.Context,
	scope domain.Scope,
	params domain.CreateAccountParams,
) (*domain.Account, error) {
	const op = "service.account.Create"
	params.HouseholdID, params.UserID = scope.HouseholdID, scope.ActorID
	a, err := s.accounts.CreateAccount(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return a, nil
}

func (s *AccountService) Update(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateAccountParams,
) (*domain.Account, error) {
	const op = "service.account.Update"
	if params.Name == nil {
		return nil, ErrNoFieldsToUpdate
	}
	a, err := s.accounts.UpdateAccount(ctx, scope, id, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return a, nil
}

func (s *AccountService) Delete(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	const op = "service.account.Delete"
	if err := s.accounts.DeleteAccount(ctx, scope, id); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *AccountService) Get(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error) {
	const op = "service.account.Get"
	a, err := s.accounts.GetAccount(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return a, nil
}

func (s *AccountService) List(ctx context.Context, scope domain.Scope) ([]domain.Account, error) {
	const op = "service.account.List"
	a, err := s.accounts.GetAccounts(ctx, scope)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return a, nil
}

// ErrNoFieldsToUpdate is returned by PATCH services when the body sets nothing.
// Alias of the domain sentinel (which owns the wire spec); kept so callers
// and tests keep using the service-level name.
var ErrNoFieldsToUpdate = domain.ErrNoFieldsToUpdate
