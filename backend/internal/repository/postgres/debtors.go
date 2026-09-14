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
// order equal to commit order. Deletes are tombstones guarded by the
// live-operations in-use check; live-name uniqueness is enforced by the
// per-household partial unique index. householdID scopes every query; actorID
// is the acting member whose id lands on the change_log row as authorship.

func (r *Repository) CreateDebtor(
	ctx context.Context,
	params domain.CreateDebtorParams,
) (*domain.Debtor, error) {
	const op = "repository.postgres.CreateDebtor"

	id := newEntityID(params.ID)
	var row db.CreateDebtorRow
	err := r.withinLockedTx(ctx, params.HouseholdID, func(q *db.Queries) error {
		var err error
		row, err = q.CreateDebtor(ctx, db.CreateDebtorParams{
			ID:          id,
			HouseholdID: params.HouseholdID,
			UserID:      params.UserID,
			Name:        params.Name,
			Note:        params.Note,
			Currency:    params.Currency,
		})
		if err != nil {
			if pgUniqueViolation(err) {
				// Either the live-name partial index or the PK (client id
				// duplicate); both are the same already-exists error.
				return domain.ErrDebtorAlreadyExists
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			params.HouseholdID,
			params.UserID,
			row.ID,
			domain.SyncEntityDebtor,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return debtorFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Note,
		row.Currency,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) UpdateDebtor(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateDebtorParams,
) (*domain.Debtor, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.UpdateDebtor"

	var row db.UpdateDebtorRow
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		var err error
		row, err = q.UpdateDebtor(ctx, db.UpdateDebtorParams{
			ID:          id,
			HouseholdID: householdID,
			Name:        params.Name,
			Note:        params.Note,
			Version:     int32(params.Version), //nolint:gosec // optimistic version is a small positive int
		})
		if err != nil {
			if pgUniqueViolation(err) {
				return domain.ErrDebtorAlreadyExists
			}
			if errNoRows(err) {
				return classifyDebtorWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			row.ID,
			domain.SyncEntityDebtor,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return debtorFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Note,
		row.Currency,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) DeleteDebtor(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeleteDebtor"

	// Same rule as service.ValidateDebtorDelete (ADR-0005), enforced here
	// inside the transaction for REST atomicity.

	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		inUse, err := q.HasLiveDebtOperationsForDebtor(ctx, db.HasLiveDebtOperationsForDebtorParams{
			HouseholdID: householdID,
			DebtorID:    id,
		})
		if err != nil {
			return err
		}
		if inUse {
			return domain.ErrDebtorHasOperations
		}
		version, err := q.SoftDeleteDebtor(
			ctx,
			db.SoftDeleteDebtorParams{ID: id, HouseholdID: householdID},
		)
		if err != nil {
			if errNoRows(err) {
				return classifyDebtorWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			id,
			domain.SyncEntityDebtor,
			domain.SyncChangeTombstone,
			int(version),
		)
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// classifyDebtorWrite distinguishes the zero-row outcomes of a CAS write for
// the REST surface: never-existed and tombstoned both read as not-found, a
// live row that did not match the expected version is a version conflict.
func classifyDebtorWrite(ctx context.Context, q *db.Queries, householdID, id uuid.UUID) error {
	row, err := q.GetDebtorAny(ctx, db.GetDebtorAnyParams{ID: id, HouseholdID: householdID})
	if err != nil || row.DeletedAt != nil {
		return domain.ErrDebtorNotFound
	}
	return domain.ErrDebtorVersionConflict
}

func (r *Repository) GetDebtor(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Debtor, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetDebtor"

	row, err := r.q.GetDebtor(ctx, db.GetDebtorParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrDebtorNotFound
		}
		return nil, opWrap(op, err)
	}
	return debtorFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Note,
		row.Currency,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) GetDebtors(ctx context.Context, scope domain.Scope) ([]domain.Debtor, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetDebtors"

	rows, err := r.q.GetDebtors(ctx, householdID)
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.Debtor, 0, len(rows))
	for _, row := range rows {
		out = append(
			out,
			*debtorFromFields(row.ID, row.UserID, row.Name, row.Note, row.Currency, row.CreatedAt, row.UpdatedAt, int(row.Version)),
		)
	}
	return out, nil
}

// debtorFromFields assembles a domain.Debtor; the debtor queries return
// structurally-identical generated Row types, so the construction is
// centralized here.
func debtorFromFields(
	id, userID uuid.UUID,
	name, note, currency string,
	createdAt, updatedAt time.Time,
	version int,
) *domain.Debtor {
	return &domain.Debtor{
		ID:        id,
		UserID:    userID,
		Name:      name,
		Note:      note,
		Currency:  currency,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
		Version:   version,
	}
}
