package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// defaultListTransactionsLimit is the page size used when the caller omits one;
// the service normally sets an explicit (bounded) limit.
const defaultListTransactionsLimit = 50

// Every mutation runs inside withinLockedTx (entity write + change_log append
// in one committed transaction); deletes are tombstones. householdID scopes
// every query; actorID is the acting member whose id lands on the change_log
// row as authorship.

func (r *Repository) CreateTransaction(
	ctx context.Context,
	params domain.CreateTransactionParams,
) (*domain.Transaction, error) {
	const op = "repository.postgres.CreateTransaction"

	id := newEntityID(params.ID)
	var row db.CreateTransactionRow
	err := r.withinLockedTx(ctx, params.HouseholdID, func(q *db.Queries) error {
		var err error
		row, err = q.CreateTransaction(ctx, db.CreateTransactionParams{
			ID:            id,
			HouseholdID:   params.HouseholdID,
			UserID:        params.UserID,
			Type:          string(params.Type),
			Amount:        params.Amount,
			Description:   params.Description,
			OccurredAt:    params.OccurredAt,
			AccountID:     params.AccountID,
			CategoryID:    params.CategoryID,
			FromAccountID: params.FromAccountID,
			ToAccountID:   params.ToAccountID,
		})
		if err != nil {
			if pgUniqueViolation(err) {
				return domain.ErrTransactionAlreadyExists
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			params.HouseholdID,
			params.UserID,
			row.ID,
			domain.SyncEntityTransaction,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return transactionFromFields(
		row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
		row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, nil,
	), nil
}

func (r *Repository) UpdateTransaction(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateTransactionParams,
) (*domain.Transaction, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.UpdateTransaction"

	var row db.UpdateTransactionRow
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		var err error
		row, err = q.UpdateTransaction(ctx, db.UpdateTransactionParams{
			ID:            id,
			HouseholdID:   householdID,
			Version:       int32(params.Version), //nolint:gosec // optimistic version is a small positive int
			Amount:        params.Amount,
			Description:   params.Description,
			OccurredAt:    params.OccurredAt,
			AccountID:     params.AccountID,
			CategoryID:    params.CategoryID,
			FromAccountID: params.FromAccountID,
			ToAccountID:   params.ToAccountID,
		})
		if err != nil {
			if errNoRows(err) {
				return classifyTransactionWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			row.ID,
			domain.SyncEntityTransaction,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return transactionFromFields(
		row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
		row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, nil,
	), nil
}

func (r *Repository) DeleteTransaction(ctx context.Context, scope domain.Scope, id uuid.UUID) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeleteTransaction"

	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		version, err := q.SoftDeleteTransaction(ctx, db.SoftDeleteTransactionParams{ID: id, HouseholdID: householdID})
		if err != nil {
			if errNoRows(err) {
				return classifyTransactionWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			id,
			domain.SyncEntityTransaction,
			domain.SyncChangeTombstone,
			int(version),
		)
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// classifyTransactionWrite distinguishes the zero-row outcomes of a CAS write:
// tombstoned reads as not-found for the REST surface (delete is idempotent at
// the sync layer instead), a live version mismatch is a version conflict.
func classifyTransactionWrite(ctx context.Context, q *db.Queries, householdID, id uuid.UUID) error {
	row, err := q.GetTransactionAny(ctx, db.GetTransactionAnyParams{ID: id, HouseholdID: householdID})
	if err != nil || row.DeletedAt != nil {
		return domain.ErrTransactionNotFound
	}
	return domain.ErrTransactionVersionConflict
}

func (r *Repository) GetTransaction(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Transaction, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetTransaction"

	row, err := r.q.GetTransaction(ctx, db.GetTransactionParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrTransactionNotFound
		}
		return nil, opWrap(op, err)
	}
	return transactionFromFields(
		row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
		row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, nil,
	), nil
}

func (r *Repository) GetTransactions(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetTransactionsParams,
) ([]domain.Transaction, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetTransactions"

	var typ *string
	if params.Type != nil {
		s := string(*params.Type)
		typ = &s
	}

	limit := int32(defaultListTransactionsLimit) // default; the service always sets an explicit fetchLimit.
	if params.Limit != nil {
		limit = int32(*params.Limit) //nolint:gosec // page limit is bounded by the service (<= maxTransactionPageSize)
	}

	qparams := db.ListTransactionsParams{
		HouseholdID: householdID,
		Type:        typ,
		Limit:       limit,
	}
	if params.AccountID != nil {
		id := *params.AccountID
		qparams.AccountID = &id
	}
	if params.CategoryID != nil {
		id := *params.CategoryID
		qparams.CategoryID = &id
	}
	if params.FromDate != nil {
		t := *params.FromDate
		qparams.FromDate = &t
	}
	if params.ToDate != nil {
		t := *params.ToDate
		qparams.ToDate = &t
	}
	if params.Cursor != nil {
		occ := params.Cursor.OccurredAt
		cid := params.Cursor.ID
		qparams.CursorOccurredAt = &occ
		qparams.CursorID = &cid
	}

	rows, err := r.q.ListTransactions(ctx, qparams)
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.Transaction, 0, len(rows))
	for _, row := range rows {
		out = append(out, *transactionFromFields(
			row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
			row.CreatedAt, row.UpdatedAt, int(row.Version),
			row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, nil,
		))
	}
	return out, nil
}

// transactionFromFields assembles a domain.Transaction; the transaction
// queries return structurally-identical generated Row types, so the
// construction is centralized here. deletedAt is non-nil only for the *Any
// reads that include tombstones.
func transactionFromFields(
	id, userID uuid.UUID,
	typ string,
	amount int64,
	description string,
	occurredAt, createdAt, updatedAt time.Time,
	version int,
	accountID, categoryID, fromAccountID, toAccountID *uuid.UUID,
	deletedAt *time.Time,
) *domain.Transaction {
	return &domain.Transaction{
		ID:            id,
		UserID:        userID,
		Type:          domain.TransactionType(typ),
		Amount:        amount,
		Description:   description,
		OccurredAt:    occurredAt,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
		Version:       version,
		AccountID:     accountID,
		CategoryID:    categoryID,
		FromAccountID: fromAccountID,
		ToAccountID:   toAccountID,
		DeletedAt:     deletedAt,
	}
}
