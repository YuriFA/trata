package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
)

func TestTransactionService_RefValidation(t *testing.T) {
	t.Parallel()
	_, _, txSvc, _, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"CustomIncome",
		domain.TransactionTypeIncome,
	)

	t.Run("income without a category rejected (account is optional, category is not)", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeIncome, Amount: 100, OccurredAt: time.Now().UTC(),
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("income with transfer refs rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeIncome, Amount: 100, OccurredAt: time.Now().UTC(),
			FromAccountID: &acct.ID, ToAccountID: &acct.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("income account not owned -> transaction account not found", func(t *testing.T) {
		t.Parallel()
		other := uuid.New()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeIncome, Amount: 100, OccurredAt: time.Now().UTC(),
			AccountID: &other, CategoryID: &cat.ID,
		})
		require.ErrorIs(t, err, domain.ErrTransactionAccountNotFound)
	})

	t.Run("income category type mismatch", func(t *testing.T) {
		t.Parallel()
		expenseCat := seedFakeCategory(
			t,
			store,
			domain.Scope{HouseholdID: userHH},
			user.ID,
			"CustomExpense",
			domain.TransactionTypeExpense,
		)
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeIncome, Amount: 100, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID, CategoryID: &expenseCat.ID,
		})
		require.ErrorIs(t, err, domain.ErrCategoryTypeMismatch)
	})

	t.Run("transfer same account rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeTransfer, Amount: 100, OccurredAt: time.Now().UTC(),
			FromAccountID: &acct.ID, ToAccountID: &acct.ID,
		})
		require.ErrorIs(t, err, domain.ErrSameAccountTransfer)
	})

	t.Run("transfer with account+category rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeTransfer, Amount: 100, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID, CategoryID: &cat.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("valid income creates", func(t *testing.T) {
		t.Parallel()
		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeIncome, Amount: 100, OccurredAt: time.Now().UTC(),
				AccountID: &acct.ID, CategoryID: &cat.ID,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, 1, created.Version)
	})

	t.Run("adjustment with category rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeAdjustment, Amount: -100, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID, CategoryID: &cat.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("adjustment with transfer refs rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeAdjustment, Amount: -100, OccurredAt: time.Now().UTC(),
			FromAccountID: &acct.ID, ToAccountID: &acct.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("adjustment without account rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeAdjustment, Amount: -100, OccurredAt: time.Now().UTC(),
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("adjustment account not owned -> transaction account not found", func(t *testing.T) {
		t.Parallel()
		other := uuid.New()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeAdjustment, Amount: -100, OccurredAt: time.Now().UTC(),
			AccountID: &other,
		})
		require.ErrorIs(t, err, domain.ErrTransactionAccountNotFound)
	})

	t.Run("valid adjustment creates and shifts balance by signed amount", func(t *testing.T) {
		t.Parallel()
		dedicated := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeAdjustment, Amount: -2500, OccurredAt: time.Now().UTC(),
				AccountID: &dedicated.ID,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, 1, created.Version)
		after, err := store.GetAccount(context.Background(), domain.Scope{HouseholdID: userHH}, dedicated.ID)
		require.NoError(t, err)
		assert.Equal(t, dedicated.Balance-2500, after.Balance)
	})
}

func TestTransactionService_AccountlessCashflow(t *testing.T) {
	t.Parallel()
	_, _, txSvc, _, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	expenseCat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Groceries",
		domain.TransactionTypeExpense,
	)
	incomeCat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Salary",
		domain.TransactionTypeIncome,
	)

	t.Run("account-less expense creates and leaves balances unchanged", func(t *testing.T) {
		t.Parallel()
		// Parallel subtests share the store; a dedicated account keeps the
		// balance assertion isolated from siblings' mutations.
		dedicated := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
		before, err := store.GetAccount(ctx, domain.Scope{HouseholdID: userHH}, dedicated.ID)
		require.NoError(t, err)

		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeExpense, Amount: 500, OccurredAt: time.Now().UTC(),
				CategoryID: &expenseCat.ID,
			},
		)
		require.NoError(t, err)
		assert.Nil(t, created.AccountID)
		assert.Equal(t, &expenseCat.ID, created.CategoryID)

		after, err := store.GetAccount(ctx, domain.Scope{HouseholdID: userHH}, dedicated.ID)
		require.NoError(t, err)
		assert.Equal(t, before.Balance, after.Balance)
	})

	t.Run("account-less income creates", func(t *testing.T) {
		t.Parallel()
		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeIncome, Amount: 70000, OccurredAt: time.Now().UTC(),
				CategoryID: &incomeCat.ID,
			},
		)
		require.NoError(t, err)
		assert.Nil(t, created.AccountID)
	})

	t.Run("account-less cashflow still requires a category", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeExpense, Amount: 500, OccurredAt: time.Now().UTC(),
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("account-less cashflow rejects transfer refs", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeExpense, Amount: 500, OccurredAt: time.Now().UTC(),
			CategoryID: &expenseCat.ID, FromAccountID: &acct.ID, ToAccountID: &acct.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidRefs)
	})

	t.Run("update assigns an account to an account-less expense", func(t *testing.T) {
		t.Parallel()
		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeExpense, Amount: 500, OccurredAt: time.Now().UTC(),
				CategoryID: &expenseCat.ID,
			},
		)
		require.NoError(t, err)

		updated, err := txSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateTransactionParams{
				Version: created.Version, AccountID: &acct.ID,
			},
		)
		require.NoError(t, err)
		require.NotNil(t, updated.AccountID)
		assert.Equal(t, acct.ID, *updated.AccountID)
	})

	t.Run("update of an account-less expense without touching refs succeeds", func(t *testing.T) {
		t.Parallel()
		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeExpense, Amount: 500, OccurredAt: time.Now().UTC(),
				CategoryID: &expenseCat.ID,
			},
		)
		require.NoError(t, err)

		newAmount := int64(600)
		updated, err := txSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateTransactionParams{
				Version: created.Version, Amount: &newAmount,
			},
		)
		require.NoError(t, err)
		assert.Nil(t, updated.AccountID)
	})
}

func TestTransactionService_AmountSignValidation(t *testing.T) {
	t.Parallel()
	_, _, txSvc, _, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"AmountIncome",
		domain.TransactionTypeIncome,
	)

	t.Run("zero income amount rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeIncome, Amount: 0, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID, CategoryID: &cat.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidAmount)
	})

	t.Run("negative expense amount rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeExpense, Amount: -100, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID, CategoryID: &cat.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidAmount)
	})

	t.Run("zero adjustment amount rejected", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeAdjustment, Amount: 0, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID,
		})
		require.ErrorIs(t, err, domain.ErrInvalidAmount)
	})

	t.Run("negative adjustment amount accepted", func(t *testing.T) {
		t.Parallel()
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type: domain.TransactionTypeAdjustment, Amount: -1, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID,
		})
		require.NoError(t, err)
	})

	t.Run("update flips amount sign against the type rule", func(t *testing.T) {
		t.Parallel()
		created, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeAdjustment, Amount: -500, OccurredAt: time.Now().UTC(),
				AccountID: &acct.ID,
			},
		)
		require.NoError(t, err)
		zero := int64(0)
		_, err = txSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateTransactionParams{
				Amount: &zero, Version: created.Version,
			},
		)
		require.ErrorIs(t, err, domain.ErrInvalidAmount)
	})
}

func TestTransactionService_CursorEncodeDecode(t *testing.T) {
	t.Parallel()
	tx := domain.Transaction{ID: uuid.New(), OccurredAt: time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)}
	encoded, err := service.EncodeTransactionCursor(tx)
	require.NoError(t, err)

	decoded, err := service.DecodeTransactionCursor(encoded)
	require.NoError(t, err)
	assert.Equal(t, tx.ID, decoded.ID)
	assert.True(t, tx.OccurredAt.Equal(decoded.OccurredAt))

	_, err = service.DecodeTransactionCursor("!!!not-base64!!!")
	assert.Error(t, err)
}

func TestTransactionService_PaginationLogic(t *testing.T) {
	t.Parallel()
	_, _, txSvc, _, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(t, store, domain.Scope{HouseholdID: userHH}, user.ID, "P", domain.TransactionTypeIncome)

	// 5 transactions, distinct occurred_at.
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	for i := range 5 {
		_, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
			Type:       domain.TransactionTypeIncome,
			Amount:     int64(i + 1),
			OccurredAt: base.Add(time.Duration(i) * time.Hour),
			AccountID:  &acct.ID,
			CategoryID: &cat.ID,
		})
		require.NoError(t, err)
	}

	pageSize := 2
	// Page 1: 2 items + nextCursor.
	p1, err := txSvc.List(ctx, domain.Scope{HouseholdID: userHH}, service.TransactionListQuery{Limit: &pageSize})
	require.NoError(t, err)
	require.Len(t, p1.Transactions, 2)
	require.NotNil(t, p1.NextCursor)
	assert.Equal(t, int64(5), p1.Transactions[0].Amount) // newest first

	// Page 2 with the cursor.
	p2, err := txSvc.List(
		ctx,
		domain.Scope{HouseholdID: userHH},
		service.TransactionListQuery{Limit: &pageSize, Cursor: p1.NextCursor},
	)
	require.NoError(t, err)
	require.Len(t, p2.Transactions, 2)
	require.NotNil(t, p2.NextCursor)
	assert.Equal(t, int64(3), p2.Transactions[0].Amount)

	// Page 3: 1 item, no nextCursor.
	p3, err := txSvc.List(
		ctx,
		domain.Scope{HouseholdID: userHH},
		service.TransactionListQuery{Limit: &pageSize, Cursor: p2.NextCursor},
	)
	require.NoError(t, err)
	require.Len(t, p3.Transactions, 1)
	assert.Nil(t, p3.NextCursor)
}

func TestTransactionService_InvalidCursor(t *testing.T) {
	t.Parallel()
	_, _, txSvc, _, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)

	_, err := txSvc.List(
		ctx,
		domain.Scope{HouseholdID: userHH},
		service.TransactionListQuery{Cursor: strPtr("!!!invalid!!!")},
	)
	require.ErrorIs(t, err, service.ErrInvalidCursor)
}

func TestTransactionService_UpdateNoFields(t *testing.T) {
	t.Parallel()
	_, _, txSvc, _, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(t, store, domain.Scope{HouseholdID: userHH}, user.ID, "U", domain.TransactionTypeIncome)

	tx, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
		Type: domain.TransactionTypeIncome, Amount: 10, OccurredAt: time.Now().UTC(),
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)

	_, err = txSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx.ID,
		domain.UpdateTransactionParams{Version: 1},
	)
	require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)

	// Optimistic concurrency mismatch surfaces the version-conflict domain error.
	_, err = txSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx.ID,
		domain.UpdateTransactionParams{Version: 999, Amount: i64(20)},
	)
	require.Error(t, err)
	require.ErrorIs(t, err, domain.ErrTransactionVersionConflict)
}
