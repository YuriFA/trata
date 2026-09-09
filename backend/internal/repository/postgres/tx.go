package postgres

import (
	"context"

	"github.com/google/uuid"

	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// withinLockedTx runs fn inside ONE database transaction that holds the
// household's change-log advisory lock from start to commit. Every REST
// mutation (entity write + change_log append) and every sync push batch goes
// through here, so a mutation is never committed without its change-log row
// and a household's change_log seq order equals commit-visibility order.
func (r *Repository) withinLockedTx(ctx context.Context, householdID uuid.UUID, fn func(q *db.Queries) error) error {
	const op = "repository.postgres.withinLockedTx"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := r.q.WithTx(tx)
	if err := q.LockHouseholdChanges(ctx, householdID.String()); err != nil {
		return opWrap(op, err)
	}
	if err := fn(q); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// appendChangeLog writes the change-log row for a committed mutation. Callers
// MUST be inside withinLockedTx (the advisory lock orders the seq allocation).
// actorID is the member performing the mutation (authorship of the change).
func appendChangeLog(
	ctx context.Context,
	q *db.Queries,
	householdID, actorID, entityID uuid.UUID,
	entity, action string,
	version int,
) error {
	_, err := q.AppendChangeLog(ctx, db.AppendChangeLogParams{
		HouseholdID: householdID,
		UserID:      actorID,
		Entity:      entity,
		EntityID:    entityID,
		Action:      action,
		Version:     int32(version), //nolint:gosec // entity versions are small positive ints
	})
	return err
}

// newEntityID returns the client-supplied id when present, else a fresh UUID.
func newEntityID(id uuid.UUID) uuid.UUID {
	if id == uuid.Nil {
		return uuid.New()
	}
	return id
}
