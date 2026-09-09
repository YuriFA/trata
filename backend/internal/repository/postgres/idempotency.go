package postgres

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

func (r *Repository) CreateIdempotencyKey(
	ctx context.Context,
	params domain.CreateIdempotencyKeyParams,
) (*domain.IdempotencyKey, error) {
	const op = "repository.postgres.CreateIdempotencyKey"

	row, err := r.q.CreateIdempotencyKey(ctx, db.CreateIdempotencyKeyParams{
		IdempotencyKey: params.IdempotencyKey,
		UserID:         params.UserID,
		RequestHash:    params.RequestHash,
		ExpiresAt:      params.ExpiresAt,
	})
	if err != nil {
		if pgUniqueViolation(err) {
			return nil, domain.ErrIdempotencyKeyInUse
		}
		return nil, opWrap(op, err)
	}
	return idempotencyFromRow(row), nil
}

func (r *Repository) UpdateIdempotencyKey(
	ctx context.Context,
	userID, id uuid.UUID,
	params domain.UpdateIdempotencyKeyParams,
) (*domain.IdempotencyKey, error) {
	const op = "repository.postgres.UpdateIdempotencyKey"

	var respStatus *int32
	if params.ResponseStatus != nil {
		v := int32(*params.ResponseStatus) //nolint:gosec // HTTP status code, always < 600
		respStatus = &v
	}

	row, err := r.q.UpdateIdempotencyKey(ctx, db.UpdateIdempotencyKeyParams{
		ID:              id,
		UserID:          userID,
		Status:          params.Status,
		ResponseStatus:  respStatus,
		ResponseHeaders: params.ResponseHeaders,
		ResponseBody:    params.ResponseBody,
	})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrIdempotencyKeyNotFound
		}
		return nil, opWrap(op, err)
	}
	return idempotencyFromRow(row), nil
}

func (r *Repository) GetByUserAndKey(
	ctx context.Context,
	userID uuid.UUID,
	key string,
) (*domain.IdempotencyKey, error) {
	const op = "repository.postgres.GetByUserAndKey"

	row, err := r.q.GetIdempotencyByUserAndKey(ctx, db.GetIdempotencyByUserAndKeyParams{
		UserID:         userID,
		IdempotencyKey: key,
	})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrIdempotencyKeyNotFound
		}
		return nil, opWrap(op, err)
	}
	return idempotencyFromRow(row), nil
}

func (r *Repository) DeleteIdempotencyKey(ctx context.Context, userID, id uuid.UUID) error {
	const op = "repository.postgres.DeleteIdempotencyKey"

	if _, err := r.q.DeleteIdempotencyKey(ctx, db.DeleteIdempotencyKeyParams{ID: id, UserID: userID}); err != nil {
		return opWrap(op, err)
	}
	return nil
}

func (r *Repository) DeleteExpiredIdempotencyKeys(ctx context.Context) (int64, error) {
	const op = "repository.postgres.DeleteExpiredIdempotencyKeys"

	n, err := r.q.DeleteExpiredIdempotencyKeys(ctx)
	if err != nil {
		return 0, opWrap(op, err)
	}
	return n, nil
}

func idempotencyFromRow(row db.IdempotencyKey) *domain.IdempotencyKey {
	var status *int
	if row.ResponseStatus != nil {
		v := int(*row.ResponseStatus)
		status = &v
	}
	return &domain.IdempotencyKey{
		ID:              row.ID,
		IdempotencyKey:  row.IdempotencyKey,
		UserID:          row.UserID,
		RequestHash:     row.RequestHash,
		Status:          row.Status,
		ResponseStatus:  status,
		ResponseHeaders: row.ResponseHeaders,
		ResponseBody:    row.ResponseBody,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
		ExpiresAt:       row.ExpiresAt,
	}
}
