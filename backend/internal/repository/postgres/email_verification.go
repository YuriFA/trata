package postgres

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yurifa/trata/backend/internal/domain"
)

// CreateEmailVerificationCode atomically replaces any existing code for the user
// with a fresh one (delete + insert in a single transaction).
func (r *Repository) CreateEmailVerificationCode(
	ctx context.Context,
	userID uuid.UUID,
	code string,
	expiresAt time.Time,
) error {
	const op = "repository.postgres.CreateEmailVerificationCode"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM email_verification_codes WHERE user_id = $1`, userID); err != nil {
		return opWrap(op, err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO email_verification_codes (id, user_id, code, expires_at)
		VALUES ($1, $2, $3, $4)`,
		uuid.New(), userID, code, expiresAt,
	); err != nil {
		return opWrap(op, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// VerifyEmailCode atomically verifies the latest code for the user:
//   - expired code -> ErrVerificationCodeExpired (code deleted)
//   - no code      -> ErrVerificationCodeNotFound
//   - wrong code   -> ErrInvalidVerificationCode (attempts incremented; after
//     MaxVerificationAttempts the code is invalidated)
//   - correct code -> user marked email_verified_at = now(), code consumed
//
// The constant-time compare and attempt accounting live here because they are
// tightly coupled to the SQL transaction (integrity-critical, not policy).
func (r *Repository) VerifyEmailCode(ctx context.Context, userID uuid.UUID, code string) error {
	const op = "repository.postgres.VerifyEmailCode"

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		rowID    uuid.UUID
		rowCode  string
		attempts int
		expired  bool
	)
	err = tx.QueryRow(ctx, `
		SELECT id, code, attempts, (expires_at <= now()) AS expired
		FROM email_verification_codes
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 1`, userID,
	).Scan(&rowID, &rowCode, &attempts, &expired)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrVerificationCodeNotFound
		}
		return opWrap(op, err)
	}

	if expired {
		if _, err := tx.Exec(ctx, `DELETE FROM email_verification_codes WHERE id = $1`, rowID); err != nil {
			return opWrap(op, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return opWrap(op, err)
		}
		return domain.ErrVerificationCodeExpired
	}

	if subtle.ConstantTimeCompare([]byte(rowCode), []byte(code)) == 1 {
		if _, err := tx.Exec(ctx, `DELETE FROM email_verification_codes WHERE id = $1`, rowID); err != nil {
			return opWrap(op, err)
		}
		if _, err := tx.Exec(
			ctx,
			`UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`,
			userID,
		); err != nil {
			return opWrap(op, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return opWrap(op, err)
		}
		return nil
	}

	// Mismatch: increment attempts, invalidate the code at the cap.
	newAttempts := attempts + 1
	if newAttempts >= domain.MaxVerificationAttempts {
		if _, err := tx.Exec(ctx, `DELETE FROM email_verification_codes WHERE id = $1`, rowID); err != nil {
			return opWrap(op, err)
		}
	} else if _, err := tx.Exec(ctx, `UPDATE email_verification_codes SET attempts = $1 WHERE id = $2`, newAttempts, rowID); err != nil {
		return opWrap(op, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return domain.ErrInvalidVerificationCode
}

func (r *Repository) LatestVerificationCodeAgeSeconds(ctx context.Context, userID uuid.UUID) (int, bool, error) {
	const op = "repository.postgres.LatestVerificationCodeAgeSeconds"

	age, err := r.q.LatestVerificationCodeAgeSeconds(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, opWrap(op, err)
	}
	return int(age), true, nil
}
