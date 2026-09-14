package http

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
)

func (s *Server) ListTransactions(
	ctx context.Context,
	req api.ListTransactionsRequestObject,
) (api.ListTransactionsResponseObject, error) {
	scope := s.currentScope(ctx)

	q := service.TransactionListQuery{
		AccountID:  req.Params.AccountId,
		CategoryID: req.Params.CategoryId,
		Limit:      req.Params.Limit,
		Cursor:     req.Params.Cursor,
	}
	if req.Params.Type != nil {
		t := domain.TransactionType(*req.Params.Type)
		q.Type = &t
	}
	if req.Params.FromDate != nil {
		from := req.Params.FromDate.Time
		q.FromDate = &from
	}
	if req.Params.ToDate != nil {
		to := endOfDay(*req.Params.ToDate)
		q.ToDate = &to
	}

	page, err := s.txn.List(ctx, scope, q)
	if err != nil {
		return nil, err
	}
	out := make([]api.Transaction, 0, len(page.Transactions))
	for _, t := range page.Transactions {
		out = append(out, toAPITransaction(t))
	}
	return api.ListTransactions200JSONResponse{
		Transactions: out,
		NextCursor:   page.NextCursor,
	}, nil
}

func (s *Server) CreateTransaction(
	ctx context.Context,
	req api.CreateTransactionRequestObject,
) (api.CreateTransactionResponseObject, error) {
	user := s.currentUser(ctx)
	scope := s.currentScope(ctx)

	var id uuid.UUID
	if req.Body.Id != nil {
		id = *req.Body.Id
	}

	params := domain.CreateTransactionParams{
		ID:                id,
		HouseholdID:       scope.HouseholdID,
		UserID:            user.ID,
		Type:              domain.TransactionType(req.Body.Type),
		Amount:            req.Body.Amount,
		OccurredAt:        req.Body.OccurredAt,
		AccountID:         fromUUIDPtr(req.Body.AccountId),
		CategoryID:        fromUUIDPtr(req.Body.CategoryId),
		FromAccountID:     fromUUIDPtr(req.Body.FromAccountId),
		ToAccountID:       fromUUIDPtr(req.Body.ToAccountId),
		DestinationAmount: req.Body.DestinationAmount,
	}
	if req.Body.Description != nil {
		params.Description = *req.Body.Description
	}

	tx, err := s.txn.Create(ctx, s.currentScope(ctx), params)
	if err != nil {
		return nil, err
	}
	return api.CreateTransaction201JSONResponse(toAPITransaction(*tx)), nil
}

func (s *Server) GetTransaction(
	ctx context.Context,
	req api.GetTransactionRequestObject,
) (api.GetTransactionResponseObject, error) {
	scope := s.currentScope(ctx)
	tx, err := s.txn.Get(ctx, scope, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetTransaction200JSONResponse(toAPITransaction(*tx)), nil
}

func (s *Server) UpdateTransaction(
	ctx context.Context,
	req api.UpdateTransactionRequestObject,
) (api.UpdateTransactionResponseObject, error) {
	params := domain.UpdateTransactionParams{
		Version:           req.Body.Version,
		Amount:            req.Body.Amount,
		Description:       req.Body.Description,
		OccurredAt:        req.Body.OccurredAt,
		AccountID:         fromUUIDPtr(req.Body.AccountId),
		CategoryID:        fromUUIDPtr(req.Body.CategoryId),
		FromAccountID:     fromUUIDPtr(req.Body.FromAccountId),
		ToAccountID:       fromUUIDPtr(req.Body.ToAccountId),
		DestinationAmount: req.Body.DestinationAmount,
	}
	tx, err := s.txn.Update(ctx, s.currentScope(ctx), req.Id, params)
	if err != nil {
		return nil, err
	}
	return api.UpdateTransaction200JSONResponse(toAPITransaction(*tx)), nil
}

func (s *Server) DeleteTransaction(
	ctx context.Context,
	req api.DeleteTransactionRequestObject,
) (api.DeleteTransactionResponseObject, error) {
	if err := s.txn.Delete(ctx, s.currentScope(ctx), req.Id); err != nil {
		return nil, err
	}
	return api.DeleteTransaction204Response{}, nil
}
