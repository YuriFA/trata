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
// order equal to commit order. Deletes are tombstones guarded by the in-use
// check. householdID scopes every query; actorID is the acting member whose id
// lands on the change_log row as authorship.

func (r *Repository) CreateAccount(ctx context.Context, params domain.CreateAccountParams) (*domain.Account, error) {
	const op = "repository.postgres.CreateAccount"

	id := newEntityID(params.ID)
	var row db.CreateAccountRow
	err := r.withinLockedTx(ctx, params.HouseholdID, func(q *db.Queries) error {
		var err error
		row, err = q.CreateAccount(ctx, db.CreateAccountParams{
			ID:             id,
			HouseholdID:    params.HouseholdID,
			UserID:         params.UserID,
			Name:           params.Name,
			Currency:       params.Currency,
			OpeningBalance: params.OpeningBalance,
		})
		if err != nil {
			if pgUniqueViolation(err) {
				return domain.ErrAccountAlreadyExists
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			params.HouseholdID,
			params.UserID,
			row.ID,
			domain.SyncEntityAccount,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return accountRow(
		row.ID, row.UserID, row.Name, row.Currency,
		row.OpeningBalance, row.Balance, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) UpdateAccount(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateAccountParams,
) (*domain.Account, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.UpdateAccount"

	var row db.UpdateAccountRow
	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		var err error
		row, err = q.UpdateAccount(ctx, db.UpdateAccountParams{
			ID:          id,
			HouseholdID: householdID,
			Name:        params.Name,
			Version:     int32(params.Version), //nolint:gosec // optimistic version is a small positive int
		})
		if err != nil {
			if errNoRows(err) {
				return classifyAccountWrite(ctx, q, householdID, id)
			}
			return err
		}
		return appendChangeLog(
			ctx,
			q,
			householdID,
			actorID,
			row.ID,
			domain.SyncEntityAccount,
			domain.SyncChangeUpsert,
			int(row.Version),
		)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return accountRow(
		row.ID, row.UserID, row.Name, row.Currency,
		row.OpeningBalance, row.Balance, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) DeleteAccount(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) error {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.DeleteAccount"

	// Same rule as service.ValidateAccountDelete (ADR-0005), enforced here
	// inside the locked transaction for REST atomicity.

	err := r.withinLockedTx(ctx, householdID, func(q *db.Queries) error {
		inUse, err := q.HasLiveTransactionsForAccount(ctx, db.HasLiveTransactionsForAccountParams{
			HouseholdID: householdID,
			AccountID:   &id,
		})
		if err != nil {
			return err
		}
		if inUse {
			return domain.ErrAccountHasTransactions
		}
		plansInUse, err := q.HasLivePlannedPaymentsForAccount(ctx, db.HasLivePlannedPaymentsForAccountParams{
			HouseholdID: householdID,
			AccountID:   id,
		})
		if err != nil {
			return err
		}
		if plansInUse {
			return domain.ErrAccountHasPlannedPayments
		}
		version, err := q.SoftDeleteAccount(ctx, db.SoftDeleteAccountParams{ID: id, HouseholdID: householdID})
		if err != nil {
			if errNoRows(err) {
				return classifyAccountWrite(ctx, q, householdID, id)
			}
			return err
		}
		if err := appendChangeLog(
			ctx, q, householdID, actorID, id, domain.SyncEntityAccount, domain.SyncChangeTombstone, int(version),
		); err != nil {
			return err
		}
		// The cascade half: the account's live adjustments are absorbed by
		// the delete (each with its own change_log row, invariants #17-#18).
		adjustments, err := q.SoftDeleteAdjustmentsForAccount(
			ctx, db.SoftDeleteAdjustmentsForAccountParams{HouseholdID: householdID, AccountID: &id},
		)
		if err != nil {
			return err
		}
		for _, adj := range adjustments {
			err := appendChangeLog(
				ctx, q, householdID, actorID, adj.ID,
				domain.SyncEntityTransaction, domain.SyncChangeTombstone, int(adj.Version),
			)
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return opWrap(op, err)
	}
	return nil
}

// classifyAccountWrite distinguishes the zero-row outcomes of a CAS write for
// the REST surface: never-existed and tombstoned both read as not-found, a
// live row that did not match the expected version is a version conflict.
func classifyAccountWrite(ctx context.Context, q *db.Queries, householdID, id uuid.UUID) error {
	row, err := q.GetAccountAny(ctx, db.GetAccountAnyParams{ID: id, HouseholdID: householdID})
	if err != nil || row.DeletedAt != nil {
		return domain.ErrAccountNotFound
	}
	return domain.ErrAccountVersionConflict
}

func (r *Repository) GetAccount(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetAccount"

	row, err := r.q.GetAccount(ctx, db.GetAccountParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrAccountNotFound
		}
		return nil, opWrap(op, err)
	}
	return accountRow(
		row.ID, row.UserID, row.Name, row.Currency,
		row.OpeningBalance, row.Balance, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (r *Repository) GetAccounts(ctx context.Context, scope domain.Scope) ([]domain.Account, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetAccounts"

	rows, err := r.q.GetAccounts(ctx, householdID)
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.Account, 0, len(rows))
	for _, row := range rows {
		out = append(
			out,
			*accountRow(row.ID, row.UserID, row.Name, row.Currency, row.OpeningBalance, row.Balance, row.CreatedAt, row.UpdatedAt, int(row.Version)),
		)
	}
	return out, nil
}

// accountRow assembles a domain.Account from its fields. The account SELECT
// queries return structurally-identical generated Row types (they differ only
// in name), so the construction is centralized here.
func accountRow(
	id, userID uuid.UUID,
	name, currency string,
	openingBalance, balance int64,
	createdAt, updatedAt time.Time,
	version int,
) *domain.Account {
	return &domain.Account{
		ID:             id,
		UserID:         userID,
		Name:           name,
		Currency:       currency,
		OpeningBalance: openingBalance,
		Balance:        balance,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
		Version:        version,
	}
}
