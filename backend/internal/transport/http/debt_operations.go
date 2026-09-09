package http

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/domain"
)

func (s *Server) ListDebtOperations(
	ctx context.Context,
	req api.ListDebtOperationsRequestObject,
) (api.ListDebtOperationsResponseObject, error) {
	scope := s.currentScope(ctx)
	ops, err := s.debtOps.List(ctx, scope, domain.GetDebtOperationsParams{
		DebtorID: fromUUIDPtr(req.Params.DebtorId),
	})
	if err != nil {
		return nil, err
	}
	out := make([]api.DebtOperation, 0, len(ops))
	for _, o := range ops {
		out = append(out, toAPIDebtOperation(o))
	}
	return api.ListDebtOperations200JSONResponse(out), nil
}

func (s *Server) CreateDebtOperation(
	ctx context.Context,
	req api.CreateDebtOperationRequestObject,
) (api.CreateDebtOperationResponseObject, error) {
	var id uuid.UUID
	if req.Body.Id != nil {
		id = *req.Body.Id
	}
	note := ""
	if req.Body.Note != nil {
		note = *req.Body.Note
	}
	o, err := s.debtOps.Create(ctx, s.currentScope(ctx), domain.CreateDebtOperationParams{
		ID:         id,
		DebtorID:   req.Body.DebtorId,
		Direction:  domain.DebtDirection(req.Body.Direction),
		Kind:       domain.DebtOperationKind(req.Body.Kind),
		Amount:     req.Body.Amount,
		Note:       note,
		OccurredAt: req.Body.OccurredAt,
	})
	if err != nil {
		return nil, err
	}
	return api.CreateDebtOperation201JSONResponse(toAPIDebtOperation(*o)), nil
}

func (s *Server) GetDebtOperation(
	ctx context.Context,
	req api.GetDebtOperationRequestObject,
) (api.GetDebtOperationResponseObject, error) {
	scope := s.currentScope(ctx)
	o, err := s.debtOps.Get(ctx, scope, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetDebtOperation200JSONResponse(toAPIDebtOperation(*o)), nil
}

func (s *Server) UpdateDebtOperation(
	ctx context.Context,
	req api.UpdateDebtOperationRequestObject,
) (api.UpdateDebtOperationResponseObject, error) {
	o, err := s.debtOps.Update(ctx, s.currentScope(ctx), req.Id, domain.UpdateDebtOperationParams{
		Amount:     req.Body.Amount,
		Note:       req.Body.Note,
		OccurredAt: req.Body.OccurredAt,
		Version:    req.Body.Version,
	})
	if err != nil {
		return nil, err
	}
	return api.UpdateDebtOperation200JSONResponse(toAPIDebtOperation(*o)), nil
}

func (s *Server) DeleteDebtOperation(
	ctx context.Context,
	req api.DeleteDebtOperationRequestObject,
) (api.DeleteDebtOperationResponseObject, error) {
	if err := s.debtOps.Delete(ctx, s.currentScope(ctx), req.Id); err != nil {
		return nil, err
	}
	return api.DeleteDebtOperation204Response{}, nil
}
