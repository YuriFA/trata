package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// Debt operations are leaf records (no in-use guard on delete); every mutation
// runs inside withinLockedTx with its change_log append. householdID scopes
// every query; actorID is the acting member whose id lands on the change_log
// row as authorship. Reference validation (live debtor of the same household)
// lives in the service layer.

func (r *Repository) CreateDebtOperation(
	ctx context.Context,
	params domain.CreateDebtOperationParams,
) (*domain.DebtOperation, error) {
	const op = "repository.postgres.CreateDebtOperation"

	id := newEntityID(params.ID)
	var row db.CreateDebtOperationRow
	err := r.withinLockedTx(ctx, params.HouseholdID, func(q *db.Queries) error {
		var err error
		row, err = q.CreateDebtOperation(ctx, db.CreateDebtOperationParams{
			ID:          id,
			HouseholdID: params.HouseholdID,
			UserID:      params.UserID,
			DebtorID:    params.DebtorID,
			Direction:   string(params.Direction),
			Kind:        string(params.Kind),
			Amount:      params.Amount,
			Note:        params.Note,
			OccurredAt:  params.OccurredAt,
		})
		if err != nil {
			if pgUniqueViolation(err) {
				return domain.ErrDebtOperationAlreadyExists
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			params.HouseholdID,
			params.UserID,
			row.ID,
			domain.SyncEntityDebtOperation,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return debtOperationFromFields(
		row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
		row.Amount, row.Note, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) UpdateDebtOperation(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateDebtOperationParams,
) (*domain.DebtOperation, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.UpdateDebtOperation"

	var row db.UpdateDebtOperationRow
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		var err error
		row, err = q.UpdateDebtOperation(ctx, db.UpdateDebtOperationParams{
			ID:          id,
			HouseholdID: householdID,
			Amount:      params.Amount,
			Note:        params.Note,
			OccurredAt:  params.OccurredAt,
			Version:     int32(params.Version), //nolint:gosec // optimistic version is a small positive int
		})
		if err != nil {
			if errNoRows(err) {
				return classifyDebtOperationWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			row.ID,
			domain.SyncEntityDebtOperation,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return debtOperationFromFields(
		row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
		row.Amount, row.Note, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) DeleteDebtOperation(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeleteDebtOperation"

	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		version, err := q.SoftDeleteDebtOperation(
			ctx, db.SoftDeleteDebtOperationParams{ID: id, HouseholdID: householdID},
		)
		if err != nil {
			if errNoRows(err) {
				return classifyDebtOperationWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx, q, householdID, actorID, id,
			domain.SyncEntityDebtOperation, domain.SyncChangeTombstone, int(version),
		)
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// classifyDebtOperationWrite distinguishes the zero-row outcomes of a CAS
// write for the REST surface: never-existed and tombstoned both read as
// not-found, a live row that did not match the expected version is a version
// conflict.
func classifyDebtOperationWrite(ctx context.Context, q *db.Queries, householdID, id uuid.UUID) error {
	row, err := q.GetDebtOperationAny(ctx, db.GetDebtOperationAnyParams{ID: id, HouseholdID: householdID})
	if err != nil || row.DeletedAt != nil {
		return domain.ErrDebtOperationNotFound
	}
	return domain.ErrDebtOperationVersionConflict
}

func (r *Repository) GetDebtOperation(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.DebtOperation, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetDebtOperation"

	row, err := r.q.GetDebtOperation(ctx, db.GetDebtOperationParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrDebtOperationNotFound
		}
		return nil, opWrap(op, err)
	}
	return debtOperationFromFields(
		row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
		row.Amount, row.Note, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) GetDebtOperations(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetDebtOperationsParams,
) ([]domain.DebtOperation, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetDebtOperations"

	rows, err := r.q.GetDebtOperations(ctx, db.GetDebtOperationsParams{
		HouseholdID: householdID,
		DebtorID:    params.DebtorID,
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.DebtOperation, 0, len(rows))
	for _, row := range rows {
		out = append(
			out,
			*debtOperationFromFields(
				row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
				row.Amount, row.Note, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
			),
		)
	}
	return out, nil
}

// debtOperationFromFields assembles a domain.DebtOperation; the operation
// queries return structurally-identical generated Row types, so the
// construction is centralized here.
func debtOperationFromFields(
	id, userID, debtorID uuid.UUID,
	direction, kind string,
	amount int64,
	note string,
	occurredAt, createdAt, updatedAt time.Time,
	version int,
) *domain.DebtOperation {
	return &domain.DebtOperation{
		ID:         id,
		UserID:     userID,
		DebtorID:   debtorID,
		Direction:  domain.DebtDirection(direction),
		Kind:       domain.DebtOperationKind(kind),
		Amount:     amount,
		Note:       note,
		OccurredAt: occurredAt,
		CreatedAt:  createdAt,
		UpdatedAt:  updatedAt,
		Version:    version,
	}
}
