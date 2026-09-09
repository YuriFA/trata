package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// Every mutation runs inside withinLockedTx: entity write + change_log append
// commit atomically, and the per-household advisory lock keeps change_log seq
// order equal to commit order. Deletes are tombstones; deletion is unguarded
// (a plan has no child records). Name is not unique, so the only
// unique-violation source is the PK (client id duplicate). householdID scopes
// every query; actorID is the acting member whose id lands on the change_log
// row as authorship.

func (r *Repository) CreatePlannedPayment(
	ctx context.Context,
	params domain.CreatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	const op = "repository.postgres.CreatePlannedPayment"

	id := newEntityID(params.ID)
	var row db.CreatePlannedPaymentRow
	err := r.withinLockedTx(ctx, params.HouseholdID, func(q *db.Queries) error {
		var err error
		row, err = q.CreatePlannedPayment(ctx, db.CreatePlannedPaymentParams{
			ID:          id,
			HouseholdID: params.HouseholdID,
			UserID:      params.UserID,
			Type:        string(params.Type),
			Amount:      params.Amount,
			Name:        params.Name,
			AccountID:   params.AccountID,
			CategoryID:  params.CategoryID,
			NextDue:     params.NextDue,
			Regularity:  string(params.Regularity),
			ConfirmMode: string(params.ConfirmMode),
			Reminder:    string(params.Reminder),
			Note:        params.Note,
		})
		if err != nil {
			if pgUniqueViolation(err) {
				return domain.ErrPlannedPaymentAlreadyExists
			}
			return err
		}
		return appendChangeLog(
			ctx, q, params.HouseholdID, params.UserID, row.ID,
			domain.SyncEntityPlannedPayment, domain.SyncChangeUpsert, int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) UpdatePlannedPayment(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.UpdatePlannedPayment"

	var row db.UpdatePlannedPaymentRow
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		var err error
		row, err = q.UpdatePlannedPayment(ctx, db.UpdatePlannedPaymentParams{
			Amount:      params.Amount,
			Name:        params.Name,
			Note:        params.Note,
			AccountID:   params.AccountID,
			CategoryID:  params.CategoryID,
			NextDue:     params.NextDue,
			Regularity:  regularityPtr(params.Regularity),
			ConfirmMode: confirmModePtr(params.ConfirmMode),
			Reminder:    reminderPtr(params.Reminder),
			ID:          id,
			HouseholdID: householdID,
			Version:     int32(params.Version), //nolint:gosec // optimistic version is a small positive int
		})
		if err != nil {
			if errNoRows(err) {
				return classifyPlannedPaymentWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx, q, householdID, actorID, row.ID,
			domain.SyncEntityPlannedPayment, domain.SyncChangeUpsert, int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) DeletePlannedPayment(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeletePlannedPayment"

	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		version, err := q.SoftDeletePlannedPayment(
			ctx, db.SoftDeletePlannedPaymentParams{ID: id, HouseholdID: householdID},
		)
		if err != nil {
			if errNoRows(err) {
				return classifyPlannedPaymentWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx, q, householdID, actorID, id,
			domain.SyncEntityPlannedPayment, domain.SyncChangeTombstone, int(version),
		)
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// classifyPlannedPaymentWrite distinguishes the zero-row outcomes of a CAS
// write for the REST surface: never-existed and tombstoned both read as
// not-found, a live row that did not match the expected version is a version
// conflict.
func classifyPlannedPaymentWrite(ctx context.Context, q *db.Queries, householdID, id uuid.UUID) error {
	row, err := q.GetPlannedPaymentAny(ctx, db.GetPlannedPaymentAnyParams{ID: id, HouseholdID: householdID})
	if err != nil || row.DeletedAt != nil {
		return domain.ErrPlannedPaymentNotFound
	}
	return domain.ErrPlannedPaymentVersionConflict
}

func (r *Repository) GetPlannedPayment(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetPlannedPayment"

	row, err := r.q.GetPlannedPayment(ctx, db.GetPlannedPaymentParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrPlannedPaymentNotFound
		}
		return nil, opWrap(op, err)
	}
	return plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) GetPlannedPayments(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetPlannedPaymentsParams,
) ([]domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetPlannedPayments"

	var typePtr *string
	if params.Type != nil {
		typePtr = (*string)(params.Type)
	}
	rows, err := r.q.GetPlannedPayments(ctx, db.GetPlannedPaymentsParams{HouseholdID: householdID, Type: typePtr})
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.PlannedPayment, 0, len(rows))
	for _, row := range rows {
		out = append(out, *plannedPaymentFromRow(
			row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
			row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
			row.CreatedAt, row.UpdatedAt, int(row.Version),
		))
	}
	return out, nil
}

// HouseholdsWithDueAutoPlannedPayments lists the households owning at least
// one due auto plan — the auto-confirm job's per-household work list (v1
// households are personal, one user each).
func (r *Repository) HouseholdsWithDueAutoPlannedPayments(ctx context.Context, today time.Time) ([]uuid.UUID, error) {
	const op = "repository.postgres.HouseholdsWithDueAutoPlannedPayments"

	ids, err := r.q.HouseholdsWithDueAutoPlannedPayments(ctx, today)
	if err != nil {
		return nil, opWrap(op, err)
	}
	return ids, nil
}

// plannedPaymentFromRow assembles a domain.PlannedPayment; the planned
// payment queries return structurally-identical generated Row types, so the
// construction is centralized here.
func plannedPaymentFromRow(
	id, userID uuid.UUID,
	typeStr string,
	amount int64,
	name string,
	accountID, categoryID uuid.UUID,
	nextDue, anchorDate time.Time,
	regularity, confirmMode, reminder, note string,
	createdAt, updatedAt time.Time,
	version int,
) *domain.PlannedPayment {
	return &domain.PlannedPayment{
		ID:          id,
		UserID:      userID,
		Type:        domain.TransactionType(typeStr),
		Amount:      amount,
		Name:        name,
		AccountID:   accountID,
		CategoryID:  categoryID,
		NextDue:     nextDue,
		AnchorDate:  anchorDate,
		Regularity:  domain.PlannedRegularity(regularity),
		ConfirmMode: domain.PlannedConfirmMode(confirmMode),
		Reminder:    domain.PlannedReminder(reminder),
		Note:        note,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
		Version:     version,
	}
}

func regularityPtr(v *domain.PlannedRegularity) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

func confirmModePtr(v *domain.PlannedConfirmMode) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

func reminderPtr(v *domain.PlannedReminder) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}
