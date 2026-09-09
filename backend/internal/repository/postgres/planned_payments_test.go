package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// Planned-payment repository mechanics against real Postgres: anchor/next_due
// handling, CAS update classification (tombstoned = not-found, live mismatch
// = version conflict), the account/category live-only in-use guards, the
// unguarded delete, CHECK constraints, and change-log participation
// (including the sync-tx advancement used by the auto-confirm job).

func seedExpenseCategory(t *testing.T, householdID, userID uuid.UUID, name string) *domain.Category {
	t.Helper()
	ctx := newCtx(t)
	c, err := testRepo.CreateCategory(ctx, domain.CreateCategoryParams{
		HouseholdID: householdID, UserID: userID,
		Name: name, Type: domain.TransactionTypeExpense, Icon: "x", Color: "#fff",
	})
	if err != nil {
		t.Fatalf("seedExpenseCategory: %v", err)
	}
	return c
}

func planParams(householdID, userID, accountID, categoryID uuid.UUID) domain.CreatePlannedPaymentParams {
	return domain.CreatePlannedPaymentParams{
		HouseholdID: householdID,
		UserID:      userID,
		Type:        domain.TransactionTypeExpense,
		Amount:      59900,
		Name:        "Netflix",
		AccountID:   accountID,
		CategoryID:  categoryID,
		NextDue:     time.Date(2026, 9, 5, 0, 0, 0, 0, time.UTC),
		Regularity:  domain.PlannedRegularityMonthly,
		ConfirmMode: domain.PlannedConfirmManual,
		Reminder:    domain.PlannedReminderDayBefore,
	}
}

func TestRepository_PlannedPayments_CRUDGuardsAndSync(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Postgres")
	}

	ctx := newCtx(t)
	user := seedUser(t, "plans")
	userHH := householdOf(t, user.ID)
	account := seedAccount(t, userHH, user.ID)
	category := seedExpenseCategory(t, userHH, user.ID, "Подписки")

	created, err := testRepo.CreatePlannedPayment(ctx, planParams(userHH, user.ID, account.ID, category.ID))
	require.NoError(t, err)
	assert.Equal(t, 1, created.Version)
	assert.True(t, created.AnchorDate.Equal(created.NextDue), "create anchors at next_due")

	t.Run("duplicate client id rejected, duplicate names legal", func(t *testing.T) {
		params := planParams(userHH, user.ID, account.ID, category.ID)
		params.ID = created.ID
		_, err := testRepo.CreatePlannedPayment(ctx, params)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentAlreadyExists)

		_, err = testRepo.CreatePlannedPayment(ctx, planParams(userHH, user.ID, account.ID, category.ID))
		require.NoError(t, err, "two live plans may share a name")
	})

	t.Run("scoping: another user sees not-found", func(t *testing.T) {
		intruder := seedUser(t, "plans-intruder")
		intruderHH := householdOf(t, intruder.ID)
		_, err := testRepo.GetPlannedPayment(ctx, domain.Scope{HouseholdID: intruderHH}, created.ID)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentNotFound)
	})

	t.Run("update CAS, note semantics, anchor reset", func(t *testing.T) {
		name := "Netflix Premium"
		updated, err := testRepo.UpdatePlannedPayment(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdatePlannedPaymentParams{
				Name: &name, Version: 1,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, 2, updated.Version)
		assert.True(t, updated.AnchorDate.Equal(created.AnchorDate), "name change keeps the anchor")

		newDue := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
		reset, err := testRepo.UpdatePlannedPayment(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdatePlannedPaymentParams{
				NextDue: &newDue, Version: 2,
			},
		)
		require.NoError(t, err)
		assert.True(t, reset.AnchorDate.Equal(newDue), "next_due change resets the anchor")

		stale := int64(1)
		_, err = testRepo.UpdatePlannedPayment(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdatePlannedPaymentParams{
				Amount: &stale, Version: 1,
			},
		)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentVersionConflict)
	})

	t.Run("in-use guards count live plans only", func(t *testing.T) {
		require.ErrorIs(
			t,
			testRepo.DeleteAccount(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, account.ID),
			domain.ErrAccountHasPlannedPayments,
		)
		require.ErrorIs(
			t,
			testRepo.DeleteCategory(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, category.ID, false),
			domain.ErrCategoryHasPlannedPayments,
		)

		// Tombstone every live plan of the account (the duplicate-name subtest
		// added a second one) through the sync surface; the guards clear.
		plans, err := testRepo.GetPlannedPayments(
			ctx,
			domain.Scope{HouseholdID: userHH},
			domain.GetPlannedPaymentsParams{},
		)
		require.NoError(t, err)
		for _, p := range plans {
			planID := p.ID
			require.NoError(
				t,
				testRepo.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: userHH}, func(tx repository.SyncTx) error {
					_, err := tx.TombstonePlannedPayment(
						ctx,
						domain.Scope{HouseholdID: userHH, ActorID: user.ID},
						planID,
					)
					return err
				}),
			)
		}
		require.NoError(t, testRepo.DeleteAccount(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, account.ID))
	})

	t.Run("tombstoned reads classify as not-found", func(t *testing.T) {
		_, err := testRepo.GetPlannedPayment(ctx, domain.Scope{HouseholdID: userHH}, created.ID)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentNotFound)
		amount := int64(1)
		_, err = testRepo.UpdatePlannedPayment(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdatePlannedPaymentParams{
				Amount: &amount, Version: 4,
			},
		)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentNotFound)
	})
}

func TestRepository_PlannedPayments_CheckConstraintsChangeLogAndAdvancement(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Postgres")
	}

	ctx := newCtx(t)
	user := seedUser(t, "plans-checks")
	userHH := householdOf(t, user.ID)
	account := seedAccount(t, userHH, user.ID)
	category := seedExpenseCategory(t, userHH, user.ID, "Развлечения")

	// CHECK constraints reject invalid enums and non-positive amounts.
	invalid := planParams(userHH, user.ID, account.ID, category.ID)
	invalid.Regularity = "biweekly"
	_, err := testRepo.CreatePlannedPayment(ctx, invalid)
	require.Error(t, err, "invalid regularity must fail the CHECK constraint")

	invalid = planParams(userHH, user.ID, account.ID, category.ID)
	invalid.Amount = 0
	_, err = testRepo.CreatePlannedPayment(ctx, invalid)
	require.Error(t, err, "non-positive amount must fail the CHECK constraint")

	plan, err := testRepo.CreatePlannedPayment(ctx, planParams(userHH, user.ID, account.ID, category.ID))
	require.NoError(t, err)

	// REST update + delete are versioned mutations that land in the change log.
	name := "Netflix 2027"
	_, err = testRepo.UpdatePlannedPayment(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		plan.ID,
		domain.UpdatePlannedPaymentParams{
			Name: &name, Version: 1,
		},
	)
	require.NoError(t, err)

	// The sync-tx advancement (auto-confirm job path) bumps next_due and the
	// version and appends its own change-log row.
	var advanced *domain.PlannedPayment
	err = testRepo.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: userHH}, func(tx repository.SyncTx) error {
		next := domain.AdvanceNextDue(plan.NextDue, plan.AnchorDate, plan.Regularity)
		advanced, err = tx.AdvancePlannedPayment(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			plan.ID,
			next,
		)
		return err
	})
	require.NoError(t, err)
	assert.True(t, advanced.NextDue.Equal(time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)))
	assert.Equal(t, 3, advanced.Version)

	// Unguarded delete is a tombstone with a version bump.
	require.NoError(t, testRepo.DeletePlannedPayment(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, plan.ID))

	changes, err := testRepo.PullChanges(ctx, domain.Scope{HouseholdID: userHH}, 0, 100)
	require.NoError(t, err)
	var upserts, tombstones, accounts, categories int
	for _, change := range changes {
		switch {
		case change.Entity == domain.SyncEntityPlannedPayment && change.Action == domain.SyncChangeUpsert:
			upserts++
			if st, ok := change.Data.(*domain.PlannedPaymentFullState); ok {
				assert.Equal(t, "2026-10-05", st.NextDue.Format("2006-01-02"))
				assert.Equal(t, "2026-09-05", st.AnchorDate.Format("2006-01-02"))
			} else {
				t.Fatalf("upsert data is %T, want *PlannedPaymentFullState", change.Data)
			}
		case change.Entity == domain.SyncEntityPlannedPayment && change.Action == domain.SyncChangeTombstone:
			tombstones++
			assert.Equal(t, 4, change.Version)
		case change.Entity == domain.SyncEntityAccount:
			accounts++
		case change.Entity == domain.SyncEntityCategory:
			categories++
		}
	}
	assert.Equal(t, 3, upserts, "create + update + advancement")
	assert.Equal(t, 1, tombstones)
	assert.Equal(t, 1, accounts)
	assert.Equal(t, 1, categories)

	// Type-filtered listing.
	expenseType := domain.TransactionTypeExpense
	incomeCategory, err := testRepo.CreateCategory(ctx, domain.CreateCategoryParams{
		HouseholdID: userHH,
		UserID:      user.ID, Name: "Работа", Type: domain.TransactionTypeIncome, Icon: "x", Color: "#fff",
	})
	require.NoError(t, err)
	income := planParams(userHH, user.ID, account.ID, incomeCategory.ID)
	income.Type = domain.TransactionTypeIncome
	_, err = testRepo.CreatePlannedPayment(ctx, income)
	require.NoError(t, err)

	expenses, err := testRepo.GetPlannedPayments(
		ctx,
		domain.Scope{HouseholdID: userHH},
		domain.GetPlannedPaymentsParams{Type: &expenseType},
	)
	require.NoError(t, err)
	for _, p := range expenses {
		assert.Equal(t, domain.TransactionTypeExpense, p.Type)
	}
}
