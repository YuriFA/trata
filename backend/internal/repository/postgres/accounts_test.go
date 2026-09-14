package postgres_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

func TestAccountCRUDAndBalance(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "acct")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	created, err := testRepo.CreateAccount(ctx, domain.CreateAccountParams{
		HouseholdID:    userHH,
		UserID:         user.ID,
		Name:           "Wallet",
		Currency:       "USD",
		OpeningBalance: 10000, // $100.00
	})
	require.NoError(t, err)
	assert.Equal(t, int64(10000), created.Balance, "fresh account balance = opening")

	// An adjustment transaction shifts the balance by its signed amount.
	acct := created.ID
	adjTx, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID,
		Type:        domain.TransactionTypeAdjustment,
		Amount:      -2500,
		AccountID:   &acct,
	})
	require.NoError(t, err)
	updated, err := testRepo.GetAccount(ctx, domain.Scope{HouseholdID: userHH}, created.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(7500), updated.Balance)

	// Rename keeps balance.
	name := "Wallet Pro"
	updated, err = testRepo.UpdateAccount(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		created.ID,
		domain.UpdateAccountParams{Name: &name, Version: updated.Version},
	)
	require.NoError(t, err)
	assert.Equal(t, "Wallet Pro", updated.Name)
	assert.Equal(t, int64(7500), updated.Balance)

	// Get + list; the listing carries the computed balance (clients sum
	// per currency client-side since the balances endpoint was removed).
	got, err := testRepo.GetAccount(ctx, domain.Scope{HouseholdID: userHH}, created.ID)
	require.NoError(t, err)
	assert.Equal(t, updated.Name, got.Name)
	assert.Equal(t, int64(7500), got.Balance)

	all, err := testRepo.GetAccounts(ctx, domain.Scope{HouseholdID: userHH})
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.Equal(t, int64(7500), all[0].Balance)

	// Delete (the adjustment transaction must be gone first: the account is
	// in use while any live transaction references it).
	require.NoError(t, testRepo.DeleteTransaction(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, adjTx.ID))
	require.NoError(t, testRepo.DeleteAccount(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, created.ID))
	_, err = testRepo.GetAccount(ctx, domain.Scope{HouseholdID: userHH}, created.ID)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)
}

func TestAccountIDORScoping(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	owner := seedUser(t, "owner")
	ownerHH := householdOf(t, owner.ID)
	intruder := seedUser(t, "intruder")
	intruderHH := householdOf(t, intruder.ID)
	ctx := newCtx(t)

	acct, err := testRepo.CreateAccount(ctx, domain.CreateAccountParams{
		HouseholdID: ownerHH,
		UserID:      owner.ID, Name: "Secret", Currency: "USD", OpeningBalance: 1,
	})
	require.NoError(t, err)

	// Intruder cannot read owner's account -> not found.
	_, err = testRepo.GetAccount(ctx, domain.Scope{HouseholdID: intruderHH}, acct.ID)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)

	// Intruder cannot delete owner's account -> not found (NOT a FK error).
	err = testRepo.DeleteAccount(ctx, domain.Scope{HouseholdID: intruderHH, ActorID: intruder.ID}, acct.ID)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)

	// Intruder cannot update owner's account.
	name := "hacked"
	_, err = testRepo.UpdateAccount(
		ctx,
		domain.Scope{HouseholdID: intruderHH, ActorID: intruder.ID},
		acct.ID,
		domain.UpdateAccountParams{Name: &name},
	)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)
}

func TestDeleteAccountInUseReturnsConflict(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "inuse")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)

	acct, err := testRepo.CreateAccount(ctx, domain.CreateAccountParams{
		HouseholdID: userHH,
		UserID:      user.ID, Name: "A", Currency: "USD", OpeningBalance: 0,
	})
	require.NoError(t, err)
	cat := seedCategory(t, userHH, user.ID, "Cat")

	_, err = testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID, Type: domain.TransactionTypeIncome, Amount: 100,
		OccurredAt: mustNow(), AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)

	// Deleting the referenced account must surface a domain error (-> 409).
	err = testRepo.DeleteAccount(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, acct.ID)
	require.ErrorIs(t, err, domain.ErrAccountHasTransactions)
}

func TestDeleteAccountAbsorbsAdjustments(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "adjdel")
	userHH := householdOf(t, user.ID)
	ctx := newCtx(t)
	scope := domain.Scope{HouseholdID: userHH, ActorID: user.ID}

	acct, err := testRepo.CreateAccount(ctx, domain.CreateAccountParams{
		HouseholdID:    userHH,
		UserID:         user.ID,
		Name:           "Cash",
		Currency:       "USD",
		OpeningBalance: 0,
	})
	require.NoError(t, err)
	acctID := acct.ID

	// Two live adjustments reconcile the account; nothing else references it.
	first, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID,
		Type:        domain.TransactionTypeAdjustment,
		Amount:      1500,
		AccountID:   &acctID,
	})
	require.NoError(t, err)
	second, err := testRepo.CreateTransaction(ctx, domain.CreateTransactionParams{
		HouseholdID: userHH,
		UserID:      user.ID,
		Type:        domain.TransactionTypeAdjustment,
		Amount:      -300,
		AccountID:   &acctID,
	})
	require.NoError(t, err)

	// Adjustments never block the delete: it succeeds and absorbs them.
	require.NoError(t, testRepo.DeleteAccount(ctx, scope, acct.ID))

	// The adjustments ride along as tombstones (sync tombstones, so other
	// devices drop them through pull).
	require.NoError(
		t,
		testRepo.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: userHH}, func(tx repository.SyncTx) error {
			for _, adj := range []*domain.Transaction{first, second} {
				row, err := tx.GetTransactionAny(ctx, domain.Scope{HouseholdID: userHH}, adj.ID)
				if err != nil {
					return err
				}
				if row == nil || row.DeletedAt == nil {
					t.Fatalf("adjustment %s was not tombstoned with the account", adj.ID)
				}
				if row.Version <= adj.Version {
					t.Fatalf("adjustment %s version did not advance: %d", adj.ID, row.Version)
				}
			}
			return nil
		}),
	)

	// The account itself is tombstoned.
	_, err = testRepo.GetAccount(ctx, domain.Scope{HouseholdID: userHH}, acct.ID)
	require.ErrorIs(t, err, domain.ErrAccountNotFound)
}
