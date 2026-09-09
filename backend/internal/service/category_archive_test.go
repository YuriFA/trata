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
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// The archive lifecycle (category-management change): archive/unarchive ride
// the update path, the listing defaults to active-only, an archived category
// keeps its name and history but is closed for new references, and the delete
// guard becomes hybrid - a cascade flag tombstones the referencing
// transactions together with the category.

func TestCategoryService_ArchiveLifecycle(t *testing.T) {
	t.Parallel()
	_, catSvc, _, _, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	c := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Продукты",
		domain.TransactionTypeExpense,
	)

	archived, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		c.ID,
		domain.UpdateCategoryParams{
			Version: c.Version, Archive: new(true),
		},
	)
	require.NoError(t, err)
	assert.NotNil(t, archived.ArchivedAt)
	assert.True(t, archived.Archived())

	// Default listing is active-only; includeArchived surfaces it again.
	active, err := catSvc.List(ctx, domain.Scope{HouseholdID: userHH}, domain.GetCategoriesParams{})
	require.NoError(t, err)
	assert.Empty(t, active)

	all, err := catSvc.List(ctx, domain.Scope{HouseholdID: userHH}, domain.GetCategoriesParams{IncludeArchived: true})
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.True(t, all[0].Archived())

	// By id the archived category stays readable (management UI).
	fetched, err := catSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, c.ID)
	require.NoError(t, err)
	assert.True(t, fetched.Archived())

	// Archived categories remain editable.
	renamed, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		c.ID,
		domain.UpdateCategoryParams{
			Version: archived.Version, Name: strPtr("Продукты (архив)"),
		},
	)
	require.NoError(t, err)
	assert.True(t, renamed.Archived())

	// Unarchive reopens the category for new transactions.
	active2, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		c.ID,
		domain.UpdateCategoryParams{
			Version: renamed.Version, Archive: new(false),
		},
	)
	require.NoError(t, err)
	assert.Nil(t, active2.ArchivedAt)
	listed, err := catSvc.List(ctx, domain.Scope{HouseholdID: userHH}, domain.GetCategoriesParams{})
	require.NoError(t, err)
	require.Len(t, listed, 1)
}

func TestCategoryService_ArchivedNameReserved(t *testing.T) {
	t.Parallel()
	_, catSvc, _, _, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	archived := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Food",
		domain.TransactionTypeExpense,
	)
	_, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		archived.ID,
		domain.UpdateCategoryParams{
			Version: archived.Version, Archive: new(true),
		},
	)
	require.NoError(t, err)

	// A new category cannot take the archived name; neither can a rename.
	_, err = catSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateCategoryParams{
		Name: "Food", Type: domain.TransactionTypeExpense, Icon: "i", Color: "#fff",
	})
	require.ErrorIs(t, err, domain.ErrCategoryAlreadyExists)

	other := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Cafe",
		domain.TransactionTypeExpense,
	)
	_, err = catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		other.ID,
		domain.UpdateCategoryParams{
			Version: other.Version, Name: strPtr("Food"),
		},
	)
	require.ErrorIs(t, err, domain.ErrCategoryAlreadyExists)
}

func TestCategoryService_ArchiveBlockedByLivePlannedPayment(t *testing.T) {
	t.Parallel()
	store := fakes.New()
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	catSvc := service.NewCategoryService(store)
	planSvc := service.NewPlannedPaymentService(store, store, store)

	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Подписки",
		domain.TransactionTypeExpense,
	)
	_, err := planSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		domain.CreatePlannedPaymentParams{
			Type: domain.TransactionTypeExpense, Amount: 500, Name: "Internet",
			AccountID: acct.ID, CategoryID: cat.ID,
			NextDue:    time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
			Regularity: domain.PlannedRegularityMonthly, ConfirmMode: domain.PlannedConfirmManual,
		},
	)
	require.NoError(t, err)

	_, err = catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		cat.ID,
		domain.UpdateCategoryParams{
			Version: cat.Version, Archive: new(true),
		},
	)
	require.ErrorIs(t, err, domain.ErrCategoryHasPlannedPayments)
}

func TestTransactionService_ArchivedCategoryReferences(t *testing.T) {
	t.Parallel()
	store := fakes.New()
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	catSvc := service.NewCategoryService(store)
	txSvc := service.NewTransactionService(store, store, store)

	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(t, store, domain.Scope{HouseholdID: userHH}, user.ID, "Кафе", domain.TransactionTypeExpense)
	// A transaction recorded while the category was active.
	tx, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
		Type: domain.TransactionTypeExpense, Amount: 300, OccurredAt: time.Now().UTC(),
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.NoError(t, err)

	archived, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		cat.ID,
		domain.UpdateCategoryParams{
			Version: cat.Version, Archive: new(true),
		},
	)
	require.NoError(t, err)

	// New assignment is rejected...
	_, err = txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
		Type: domain.TransactionTypeExpense, Amount: 100, OccurredAt: time.Now().UTC(),
		AccountID: &acct.ID, CategoryID: &cat.ID,
	})
	require.ErrorIs(t, err, domain.ErrCategoryArchived)

	otherCat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Другое",
		domain.TransactionTypeExpense,
	)
	_, err = txSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx.ID,
		domain.UpdateTransactionParams{
			Version: tx.Version, CategoryID: &otherCat.ID,
		},
	)
	require.NoError(t, err)
	tx2, err := txSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, tx.ID)
	require.NoError(t, err)

	// ...switching TO the archived category is rejected...
	_, err = txSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx.ID,
		domain.UpdateTransactionParams{
			Version: tx2.Version, CategoryID: &cat.ID,
		},
	)
	require.ErrorIs(t, err, domain.ErrCategoryArchived)

	// ...but keeping an already-assigned archived category is allowed.
	tx3, err := txSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreateTransactionParams{
		Type: domain.TransactionTypeExpense, Amount: 150, OccurredAt: time.Now().UTC(),
		AccountID: &acct.ID, CategoryID: &otherCat.ID,
	})
	require.NoError(t, err)
	_, err = catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		otherCat.ID,
		domain.UpdateCategoryParams{
			Version: otherCat.Version, Archive: new(true),
		},
	)
	require.NoError(t, err)
	desc := "kept"
	_, err = txSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		tx3.ID,
		domain.UpdateTransactionParams{
			Version: tx3.Version, Description: &desc,
		},
	)
	require.NoError(t, err)
	_ = archived
}

func TestPlannedPaymentService_ArchivedCategoryRejected(t *testing.T) {
	t.Parallel()
	store := fakes.New()
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	catSvc := service.NewCategoryService(store)
	planSvc := service.NewPlannedPaymentService(store, store, store)

	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Связь",
		domain.TransactionTypeExpense,
	)
	_, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		cat.ID,
		domain.UpdateCategoryParams{
			Version: cat.Version, Archive: new(true),
		},
	)
	require.NoError(t, err)

	_, err = planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, domain.CreatePlannedPaymentParams{
		Type: domain.TransactionTypeExpense, Amount: 600, Name: "Mobile",
		AccountID: acct.ID, CategoryID: cat.ID,
		NextDue:    time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		Regularity: domain.PlannedRegularityMonthly, ConfirmMode: domain.PlannedConfirmManual,
	})
	require.ErrorIs(t, err, domain.ErrPlannedPaymentCategoryArchived)
}

func TestCategoryService_HybridDelete(t *testing.T) {
	t.Parallel()
	store := fakes.New()
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	catSvc := service.NewCategoryService(store)
	txSvc := service.NewTransactionService(store, store, store)

	acct := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	cat := seedFakeCategory(
		t,
		store,
		domain.Scope{HouseholdID: userHH},
		user.ID,
		"Вредное",
		domain.TransactionTypeExpense,
	)
	txIDs := make([]uuid.UUID, 0, 2)
	for range 2 {
		tx, err := txSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateTransactionParams{
				Type: domain.TransactionTypeExpense, Amount: 100, OccurredAt: time.Now().UTC(),
				AccountID: &acct.ID, CategoryID: &cat.ID,
			},
		)
		require.NoError(t, err)
		txIDs = append(txIDs, tx.ID)
	}

	// Plain delete of a referenced category is still the guarded error.
	err := catSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, cat.ID, false)
	require.ErrorIs(t, err, domain.ErrCategoryHasTransactions)

	// Cascade tombstones the category and the referencing transactions.
	require.NoError(t, catSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, cat.ID, true))
	_, err = catSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, cat.ID)
	require.ErrorIs(t, err, domain.ErrCategoryNotFound)
	for _, id := range txIDs {
		_, err := txSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, id)
		require.ErrorIs(t, err, domain.ErrTransactionNotFound)
	}

	// Every tombstone landed in the change feed (category + 2 transactions).
	changes, err := store.PullChanges(ctx, domain.Scope{HouseholdID: userHH}, 0, 1000)
	require.NoError(t, err)
	tombstones := 0
	for _, ch := range changes {
		if ch.Action == domain.SyncChangeTombstone {
			tombstones++
		}
	}
	assert.Equal(t, 3, tombstones)
}

func TestCategoryService_CascadeDeleteByAnyMember(t *testing.T) {
	t.Parallel()
	f := newIsolationFixture(t)
	ctx := context.Background()
	acct := seedFakeAccount(t, f.store, domain.Scope{HouseholdID: f.ownerHH}, f.owner.ID)
	cat := seedFakeCategory(
		t,
		f.store,
		domain.Scope{HouseholdID: f.ownerHH},
		f.owner.ID,
		"Общее",
		domain.TransactionTypeExpense,
	)
	// The owner's transaction; the sibling (a member, not the owner) cascades.
	_, err := f.txSvc.Create(
		ctx,
		domain.Scope{HouseholdID: f.ownerHH, ActorID: f.owner.ID},
		domain.CreateTransactionParams{
			Type: domain.TransactionTypeExpense, Amount: 200, OccurredAt: time.Now().UTC(),
			AccountID: &acct.ID, CategoryID: &cat.ID,
		},
	)
	require.NoError(t, err)

	require.NoError(t, f.catSvc.Delete(ctx, domain.Scope{HouseholdID: f.ownerHH, ActorID: f.sibling.ID}, cat.ID, true))
	_, err = f.catSvc.Get(ctx, domain.Scope{HouseholdID: f.ownerHH}, cat.ID)
	require.ErrorIs(t, err, domain.ErrCategoryNotFound)
}
