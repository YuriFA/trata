package http

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/domain"
)

func (s *Server) ListAccounts(
	ctx context.Context,
	_ api.ListAccountsRequestObject,
) (api.ListAccountsResponseObject, error) {
	scope := s.currentScope(ctx)
	accounts, err := s.accounts.List(ctx, scope)
	if err != nil {
		return nil, err
	}
	out := make([]api.Account, 0, len(accounts))
	for _, a := range accounts {
		out = append(out, toAPIAccount(a))
	}
	return api.ListAccounts200JSONResponse(out), nil
}

func (s *Server) CreateAccount(
	ctx context.Context,
	req api.CreateAccountRequestObject,
) (api.CreateAccountResponseObject, error) {
	var id uuid.UUID
	if req.Body.Id != nil {
		id = *req.Body.Id
	}
	a, err := s.accounts.Create(ctx, s.currentScope(ctx), domain.CreateAccountParams{
		ID:             id,
		Name:           req.Body.Name,
		Currency:       string(req.Body.Currency),
		OpeningBalance: req.Body.OpeningBalance,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateAccount201JSONResponse(toAPIAccount(*a)), nil
}

func (s *Server) GetAccount(
	ctx context.Context,
	req api.GetAccountRequestObject,
) (api.GetAccountResponseObject, error) {
	scope := s.currentScope(ctx)
	a, err := s.accounts.Get(ctx, scope, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetAccount200JSONResponse(toAPIAccount(*a)), nil
}

func (s *Server) UpdateAccount(
	ctx context.Context,
	req api.UpdateAccountRequestObject,
) (api.UpdateAccountResponseObject, error) {
	var name *string
	if req.Body.Name != nil {
		n := *req.Body.Name
		name = &n
	}
	a, err := s.accounts.Update(ctx, s.currentScope(ctx), req.Id, domain.UpdateAccountParams{
		Name:    name,
		Version: req.Body.Version,
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateAccount200JSONResponse(toAPIAccount(*a)), nil
}

func (s *Server) DeleteAccount(
	ctx context.Context,
	req api.DeleteAccountRequestObject,
) (api.DeleteAccountResponseObject, error) {
	if err := s.accounts.Delete(ctx, s.currentScope(ctx), req.Id); err != nil {
		return nil, err
	}
	return api.DeleteAccount204Response{}, nil
}
