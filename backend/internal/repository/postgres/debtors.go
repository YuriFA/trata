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
// order equal to commit order. Deletes are cascading tombstones: the debtor
// and every live debt operation are tombstoned together (each with its own
// change_log row); live-name uniqueness is enforced by the per-household
// partial unique index. householdID scopes every query; actorID is the acting
// member whose id lands on the change_log row as authorship.

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
		row.Currency,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	), nil
}

func (r *Repository) DeleteDebtor(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeleteDebtor"

	// A debt is its ledger and its name: deleting the debtor tombstones its
	// live operations in the same transaction (no in-use guard).
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		_, err := cascadeDeleteDebtor(ctx, q, householdID, actorID, id)
		return err
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// cascadeDeleteDebtor tombstones the debtor together with every live debt
// operation on the caller's transaction: the debtor row is locked FOR UPDATE,
// each live operation is tombstoned (deleted_at = now(), version = version +
// 1) with its own change_log row, then the debtor follows; every change-log
// tombstone carries the record's new version (change-log atomicity
// invariant). Never-existed and already-tombstoned debtors both read as
// not-found. Returns the debtor's new (post-tombstone) version. Shared
// verbatim by the REST delete and the sync batch tombstone.
func cascadeDeleteDebtor(
	ctx context.Context,
	q *db.Queries,
	householdID, actorID, id uuid.UUID,
) (int, error) {
	deletedAt, err := q.LockDebtorForDelete(
		ctx, db.LockDebtorForDeleteParams{ID: id, HouseholdID: householdID},
	)
	if err != nil {
		if errNoRows(err) {
			return 0, domain.ErrDebtorNotFound
		}
		return 0, err
	}
	if deletedAt != nil {
		return 0, domain.ErrDebtorNotFound
	}
	operations, err := q.SoftDeleteDebtOperationsForDebtor(
		ctx,
		db.SoftDeleteDebtOperationsForDebtorParams{HouseholdID: householdID, DebtorID: id},
	)
	if err != nil {
		return 0, err
	}
	for _, operation := range operations {
		if err := appendChangeLog(
			ctx, q, householdID, actorID, operation.ID,
			domain.SyncEntityDebtOperation, domain.SyncChangeTombstone, int(operation.Version),
		); err != nil {
			return 0, err
		}
	}
	version, err := q.SoftDeleteDebtor(
		ctx,
		db.SoftDeleteDebtorParams{ID: id, HouseholdID: householdID},
	)
	if err != nil {
		return 0, err
	}
	if err := appendChangeLog(
		ctx, q, householdID, actorID, id,
		domain.SyncEntityDebtor, domain.SyncChangeTombstone, int(version),
	); err != nil {
		return 0, err
	}
	return int(version), nil
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
			*debtorFromFields(row.ID, row.UserID, row.Name, row.Currency, row.CreatedAt, row.UpdatedAt, int(row.Version)),
		)
	}
	return out, nil
}

// debtorFromFields assembles a domain.Debtor; the debtor queries return
// structurally-identical generated Row types, so the construction is
// centralized here.
func debtorFromFields(
	id, userID uuid.UUID,
	name, currency string,
	createdAt, updatedAt time.Time,
	version int,
) *domain.Debtor {
	return &domain.Debtor{
		ID:        id,
		UserID:    userID,
		Name:      name,
		Currency:  currency,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
		Version:   version,
	}
}
