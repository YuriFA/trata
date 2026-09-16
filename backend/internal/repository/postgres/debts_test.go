package postgres_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
)

// Debtor + debt operation repository mechanics against real Postgres: partial
// live-name uniqueness, CAS update classification (tombstoned = not-found,
// live mismatch = version conflict), the cascading delete (debtor + live
// operations tombstoned together, one change_log row per record), tombstone
// versioning, and the CHECK constraints on direction/kind/amount.

func TestRepository_Debtors_CRUDAndGuards(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Postgres")
	}

	ctx := newCtx(t)
	user := seedUser(t, "debtors")
	userHH := householdOf(t, user.ID)

	created, err := testRepo.CreateDebtor(ctx, domain.CreateDebtorParams{
		HouseholdID: userHH,
		UserID:      user.ID, Name: "Анна",
	})
	require.NoError(t, err)
	assert.Equal(t, 1, created.Version)

	t.Run("duplicate live name rejected", func(t *testing.T) {
		_, err := testRepo.CreateDebtor(
			ctx,
			domain.CreateDebtorParams{HouseholdID: userHH, UserID: user.ID, Name: "Анна"},
		)
		require.ErrorIs(t, err, domain.ErrDebtorAlreadyExists)
	})

	t.Run("duplicate client id rejected", func(t *testing.T) {
		_, err := testRepo.CreateDebtor(
			ctx,
			domain.CreateDebtorParams{ID: created.ID, HouseholdID: userHH, UserID: user.ID, Name: "Другой"},
		)
		require.ErrorIs(t, err, domain.ErrDebtorAlreadyExists)
	})

	t.Run("scoping: another user sees not-found", func(t *testing.T) {
		intruder := seedUser(t, "debtors-intruder")
		intruderHH := householdOf(t, intruder.ID)
		_, err := testRepo.GetDebtor(ctx, domain.Scope{HouseholdID: intruderHH}, created.ID)
		require.ErrorIs(t, err, domain.ErrDebtorNotFound)
		_, err = testRepo.UpdateDebtor(
			ctx,
			domain.Scope{HouseholdID: intruderHH, ActorID: intruder.ID},
			created.ID,
			domain.UpdateDebtorParams{
				Name: new("x"), Version: 1,
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtorNotFound)
		require.ErrorIs(
			t,
			testRepo.DeleteDebtor(ctx, domain.Scope{HouseholdID: intruderHH, ActorID: intruder.ID}, created.ID),
			domain.ErrDebtorNotFound,
		)
	})

	t.Run("update CAS", func(t *testing.T) {
		updated, err := testRepo.UpdateDebtor(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateDebtorParams{
				Name: new("Анна П."), Version: 1,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, "Анна П.", updated.Name)
		assert.Equal(t, 2, updated.Version)

		_, err = testRepo.UpdateDebtor(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateDebtorParams{
				Name: new("stale"), Version: 1,
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtorVersionConflict)
	})

	t.Run("delete cascades over live operations only", func(t *testing.T) {
		op, err := testRepo.CreateDebtOperation(ctx, domain.CreateDebtOperationParams{
			HouseholdID: userHH,
			UserID:      user.ID, DebtorID: created.ID,
			Direction: domain.DebtDirectionReceivable, Kind: domain.DebtOperationKindDebt,
			Amount: 100000, OccurredAt: mustNow(),
		})
		require.NoError(t, err)

		// There is no in-use guard: the delete tombstones the debtor and its
		// live operation in one transaction.
		require.NoError(t, testRepo.DeleteDebtor(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, created.ID))

		// Tombstoned reads classify as not-found; updates and deletes too.
		_, err = testRepo.GetDebtor(ctx, domain.Scope{HouseholdID: userHH}, created.ID)
		require.ErrorIs(t, err, domain.ErrDebtorNotFound)
		_, err = testRepo.GetDebtOperation(ctx, domain.Scope{HouseholdID: userHH}, op.ID)
		require.ErrorIs(t, err, domain.ErrDebtOperationNotFound, "the live operation is cascaded")
		_, err = testRepo.UpdateDebtor(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateDebtorParams{
				Name: new("x"), Version: 3,
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtorNotFound)
		require.ErrorIs(
			t,
			testRepo.DeleteDebtor(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, created.ID),
			domain.ErrDebtorNotFound,
		)

		// One tombstone per cascaded record, each carrying the bumped
		// version; no extra rows for the re-delete.
		changes, err := testRepo.PullChanges(ctx, domain.Scope{HouseholdID: userHH}, 0, 100)
		require.NoError(t, err)
		var debtorTombstones, opTombstones int
		for _, change := range changes {
			if change.Action != domain.SyncChangeTombstone {
				continue
			}
			switch {
			case change.Entity == domain.SyncEntityDebtor && change.ID == created.ID:
				debtorTombstones++
				assert.Equal(t, 3, change.Version, "debtor tombstone carries the bumped version")
			case change.Entity == domain.SyncEntityDebtOperation && change.ID == op.ID:
				opTombstones++
				assert.Equal(t, 2, change.Version, "operation tombstone carries the bumped version")
			}
		}
		assert.Equal(t, 1, debtorTombstones)
		assert.Equal(t, 1, opTombstones)

		// The freed name can be recreated.
		_, err = testRepo.CreateDebtor(
			ctx,
			domain.CreateDebtorParams{HouseholdID: userHH, UserID: user.ID, Name: "Анна"},
		)
		require.NoError(t, err)
	})
}

func TestRepository_DebtOperations_CheckConstraintsAndChangeLog(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Postgres")
	}

	ctx := newCtx(t)
	user := seedUser(t, "debt-ops")
	userHH := householdOf(t, user.ID)
	debtor, err := testRepo.CreateDebtor(
		ctx,
		domain.CreateDebtorParams{HouseholdID: userHH, UserID: user.ID, Name: "Михаил"},
	)
	require.NoError(t, err)

	// CHECK constraints reject invalid direction/kind/amount at the DB level.
	_, err = testRepo.CreateDebtOperation(ctx, domain.CreateDebtOperationParams{
		HouseholdID: userHH,
		UserID:      user.ID, DebtorID: debtor.ID,
		Direction: "sideways", Kind: domain.DebtOperationKindDebt, Amount: 100, OccurredAt: mustNow(),
	})
	require.Error(t, err, "invalid direction must fail the CHECK constraint")

	_, err = testRepo.CreateDebtOperation(ctx, domain.CreateDebtOperationParams{
		HouseholdID: userHH,
		UserID:      user.ID, DebtorID: debtor.ID,
		Direction: domain.DebtDirectionPayable, Kind: "write-off", Amount: 100, OccurredAt: mustNow(),
	})
	require.Error(t, err, "invalid kind must fail the CHECK constraint")

	_, err = testRepo.CreateDebtOperation(ctx, domain.CreateDebtOperationParams{
		HouseholdID: userHH,
		UserID:      user.ID, DebtorID: debtor.ID,
		Direction: domain.DebtDirectionPayable, Kind: domain.DebtOperationKindDebt, Amount: 0, OccurredAt: mustNow(),
	})
	require.Error(t, err, "non-positive amount must fail the CHECK constraint")

	op, err := testRepo.CreateDebtOperation(ctx, domain.CreateDebtOperationParams{
		HouseholdID: userHH,
		UserID:      user.ID, DebtorID: debtor.ID,
		Direction: domain.DebtDirectionPayable, Kind: domain.DebtOperationKindRepayment,
		Amount: 100, OccurredAt: mustNow(),
	})
	require.NoError(t, err)
	assert.Equal(t, 1, op.Version)

	// Update + delete are versioned mutations that land in the change log.
	updated, err := testRepo.UpdateDebtOperation(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		op.ID,
		domain.UpdateDebtOperationParams{
			Amount: new(int64(250)), Version: 1,
		},
	)
	require.NoError(t, err)
	assert.Equal(t, 2, updated.Version)

	require.NoError(t, testRepo.DeleteDebtOperation(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, op.ID))
	_, err = testRepo.GetDebtOperation(ctx, domain.Scope{HouseholdID: userHH}, op.ID)
	require.ErrorIs(t, err, domain.ErrDebtOperationNotFound)

	changes, err := testRepo.PullChanges(ctx, domain.Scope{HouseholdID: userHH}, 0, 100)
	require.NoError(t, err)
	var debtorUpserts, opUpserts, opTombstones int
	for _, change := range changes {
		if change.Entity != domain.SyncEntityDebtor && change.Entity != domain.SyncEntityDebtOperation {
			continue
		}
		switch {
		case change.Entity == domain.SyncEntityDebtor && change.Action == domain.SyncChangeUpsert:
			debtorUpserts++
		case change.Entity == domain.SyncEntityDebtOperation && change.Action == domain.SyncChangeUpsert:
			opUpserts++
		case change.Entity == domain.SyncEntityDebtOperation && change.Action == domain.SyncChangeTombstone:
			opTombstones++
			assert.Equal(t, 3, change.Version, "tombstone carries the bumped version")
		}
	}
	assert.Equal(t, 1, debtorUpserts)
	assert.Equal(t, 2, opUpserts)
	assert.Equal(t, 1, opTombstones)
}
