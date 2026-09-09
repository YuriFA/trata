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

func planServices(t *testing.T) (*service.PlannedPaymentService, *fakes.Store) {
	t.Helper()
	store := fakes.New()
	return service.NewPlannedPaymentService(store, store, store), store
}

func seedPlanRefs(
	t *testing.T,
	store *fakes.Store,
	scope domain.Scope, userID uuid.UUID,
) (*domain.Account, *domain.Category) {
	t.Helper()
	account, err := store.CreateAccount(context.Background(), domain.CreateAccountParams{
		HouseholdID: scope.HouseholdID, UserID: userID, Name: "Карта", Currency: "RUB",
	})
	require.NoError(t, err)
	category, err := store.CreateCategory(context.Background(), domain.CreateCategoryParams{
		HouseholdID: scope.HouseholdID, UserID: userID, Name: "Подписки", Type: domain.TransactionTypeExpense,
	})
	require.NoError(t, err)
	return account, category
}

func validPlanParams(userID, accountID, categoryID uuid.UUID) domain.CreatePlannedPaymentParams {
	return domain.CreatePlannedPaymentParams{
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
		Note:        "family plan",
	}
}

func TestPlannedPaymentService_Rules(t *testing.T) {
	t.Parallel()
	planSvc, store := planServices(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	other := seedFakeUser(t, store)
	account, category := seedPlanRefs(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	accountID, categoryID := account.ID, category.ID

	created, err := planSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		validPlanParams(user.ID, accountID, categoryID),
	)
	require.NoError(t, err)
	assert.Equal(t, "Netflix", created.Name)
	assert.Equal(t, created.NextDue, created.AnchorDate, "create anchors the series at next_due")
	assert.Equal(t, 1, created.Version)

	t.Run("duplicate names are legal", func(t *testing.T) {
		t.Parallel()
		_, err := planSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			validPlanParams(user.ID, accountID, categoryID),
		)
		require.NoError(t, err)
	})

	t.Run("unknown account rejected", func(t *testing.T) {
		t.Parallel()
		params := validPlanParams(user.ID, accountID, categoryID)
		params.AccountID = uuid.New()
		_, err := planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, params)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentAccountNotFound)
	})

	t.Run("foreign account rejected", func(t *testing.T) {
		t.Parallel()
		foreignAccount, err := store.CreateAccount(ctx, domain.CreateAccountParams{
			UserID: other.ID, Name: "Чужая", Currency: "RUB",
		})
		require.NoError(t, err)
		params := validPlanParams(user.ID, accountID, categoryID)
		params.AccountID = foreignAccount.ID
		_, err = planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, params)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentAccountNotFound)
	})

	t.Run("unknown category rejected", func(t *testing.T) {
		t.Parallel()
		params := validPlanParams(user.ID, accountID, categoryID)
		params.CategoryID = uuid.New()
		_, err := planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, params)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentCategoryNotFound)
	})

	t.Run("type-mismatched category rejected", func(t *testing.T) {
		t.Parallel()
		incomeCategory, err := store.CreateCategory(ctx, domain.CreateCategoryParams{
			HouseholdID: userHH, UserID: user.ID, Name: "Зарплата", Type: domain.TransactionTypeIncome,
		})
		require.NoError(t, err)
		params := validPlanParams(user.ID, accountID, categoryID)
		params.CategoryID = incomeCategory.ID
		_, err = planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, params)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentCategoryTypeMismatch)
	})

	t.Run("past next_due accepted", func(t *testing.T) {
		t.Parallel()
		params := validPlanParams(user.ID, accountID, categoryID)
		params.NextDue = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		p, err := planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, params)
		require.NoError(t, err)
		assert.True(t, p.NextDue.Before(time.Now().UTC()))
	})

	t.Run("client id duplicate rejected", func(t *testing.T) {
		t.Parallel()
		params := validPlanParams(user.ID, accountID, categoryID)
		params.ID = created.ID
		_, err := planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, params)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentAlreadyExists)
	})

	t.Run("no-op update rejected", func(t *testing.T) {
		t.Parallel()
		_, err := planSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdatePlannedPaymentParams{Version: created.Version},
		)
		require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)
	})

	t.Run("version conflict on stale update", func(t *testing.T) {
		t.Parallel()
		p, err := planSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			validPlanParams(user.ID, accountID, categoryID),
		)
		require.NoError(t, err)
		amount := int64(64900)
		_, err = planSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			p.ID,
			domain.UpdatePlannedPaymentParams{
				Amount: &amount, Version: p.Version,
			},
		)
		require.NoError(t, err)
		_, err = planSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			p.ID,
			domain.UpdatePlannedPaymentParams{
				Amount: &amount, Version: p.Version,
			},
		)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentVersionConflict)
	})

	t.Run("next_due change resets the anchor", func(t *testing.T) {
		t.Parallel()
		p, err := planSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			validPlanParams(user.ID, accountID, categoryID),
		)
		require.NoError(t, err)
		newDue := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
		updated, err := planSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			p.ID,
			domain.UpdatePlannedPaymentParams{
				NextDue: &newDue, Version: p.Version,
			},
		)
		require.NoError(t, err)
		assert.True(t, updated.AnchorDate.Equal(newDue))
		assert.True(t, updated.NextDue.Equal(newDue))
	})

	t.Run("re-point account validates refs", func(t *testing.T) {
		t.Parallel()
		p, err := planSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			validPlanParams(user.ID, accountID, categoryID),
		)
		require.NoError(t, err)
		newAccount := uuid.New()
		_, err = planSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			p.ID,
			domain.UpdatePlannedPaymentParams{
				AccountID: &newAccount, Version: p.Version,
			},
		)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentAccountNotFound)
	})

	t.Run("update of a missing plan is not-found", func(t *testing.T) {
		t.Parallel()
		amount := int64(1)
		_, err := planSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			uuid.New(),
			domain.UpdatePlannedPaymentParams{
				Amount: &amount, Version: 1,
			},
		)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentNotFound)
	})

	t.Run("list filters by type and excludes tombstones", func(t *testing.T) {
		t.Parallel()
		incomeCategory, err := store.CreateCategory(ctx, domain.CreateCategoryParams{
			HouseholdID: userHH, UserID: user.ID, Name: "Работа", Type: domain.TransactionTypeIncome,
		})
		require.NoError(t, err)
		incomeParams := validPlanParams(user.ID, accountID, incomeCategory.ID)
		incomeParams.Type = domain.TransactionTypeIncome
		incomeParams.Name = "Зарплата"
		_, err = planSvc.Create(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, incomeParams)
		require.NoError(t, err)

		expenseType := domain.TransactionTypeExpense
		expenses, err := planSvc.List(
			ctx,
			domain.Scope{HouseholdID: userHH},
			domain.GetPlannedPaymentsParams{Type: &expenseType},
		)
		require.NoError(t, err)
		for _, p := range expenses {
			assert.Equal(t, domain.TransactionTypeExpense, p.Type)
		}

		require.NoError(t, planSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, created.ID))
		all, err := planSvc.List(ctx, domain.Scope{HouseholdID: userHH}, domain.GetPlannedPaymentsParams{})
		require.NoError(t, err)
		for _, p := range all {
			assert.NotEqual(t, created.ID, p.ID)
		}
	})

	t.Run("delete always allowed, keeps transactions", func(t *testing.T) {
		t.Parallel()
		p, err := planSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			validPlanParams(user.ID, accountID, categoryID),
		)
		require.NoError(t, err)
		require.NoError(t, planSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, p.ID))
		require.NoError(
			t,
			planSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, p.ID),
			"second delete of the tombstoned plan stays idempotent in the fake",
		)
		_, err = planSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, p.ID)
		require.ErrorIs(t, err, domain.ErrPlannedPaymentNotFound)
	})
}

func TestPlannedPaymentService_InUseGuards(t *testing.T) {
	t.Parallel()
	planSvc, store := planServices(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	account, category := seedPlanRefs(t, store, domain.Scope{HouseholdID: userHH}, user.ID)
	accountID, categoryID := account.ID, category.ID
	_, err := planSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		validPlanParams(user.ID, accountID, categoryID),
	)
	require.NoError(t, err)

	require.ErrorIs(
		t,
		store.DeleteAccount(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, accountID),
		domain.ErrAccountHasPlannedPayments,
	)
	require.ErrorIs(
		t,
		store.DeleteCategory(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, categoryID, false),
		domain.ErrCategoryHasPlannedPayments,
	)

	tombstoned, err := planSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		validPlanParams(user.ID, accountID, categoryID),
	)
	require.NoError(t, err)
	require.NoError(t, planSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, tombstoned.ID))
}
