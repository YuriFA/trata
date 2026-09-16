package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// syncTx implements repository.SyncTx over the open batch transaction.
type syncTx struct {
	q  *db.Queries
	tx pgx.Tx
}

// Compile-time guarantee.
var _ repository.SyncTx = (*syncTx)(nil)

func (r *Repository) WithinHouseholdTx(
	ctx context.Context,
	scope domain.Scope,
	fn func(t repository.SyncTx) error,
) error {
	householdID := scope.HouseholdID
	const op = "repository.postgres.WithinHouseholdTx"

	// Same shape as withinLockedTx (tx + per-household advisory lock + fn +
	// commit) but hands the syncTx both the sqlc Queries and the raw pgx.Tx
	// (AdoptOrphanedID runs table-polymorphic SQL the generated layer has no
	// method for).
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return opWrap(op, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := r.q.WithTx(tx)
	if err := q.LockHouseholdChanges(ctx, householdID.String()); err != nil {
		return opWrap(op, err)
	}
	if err := fn(&syncTx{q: q, tx: tx}); err != nil {
		return opWrap(op, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// syncEntityTables maps the wire entity kinds to their tables for
// AdoptOrphanedID's polymorphic SQL.
//
//nolint:gochecknoglobals // immutable lookup table; the idiomatic home for constant dispatch data
var syncEntityTables = map[string]string{
	domain.SyncEntityAccount:        "accounts",
	domain.SyncEntityCategory:       "categories",
	domain.SyncEntityTransaction:    "transactions",
	domain.SyncEntityDebtor:         "debtors",
	domain.SyncEntityDebtOperation:  "debt_operations",
	domain.SyncEntityPlannedPayment: "planned_payments",
}

// AdoptOrphanedID implements the household-join union semantics (design
// D3/D4) for base-0 creates whose id exists in ANOTHER household: ids are
// globally unique (PK), so the create can only land when the id's current
// household is orphaned - no members left, i.e. the pusher's former personal
// household after a join swap. The orphaned row is deleted in this
// transaction and the caller's create re-inserts it (same id, new household,
// pushed state). A row in a still-live household is never stolen: its state
// is returned as an already-exists conflict.
func (t *syncTx) AdoptOrphanedID(
	ctx context.Context,
	entity string,
	entityID uuid.UUID, scope domain.Scope,
) (*domain.SyncServerState, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.AdoptOrphanedID"

	table, ok := syncEntityTables[entity]
	if !ok {
		return nil, opWrap(op, domain.ErrUnknownSyncEntity)
	}

	var owner uuid.UUID
	var version int32
	var deletedAt *time.Time
	err := t.tx.QueryRow(ctx, `
		SELECT household_id, version, deleted_at FROM `+table+` WHERE id = $1`,
		entityID,
	).Scan(&owner, &version, &deletedAt)
	if err != nil {
		if errNoRows(err) {
			// The id is free everywhere - a plain create.
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
		}
		return nil, opWrap(op, err)
	}
	if owner == householdID {
		// Same household: the caller's household-scoped read governs.
		return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
	}

	// A household that still has members keeps its records; the pusher's
	// create reports already-exists with the live row's state.
	var hasMembers bool
	if err := t.tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM household_members WHERE household_id = $1)`,
		owner,
	).Scan(&hasMembers); err != nil {
		return nil, opWrap(op, err)
	}
	if hasMembers {
		return &domain.SyncServerState{
			Version: int(version),
			Deleted: deletedAt != nil,
		}, nil
	}

	// Orphaned: drop the row so the caller's create re-inserts it here. No
	// member can observe the disappearance (the household has none), and the
	// new household's change_log will carry the record from its create.
	if _, err := t.tx.Exec(ctx, `
		DELETE FROM `+table+` WHERE id = $1 AND household_id = $2`,
		entityID, owner,
	); err != nil {
		return nil, opWrap(op, err)
	}
	return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
}

// --- applied_operations -----------------------------------------------------

func (t *syncTx) GetAppliedOperation(
	ctx context.Context,
	scope domain.Scope, opID uuid.UUID,
) (*domain.AppliedOperation, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetAppliedOperation"

	row, err := t.q.GetAppliedOperation(
		ctx,
		db.GetAppliedOperationParams{HouseholdID: householdID, OpID: opID},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	var result domain.SyncPushResult
	if err := json.Unmarshal(row.Result, &result); err != nil {
		return nil, opWrap(op, err)
	}
	return &domain.AppliedOperation{
		OpID:        row.OpID,
		HouseholdID: householdID,
		UserID:      row.UserID,
		Entity:      row.Entity,
		EntityID:    row.EntityID,
		Result:      result,
		AppliedAt:   row.AppliedAt,
	}, nil
}

func (t *syncTx) InsertAppliedOperation(ctx context.Context, rec domain.AppliedOperation) error {
	const op = "repository.postgres.syncTx.InsertAppliedOperation"

	raw, err := json.Marshal(rec.Result)
	if err != nil {
		return opWrap(op, err)
	}
	if err := t.q.InsertAppliedOperation(ctx, db.InsertAppliedOperationParams{
		OpID:        rec.OpID,
		HouseholdID: rec.HouseholdID,
		UserID:      rec.UserID,
		Entity:      rec.Entity,
		EntityID:    rec.EntityID,
		Result:      raw,
	}); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// --- reads (incl. tombstones) -------------------------------------------------

func (t *syncTx) GetAccountAny(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Account, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetAccountAny"

	row, err := t.q.GetAccountAny(ctx, db.GetAccountAnyParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	return &domain.Account{
		ID:             row.ID,
		UserID:         row.UserID,
		Name:           row.Name,
		Currency:       row.Currency,
		OpeningBalance: row.OpeningBalance,
		Balance:        row.Balance,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		Version:        int(row.Version),
		DeletedAt:      row.DeletedAt,
	}, nil
}

func (t *syncTx) GetCategoryAny(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Category, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetCategoryAny"

	row, err := t.q.GetCategoryAny(ctx, db.GetCategoryAnyParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	return &domain.Category{
		ID:         row.ID,
		UserID:     row.UserID,
		Name:       row.Name,
		Type:       domain.TransactionType(row.Type),
		Icon:       row.Icon,
		Color:      row.Color,
		ArchivedAt: row.ArchivedAt,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
		Version:    int(row.Version),
		DeletedAt:  row.DeletedAt,
	}, nil
}

func (t *syncTx) GetTransactionAny(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Transaction, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetTransactionAny"

	row, err := t.q.GetTransactionAny(
		ctx,
		db.GetTransactionAnyParams{ID: id, HouseholdID: householdID},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	return transactionFromFields(
		row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
		row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, row.DeletedAt,
	), nil
}

func (t *syncTx) GetDebtorAny(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Debtor, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetDebtorAny"

	row, err := t.q.GetDebtorAny(ctx, db.GetDebtorAnyParams{ID: id, HouseholdID: householdID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	d := debtorFromFields(
		row.ID,
		row.UserID,
		row.Name,
		row.Currency,
		row.CreatedAt,
		row.UpdatedAt,
		int(row.Version),
	)
	d.DeletedAt = row.DeletedAt
	return d, nil
}

func (t *syncTx) GetDebtOperationAny(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.DebtOperation, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetDebtOperationAny"

	row, err := t.q.GetDebtOperationAny(
		ctx,
		db.GetDebtOperationAnyParams{ID: id, HouseholdID: householdID},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	op2 := debtOperationFromFields(
		row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
		row.Amount, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
	)
	op2.DeletedAt = row.DeletedAt
	return op2, nil
}

func (t *syncTx) GetPlannedPaymentAny(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.GetPlannedPaymentAny"

	row, err := t.q.GetPlannedPaymentAny(
		ctx,
		db.GetPlannedPaymentAnyParams{ID: id, HouseholdID: householdID},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil //nolint:nilnil // (nil, nil) is the documented "never created" signal
		}
		return nil, opWrap(op, err)
	}
	p := plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	)
	p.DeletedAt = row.DeletedAt
	return p, nil
}

// --- live reads ----------------------------------------------------------------

func (t *syncTx) LiveAccountExists(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (bool, error) {
	const op = "repository.postgres.syncTx.LiveAccountExists"

	a, err := t.GetAccountAny(ctx, scope, id)
	if err != nil {
		return false, opWrap(op, err)
	}
	return a != nil && !a.Deleted(), nil
}

// LiveAccountCurrency returns the live account's currency (the cross-currency
// transfer rule reads it); a tombstoned or missing account reads as
// ErrTransactionAccountNotFound.
func (t *syncTx) LiveAccountCurrency(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (string, error) {
	const op = "repository.postgres.syncTx.LiveAccountCurrency"

	a, err := t.GetAccountAny(ctx, scope, id)
	if err != nil {
		return "", opWrap(op, err)
	}
	if a == nil || a.Deleted() {
		return "", domain.ErrTransactionAccountNotFound
	}
	return a.Currency, nil
}

func (t *syncTx) LiveCategory(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (*domain.Category, error) {
	const op = "repository.postgres.syncTx.LiveCategory"

	c, err := t.GetCategoryAny(ctx, scope, id)
	if err != nil {
		return nil, opWrap(op, err)
	}
	if c == nil || c.Deleted() {
		return nil, domain.ErrCategoryNotFound
	}
	return c, nil
}

func (t *syncTx) CategoryNameTaken(
	ctx context.Context,
	scope domain.Scope,
	name string,
	exceptID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.CategoryNameTaken"

	taken, err := t.q.CategoryNameTaken(ctx, db.CategoryNameTakenParams{
		HouseholdID: householdID,
		Name:        name,
		ExceptID:    exceptID,
	})
	if err != nil {
		return false, opWrap(op, err)
	}
	return taken, nil
}

func (t *syncTx) HasLiveTransactionsForAccount(
	ctx context.Context,
	scope domain.Scope,
	accountID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.HasLiveTransactionsForAccount"

	inUse, err := t.q.HasLiveTransactionsForAccount(ctx, db.HasLiveTransactionsForAccountParams{
		HouseholdID: householdID,
		AccountID:   &accountID,
	})
	if err != nil {
		return false, opWrap(op, err)
	}
	return inUse, nil
}

func (t *syncTx) HasLiveTransactionsForCategory(
	ctx context.Context,
	scope domain.Scope,
	categoryID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.HasLiveTransactionsForCategory"

	inUse, err := t.q.HasLiveTransactionsForCategory(ctx, db.HasLiveTransactionsForCategoryParams{
		HouseholdID: householdID,
		CategoryID:  &categoryID,
	})
	if err != nil {
		return false, opWrap(op, err)
	}
	return inUse, nil
}

func (t *syncTx) LiveDebtorExists(
	ctx context.Context,
	scope domain.Scope,
	id uuid.UUID,
) (bool, error) {
	const op = "repository.postgres.syncTx.LiveDebtorExists"

	d, err := t.GetDebtorAny(ctx, scope, id)
	if err != nil {
		return false, opWrap(op, err)
	}
	return d != nil && !d.Deleted(), nil
}

func (t *syncTx) DebtorNameTaken(
	ctx context.Context,
	scope domain.Scope,
	name string,
	exceptID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.DebtorNameTaken"

	taken, err := t.q.DebtorNameTaken(ctx, db.DebtorNameTakenParams{
		HouseholdID: householdID,
		Name:        name,
		ExceptID:    exceptID,
	})
	if err != nil {
		return false, opWrap(op, err)
	}
	return taken, nil
}

func (t *syncTx) HasLivePlannedPaymentsForAccount(
	ctx context.Context,
	scope domain.Scope,
	accountID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.HasLivePlannedPaymentsForAccount"

	inUse, err := t.q.HasLivePlannedPaymentsForAccount(
		ctx,
		db.HasLivePlannedPaymentsForAccountParams{
			HouseholdID: householdID,
			AccountID:   accountID,
		},
	)
	if err != nil {
		return false, opWrap(op, err)
	}
	return inUse, nil
}

func (t *syncTx) HasLivePlannedPaymentsForCategory(
	ctx context.Context,
	scope domain.Scope, categoryID uuid.UUID,
) (bool, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.HasLivePlannedPaymentsForCategory"

	inUse, err := t.q.HasLivePlannedPaymentsForCategory(
		ctx,
		db.HasLivePlannedPaymentsForCategoryParams{
			HouseholdID: householdID,
			CategoryID:  categoryID,
		},
	)
	if err != nil {
		return false, opWrap(op, err)
	}
	return inUse, nil
}

// DueAutoPlannedPayments is the auto-confirm job's due scan, run inside the
// same locked tx that will create the payments and advance the plans.
func (t *syncTx) DueAutoPlannedPayments(
	ctx context.Context,
	scope domain.Scope,
	today time.Time,
) ([]domain.PlannedPayment, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.syncTx.DueAutoPlannedPayments"

	rows, err := t.q.DueAutoPlannedPayments(
		ctx,
		db.DueAutoPlannedPaymentsParams{HouseholdID: householdID, Today: today},
	)
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.PlannedPayment, 0, len(rows))
	for _, row := range rows {
		out = append(out, *plannedPaymentFromRow(
			row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
			row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
			row.CreatedAt, row.UpdatedAt, int(row.Version),
		))
	}
	return out, nil
}

// --- writes (each appends change_log on the same tx) -----------------------------

func (t *syncTx) CreateAccount(
	ctx context.Context,
	params domain.CreateAccountParams,
) (*domain.Account, error) {
	const op = "repository.postgres.syncTx.CreateAccount"

	row, err := t.q.CreateAccount(ctx, db.CreateAccountParams{
		ID:             newEntityID(params.ID),
		HouseholdID:    params.HouseholdID,
		UserID:         params.UserID,
		Name:           params.Name,
		Currency:       params.Currency,
		OpeningBalance: params.OpeningBalance,
	})
	if err != nil {
		return nil, classifyInsertErr(op, err, domain.ErrAccountAlreadyExists)
	}
	if err := appendChangeLog(
		ctx, t.q, params.HouseholdID, params.UserID, row.ID,
		domain.SyncEntityAccount, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return accountRow(
		row.ID, row.UserID, row.Name, row.Currency,
		row.OpeningBalance, row.Balance, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (t *syncTx) ReplaceAccount(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.AccountFullState,
) (*domain.Account, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.ReplaceAccount"

	row, err := t.q.SyncReplaceAccount(ctx, db.SyncReplaceAccountParams{
		ID:             id,
		HouseholdID:    householdID,
		Name:           st.Name,
		Currency:       st.Currency,
		OpeningBalance: st.OpeningBalance,
		BaseVersion:    int32(baseVersion), //nolint:gosec // server versions are small positive ints
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			current, cerr := t.q.GetAccountAny(
				ctx,
				db.GetAccountAnyParams{ID: id, HouseholdID: householdID},
			)
			return nil, classifySyncWrite(
				cerr,
				current.DeletedAt != nil,
				domain.ErrAccountNotFound,
				domain.ErrAccountVersionConflict,
			)
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityAccount, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return accountRow(
		row.ID, row.UserID, row.Name, row.Currency,
		row.OpeningBalance, row.Balance, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

// tombstoneEntity is the shared tombstone protocol behind the Tombstone*
// wrappers: CAS soft-delete, classify absent (not found) vs
// already-tombstoned (idempotent delete, stored row back), append the
// change_log row, synthesize the tombstoned result. What differs per
// entity — the sqlc call, the tombstone-inclusive re-read, the not-found
// sentinel, the sync entity const, the result constructor — arrives as
// funcs (Go methods cannot carry their own type parameters).
func tombstoneEntity[T any](
	ctx context.Context,
	q *db.Queries,
	scope domain.Scope,
	id uuid.UUID,
	op string,
	softDelete func() (int32, error),
	getAny func() (*T, error),
	notFound error,
	entity string,
	build func(version int32) *T,
) (*T, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID

	version, err := softDelete()
	if err != nil { //nolint:nestif // classify absent vs already-tombstoned (idempotent delete)
		if errors.Is(err, pgx.ErrNoRows) {
			current, err := getAny()
			if err != nil {
				return nil, opWrap(op, err)
			}
			if current == nil {
				return nil, notFound
			}
			return current, nil // already tombstoned: idempotent delete
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, q, householdID, actorID, id, entity, domain.SyncChangeTombstone, int(version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return build(version), nil
}

// TombstoneAccount deletes the account and absorbs its live adjustments:
// each tombstoned adjustment gets its own change_log row on the batch
// transaction (invariants #17-#18), mirroring the REST DeleteAccount.
func (t *syncTx) TombstoneAccount(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Account, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	account, err := tombstoneEntity(ctx, t.q, scope, id,
		"repository.postgres.syncTx.TombstoneAccount",
		func() (int32, error) {
			return t.q.SoftDeleteAccount(
				ctx,
				db.SoftDeleteAccountParams{ID: id, HouseholdID: scope.HouseholdID},
			)
		},
		func() (*domain.Account, error) { return t.GetAccountAny(ctx, scope, id) },
		domain.ErrAccountNotFound,
		domain.SyncEntityAccount,
		func(version int32) *domain.Account {
			now := time.Now().UTC()
			return &domain.Account{
				ID:        id,
				UserID:    scope.ActorID,
				Version:   int(version),
				DeletedAt: &now,
			}
		},
	)
	if err != nil {
		return nil, err
	}
	adjustments, err := t.q.SoftDeleteAdjustmentsForAccount(
		ctx, db.SoftDeleteAdjustmentsForAccountParams{HouseholdID: householdID, AccountID: &id},
	)
	if err != nil {
		const op = "repository.postgres.syncTx.TombstoneAccount"
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	for _, adj := range adjustments {
		if err := appendChangeLog(
			ctx, t.q, householdID, actorID, adj.ID,
			domain.SyncEntityTransaction, domain.SyncChangeTombstone, int(adj.Version),
		); err != nil {
			const op = "repository.postgres.syncTx.TombstoneAccount"
			return nil, fmt.Errorf("%s: %w", op, err)
		}
	}
	return account, nil
}

func (t *syncTx) CreateCategory(
	ctx context.Context,
	params domain.CreateCategoryParams,
) (*domain.Category, error) {
	const op = "repository.postgres.syncTx.CreateCategory"

	row, err := t.q.CreateCategory(ctx, db.CreateCategoryParams{
		ID:          newEntityID(params.ID),
		HouseholdID: params.HouseholdID,
		UserID:      params.UserID,
		Name:        params.Name,
		Type:        string(params.Type),
		Icon:        params.Icon,
		Color:       params.Color,
		ArchivedAt:  params.ArchivedAt,
	})
	if err != nil {
		return nil, classifyInsertErr(op, err, domain.ErrCategoryAlreadyExists)
	}
	if err := appendChangeLog(
		ctx, t.q, params.HouseholdID, params.UserID, row.ID,
		domain.SyncEntityCategory, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return &domain.Category{
		ID: row.ID, UserID: row.UserID, Name: row.Name,
		Type: domain.TransactionType(row.Type), Icon: row.Icon, Color: row.Color,
		ArchivedAt: row.ArchivedAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Version: int(row.Version),
	}, nil
}

func (t *syncTx) ReplaceCategory(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.CategoryFullState,
) (*domain.Category, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.ReplaceCategory"

	row, err := t.q.SyncReplaceCategory(ctx, db.SyncReplaceCategoryParams{
		ID:          id,
		HouseholdID: householdID,
		Name:        st.Name,
		Type:        string(st.Type),
		Icon:        st.Icon,
		Color:       st.Color,
		ArchivedAt:  st.ArchivedAt,
		BaseVersion: int32(baseVersion), //nolint:gosec // server versions are small positive ints
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			current, cerr := t.q.GetCategoryAny(
				ctx,
				db.GetCategoryAnyParams{ID: id, HouseholdID: householdID},
			)
			return nil, classifySyncWrite(
				cerr,
				current.DeletedAt != nil,
				domain.ErrCategoryNotFound,
				domain.ErrCategoryVersionConflict,
			)
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityCategory, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return &domain.Category{
		ID: row.ID, UserID: row.UserID, Name: row.Name,
		Type: domain.TransactionType(row.Type), Icon: row.Icon, Color: row.Color,
		ArchivedAt: row.ArchivedAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Version: int(row.Version),
	}, nil
}

func (t *syncTx) TombstoneCategory(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	return tombstoneEntity(ctx, t.q, scope, id,
		"repository.postgres.syncTx.TombstoneCategory",
		func() (int32, error) {
			return t.q.SoftDeleteCategory(
				ctx,
				db.SoftDeleteCategoryParams{ID: id, HouseholdID: scope.HouseholdID},
			)
		},
		func() (*domain.Category, error) { return t.GetCategoryAny(ctx, scope, id) },
		domain.ErrCategoryNotFound,
		domain.SyncEntityCategory,
		func(version int32) *domain.Category {
			now := time.Now().UTC()
			return &domain.Category{
				ID:        id,
				UserID:    scope.ActorID,
				Version:   int(version),
				DeletedAt: &now,
			}
		},
	)
}

// CascadeTombstoneCategory is the cascade-flagged category delete: the
// category tombstone plus one tombstone per live referencing transaction,
// each with its change_log row, all on the batch transaction (invariants
// #17-#18). Balances recompute implicitly (they are derived from live
// transactions).
func (t *syncTx) CascadeTombstoneCategory(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Category, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.CascadeTombstoneCategory"

	// Reuse the plain tombstone for the category half (idempotent on an
	// already-tombstoned record; the engine checks liveness first).
	c, err := t.TombstoneCategory(ctx, scope, id)
	if err != nil {
		return nil, opWrap(op, err)
	}
	rows, err := t.q.SoftDeleteTransactionsForCategory(
		ctx,
		db.SoftDeleteTransactionsForCategoryParams{
			HouseholdID: householdID,
			CategoryID:  &id,
		},
	)
	if err != nil {
		return nil, opWrap(op, err)
	}
	for _, tx := range rows {
		if err := appendChangeLog(
			ctx, t.q, householdID, actorID, tx.ID,
			domain.SyncEntityTransaction, domain.SyncChangeTombstone, int(tx.Version),
		); err != nil {
			return nil, opWrap(op, err)
		}
	}
	return c, nil
}

func (t *syncTx) CreateDebtor(
	ctx context.Context,
	params domain.CreateDebtorParams,
) (*domain.Debtor, error) {
	const op = "repository.postgres.syncTx.CreateDebtor"

	row, err := t.q.CreateDebtor(ctx, db.CreateDebtorParams{
		ID:          newEntityID(params.ID),
		HouseholdID: params.HouseholdID,
		UserID:      params.UserID,
		Name:        params.Name,
	})
	if err != nil {
		return nil, classifyInsertErr(op, err, domain.ErrDebtorAlreadyExists)
	}
	if err := appendChangeLog(
		ctx, t.q, params.HouseholdID, params.UserID, row.ID,
		domain.SyncEntityDebtor, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
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

func (t *syncTx) ReplaceDebtor(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.DebtorFullState,
) (*domain.Debtor, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.ReplaceDebtor"

	row, err := t.q.SyncReplaceDebtor(ctx, db.SyncReplaceDebtorParams{
		ID:          id,
		HouseholdID: householdID,
		Name:        st.Name,
		BaseVersion: int32(baseVersion), //nolint:gosec // server versions are small positive ints
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			current, cerr := t.q.GetDebtorAny(
				ctx,
				db.GetDebtorAnyParams{ID: id, HouseholdID: householdID},
			)
			return nil, classifySyncWrite(
				cerr,
				current.DeletedAt != nil,
				domain.ErrDebtorNotFound,
				domain.ErrDebtorVersionConflict,
			)
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityDebtor, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
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

// TombstoneDebtor deletes the debtor and cascades over its live debt
// operations: every tombstoned operation gets its own change_log row on the
// batch transaction (invariants #17-#18), mirroring the REST DeleteDebtor -
// both run cascadeDeleteDebtor, so REST and pushed deletes are one behavior.
// Like the other tombstone twins it is idempotent: an already-tombstoned
// debtor is returned as stored, without a re-cascade.
func (t *syncTx) TombstoneDebtor(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Debtor, error) {
	const op = "repository.postgres.syncTx.TombstoneDebtor"

	current, err := t.GetDebtorAny(ctx, scope, id)
	if err != nil {
		return nil, opWrap(op, err)
	}
	if current == nil {
		return nil, domain.ErrDebtorNotFound
	}
	if current.Deleted() {
		return current, nil // already tombstoned: idempotent delete
	}
	version, err := cascadeDeleteDebtor(
		ctx, t.q, scope.HouseholdID, scope.ActorID, id,
	)
	if err != nil {
		return nil, opWrap(op, err)
	}
	now := time.Now().UTC()
	current.Version = version
	current.DeletedAt = &now
	return current, nil
}

func (t *syncTx) CreateDebtOperation(
	ctx context.Context,
	params domain.CreateDebtOperationParams,
) (*domain.DebtOperation, error) {
	const op = "repository.postgres.syncTx.CreateDebtOperation"

	row, err := t.q.CreateDebtOperation(ctx, db.CreateDebtOperationParams{
		ID:          newEntityID(params.ID),
		HouseholdID: params.HouseholdID,
		UserID:      params.UserID,
		DebtorID:    params.DebtorID,
		Direction:   string(params.Direction),
		Kind:        string(params.Kind),
		Amount:      params.Amount,
		OccurredAt:  params.OccurredAt,
	})
	if err != nil {
		return nil, classifyInsertErr(op, err, domain.ErrDebtOperationAlreadyExists)
	}
	if err := appendChangeLog(
		ctx, t.q, params.HouseholdID, params.UserID, row.ID,
		domain.SyncEntityDebtOperation, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return debtOperationFromFields(
		row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
		row.Amount, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (t *syncTx) ReplaceDebtOperation(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.DebtOperationFullState,
) (*domain.DebtOperation, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.ReplaceDebtOperation"

	row, err := t.q.SyncReplaceDebtOperation(ctx, db.SyncReplaceDebtOperationParams{
		ID:          id,
		HouseholdID: householdID,
		DebtorID:    st.DebtorID,
		Direction:   string(st.Direction),
		Kind:        string(st.Kind),
		Amount:      st.Amount,
		OccurredAt:  st.OccurredAt,
		BaseVersion: int32(baseVersion), //nolint:gosec // server versions are small positive ints
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			current, cerr := t.q.GetDebtOperationAny(
				ctx,
				db.GetDebtOperationAnyParams{ID: id, HouseholdID: householdID},
			)
			return nil, classifySyncWrite(
				cerr,
				current.DeletedAt != nil,
				domain.ErrDebtOperationNotFound,
				domain.ErrDebtOperationVersionConflict,
			)
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityDebtOperation, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return debtOperationFromFields(
		row.ID, row.UserID, row.DebtorID, row.Direction, row.Kind,
		row.Amount, row.OccurredAt, row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (t *syncTx) TombstoneDebtOperation(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.DebtOperation, error) {
	return tombstoneEntity(ctx, t.q, scope, id,
		"repository.postgres.syncTx.TombstoneDebtOperation",
		func() (int32, error) {
			return t.q.SoftDeleteDebtOperation(
				ctx, db.SoftDeleteDebtOperationParams{ID: id, HouseholdID: scope.HouseholdID},
			)
		},
		func() (*domain.DebtOperation, error) { return t.GetDebtOperationAny(ctx, scope, id) },
		domain.ErrDebtOperationNotFound,
		domain.SyncEntityDebtOperation,
		func(version int32) *domain.DebtOperation {
			now := time.Now().UTC()
			return &domain.DebtOperation{
				ID:        id,
				UserID:    scope.ActorID,
				Version:   int(version),
				DeletedAt: &now,
			}
		},
	)
}

func (t *syncTx) CreatePlannedPayment(
	ctx context.Context,
	params domain.CreatePlannedPaymentParams,
) (*domain.PlannedPayment, error) {
	const op = "repository.postgres.syncTx.CreatePlannedPayment"

	row, err := t.q.CreatePlannedPayment(ctx, db.CreatePlannedPaymentParams{
		ID:          newEntityID(params.ID),
		HouseholdID: params.HouseholdID,
		UserID:      params.UserID,
		Type:        string(params.Type),
		Amount:      params.Amount,
		Name:        params.Name,
		AccountID:   params.AccountID,
		CategoryID:  params.CategoryID,
		NextDue:     params.NextDue,
		Regularity:  string(params.Regularity),
		ConfirmMode: string(params.ConfirmMode),
		Reminder:    string(params.Reminder),
		Note:        params.Note,
	})
	if err != nil {
		return nil, classifyInsertErr(op, err, domain.ErrPlannedPaymentAlreadyExists)
	}
	if err := appendChangeLog(
		ctx, t.q, params.HouseholdID, params.UserID, row.ID,
		domain.SyncEntityPlannedPayment, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (t *syncTx) ReplacePlannedPayment(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.PlannedPaymentFullState,
) (*domain.PlannedPayment, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.ReplacePlannedPayment"

	row, err := t.q.SyncReplacePlannedPayment(ctx, db.SyncReplacePlannedPaymentParams{
		ID:          id,
		HouseholdID: householdID,
		Type:        string(st.Type),
		Amount:      st.Amount,
		Name:        st.Name,
		AccountID:   st.AccountID,
		CategoryID:  st.CategoryID,
		NextDue:     st.NextDue.Time,
		AnchorDate:  st.AnchorDate.Time,
		Regularity:  string(st.Regularity),
		ConfirmMode: string(st.ConfirmMode),
		Reminder:    string(st.Reminder),
		Note:        st.Note,
		BaseVersion: int32(baseVersion), //nolint:gosec // server versions are small positive ints
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			current, cerr := t.q.GetPlannedPaymentAny(
				ctx,
				db.GetPlannedPaymentAnyParams{ID: id, HouseholdID: householdID},
			)
			return nil, classifySyncWrite(
				cerr,
				current.DeletedAt != nil,
				domain.ErrPlannedPaymentNotFound,
				domain.ErrPlannedPaymentVersionConflict,
			)
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityPlannedPayment, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (t *syncTx) TombstonePlannedPayment(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.PlannedPayment, error) {
	return tombstoneEntity(ctx, t.q, scope, id,
		"repository.postgres.syncTx.TombstonePlannedPayment",
		func() (int32, error) {
			return t.q.SoftDeletePlannedPayment(
				ctx, db.SoftDeletePlannedPaymentParams{ID: id, HouseholdID: scope.HouseholdID},
			)
		},
		func() (*domain.PlannedPayment, error) { return t.GetPlannedPaymentAny(ctx, scope, id) },
		domain.ErrPlannedPaymentNotFound,
		domain.SyncEntityPlannedPayment,
		func(version int32) *domain.PlannedPayment {
			now := time.Now().UTC()
			return &domain.PlannedPayment{
				ID:        id,
				UserID:    scope.ActorID,
				Version:   int(version),
				DeletedAt: &now,
			}
		},
	)
}

// AdvancePlannedPayment moves next_due to the already-computed next occurrence
// and appends the change_log row — the auto-confirm job's plan half; the
// transaction half (CreateTransaction) rides the same tx, making the
// advancement the structural dedup marker for the executed occurrence.
func (t *syncTx) AdvancePlannedPayment(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	nextDue time.Time,
) (*domain.PlannedPayment, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.AdvancePlannedPayment"

	row, err := t.q.AdvancePlannedPayment(ctx, db.AdvancePlannedPaymentParams{
		ID:          id,
		HouseholdID: householdID,
		NextDue:     nextDue,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrPlannedPaymentNotFound
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityPlannedPayment, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return plannedPaymentFromRow(
		row.ID, row.UserID, row.Type, row.Amount, row.Name, row.AccountID, row.CategoryID,
		row.NextDue, row.AnchorDate, row.Regularity, row.ConfirmMode, row.Reminder, row.Note,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
	), nil
}

func (t *syncTx) CreateTransaction(
	ctx context.Context,
	params domain.CreateTransactionParams,
) (*domain.Transaction, error) {
	const op = "repository.postgres.syncTx.CreateTransaction"

	row, err := t.q.CreateTransaction(ctx, db.CreateTransactionParams{
		ID:            newEntityID(params.ID),
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
		return nil, classifyInsertErr(op, err, domain.ErrTransactionAlreadyExists)
	}
	if err := appendChangeLog(
		ctx, t.q, params.HouseholdID, params.UserID, row.ID,
		domain.SyncEntityTransaction, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return transactionFromFields(
		row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
		row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, nil,
	), nil
}

func (t *syncTx) ReplaceTransaction(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	baseVersion int,
	st domain.TransactionFullState,
) (*domain.Transaction, error) {
	householdID, actorID := scope.HouseholdID, scope.ActorID
	const op = "repository.postgres.syncTx.ReplaceTransaction"

	row, err := t.q.SyncReplaceTransaction(ctx, db.SyncReplaceTransactionParams{
		ID:            id,
		HouseholdID:   householdID,
		Amount:        st.Amount,
		Description:   st.Description,
		OccurredAt:    st.OccurredAt,
		AccountID:     st.AccountID,
		CategoryID:    st.CategoryID,
		FromAccountID: st.FromAccountID,
		ToAccountID:   st.ToAccountID,
		BaseVersion:   int32(baseVersion), //nolint:gosec // server versions are small positive ints
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			current, cerr := t.q.GetTransactionAny(
				ctx,
				db.GetTransactionAnyParams{ID: id, HouseholdID: householdID},
			)
			return nil, classifySyncWrite(
				cerr,
				current.DeletedAt != nil,
				domain.ErrTransactionNotFound,
				domain.ErrTransactionVersionConflict,
			)
		}
		return nil, opWrap(op, err)
	}
	if err := appendChangeLog(
		ctx, t.q, householdID, actorID, row.ID,
		domain.SyncEntityTransaction, domain.SyncChangeUpsert, int(row.Version),
	); err != nil {
		return nil, opWrap(op, err)
	}
	return transactionFromFields(
		row.ID, row.UserID, row.Type, row.Amount, row.Description, row.OccurredAt,
		row.CreatedAt, row.UpdatedAt, int(row.Version),
		row.AccountID, row.CategoryID, row.FromAccountID, row.ToAccountID, nil,
	), nil
}

func (t *syncTx) TombstoneTransaction(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
) (*domain.Transaction, error) {
	return tombstoneEntity(ctx, t.q, scope, id,
		"repository.postgres.syncTx.TombstoneTransaction",
		func() (int32, error) {
			return t.q.SoftDeleteTransaction(
				ctx, db.SoftDeleteTransactionParams{ID: id, HouseholdID: scope.HouseholdID},
			)
		},
		func() (*domain.Transaction, error) { return t.GetTransactionAny(ctx, scope, id) },
		domain.ErrTransactionNotFound,
		domain.SyncEntityTransaction,
		func(version int32) *domain.Transaction {
			now := time.Now().UTC()
			return &domain.Transaction{
				ID:        id,
				UserID:    scope.ActorID,
				Version:   int(version),
				DeletedAt: &now,
			}
		},
	)
}

// classifySyncWrite classifies a zero-row CAS write for the sync surface:
// a tombstoned row is its own sentinel (the client learns via
// SYNC_DELETED_CONFLICT); a live version mismatch is the entity's version
// conflict; an absent row keeps the entity's not-found sentinel. Each
// Replace twin supplies its own re-read and sentinels - no entity-string
// dispatch remains on the push write path (ADR-0003).
func classifySyncWrite(rowErr error, rowDeleted bool, notFound, versionConflict error) error {
	if rowErr != nil {
		return notFound
	}
	if rowDeleted {
		return domain.ErrRecordDeleted
	}
	return versionConflict
}

// classifyInsertErr maps a create failure: a unique violation is the
// entity's already-exists sentinel (idempotent replays are answered one
// level up via applied_operations); anything else wraps with op.
func classifyInsertErr(op string, err, alreadyExists error) error {
	if pgUniqueViolation(err) {
		return alreadyExists
	}
	return opWrap(op, err)
}

// --- pull -------------------------------------------------------------------------

// PullChanges fetches the change-log page and the CURRENT state of every
// record named by an upsert row. A record superseded later in the window may
// carry newer data than its change-time version; applying the stream in seq
// order still converges because the later change is applied right after it.
func (r *Repository) PullChanges(
	ctx context.Context,
	scope domain.Scope,
	afterSeq int64,
	limit int,
) ([]domain.SyncChange, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.PullChanges"

	rows, err := r.q.PullChangeLog(ctx, db.PullChangeLogParams{
		HouseholdID: householdID,
		AfterSeq:    afterSeq,
		Limit:       int32(limit), //nolint:gosec // bounded by the service (<= max pull page size)
	})
	if err != nil {
		return nil, opWrap(op, err)
	}

	accountsByID, categoriesByID, transactionsByID, err := r.fetchPullStates(ctx, householdID, rows)
	if err != nil {
		return nil, opWrap(op, err)
	}
	debtorsByID, debtOperationsByID, err := r.fetchDebtPullStates(ctx, householdID, rows)
	if err != nil {
		return nil, opWrap(op, err)
	}
	plannedPaymentsByID, err := r.fetchPlannedPaymentPullStates(ctx, householdID, rows)
	if err != nil {
		return nil, opWrap(op, err)
	}

	changes := make([]domain.SyncChange, 0, len(rows))
	for _, row := range rows {
		change := domain.SyncChange{
			Seq:     row.Seq,
			UserID:  row.UserID,
			Entity:  row.Entity,
			ID:      row.EntityID,
			Action:  row.Action,
			Version: int(row.Version),
		}
		if row.Action == domain.SyncChangeUpsert {
			change.Data = pullStateOf(
				row.Entity, row.EntityID,
				accountsByID, categoriesByID, transactionsByID, debtorsByID, debtOperationsByID,
				plannedPaymentsByID,
			)
		}
		changes = append(changes, change)
	}
	return changes, nil
}

// fetchPullStates batch-loads the current state of every record named by an
// upsert row of the page, keyed by id.
func (r *Repository) fetchPullStates(
	ctx context.Context,
	householdID uuid.UUID,
	rows []db.PullChangeLogRow,
) (
	map[uuid.UUID]db.SyncAccountsByIDsRow,
	map[uuid.UUID]db.SyncCategoriesByIDsRow,
	map[uuid.UUID]db.SyncTransactionsByIDsRow,
	error,
) {
	accIDs := make([]uuid.UUID, 0)
	catIDs := make([]uuid.UUID, 0)
	txnIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		if row.Action != domain.SyncChangeUpsert {
			continue
		}
		switch row.Entity {
		case domain.SyncEntityAccount:
			accIDs = append(accIDs, row.EntityID)
		case domain.SyncEntityCategory:
			catIDs = append(catIDs, row.EntityID)
		case domain.SyncEntityTransaction:
			txnIDs = append(txnIDs, row.EntityID)
		}
	}

	accountsByID := make(map[uuid.UUID]db.SyncAccountsByIDsRow, len(accIDs))
	if len(accIDs) > 0 {
		items, err := r.q.SyncAccountsByIDs(
			ctx,
			db.SyncAccountsByIDsParams{HouseholdID: householdID, Ids: accIDs},
		)
		if err != nil {
			return nil, nil, nil, err
		}
		for _, a := range items {
			accountsByID[a.ID] = a
		}
	}
	categoriesByID := make(map[uuid.UUID]db.SyncCategoriesByIDsRow, len(catIDs))
	if len(catIDs) > 0 {
		items, err := r.q.SyncCategoriesByIDs(
			ctx,
			db.SyncCategoriesByIDsParams{HouseholdID: householdID, Ids: catIDs},
		)
		if err != nil {
			return nil, nil, nil, err
		}
		for _, c := range items {
			categoriesByID[c.ID] = c
		}
	}
	transactionsByID := make(map[uuid.UUID]db.SyncTransactionsByIDsRow, len(txnIDs))
	if len(txnIDs) > 0 {
		items, err := r.q.SyncTransactionsByIDs(
			ctx,
			db.SyncTransactionsByIDsParams{HouseholdID: householdID, Ids: txnIDs},
		)
		if err != nil {
			return nil, nil, nil, err
		}
		for _, t := range items {
			transactionsByID[t.ID] = t
		}
	}
	return accountsByID, categoriesByID, transactionsByID, nil
}

// fetchDebtPullStates batch-loads the current state of the debt records named
// by an upsert row of the page, keyed by id (the debt half of fetchPullStates,
// split out to keep both under the funlen budget).
func (r *Repository) fetchDebtPullStates(
	ctx context.Context,
	householdID uuid.UUID,
	rows []db.PullChangeLogRow,
) (
	map[uuid.UUID]db.SyncDebtorsByIDsRow,
	map[uuid.UUID]db.SyncDebtOperationsByIDsRow,
	error,
) {
	debtorIDs := make([]uuid.UUID, 0)
	debtOpIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		if row.Action != domain.SyncChangeUpsert {
			continue
		}
		switch row.Entity {
		case domain.SyncEntityDebtor:
			debtorIDs = append(debtorIDs, row.EntityID)
		case domain.SyncEntityDebtOperation:
			debtOpIDs = append(debtOpIDs, row.EntityID)
		}
	}

	debtorsByID := make(map[uuid.UUID]db.SyncDebtorsByIDsRow, len(debtorIDs))
	if len(debtorIDs) > 0 {
		items, err := r.q.SyncDebtorsByIDs(
			ctx,
			db.SyncDebtorsByIDsParams{HouseholdID: householdID, Ids: debtorIDs},
		)
		if err != nil {
			return nil, nil, err
		}
		for _, d := range items {
			debtorsByID[d.ID] = d
		}
	}
	debtOperationsByID := make(map[uuid.UUID]db.SyncDebtOperationsByIDsRow, len(debtOpIDs))
	if len(debtOpIDs) > 0 {
		items, err := r.q.SyncDebtOperationsByIDs(
			ctx,
			db.SyncDebtOperationsByIDsParams{HouseholdID: householdID, Ids: debtOpIDs},
		)
		if err != nil {
			return nil, nil, err
		}
		for _, o := range items {
			debtOperationsByID[o.ID] = o
		}
	}
	return debtorsByID, debtOperationsByID, nil
}

// fetchPlannedPaymentPullStates batch-loads the current state of the planned
// payments named by an upsert row of the page, keyed by id.
func (r *Repository) fetchPlannedPaymentPullStates(
	ctx context.Context,
	householdID uuid.UUID,
	rows []db.PullChangeLogRow,
) (map[uuid.UUID]db.SyncPlannedPaymentsByIDsRow, error) {
	planIDs := make([]uuid.UUID, 0)
	for _, row := range rows {
		if row.Action != domain.SyncChangeUpsert {
			continue
		}
		if row.Entity == domain.SyncEntityPlannedPayment {
			planIDs = append(planIDs, row.EntityID)
		}
	}

	plannedPaymentsByID := make(map[uuid.UUID]db.SyncPlannedPaymentsByIDsRow, len(planIDs))
	if len(planIDs) > 0 {
		items, err := r.q.SyncPlannedPaymentsByIDs(
			ctx, db.SyncPlannedPaymentsByIDsParams{HouseholdID: householdID, Ids: planIDs},
		)
		if err != nil {
			return nil, err
		}
		for _, p := range items {
			plannedPaymentsByID[p.ID] = p
		}
	}
	return plannedPaymentsByID, nil
}

// pullStateOf maps a change row to the full state payload of its record (nil
// when the record no longer exists). A record superseded later in the window
// may carry newer data than its change-time version; applying the stream in
// seq order still converges because the later change is applied right after.
func pullStateOf(
	entity string,
	id uuid.UUID,
	accountsByID map[uuid.UUID]db.SyncAccountsByIDsRow,
	categoriesByID map[uuid.UUID]db.SyncCategoriesByIDsRow,
	transactionsByID map[uuid.UUID]db.SyncTransactionsByIDsRow,
	debtorsByID map[uuid.UUID]db.SyncDebtorsByIDsRow,
	debtOperationsByID map[uuid.UUID]db.SyncDebtOperationsByIDsRow,
	plannedPaymentsByID map[uuid.UUID]db.SyncPlannedPaymentsByIDsRow,
) any {
	switch entity {
	case domain.SyncEntityAccount:
		if a, ok := accountsByID[id]; ok {
			return &domain.AccountFullState{
				Name:           a.Name,
				Currency:       a.Currency,
				OpeningBalance: a.OpeningBalance,
			}
		}
	case domain.SyncEntityCategory:
		if c, ok := categoriesByID[id]; ok {
			return &domain.CategoryFullState{
				Name:       c.Name,
				Type:       domain.TransactionType(c.Type),
				Icon:       c.Icon,
				Color:      c.Color,
				ArchivedAt: c.ArchivedAt,
			}
		}
	case domain.SyncEntityTransaction:
		if t, ok := transactionsByID[id]; ok {
			return &domain.TransactionFullState{
				Type:          domain.TransactionType(t.Type),
				Amount:        t.Amount,
				Description:   t.Description,
				OccurredAt:    t.OccurredAt,
				AccountID:     t.AccountID,
				CategoryID:    t.CategoryID,
				FromAccountID: t.FromAccountID,
				ToAccountID:   t.ToAccountID,
			}
		}
	case domain.SyncEntityDebtor:
		if d, ok := debtorsByID[id]; ok {
			return &domain.DebtorFullState{
				Name: d.Name,
			}
		}
	case domain.SyncEntityDebtOperation:
		if o, ok := debtOperationsByID[id]; ok {
			return &domain.DebtOperationFullState{
				DebtorID:   o.DebtorID,
				Direction:  domain.DebtDirection(o.Direction),
				Kind:       domain.DebtOperationKind(o.Kind),
				Amount:     o.Amount,
				OccurredAt: o.OccurredAt,
			}
		}
	case domain.SyncEntityPlannedPayment:
		if p, ok := plannedPaymentsByID[id]; ok {
			return &domain.PlannedPaymentFullState{
				Type:        domain.TransactionType(p.Type),
				Amount:      p.Amount,
				Name:        p.Name,
				AccountID:   p.AccountID,
				CategoryID:  p.CategoryID,
				NextDue:     domain.Date{Time: p.NextDue},
				AnchorDate:  domain.Date{Time: p.AnchorDate},
				Regularity:  domain.PlannedRegularity(p.Regularity),
				ConfirmMode: domain.PlannedConfirmMode(p.ConfirmMode),
				Reminder:    domain.PlannedReminder(p.Reminder),
				Note:        p.Note,
			}
		}
	}
	return nil
}
