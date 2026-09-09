package plannedconfirm_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/jobs/plannedconfirm"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// The job is driven through Run with a short interval (the retention-test
// pattern): the startup pass executes the due plans, and later ticks prove
// idempotency. A daily plan three days behind makes the occurrence count
// deterministic regardless of the day the test runs on.

func dayStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func runJobUntilSettled(t *testing.T, store *fakes.Store) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	job := plannedconfirm.New(store, logger.NewDiscardLogger(), 20*time.Millisecond)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = job.Run(ctx)
	}()
	// Startup pass + several ticks, then stop; the assertions below observe
	// the settled state.
	time.Sleep(100 * time.Millisecond)
	cancel()
	<-done
}

func TestJob_ExecutesDueAutoPlansWithCatchUp(t *testing.T) {
	if testing.Short() {
		t.Skip("timing-based")
	}
	t.Parallel()

	store := fakes.New()
	ctx := context.Background()

	user, householdID := seedFakePlansUser(t, store)
	account := seedFakePlansAccount(t, store, householdID, user.ID)
	category := seedFakePlansCategory(t, store, householdID, user.ID)

	today := dayStart(time.Now())
	start := today.AddDate(0, 0, -3)

	plan, err := store.CreatePlannedPayment(ctx, domain.CreatePlannedPaymentParams{
		HouseholdID: householdID, UserID: user.ID, Type: domain.TransactionTypeExpense, Amount: 59900,
		Name: "Netflix", AccountID: account.ID, CategoryID: category.ID,
		NextDue: start, Regularity: domain.PlannedRegularityDaily,
		ConfirmMode: domain.PlannedConfirmAuto, Reminder: domain.PlannedReminderOff,
	})
	require.NoError(t, err)

	// A manual plan due long ago must NOT be auto-executed.
	manual, err := store.CreatePlannedPayment(ctx, domain.CreatePlannedPaymentParams{
		HouseholdID: householdID, UserID: user.ID, Type: domain.TransactionTypeExpense, Amount: 240000,
		Name: "ЖКХ", AccountID: account.ID, CategoryID: category.ID,
		NextDue: start, Regularity: domain.PlannedRegularityDaily,
		ConfirmMode: domain.PlannedConfirmManual, Reminder: domain.PlannedReminderOff,
	})
	require.NoError(t, err)

	runJobUntilSettled(t, store)

	// Daily occurrences due: today-3, today-2, today-1, today = four.
	transactions, err := store.GetTransactions(
		ctx,
		domain.Scope{HouseholdID: householdID},
		domain.GetTransactionsParams{},
	)
	require.NoError(t, err)
	require.Len(t, transactions, 4)
	for _, txn := range transactions {
		assert.Equal(t, int64(59900), txn.Amount)
		assert.Equal(t, "Netflix", txn.Description, "note = plan name")
		assert.Equal(t, domain.TransactionTypeExpense, txn.Type)
		assert.Equal(
			t,
			12,
			txn.OccurredAt.UTC().Hour(),
			"occurred_at = the occurrence date at 12:00 UTC",
		)
		assert.Equal(t, plan.AccountID, *txn.AccountID)
		assert.Equal(t, plan.CategoryID, *txn.CategoryID)
	}

	updated, err := store.GetPlannedPayment(ctx, domain.Scope{HouseholdID: householdID}, plan.ID)
	require.NoError(t, err)
	assert.True(t, updated.NextDue.Equal(today.AddDate(0, 0, 1)),
		"next_due lands on the first future occurrence")
	assert.Equal(t, 5, updated.Version, "one version bump per executed occurrence")

	manualPlan, err := store.GetPlannedPayment(ctx, domain.Scope{HouseholdID: householdID}, manual.ID)
	require.NoError(t, err)
	assert.True(t, manualPlan.NextDue.Equal(start), "manual plans are never auto-executed")
	assert.Equal(t, 1, manualPlan.Version)
}

func TestJob_RerunIsIdempotentAndDeletedPlansProduceNothing(t *testing.T) {
	if testing.Short() {
		t.Skip("timing-based")
	}
	t.Parallel()

	store := fakes.New()
	ctx := context.Background()

	user, householdID := seedFakePlansUser(t, store)
	account := seedFakePlansAccount(t, store, householdID, user.ID)
	category := seedFakePlansCategory(t, store, householdID, user.ID)

	today := dayStart(time.Now())
	plan, err := store.CreatePlannedPayment(ctx, domain.CreatePlannedPaymentParams{
		HouseholdID: householdID, UserID: user.ID, Type: domain.TransactionTypeExpense, Amount: 1000,
		AccountID: account.ID, CategoryID: category.ID,
		NextDue: today.AddDate(0, 0, -1), Regularity: domain.PlannedRegularityDaily,
		ConfirmMode: domain.PlannedConfirmAuto, Reminder: domain.PlannedReminderOff,
	})
	require.NoError(t, err)
	require.NoError(
		t,
		store.DeletePlannedPayment(ctx, domain.Scope{HouseholdID: householdID, ActorID: user.ID}, plan.ID),
	)

	runJobUntilSettled(t, store)

	transactions, err := store.GetTransactions(
		ctx,
		domain.Scope{HouseholdID: householdID},
		domain.GetTransactionsParams{},
	)
	require.NoError(t, err)
	assert.Empty(t, transactions, "a deleted overdue plan produces nothing")
}

func seedFakePlansUser(t *testing.T, store *fakes.Store) (*domain.User, uuid.UUID) {
	t.Helper()
	u, err := store.RegisterUser(context.Background(), domain.RegisterUserParams{
		Email:        time.Now().Format("150405.000000000") + "@plans.example.com",
		PasswordHash: "hashed",
	})
	require.NoError(t, err)
	m, err := store.GetMembershipByUser(context.Background(), u.ID)
	require.NoError(t, err)
	return u, m.HouseholdID
}

func seedFakePlansAccount(t *testing.T, store *fakes.Store, householdID, userID uuid.UUID) *domain.Account {
	t.Helper()
	a, err := store.CreateAccount(context.Background(), domain.CreateAccountParams{
		HouseholdID: householdID, UserID: userID, Name: "Карта", Currency: "RUB",
	})
	require.NoError(t, err)
	return a
}

func seedFakePlansCategory(t *testing.T, store *fakes.Store, householdID, userID uuid.UUID) *domain.Category {
	t.Helper()
	c, err := store.CreateCategory(context.Background(), domain.CreateCategoryParams{
		HouseholdID: householdID, UserID: userID, Name: "Подписки", Type: domain.TransactionTypeExpense,
	})
	require.NoError(t, err)
	return c
}
