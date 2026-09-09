package http

import (
	"context"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/domain"
)

// Date conversion lives here because the wire format is a calendar date
// (YYYY-MM-DD) while the domain stores UTC midnight: past dates are legal
// (a plan may start out overdue), so no future-only validation exists.

func (s *Server) ListPlannedPayments(
	ctx context.Context,
	req api.ListPlannedPaymentsRequestObject,
) (api.ListPlannedPaymentsResponseObject, error) {
	scope := s.currentScope(ctx)
	var typeFilter *domain.TransactionType
	if req.Params.Type != nil {
		t := domain.TransactionType(*req.Params.Type)
		typeFilter = &t
	}
	plans, err := s.plans.List(ctx, scope, domain.GetPlannedPaymentsParams{Type: typeFilter})
	if err != nil {
		return nil, err
	}
	out := make([]api.PlannedPayment, 0, len(plans))
	for _, p := range plans {
		out = append(out, toAPIPlannedPayment(p))
	}
	return api.ListPlannedPayments200JSONResponse(out), nil
}

func (s *Server) CreatePlannedPayment(
	ctx context.Context,
	req api.CreatePlannedPaymentRequestObject,
) (api.CreatePlannedPaymentResponseObject, error) {
	var id uuid.UUID
	if req.Body.Id != nil {
		id = *req.Body.Id
	}
	name := ""
	if req.Body.Name != nil {
		name = *req.Body.Name
	}
	note := ""
	if req.Body.Note != nil {
		note = *req.Body.Note
	}
	reminder := domain.PlannedReminderOff
	if req.Body.Reminder != nil {
		reminder = domain.PlannedReminder(*req.Body.Reminder)
	}
	nextDue, err := parseAPIDate(req.Body.NextDue)
	if err != nil {
		return nil, err
	}
	p, err := s.plans.Create(ctx, s.currentScope(ctx), domain.CreatePlannedPaymentParams{
		ID:          id,
		Type:        domain.TransactionType(req.Body.Type),
		Amount:      req.Body.Amount,
		Name:        name,
		AccountID:   req.Body.AccountId,
		CategoryID:  req.Body.CategoryId,
		NextDue:     nextDue,
		Regularity:  domain.PlannedRegularity(req.Body.Regularity),
		ConfirmMode: domain.PlannedConfirmMode(req.Body.ConfirmMode),
		Reminder:    reminder,
		Note:        note,
	})
	if err != nil {
		return nil, err
	}
	return api.CreatePlannedPayment201JSONResponse(toAPIPlannedPayment(*p)), nil
}

func (s *Server) GetPlannedPayment(
	ctx context.Context,
	req api.GetPlannedPaymentRequestObject,
) (api.GetPlannedPaymentResponseObject, error) {
	scope := s.currentScope(ctx)
	p, err := s.plans.Get(ctx, scope, req.Id)
	if err != nil {
		return nil, err
	}
	return api.GetPlannedPayment200JSONResponse(toAPIPlannedPayment(*p)), nil
}

func (s *Server) UpdatePlannedPayment(
	ctx context.Context,
	req api.UpdatePlannedPaymentRequestObject,
) (api.UpdatePlannedPaymentResponseObject, error) {
	params := domain.UpdatePlannedPaymentParams{Version: req.Body.Version}
	if req.Body.Amount != nil {
		params.Amount = req.Body.Amount
	}
	if req.Body.Name != nil {
		v := *req.Body.Name
		params.Name = &v
	}
	if req.Body.Note != nil {
		v := *req.Body.Note
		params.Note = &v
	}
	if req.Body.AccountId != nil {
		params.AccountID = req.Body.AccountId
	}
	if req.Body.CategoryId != nil {
		params.CategoryID = req.Body.CategoryId
	}
	if req.Body.NextDue != nil {
		v, err := parseAPIDate(*req.Body.NextDue)
		if err != nil {
			return nil, err
		}
		params.NextDue = &v
	}
	if req.Body.Regularity != nil {
		v := domain.PlannedRegularity(*req.Body.Regularity)
		params.Regularity = &v
	}
	if req.Body.ConfirmMode != nil {
		v := domain.PlannedConfirmMode(*req.Body.ConfirmMode)
		params.ConfirmMode = &v
	}
	if req.Body.Reminder != nil {
		v := domain.PlannedReminder(*req.Body.Reminder)
		params.Reminder = &v
	}
	p, err := s.plans.Update(ctx, s.currentScope(ctx), req.Id, params)
	if err != nil {
		return nil, err
	}
	return api.UpdatePlannedPayment200JSONResponse(toAPIPlannedPayment(*p)), nil
}

func (s *Server) DeletePlannedPayment(
	ctx context.Context,
	req api.DeletePlannedPaymentRequestObject,
) (api.DeletePlannedPaymentResponseObject, error) {
	if err := s.plans.Delete(ctx, s.currentScope(ctx), req.Id); err != nil {
		return nil, err
	}
	return api.DeletePlannedPayment204Response{}, nil
}

func parseAPIDate(d openapi_types.Date) (time.Time, error) {
	t := d.Time
	if t.IsZero() {
		return time.Time{}, domain.ErrInvalidDate
	}
	return t.UTC(), nil
}

func toAPIPlannedPayment(p domain.PlannedPayment) api.PlannedPayment {
	return api.PlannedPayment{
		Id:          toUUID(p.ID),
		UserId:      toUUID(p.UserID),
		Type:        api.PlannedPaymentType(p.Type),
		Amount:      p.Amount,
		Name:        p.Name,
		AccountId:   toUUID(p.AccountID),
		CategoryId:  toUUID(p.CategoryID),
		NextDue:     openapi_types.Date{Time: p.NextDue.UTC()},
		AnchorDate:  openapi_types.Date{Time: p.AnchorDate.UTC()},
		Regularity:  api.PlannedPaymentRegularity(p.Regularity),
		ConfirmMode: api.PlannedPaymentConfirmMode(p.ConfirmMode),
		Reminder:    api.PlannedPaymentReminder(p.Reminder),
		Note:        p.Note,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
		Version:     p.Version,
	}
}
