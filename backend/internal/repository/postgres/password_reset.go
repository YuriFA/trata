package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yurifa/trata/backend/internal/domain"
)

// CreatePasswordResetToken atomically replaces any existing reset token for the
// user with a fresh hashed one (delete + insert in a single transaction).
func (r *Repository) CreatePasswordResetToken(
	ctx context.Context,
	userID uuid.UUID,
	tokenHash string,
	expiresAt time.Time,
) error {
	const op = "repository.postgres.CreatePasswordResetToken"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM password_reset_tokens WHERE user_id = $1`, userID); err != nil {
		return opWrap(op, err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
		VALUES ($1, $2, $3)`, tokenHash, userID, expiresAt,
	); err != nil {
		return opWrap(op, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// ResetPassword atomically consumes a single-use reset token, updates the
// user's password, and revokes ALL of the user's sessions. An invalid/expired
// token -> domain.ErrPasswordResetTokenNotFound.
func (r *Repository) ResetPassword(ctx context.Context, tokenHash, passwordHash string) error {
	const op = "repository.postgres.ResetPassword"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID uuid.UUID
	err = tx.QueryRow(ctx, `
		DELETE FROM password_reset_tokens
		WHERE token_hash = $1 AND expires_at > now()
		RETURNING user_id`, tokenHash,
	).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrPasswordResetTokenNotFound
		}
		return opWrap(op, err)
	}

	if _, err := tx.Exec(
		ctx,
		`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
		passwordHash,
		userID,
	); err != nil {
		return opWrap(op, err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return opWrap(op, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}

func (r *Repository) LatestPasswordResetTokenAgeSeconds(ctx context.Context, userID uuid.UUID) (int, bool, error) {
	const op = "repository.postgres.LatestPasswordResetTokenAgeSeconds"

	age, err := r.q.LatestPasswordResetTokenAgeSeconds(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, opWrap(op, err)
	}
	return int(age), true, nil
}
