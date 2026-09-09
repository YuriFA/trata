package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

func (r *Repository) CreateSession(ctx context.Context, params domain.CreateSessionParams) (*domain.Session, error) {
	const op = "repository.postgres.CreateSession"

	row, err := r.q.CreateSession(ctx, dbCreateSessionParams(params))
	if err != nil {
		return nil, opWrap(op, err)
	}
	return sessionFromRow(row), nil
}

func (r *Repository) GetSessionByID(ctx context.Context, id string) (*domain.Session, error) {
	const op = "repository.postgres.GetSessionByID"

	row, err := r.q.GetSessionByID(ctx, id)
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrSessionNotFound
		}
		return nil, opWrap(op, err)
	}
	return sessionFromRow(row), nil
}

func (r *Repository) DeleteSession(ctx context.Context, id string) error {
	const op = "repository.postgres.DeleteSession"

	n, err := r.q.DeleteSession(ctx, id)
	if err != nil {
		return opWrap(op, err)
	}
	if n == 0 {
		return domain.ErrSessionNotFound
	}
	return nil
}

func (r *Repository) ExtendSession(ctx context.Context, id string, newExpiresAt time.Time) error {
	const op = "repository.postgres.ExtendSession"

	n, err := r.q.ExtendSession(ctx, db.ExtendSessionParams{ID: id, ExpiresAt: newExpiresAt})
	if err != nil {
		return opWrap(op, err)
	}
	if n == 0 {
		return domain.ErrSessionNotFound
	}
	return nil
}

func (r *Repository) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	const op = "repository.postgres.DeleteExpiredSessions"

	n, err := r.q.DeleteExpiredSessions(ctx)
	if err != nil {
		return 0, opWrap(op, err)
	}
	return n, nil
}

func (r *Repository) GetSessionsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Session, error) {
	const op = "repository.postgres.GetSessionsByUser"

	rows, err := r.q.GetSessionsByUser(ctx, userID)
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.Session, 0, len(rows))
	for _, row := range rows {
		out = append(out, *sessionFromRow(row))
	}
	return out, nil
}

func (r *Repository) DeleteSessionsByUserExcept(
	ctx context.Context,
	userID uuid.UUID,
	exceptSessionID string,
) (int64, error) {
	const op = "repository.postgres.DeleteSessionsByUserExcept"

	n, err := r.q.DeleteSessionsByUserExcept(ctx, db.DeleteSessionsByUserExceptParams{
		UserID: userID,
		ID:     exceptSessionID,
	})
	if err != nil {
		return 0, opWrap(op, err)
	}
	return n, nil
}

func (r *Repository) DeleteSessionsByUser(ctx context.Context, userID uuid.UUID) (int64, error) {
	const op = "repository.postgres.DeleteSessionsByUser"

	n, err := r.q.DeleteSessionsByUser(ctx, userID)
	if err != nil {
		return 0, opWrap(op, err)
	}
	return n, nil
}

// sessionFromRow maps a generated session row to the domain session.
func sessionFromRow(row db.Session) *domain.Session {
	return &domain.Session{
		ID:        row.ID,
		UserID:    row.UserID,
		ExpiresAt: row.ExpiresAt,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

func dbCreateSessionParams(p domain.CreateSessionParams) db.CreateSessionParams {
	return db.CreateSessionParams{
		ID:        p.SessionID,
		UserID:    p.UserID,
		ExpiresAt: p.ExpiresAt,
	}
}
