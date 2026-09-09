package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// Pins the tombstone protocol of the six SyncTx.Tombstone* methods against
// real Postgres: success bumps the version and appends exactly one
// change_log tombstone row; a repeated delete is idempotent (stored row
// back, no new change); a foreign household and an unknown id are
// ErrXNotFound. The service level pins the same contract on the fakes
// (service/sync_push_protocol_test.go); this file pins the SQL twins
// themselves, so a repository-layer restructure stays regression-covered.
func TestSyncTombstoneProtocol(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}

	type outcome struct {
		Version   int
		DeletedAt *time.Time
	}
	type entityCase struct {
		name      string
		entity    string
		seed      func(t *testing.T) (userID, householdID, id uuid.UUID)
		tombstone func(context.Context, repository.SyncTx, domain.Scope, uuid.UUID) (outcome, error)
		notFound  error
	}

	cases := []entityCase{
		{
			name:   "account",
			entity: domain.SyncEntityAccount,
			seed: func(t *testing.T) (uuid.UUID, uuid.UUID, uuid.UUID) {
				user := seedUser(t, "tomb-account")
				hh := householdOf(t, user.ID)
				return user.ID, hh, seedAccount(t, hh, user.ID).ID
			},
			tombstone: func(ctx context.Context, tx repository.SyncTx, scope domain.Scope, id uuid.UUID) (outcome, error) {
				row, err := tx.TombstoneAccount(ctx, scope, id)
				if err != nil {
					return outcome{}, err
				}
				return outcome{Version: row.Version, DeletedAt: row.DeletedAt}, nil
			},
			notFound: domain.ErrAccountNotFound,
		},
		{
			name:   "category",
			entity: domain.SyncEntityCategory,
			seed: func(t *testing.T) (uuid.UUID, uuid.UUID, uuid.UUID) {
				user := seedUser(t, "tomb-category")
				hh := householdOf(t, user.ID)
				return user.ID, hh, seedCategory(t, hh, user.ID, "Категория").ID
			},
			tombstone: func(ctx context.Context, tx repository.SyncTx, scope domain.Scope, id uuid.UUID) (outcome, error) {
				row, err := tx.TombstoneCategory(ctx, scope, id)
				if err != nil {
					return outcome{}, err
				}
				return outcome{Version: row.Version, DeletedAt: row.DeletedAt}, nil
			},
			notFound: domain.ErrCategoryNotFound,
		},
		{
			name:   "transaction",
			entity: domain.SyncEntityTransaction,
			seed: func(t *testing.T) (uuid.UUID, uuid.UUID, uuid.UUID) {
				user := seedUser(t, "tomb-transaction")
				hh := householdOf(t, user.ID)
				acct := seedAccount(t, hh, user.ID)
				cat := seedCategory(t, hh, user.ID, "Еда")
				txRow, err := testRepo.CreateTransaction(newCtx(t), domain.CreateTransactionParams{
					HouseholdID: hh, UserID: user.ID,
					Type: domain.TransactionTypeIncome, Amount: 100, Description: "t",
					OccurredAt: mustNow(), AccountID: &acct.ID, CategoryID: &cat.ID,
				})
				require.NoError(t, err)
				return user.ID, hh, txRow.ID
			},
			tombstone: func(ctx context.Context, tx repository.SyncTx, scope domain.Scope, id uuid.UUID) (outcome, error) {
				row, err := tx.TombstoneTransaction(ctx, scope, id)
				if err != nil {
					return outcome{}, err
				}
				return outcome{Version: row.Version, DeletedAt: row.DeletedAt}, nil
			},
			notFound: domain.ErrTransactionNotFound,
		},
		{
			name:   "debtor",
			entity: domain.SyncEntityDebtor,
			seed: func(t *testing.T) (uuid.UUID, uuid.UUID, uuid.UUID) {
				user := seedUser(t, "tomb-debtor")
				hh := householdOf(t, user.ID)
				debtor, err := testRepo.CreateDebtor(newCtx(t), domain.CreateDebtorParams{
					HouseholdID: hh, UserID: user.ID, Name: "Анна",
				})
				require.NoError(t, err)
				return user.ID, hh, debtor.ID
			},
			tombstone: func(ctx context.Context, tx repository.SyncTx, scope domain.Scope, id uuid.UUID) (outcome, error) {
				row, err := tx.TombstoneDebtor(ctx, scope, id)
				if err != nil {
					return outcome{}, err
				}
				return outcome{Version: row.Version, DeletedAt: row.DeletedAt}, nil
			},
			notFound: domain.ErrDebtorNotFound,
		},
		{
			name:   "debt_operation",
			entity: domain.SyncEntityDebtOperation,
			seed: func(t *testing.T) (uuid.UUID, uuid.UUID, uuid.UUID) {
				user := seedUser(t, "tomb-debt-op")
				hh := householdOf(t, user.ID)
				debtor, err := testRepo.CreateDebtor(newCtx(t), domain.CreateDebtorParams{
					HouseholdID: hh, UserID: user.ID, Name: "Борис",
				})
				require.NoError(t, err)
				op, err := testRepo.CreateDebtOperation(newCtx(t), domain.CreateDebtOperationParams{
					HouseholdID: hh, UserID: user.ID, DebtorID: debtor.ID,
					Direction: domain.DebtDirectionReceivable, Kind: domain.DebtOperationKindDebt,
					Amount: 5000, OccurredAt: mustNow(),
				})
				require.NoError(t, err)
				return user.ID, hh, op.ID
			},
			tombstone: func(ctx context.Context, tx repository.SyncTx, scope domain.Scope, id uuid.UUID) (outcome, error) {
				row, err := tx.TombstoneDebtOperation(ctx, scope, id)
				if err != nil {
					return outcome{}, err
				}
				return outcome{Version: row.Version, DeletedAt: row.DeletedAt}, nil
			},
			notFound: domain.ErrDebtOperationNotFound,
		},
		{
			name:   "planned_payment",
			entity: domain.SyncEntityPlannedPayment,
			seed: func(t *testing.T) (uuid.UUID, uuid.UUID, uuid.UUID) {
				user := seedUser(t, "tomb-plan")
				hh := householdOf(t, user.ID)
				acct := seedAccount(t, hh, user.ID)
				cat := seedExpenseCategory(t, hh, user.ID, "Подписки")
				plan, err := testRepo.CreatePlannedPayment(newCtx(t), planParams(hh, user.ID, acct.ID, cat.ID))
				require.NoError(t, err)
				return user.ID, hh, plan.ID
			},
			tombstone: func(ctx context.Context, tx repository.SyncTx, scope domain.Scope, id uuid.UUID) (outcome, error) {
				row, err := tx.TombstonePlannedPayment(ctx, scope, id)
				if err != nil {
					return outcome{}, err
				}
				return outcome{Version: row.Version, DeletedAt: row.DeletedAt}, nil
			},
			notFound: domain.ErrPlannedPaymentNotFound,
		},
	}

	tombstoneChanges := func(t *testing.T, householdID, id uuid.UUID) []domain.SyncChange {
		t.Helper()
		changes, err := testRepo.PullChanges(newCtx(t), domain.Scope{HouseholdID: householdID}, 0, 1000)
		require.NoError(t, err)
		var out []domain.SyncChange
		for _, ch := range changes {
			if ch.ID == id && ch.Action == domain.SyncChangeTombstone {
				out = append(out, ch)
			}
		}
		return out
	}

	run := func(
		ctx context.Context, scope domain.Scope, fn func(repository.SyncTx) error,
	) error {
		return testRepo.WithinHouseholdTx(ctx, scope, fn)
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			userID, hh, id := tc.seed(t)
			ctx := newCtx(t)
			scope := domain.Scope{HouseholdID: hh, ActorID: userID}

			var first outcome
			require.NoError(t, run(ctx, scope, func(tx repository.SyncTx) error {
				out, err := tc.tombstone(ctx, tx, scope, id)
				first = out
				return err
			}), "tombstone succeeds")
			assert.Equal(t, 2, first.Version, "version bumps 1 -> 2")
			require.NotNil(t, first.DeletedAt, "result reports DeletedAt")

			changes := tombstoneChanges(t, hh, id)
			require.Len(t, changes, 1, "exactly one change_log tombstone row")
			assert.Equal(t, tc.entity, changes[0].Entity)
			assert.Equal(t, 2, changes[0].Version)

			var second outcome
			require.NoError(t, run(ctx, scope, func(tx repository.SyncTx) error {
				out, err := tc.tombstone(ctx, tx, scope, id)
				second = out
				return err
			}), "repeated delete is idempotent")
			assert.Equal(t, first.Version, second.Version, "version unchanged on repeat")
			require.NotNil(t, second.DeletedAt)
			assert.Len(t, tombstoneChanges(t, hh, id), 1, "no extra change_log row on repeat")

			intruder := seedUser(t, "tomb-foreign-"+tc.name)
			foreignScope := domain.Scope{
				HouseholdID: householdOf(t, intruder.ID), ActorID: intruder.ID,
			}
			err := run(ctx, foreignScope, func(tx repository.SyncTx) error {
				_, err := tc.tombstone(ctx, tx, foreignScope, id)
				return err
			})
			require.ErrorIs(t, err, tc.notFound, "foreign household sees not-found")

			err = run(ctx, scope, func(tx repository.SyncTx) error {
				_, err := tc.tombstone(ctx, tx, scope, uuid.New())
				return err
			})
			require.ErrorIs(t, err, tc.notFound, "unknown id is not-found")
		})
	}
}
