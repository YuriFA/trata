package service_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// Push-protocol characterization (ADR-0003): these pin the frozen per-item
// outcomes of the engine-backed entities against the fake store - the
// four-way conflict classification (already-exists / not-found / deleted /
// version), delete idempotence, in-use guards, name-uniqueness pre-checks,
// opId replay, and decode/action validation. They are behavior tests: the
// same cases must keep passing as each entity's twin migrates onto the
// engine. Cross-household adoption semantics are Postgres-only (the fake's
// AdoptOrphanedID is a stub) and live in the e2e household-join suite.

func pushFixture(t *testing.T) (*service.SyncService, *domain.User, uuid.UUID) {
	t.Helper()
	store := fakes.New()
	user := seedFakeUser(t, store)
	householdID := householdOf(t, store, user.ID)
	return service.NewSyncService(store), user, householdID
}

func pushOne(
	t *testing.T,
	syncSvc *service.SyncService,
	householdID, userID uuid.UUID,
	op domain.SyncOperation,
) domain.SyncPushResult {
	t.Helper()
	results, err := syncSvc.Push(
		context.Background(),
		domain.Scope{HouseholdID: householdID, ActorID: userID},
		[]domain.SyncOperation{op},
	)
	require.NoError(t, err)
	require.Len(t, results, 1)
	return results[0]
}

func upsertOp(entity string, opID, recordID uuid.UUID, base int, data any) domain.SyncOperation {
	return domain.SyncOperation{
		OpID: opID, Entity: entity, Action: domain.SyncActionUpsert,
		ID: recordID, BaseVersion: base, Data: mustJSON(data),
	}
}

func deleteOp(entity string, opID, recordID uuid.UUID) domain.SyncOperation {
	return domain.SyncOperation{
		OpID: opID, Entity: entity, Action: domain.SyncActionDelete, ID: recordID,
	}
}

// cascadeDeleteOp is a category delete carrying the cascade flag in its
// data payload ({"cascade": true}).
func cascadeDeleteOp(entity string, opID, recordID uuid.UUID) domain.SyncOperation {
	return domain.SyncOperation{
		OpID: opID, Entity: entity, Action: domain.SyncActionDelete, ID: recordID,
		Data: json.RawMessage(`{"cascade":true}`),
	}
}

func TestSyncPush_AccountProtocol(t *testing.T) {
	t.Parallel()
	accountData := &domain.AccountFullState{Name: "Карта", Currency: "RUB", OpeningBalance: 100}

	t.Run("create at base 0 applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), uuid.New(), 0, accountData))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
		assert.Empty(t, res.Code)
	})

	t.Run(
		"a different opId claiming the id is an already-exists conflict with server state",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			recordID := uuid.New()
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, 0, accountData))
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			res := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, 0, accountData))
			assert.Equal(t, domain.SyncStatusConflict, res.Status)
			assert.Equal(t, domain.SyncCodeAlreadyExists, res.Code)
			require.NotNil(t, res.ServerState)
			assert.Equal(t, 1, res.ServerState.Version)
			assert.False(t, res.ServerState.Deleted)
			assert.NotNil(t, res.ServerState.Data)
		},
	)

	t.Run("update on the current base applies and bumps the version", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		recordID := uuid.New()
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, 0, accountData))
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, 1, accountData))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 2, res.Version)
	})

	t.Run("update on a stale base conflicts with the current server state", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		recordID := uuid.New()
		for _, base := range []int{0, 1} {
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, base, accountData))
			require.Equal(t, domain.SyncStatusApplied, created.Status)
		}

		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, 1, accountData))
		assert.Equal(t, domain.SyncStatusConflict, res.Status)
		assert.Equal(t, domain.SyncCodeVersionConflict, res.Code)
		require.NotNil(t, res.ServerState)
		assert.Equal(t, 2, res.ServerState.Version)
		assert.NotNil(t, res.ServerState.Data)
	})

	t.Run("update on an unknown id conflicts with the zero state", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), uuid.New(), 5, accountData))
		assert.Equal(t, domain.SyncStatusConflict, res.Status)
		assert.Equal(t, domain.SyncCodeVersionConflict, res.Code)
		require.NotNil(t, res.ServerState)
		assert.Equal(t, 0, res.ServerState.Version)
		assert.Nil(t, res.ServerState.Data)
	})

	t.Run("delete of an unknown id is idempotently applied at version 0", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityAccount, uuid.New(), uuid.New()))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 0, res.Version)
	})

	t.Run(
		"delete tombstones, repeats idempotently, and upserts hit the deleted conflict",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			recordID := uuid.New()
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityAccount, uuid.New(), recordID, 0, accountData))
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			deleted := pushOne(t, syncSvc, householdID, user.ID,
				deleteOp(domain.SyncEntityAccount, uuid.New(), recordID))
			assert.Equal(t, domain.SyncStatusApplied, deleted.Status)
			assert.Equal(t, 2, deleted.Version)

			again := pushOne(t, syncSvc, householdID, user.ID,
				deleteOp(domain.SyncEntityAccount, uuid.New(), recordID))
			assert.Equal(t, domain.SyncStatusApplied, again.Status)
			assert.Equal(t, deleted.Version, again.Version)

			res := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityAccount,
					uuid.New(),
					recordID,
					deleted.Version,
					accountData,
				),
			)
			assert.Equal(t, domain.SyncStatusConflict, res.Status)
			assert.Equal(t, domain.SyncCodeDeletedConflict, res.Code)
			require.NotNil(t, res.ServerState)
			assert.Equal(t, deleted.Version, res.ServerState.Version)
			assert.True(t, res.ServerState.Deleted)
			assert.Nil(t, res.ServerState.Data)
		},
	)

	t.Run("delete of an account with live transactions is a per-item error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		busy := uuid.New()
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), busy, 0, accountData))
		require.Equal(t, domain.SyncStatusApplied, created.Status)
		pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeAdjustment, Amount: 500,
					OccurredAt: time.Now().UTC(), AccountID: &busy,
				}))

		res := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityAccount, uuid.New(), busy))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "ACCOUNT_IN_USE", res.Code)
		assert.Equal(t, "account has transactions and cannot be deleted", res.Message)
	})

	t.Run(
		"delete of an account with live planned payments is a per-item error",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			busy := uuid.New()
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityAccount, uuid.New(), busy, 0, accountData))
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			// A live plan referencing the account (the plan's own reference
			// validation needs a live expense account + category first).
			categoryID := uuid.New()
			for _, op := range []domain.SyncOperation{
				upsertOp(domain.SyncEntityCategory, uuid.New(), categoryID, 0,
					&domain.CategoryFullState{Name: "Подписки", Type: domain.TransactionTypeExpense}),
				upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0,
					&domain.PlannedPaymentFullState{
						Type: domain.TransactionTypeExpense, Amount: 500, Name: "Интернет",
						AccountID: busy, CategoryID: categoryID,
						NextDue: domain.NewDate(2026, 10, 1), AnchorDate: domain.NewDate(2026, 9, 1),
						Regularity: domain.PlannedRegularityMonthly, ConfirmMode: domain.PlannedConfirmManual,
						Reminder: domain.PlannedReminderOff,
					}),
			} {
				require.Equal(
					t,
					domain.SyncStatusApplied,
					pushOne(t, syncSvc, householdID, user.ID, op).Status,
				)
			}

			res := pushOne(t, syncSvc, householdID, user.ID,
				deleteOp(domain.SyncEntityAccount, uuid.New(), busy))
			assert.Equal(t, domain.SyncStatusError, res.Status)
			assert.Equal(t, "ACCOUNT_IN_USE", res.Code)
			assert.Equal(t, "account has planned payments and cannot be deleted", res.Message)
		},
	)

	t.Run("opId replay returns the stored result with no new mutation", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		opID := uuid.New()
		fresh := uuid.New()
		first := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, opID, fresh, 0, accountData))
		replayed := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, opID, fresh, 0, accountData))
		assert.Equal(t, first, replayed)

		page, err := syncSvc.Pull(
			context.Background(),
			domain.Scope{HouseholdID: householdID},
			0,
			nil,
		)
		require.NoError(t, err)
		accountCreates := 0
		for _, change := range page.Changes {
			if change.Entity == domain.SyncEntityAccount && change.ID == fresh {
				accountCreates++
			}
		}
		assert.Equal(t, 1, accountCreates, "the replay must not append a second change")
	})

	t.Run("undecodable data is a per-item validation error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID, domain.SyncOperation{
			OpID: uuid.New(), Entity: domain.SyncEntityAccount, Action: domain.SyncActionUpsert,
			ID: uuid.New(), Data: []byte(`{not json`),
		})
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "VALIDATION_FAILED", res.Code)
		assert.Equal(t, "invalid account data", res.Message)
	})

	t.Run("unknown action and unknown entity are per-item validation errors", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		action := pushOne(t, syncSvc, householdID, user.ID, domain.SyncOperation{
			OpID: uuid.New(), Entity: domain.SyncEntityAccount, Action: "purge", ID: uuid.New(),
		})
		assert.Equal(t, domain.SyncStatusError, action.Status)
		assert.Equal(t, "VALIDATION_FAILED", action.Code)
		assert.Equal(t, "unknown action", action.Message)

		entity := pushOne(t, syncSvc, householdID, user.ID, domain.SyncOperation{
			OpID: uuid.New(), Entity: "widget", Action: domain.SyncActionUpsert, ID: uuid.New(), Data: []byte(`{}`),
		})
		assert.Equal(t, domain.SyncStatusError, entity.Status)
		assert.Equal(t, "VALIDATION_FAILED", entity.Code)
		assert.Equal(t, "unknown entity", entity.Message)
	})
}

func TestSyncPush_DebtorProtocol(t *testing.T) {
	t.Parallel()

	t.Run("create at base 0 applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityDebtor, uuid.New(), uuid.New(), 0,
				&domain.DebtorFullState{Name: "Анна", Note: "", Currency: "RUB"}))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
	})

	t.Run("duplicate live name under a different id is a per-item error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityDebtor, uuid.New(), uuid.New(), 0,
				&domain.DebtorFullState{Name: "Анна", Note: "", Currency: "RUB"}))
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityDebtor, uuid.New(), uuid.New(), 0,
				&domain.DebtorFullState{Name: "Анна", Note: "другая", Currency: "RUB"}))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "DEBTOR_ALREADY_EXISTS", res.Code)
	})

	t.Run(
		"update on the current base applies, unknown id conflicts with the zero state",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			recordID := uuid.New()
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityDebtor, uuid.New(), recordID, 0,
					&domain.DebtorFullState{Name: "Борис", Note: "x", Currency: "RUB"}))
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			updated := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityDebtor, uuid.New(), recordID, 1,
					&domain.DebtorFullState{Name: "Борис", Note: "y", Currency: "RUB"}))
			assert.Equal(t, domain.SyncStatusApplied, updated.Status)
			assert.Equal(t, 2, updated.Version)

			unknown := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityDebtor, uuid.New(), uuid.New(), 3,
					&domain.DebtorFullState{Name: "Григорий", Note: "", Currency: "RUB"}))
			assert.Equal(t, domain.SyncStatusConflict, unknown.Status)
			assert.Equal(t, domain.SyncCodeVersionConflict, unknown.Code)
			require.NotNil(t, unknown.ServerState)
			assert.Equal(t, 0, unknown.ServerState.Version)

			// The name pre-check outranks the four-way classification: a taken
			// name on an unknown id is DEBTOR_ALREADY_EXISTS, not a conflict.
			precheck := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityDebtor, uuid.New(), uuid.New(), 3,
					&domain.DebtorFullState{Name: "Борис", Note: "", Currency: "RUB"}))
			assert.Equal(t, domain.SyncStatusError, precheck.Status)
			assert.Equal(t, "DEBTOR_ALREADY_EXISTS", precheck.Code)
		},
	)

	t.Run("delete of a debtor with live debt operations is a per-item error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		debtorID := uuid.New()
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityDebtor, uuid.New(), debtorID, 0,
				&domain.DebtorFullState{Name: "Вера", Note: "", Currency: "RUB"}))
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityDebtOperation, uuid.New(), uuid.New(), 0,
				&domain.DebtOperationFullState{
					DebtorID: debtorID, Direction: domain.DebtDirectionPayable, Kind: domain.DebtOperationKindDebt,
					Amount: 1000, OccurredAt: time.Now().UTC(),
				}))

		res := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityDebtor, uuid.New(), debtorID))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "DEBTOR_IN_USE", res.Code)
	})
}

func TestSyncPush_CategoryProtocol(t *testing.T) {
	t.Parallel()

	t.Run("create at base 0 applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityCategory, uuid.New(), uuid.New(), 0,
				&domain.CategoryFullState{Name: "Продукты", Type: domain.TransactionTypeExpense}))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
	})

	t.Run("duplicate live name under a different id is a per-item error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityCategory, uuid.New(), uuid.New(), 0,
				&domain.CategoryFullState{Name: "Продукты", Type: domain.TransactionTypeExpense}))
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityCategory, uuid.New(), uuid.New(), 0,
				&domain.CategoryFullState{Name: "Продукты", Type: domain.TransactionTypeIncome}))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "CATEGORY_ALREADY_EXISTS", res.Code)
	})

	t.Run("a non-cashflow type is a per-item shape error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityCategory, uuid.New(), uuid.New(), 0,
				&domain.CategoryFullState{Name: "Переводы", Type: domain.TransactionTypeTransfer}))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "VALIDATION_FAILED", res.Code)
		assert.Equal(t, "invalid category type", res.Message)
	})

	t.Run(
		"update on the current base applies, unknown id conflicts with the zero state",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			recordID := uuid.New()
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(
					domain.SyncEntityCategory,
					uuid.New(),
					recordID,
					0,
					&domain.CategoryFullState{
						Name: "Кафе",
						Type: domain.TransactionTypeExpense,
						Icon: "coffee",
					},
				))
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			updated := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(
					domain.SyncEntityCategory,
					uuid.New(),
					recordID,
					1,
					&domain.CategoryFullState{
						Name: "Кафе",
						Type: domain.TransactionTypeExpense,
						Icon: "food",
					},
				))
			assert.Equal(t, domain.SyncStatusApplied, updated.Status)
			assert.Equal(t, 2, updated.Version)

			unknown := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityCategory, uuid.New(), uuid.New(), 3,
					&domain.CategoryFullState{Name: "Свежая", Type: domain.TransactionTypeExpense}))
			assert.Equal(t, domain.SyncStatusConflict, unknown.Status)
			assert.Equal(t, domain.SyncCodeVersionConflict, unknown.Code)
			require.NotNil(t, unknown.ServerState)
			assert.Equal(t, 0, unknown.ServerState.Version)

			// The name pre-check outranks the four-way classification.
			precheck := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityCategory, uuid.New(), uuid.New(), 3,
					&domain.CategoryFullState{Name: "Кафе", Type: domain.TransactionTypeExpense}))
			assert.Equal(t, domain.SyncStatusError, precheck.Status)
			assert.Equal(t, "CATEGORY_ALREADY_EXISTS", precheck.Code)
		},
	)

	t.Run("delete of a category with live transactions is a per-item error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID := uuid.New()
		categoryID := uuid.New()
		for _, op := range []domain.SyncOperation{
			upsertOp(domain.SyncEntityAccount, uuid.New(), accountID, 0,
				&domain.AccountFullState{Name: "Карта", Currency: "RUB"}),
			upsertOp(domain.SyncEntityCategory, uuid.New(), categoryID, 0,
				&domain.CategoryFullState{Name: "Продукты", Type: domain.TransactionTypeExpense}),
			upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250,
					OccurredAt: time.Now().UTC(), AccountID: &accountID, CategoryID: &categoryID,
				}),
		} {
			require.Equal(
				t,
				domain.SyncStatusApplied,
				pushOne(t, syncSvc, householdID, user.ID, op).Status,
			)
		}

		res := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityCategory, uuid.New(), categoryID))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "CATEGORY_IN_USE", res.Code)
		assert.Equal(t, "category has transactions and cannot be deleted", res.Message)
	})

	t.Run(
		"delete of a category with live planned payments is a per-item error",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			accountID, categoryID := uuid.New(), uuid.New()
			for _, op := range []domain.SyncOperation{
				upsertOp(domain.SyncEntityAccount, uuid.New(), accountID, 0,
					&domain.AccountFullState{Name: "Карта", Currency: "RUB"}),
				upsertOp(domain.SyncEntityCategory, uuid.New(), categoryID, 0,
					&domain.CategoryFullState{Name: "Подписки", Type: domain.TransactionTypeExpense}),
				upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0,
					&domain.PlannedPaymentFullState{
						Type: domain.TransactionTypeExpense, Amount: 500, Name: "Интернет",
						AccountID: accountID, CategoryID: categoryID,
						NextDue: domain.NewDate(2026, 10, 1), AnchorDate: domain.NewDate(2026, 9, 1),
						Regularity: domain.PlannedRegularityMonthly, ConfirmMode: domain.PlannedConfirmManual,
						Reminder: domain.PlannedReminderOff,
					}),
			} {
				require.Equal(
					t,
					domain.SyncStatusApplied,
					pushOne(t, syncSvc, householdID, user.ID, op).Status,
				)
			}

			res := pushOne(t, syncSvc, householdID, user.ID,
				deleteOp(domain.SyncEntityCategory, uuid.New(), categoryID))
			assert.Equal(t, domain.SyncStatusError, res.Status)
			assert.Equal(t, "CATEGORY_IN_USE", res.Code)
			assert.Equal(t, "category has planned payments and cannot be deleted", res.Message)
		},
	)

	t.Run("delete of an unknown id is idempotently applied at version 0", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityCategory, uuid.New(), uuid.New()))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 0, res.Version)
	})

	t.Run("cascade delete tombstones the referencing transactions", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID, txID := uuid.New(), uuid.New(), uuid.New()
		for _, op := range []domain.SyncOperation{
			upsertOp(domain.SyncEntityAccount, uuid.New(), accountID, 0,
				&domain.AccountFullState{Name: "Карта", Currency: "RUB"}),
			upsertOp(domain.SyncEntityCategory, uuid.New(), categoryID, 0,
				&domain.CategoryFullState{Name: "Продукты", Type: domain.TransactionTypeExpense}),
			upsertOp(domain.SyncEntityTransaction, uuid.New(), txID, 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250,
					OccurredAt: time.Now().UTC(), AccountID: &accountID, CategoryID: &categoryID,
				}),
		} {
			require.Equal(
				t,
				domain.SyncStatusApplied,
				pushOne(t, syncSvc, householdID, user.ID, op).Status,
			)
		}

		res := pushOne(t, syncSvc, householdID, user.ID,
			cascadeDeleteOp(domain.SyncEntityCategory, uuid.New(), categoryID))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Positive(t, res.Version)

		// The transaction tombstone travels through the pull feed.
		page, err := syncSvc.Pull(
			context.Background(),
			domain.Scope{HouseholdID: householdID},
			0,
			nil,
		)
		require.NoError(t, err)
		tombstoned := map[string]bool{}
		for _, ch := range page.Changes {
			if ch.Action == domain.SyncChangeTombstone {
				tombstoned[ch.Entity+"/"+ch.ID.String()] = true
			}
		}
		assert.True(
			t,
			tombstoned[domain.SyncEntityCategory+"/"+categoryID.String()],
			"category tombstone in feed",
		)
		assert.True(
			t,
			tombstoned[domain.SyncEntityTransaction+"/"+txID.String()],
			"transaction tombstone in feed",
		)
	})

	t.Run("cascade delete is still blocked by live planned payments", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID := uuid.New(), uuid.New()
		for _, op := range []domain.SyncOperation{
			upsertOp(domain.SyncEntityAccount, uuid.New(), accountID, 0,
				&domain.AccountFullState{Name: "Карта", Currency: "RUB"}),
			upsertOp(domain.SyncEntityCategory, uuid.New(), categoryID, 0,
				&domain.CategoryFullState{Name: "Подписки", Type: domain.TransactionTypeExpense}),
			upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0,
				&domain.PlannedPaymentFullState{
					Type: domain.TransactionTypeExpense, Amount: 500, Name: "Интернет",
					AccountID: accountID, CategoryID: categoryID,
					NextDue: domain.NewDate(2026, 10, 1), AnchorDate: domain.NewDate(2026, 9, 1),
					Regularity: domain.PlannedRegularityMonthly, ConfirmMode: domain.PlannedConfirmManual,
					Reminder: domain.PlannedReminderOff,
				}),
		} {
			require.Equal(
				t,
				domain.SyncStatusApplied,
				pushOne(t, syncSvc, householdID, user.ID, op).Status,
			)
		}

		res := pushOne(t, syncSvc, householdID, user.ID,
			cascadeDeleteOp(domain.SyncEntityCategory, uuid.New(), categoryID))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "CATEGORY_IN_USE", res.Code)
		assert.Equal(t, "category has planned payments and cannot be deleted", res.Message)
	})

	t.Run("malformed cascade delete data is a per-item error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		categoryID := uuid.New()
		require.Equal(t, domain.SyncStatusApplied, pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(
				domain.SyncEntityCategory,
				uuid.New(),
				categoryID,
				0,
				&domain.CategoryFullState{
					Name: "Продукты",
					Type: domain.TransactionTypeExpense,
				},
			)).Status)

		op := domain.SyncOperation{
			OpID: uuid.New(), Entity: domain.SyncEntityCategory,
			Action: domain.SyncActionDelete, ID: categoryID,
			Data: json.RawMessage(`{"cascade":"yes"}`),
		}
		res := pushOne(t, syncSvc, householdID, user.ID, op)
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "VALIDATION_FAILED", res.Code)
		assert.Equal(t, "invalid category delete data", res.Message)
	})
}

func TestSyncPush_DebtOperationProtocol(t *testing.T) {
	t.Parallel()
	debtorID := uuid.New()
	seedDebtor := func(t *testing.T, syncSvc *service.SyncService, householdID, userID uuid.UUID) {
		t.Helper()
		created := pushOne(t, syncSvc, householdID, userID,
			upsertOp(domain.SyncEntityDebtor, uuid.New(), debtorID, 0,
				&domain.DebtorFullState{Name: "Анна", Note: "", Currency: "RUB"}))
		require.Equal(t, domain.SyncStatusApplied, created.Status)
	}
	debtOpData := func(kind domain.DebtOperationKind) *domain.DebtOperationFullState {
		return &domain.DebtOperationFullState{
			DebtorID: debtorID, Direction: domain.DebtDirectionPayable, Kind: kind,
			Amount: 1000, OccurredAt: time.Now().UTC(),
		}
	}

	t.Run("create at base 0 applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		seedDebtor(t, syncSvc, householdID, user.ID)
		res := pushOne(
			t,
			syncSvc,
			householdID,
			user.ID,
			upsertOp(
				domain.SyncEntityDebtOperation,
				uuid.New(),
				uuid.New(),
				0,
				debtOpData(domain.DebtOperationKindDebt),
			),
		)
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
	})

	t.Run("a missing live debtor is a per-item reference error", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		res := pushOne(
			t,
			syncSvc,
			householdID,
			user.ID,
			upsertOp(
				domain.SyncEntityDebtOperation,
				uuid.New(),
				uuid.New(),
				0,
				debtOpData(domain.DebtOperationKindDebt),
			),
		)
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "DEBT_OPERATION_DEBTOR_NOT_FOUND", res.Code)
	})

	t.Run("shape violations are per-item validation errors", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		seedDebtor(t, syncSvc, householdID, user.ID)
		cases := []struct {
			name    string
			data    domain.DebtOperationFullState
			message string
		}{
			{
				"zero amount",
				domain.DebtOperationFullState{
					DebtorID:   debtorID,
					Direction:  domain.DebtDirectionPayable,
					Kind:       domain.DebtOperationKindDebt,
					OccurredAt: time.Now().UTC(),
				},
				"amount must be at least 1 minor unit",
			},
			{
				"bad direction",
				domain.DebtOperationFullState{
					DebtorID:   debtorID,
					Direction:  "sideways",
					Kind:       domain.DebtOperationKindDebt,
					Amount:     10,
					OccurredAt: time.Now().UTC(),
				},
				"invalid debt direction",
			},
			{
				"bad kind",
				domain.DebtOperationFullState{
					DebtorID:   debtorID,
					Direction:  domain.DebtDirectionPayable,
					Kind:       "gift",
					Amount:     10,
					OccurredAt: time.Now().UTC(),
				},
				"invalid debt operation kind",
			},
		}
		for _, tc := range cases {
			res := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityDebtOperation, uuid.New(), uuid.New(), 0, &tc.data))
			assert.Equal(t, domain.SyncStatusError, res.Status, tc.name)
			assert.Equal(t, "VALIDATION_FAILED", res.Code, tc.name)
			assert.Equal(t, tc.message, res.Message, tc.name)
		}
	})

	t.Run(
		"update on the current base applies, unknown id conflicts with the zero state",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			seedDebtor(t, syncSvc, householdID, user.ID)
			recordID := uuid.New()
			created := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityDebtOperation,
					uuid.New(),
					recordID,
					0,
					debtOpData(domain.DebtOperationKindDebt),
				),
			)
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			updated := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityDebtOperation,
					uuid.New(),
					recordID,
					1,
					debtOpData(domain.DebtOperationKindDebt),
				),
			)
			assert.Equal(t, domain.SyncStatusApplied, updated.Status)
			assert.Equal(t, 2, updated.Version)

			unknown := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityDebtOperation,
					uuid.New(),
					uuid.New(),
					3,
					debtOpData(domain.DebtOperationKindDebt),
				),
			)
			assert.Equal(t, domain.SyncStatusConflict, unknown.Status)
			assert.Equal(t, domain.SyncCodeVersionConflict, unknown.Code)
			require.NotNil(t, unknown.ServerState)
			assert.Equal(t, 0, unknown.ServerState.Version)
		},
	)

	t.Run(
		"an immutable-field violation outranks the version conflict on a stale base",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			seedDebtor(t, syncSvc, householdID, user.ID)
			recordID := uuid.New()
			for _, base := range []int{0, 1} {
				created := pushOne(
					t,
					syncSvc,
					householdID,
					user.ID,
					upsertOp(
						domain.SyncEntityDebtOperation,
						uuid.New(),
						recordID,
						base,
						debtOpData(domain.DebtOperationKindDebt),
					),
				)
				require.Equal(t, domain.SyncStatusApplied, created.Status)
			}

			// Stale base (server is at v2) AND an immutable field changed: the
			// immutability error fires before the version conflict.
			res := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityDebtOperation,
					uuid.New(),
					recordID,
					1,
					debtOpData(domain.DebtOperationKindRepayment),
				),
			)
			assert.Equal(t, domain.SyncStatusError, res.Status)
			assert.Equal(t, "VALIDATION_FAILED", res.Code)
			assert.Equal(t, "debtor, direction, and kind are immutable", res.Message)
		},
	)

	t.Run("delete tombstones unconditionally and repeats idempotently", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		seedDebtor(t, syncSvc, householdID, user.ID)
		recordID := uuid.New()
		created := pushOne(
			t,
			syncSvc,
			householdID,
			user.ID,
			upsertOp(
				domain.SyncEntityDebtOperation,
				uuid.New(),
				recordID,
				0,
				debtOpData(domain.DebtOperationKindDebt),
			),
		)
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		deleted := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityDebtOperation, uuid.New(), recordID))
		assert.Equal(
			t,
			domain.SyncStatusApplied,
			deleted.Status,
			"no in-use guard on debt operations",
		)
		assert.Equal(t, 2, deleted.Version)

		again := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityDebtOperation, uuid.New(), recordID))
		assert.Equal(t, domain.SyncStatusApplied, again.Status)
		assert.Equal(t, deleted.Version, again.Version)
	})
}

func TestSyncPush_TransactionProtocol(t *testing.T) {
	t.Parallel()

	seedRefs := func(t *testing.T, syncSvc *service.SyncService, householdID, userID uuid.UUID) (uuid.UUID, uuid.UUID) {
		t.Helper()
		accountID, categoryID := uuid.New(), uuid.New()
		for _, op := range []domain.SyncOperation{
			upsertOp(domain.SyncEntityAccount, uuid.New(), accountID, 0,
				&domain.AccountFullState{Name: "Карта", Currency: "RUB"}),
			upsertOp(domain.SyncEntityCategory, uuid.New(), categoryID, 0,
				&domain.CategoryFullState{Name: "Продукты", Type: domain.TransactionTypeExpense}),
		} {
			require.Equal(
				t,
				domain.SyncStatusApplied,
				pushOne(t, syncSvc, householdID, userID, op).Status,
			)
		}
		return accountID, categoryID
	}

	t.Run("cashflow create with valid refs applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID := seedRefs(t, syncSvc, householdID, user.ID)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250, Description: "хлеб",
					OccurredAt: time.Now().UTC(), AccountID: &accountID, CategoryID: &categoryID,
				}))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
	})

	t.Run("shape and reference violations are per-item errors", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID := seedRefs(t, syncSvc, householdID, user.ID)
		otherAccount := uuid.New()
		require.Equal(t, domain.SyncStatusApplied, pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityAccount, uuid.New(), otherAccount, 0,
				&domain.AccountFullState{Name: "Наличные", Currency: "RUB"})).Status)

		cases := []struct {
			name string
			code string
			data *domain.TransactionFullState
		}{
			{"zero amount", "INVALID_AMOUNT", &domain.TransactionFullState{
				Type: domain.TransactionTypeExpense, Amount: 0, OccurredAt: time.Now().UTC(),
				AccountID: &accountID, CategoryID: &categoryID}},
			{"unknown type", "VALIDATION_FAILED", &domain.TransactionFullState{
				Type: domain.TransactionType("barter"), Amount: 5, OccurredAt: time.Now().UTC(),
				AccountID: &accountID, CategoryID: &categoryID}},
			{"expense with transfer refs", "INVALID_REFS", &domain.TransactionFullState{
				Type: domain.TransactionTypeExpense, Amount: 5, OccurredAt: time.Now().UTC(),
				FromAccountID: &accountID, ToAccountID: &otherAccount}},
			{"unknown account", "ACCOUNT_NOT_FOUND", &domain.TransactionFullState{
				Type: domain.TransactionTypeExpense, Amount: 5, OccurredAt: time.Now().UTC(),
				AccountID: &uuid.UUID{}, CategoryID: &categoryID}},
			{"unknown category", "CATEGORY_NOT_FOUND", &domain.TransactionFullState{
				Type: domain.TransactionTypeExpense, Amount: 5, OccurredAt: time.Now().UTC(),
				AccountID: &accountID, CategoryID: &uuid.UUID{}}},
			{"category type mismatch", "CATEGORY_TYPE_MISMATCH", &domain.TransactionFullState{
				Type: domain.TransactionTypeIncome, Amount: 5, OccurredAt: time.Now().UTC(),
				AccountID: &accountID, CategoryID: &categoryID}},
			{"same-account transfer", "SAME_ACCOUNT_TRANSFER", &domain.TransactionFullState{
				Type: domain.TransactionTypeTransfer, Amount: 5, OccurredAt: time.Now().UTC(),
				FromAccountID: &accountID, ToAccountID: &accountID}},
			{"adjustment with category", "INVALID_REFS", &domain.TransactionFullState{
				Type: domain.TransactionTypeAdjustment, Amount: 5, OccurredAt: time.Now().UTC(),
				AccountID: &accountID, CategoryID: &categoryID}},
		}
		for _, tc := range cases {
			res := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 0, tc.data))
			assert.Equal(t, domain.SyncStatusError, res.Status, tc.name)
			assert.Equal(t, tc.code, res.Code, tc.name)
		}
	})

	t.Run("account-less cashflow create applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		_, categoryID := seedRefs(t, syncSvc, householdID, user.ID)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250, Description: "из старой таблицы",
					OccurredAt: time.Now().UTC(), CategoryID: &categoryID,
				}))
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
	})

	t.Run("account-less cashflow without a category is invalid", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, _ := seedRefs(t, syncSvc, householdID, user.ID)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250, OccurredAt: time.Now().UTC(),
					AccountID: &accountID,
				}))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "INVALID_REFS", res.Code)
	})

	t.Run("full-state replace clears the account of an accounted expense", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID := seedRefs(t, syncSvc, householdID, user.ID)
		recordID := uuid.New()
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250,
					OccurredAt: time.Now().UTC(), AccountID: &accountID, CategoryID: &categoryID,
				}))
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		cleared := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, 1,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeExpense, Amount: 250,
					OccurredAt: time.Now().UTC(), CategoryID: &categoryID,
				}))
		assert.Equal(t, domain.SyncStatusApplied, cleared.Status)
		assert.Equal(t, 2, cleared.Version)
	})

	t.Run(
		"update on the current base applies, unknown id conflicts with the zero state",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			accountID, categoryID := seedRefs(t, syncSvc, householdID, user.ID)
			recordID := uuid.New()
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, 0,
					&domain.TransactionFullState{
						Type: domain.TransactionTypeExpense, Amount: 250, Description: "хлеб",
						OccurredAt: time.Now().
							UTC(),
						AccountID: &accountID, CategoryID: &categoryID,
					}))
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			updated := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, 1,
					&domain.TransactionFullState{
						Type: domain.TransactionTypeExpense, Amount: 300, Description: "хлеб и молоко",
						OccurredAt: time.Now().
							UTC(),
						AccountID: &accountID, CategoryID: &categoryID,
					}))
			assert.Equal(t, domain.SyncStatusApplied, updated.Status)
			assert.Equal(t, 2, updated.Version)

			unknown := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityTransaction, uuid.New(), uuid.New(), 3,
					&domain.TransactionFullState{
						Type: domain.TransactionTypeAdjustment, Amount: 5,
						OccurredAt: time.Now().UTC(), AccountID: &accountID,
					}))
			assert.Equal(t, domain.SyncStatusConflict, unknown.Status)
			assert.Equal(t, domain.SyncCodeVersionConflict, unknown.Code)
			require.NotNil(t, unknown.ServerState)
			assert.Equal(t, 0, unknown.ServerState.Version)
		},
	)

	t.Run("a type change outranks the version conflict on a stale base", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID := seedRefs(t, syncSvc, householdID, user.ID)
		recordID := uuid.New()
		for _, base := range []int{0, 1} {
			created := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, base,
					&domain.TransactionFullState{
						Type: domain.TransactionTypeExpense, Amount: 250,
						OccurredAt: time.Now().
							UTC(),
						AccountID: &accountID, CategoryID: &categoryID,
					}))
			require.Equal(t, domain.SyncStatusApplied, created.Status)
		}

		// Stale base (server is at v2) AND the type changed: the immutability
		// error fires before the version conflict.
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, 1,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeAdjustment, Amount: 250,
					OccurredAt: time.Now().UTC(), AccountID: &accountID,
				}))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "VALIDATION_FAILED", res.Code)
		assert.Equal(t, "transaction type is immutable", res.Message)
	})

	t.Run("delete tombstones unconditionally and repeats idempotently", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, _ := seedRefs(t, syncSvc, householdID, user.ID)
		recordID := uuid.New()
		created := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityTransaction, uuid.New(), recordID, 0,
				&domain.TransactionFullState{
					Type: domain.TransactionTypeAdjustment, Amount: 250,
					OccurredAt: time.Now().UTC(), AccountID: &accountID,
				}))
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		deleted := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityTransaction, uuid.New(), recordID))
		assert.Equal(t, domain.SyncStatusApplied, deleted.Status, "no in-use guard on transactions")
		assert.Equal(t, 2, deleted.Version)

		again := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityTransaction, uuid.New(), recordID))
		assert.Equal(t, domain.SyncStatusApplied, again.Status)
		assert.Equal(t, deleted.Version, again.Version)
	})
}

func TestSyncPush_PlannedPaymentProtocol(t *testing.T) {
	t.Parallel()

	seedRefs := func(t *testing.T, syncSvc *service.SyncService, householdID, userID uuid.UUID) (uuid.UUID, uuid.UUID, uuid.UUID) {
		t.Helper()
		accountID, expenseCatID, incomeCatID := uuid.New(), uuid.New(), uuid.New()
		for _, op := range []domain.SyncOperation{
			upsertOp(domain.SyncEntityAccount, uuid.New(), accountID, 0,
				&domain.AccountFullState{Name: "Карта", Currency: "RUB"}),
			upsertOp(domain.SyncEntityCategory, uuid.New(), expenseCatID, 0,
				&domain.CategoryFullState{Name: "Подписки", Type: domain.TransactionTypeExpense}),
			upsertOp(domain.SyncEntityCategory, uuid.New(), incomeCatID, 0,
				&domain.CategoryFullState{Name: "Зарплата", Type: domain.TransactionTypeIncome}),
		} {
			require.Equal(
				t,
				domain.SyncStatusApplied,
				pushOne(t, syncSvc, householdID, userID, op).Status,
			)
		}
		return accountID, expenseCatID, incomeCatID
	}
	validPlan := func(accountID, categoryID uuid.UUID) *domain.PlannedPaymentFullState {
		return &domain.PlannedPaymentFullState{
			Type: domain.TransactionTypeExpense, Amount: 500, Name: "Интернет",
			AccountID: accountID, CategoryID: categoryID,
			NextDue: domain.NewDate(2026, 10, 1), AnchorDate: domain.NewDate(2026, 9, 1),
			Regularity: domain.PlannedRegularityMonthly, ConfirmMode: domain.PlannedConfirmManual,
			Reminder: domain.PlannedReminderOff,
		}
	}

	t.Run("create with valid refs applies at version 1", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID, _ := seedRefs(t, syncSvc, householdID, user.ID)
		res := pushOne(
			t,
			syncSvc,
			householdID,
			user.ID,
			upsertOp(
				domain.SyncEntityPlannedPayment,
				uuid.New(),
				uuid.New(),
				0,
				validPlan(accountID, categoryID),
			),
		)
		assert.Equal(t, domain.SyncStatusApplied, res.Status)
		assert.Equal(t, 1, res.Version)
	})

	t.Run("shape violations are per-item validation errors", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID, _ := seedRefs(t, syncSvc, householdID, user.ID)
		cases := []struct {
			name string
			mut  func(*domain.PlannedPaymentFullState)
		}{
			{"zero amount", func(p *domain.PlannedPaymentFullState) { p.Amount = 0 }},
			{
				"bad type",
				func(p *domain.PlannedPaymentFullState) { p.Type = domain.TransactionTypeTransfer },
			},
			{"bad regularity", func(p *domain.PlannedPaymentFullState) { p.Regularity = "hourly" }},
			{
				"bad confirm mode",
				func(p *domain.PlannedPaymentFullState) { p.ConfirmMode = "maybe" },
			},
			{"bad reminder", func(p *domain.PlannedPaymentFullState) { p.Reminder = "weekly" }},
			{
				"zero next due",
				func(p *domain.PlannedPaymentFullState) { p.NextDue = domain.Date{} },
			},
			{
				"zero anchor",
				func(p *domain.PlannedPaymentFullState) { p.AnchorDate = domain.Date{} },
			},
		}
		for _, tc := range cases {
			data := validPlan(accountID, categoryID)
			tc.mut(data)
			res := pushOne(t, syncSvc, householdID, user.ID,
				upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0, data))
			assert.Equal(t, domain.SyncStatusError, res.Status, tc.name)
			assert.Equal(t, "VALIDATION_FAILED", res.Code, tc.name)
			assert.Equal(t, "invalid planned payment data", res.Message, tc.name)
		}
	})

	t.Run("reference violations are per-item errors with their own codes", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID, _ := seedRefs(t, syncSvc, householdID, user.ID)

		unknownAccount := validPlan(uuid.New(), categoryID)
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0, unknownAccount))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "PLANNED_PAYMENT_ACCOUNT_NOT_FOUND", res.Code)

		unknownCategory := validPlan(accountID, uuid.New())
		res = pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0, unknownCategory))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "PLANNED_PAYMENT_CATEGORY_NOT_FOUND", res.Code)

		mismatch := validPlan(accountID, categoryID)
		mismatch.Type = domain.TransactionTypeIncome
		res = pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), uuid.New(), 0, mismatch))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "PLANNED_PAYMENT_CATEGORY_NOT_FOUND", res.Code)
		// The shared wire spec (domain.ErrorSpecFor): the same wording the
		// REST surface answers with (write-rules unification, ADR-0005).
		assert.Equal(t, "plan type does not match category type", res.Message)
	})

	t.Run(
		"update on the current base applies, unknown id conflicts with the zero state",
		func(t *testing.T) {
			t.Parallel()
			syncSvc, user, householdID := pushFixture(t)
			accountID, categoryID, _ := seedRefs(t, syncSvc, householdID, user.ID)
			recordID := uuid.New()
			created := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityPlannedPayment,
					uuid.New(),
					recordID,
					0,
					validPlan(accountID, categoryID),
				),
			)
			require.Equal(t, domain.SyncStatusApplied, created.Status)

			updated := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityPlannedPayment,
					uuid.New(),
					recordID,
					1,
					validPlan(accountID, categoryID),
				),
			)
			assert.Equal(t, domain.SyncStatusApplied, updated.Status)
			assert.Equal(t, 2, updated.Version)

			unknown := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityPlannedPayment,
					uuid.New(),
					uuid.New(),
					3,
					validPlan(accountID, categoryID),
				),
			)
			assert.Equal(t, domain.SyncStatusConflict, unknown.Status)
			assert.Equal(t, domain.SyncCodeVersionConflict, unknown.Code)
			require.NotNil(t, unknown.ServerState)
			assert.Equal(t, 0, unknown.ServerState.Version)
		},
	)

	t.Run("a plan-type change outranks the version conflict on a stale base", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, expenseCatID, incomeCatID := seedRefs(t, syncSvc, householdID, user.ID)
		recordID := uuid.New()
		for _, base := range []int{0, 1} {
			created := pushOne(
				t,
				syncSvc,
				householdID,
				user.ID,
				upsertOp(
					domain.SyncEntityPlannedPayment,
					uuid.New(),
					recordID,
					base,
					validPlan(accountID, expenseCatID),
				),
			)
			require.Equal(t, domain.SyncStatusApplied, created.Status)
		}

		// Retyped to income AND re-referenced to the income category so the
		// pre-validation passes and the immutability rule is what fires.
		retyped := validPlan(accountID, incomeCatID)
		retyped.Type = domain.TransactionTypeIncome
		res := pushOne(t, syncSvc, householdID, user.ID,
			upsertOp(domain.SyncEntityPlannedPayment, uuid.New(), recordID, 1, retyped))
		assert.Equal(t, domain.SyncStatusError, res.Status)
		assert.Equal(t, "VALIDATION_FAILED", res.Code)
		assert.Equal(t, "plan type is immutable", res.Message)
	})

	t.Run("delete tombstones unconditionally and repeats idempotently", func(t *testing.T) {
		t.Parallel()
		syncSvc, user, householdID := pushFixture(t)
		accountID, categoryID, _ := seedRefs(t, syncSvc, householdID, user.ID)
		recordID := uuid.New()
		created := pushOne(
			t,
			syncSvc,
			householdID,
			user.ID,
			upsertOp(
				domain.SyncEntityPlannedPayment,
				uuid.New(),
				recordID,
				0,
				validPlan(accountID, categoryID),
			),
		)
		require.Equal(t, domain.SyncStatusApplied, created.Status)

		deleted := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityPlannedPayment, uuid.New(), recordID))
		assert.Equal(
			t,
			domain.SyncStatusApplied,
			deleted.Status,
			"no in-use guard on planned payments",
		)
		assert.Equal(t, 2, deleted.Version)

		again := pushOne(t, syncSvc, householdID, user.ID,
			deleteOp(domain.SyncEntityPlannedPayment, uuid.New(), recordID))
		assert.Equal(t, domain.SyncStatusApplied, again.Status)
		assert.Equal(t, deleted.Version, again.Version)
	})
}
