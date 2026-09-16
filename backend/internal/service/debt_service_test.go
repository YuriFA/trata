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

func debtServices(t *testing.T) (*service.DebtorService, *service.DebtOperationService, *fakes.Store) {
	t.Helper()
	store := fakes.New()
	return service.NewDebtorService(store), service.NewDebtOperationService(store, store), store
}

func seedDebtor(t *testing.T, svc *service.DebtorService, householdID, userID uuid.UUID, name string) *domain.Debtor {
	t.Helper()
	d, err := svc.Create(
		context.Background(),
		domain.Scope{HouseholdID: householdID, ActorID: userID},
		domain.CreateDebtorParams{Name: name},
	)
	require.NoError(t, err)
	return d
}

func TestDebtorService_CreateAndUpdate(t *testing.T) {
	t.Parallel()
	debtorSvc, _, store := debtServices(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	other := seedFakeUser(t, store)
	otherHH := householdOf(t, store, other.ID)

	created, err := debtorSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		domain.CreateDebtorParams{Name: "Анна"},
	)
	require.NoError(t, err)
	assert.Equal(t, "Анна", created.Name)
	assert.Equal(t, 1, created.Version)

	t.Run("duplicate name rejected", func(t *testing.T) {
		t.Parallel()
		_, err := debtorSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateDebtorParams{Name: "Анна"},
		)
		require.ErrorIs(t, err, domain.ErrDebtorAlreadyExists)
	})

	t.Run("same name for another user is fine", func(t *testing.T) {
		t.Parallel()
		_, err := debtorSvc.Create(
			ctx,
			domain.Scope{HouseholdID: otherHH, ActorID: other.ID},
			domain.CreateDebtorParams{Name: "Анна"},
		)
		require.NoError(t, err)
	})

	t.Run("rename to a taken name rejected", func(t *testing.T) {
		t.Parallel()
		second := seedDebtor(t, debtorSvc, userHH, user.ID, "Михаил")
		_, err := debtorSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			second.ID,
			domain.UpdateDebtorParams{
				Name: strPtr("Анна"), Version: second.Version,
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtorAlreadyExists)
	})

	t.Run("empty update rejected", func(t *testing.T) {
		t.Parallel()
		fresh := seedDebtor(t, debtorSvc, userHH, user.ID, "Сергей")
		_, err := debtorSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			fresh.ID,
			domain.UpdateDebtorParams{Version: fresh.Version},
		)
		require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)
	})

	t.Run("no-op rename rejected", func(t *testing.T) {
		t.Parallel()
		fresh := seedDebtor(t, debtorSvc, userHH, user.ID, "Ольга")
		_, err := debtorSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			fresh.ID,
			domain.UpdateDebtorParams{
				Name: strPtr("Ольга"), Version: fresh.Version,
			},
		)
		require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)
	})

	t.Run("version conflict on concurrent edit", func(t *testing.T) {
		t.Parallel()
		fresh := seedDebtor(t, debtorSvc, userHH, user.ID, "Игорь")
		updated, err := debtorSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			fresh.ID,
			domain.UpdateDebtorParams{
				Name: strPtr("Игорь Р."), Version: fresh.Version,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, 2, updated.Version)

		_, err = debtorSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			fresh.ID,
			domain.UpdateDebtorParams{
				Name: strPtr("Игорь С."), Version: fresh.Version,
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtorVersionConflict)
	})
}

func TestDebtorService_DeleteCascadesOverLiveOperations(t *testing.T) {
	t.Parallel()
	debtorSvc, opSvc, store := debtServices(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	debtor := seedDebtor(t, debtorSvc, userHH, user.ID, "Анна")
	other := seedDebtor(t, debtorSvc, userHH, user.ID, "Михаил")
	otherOp, err := opSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		domain.CreateDebtOperationParams{
			DebtorID: other.ID, Direction: domain.DebtDirectionReceivable,
			Kind: domain.DebtOperationKindDebt, Amount: 1000, OccurredAt: time.Now().UTC(),
		},
	)
	require.NoError(t, err)

	// Two live operations on the debtor (a delete must not require an empty
	// ledger) and one operation tombstoned beforehand.
	var liveOps []*domain.DebtOperation
	for _, amount := range []int64{500000, 250000} {
		op, err := opSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateDebtOperationParams{
				DebtorID: debtor.ID, Direction: domain.DebtDirectionReceivable,
				Kind: domain.DebtOperationKindDebt, Amount: amount, OccurredAt: time.Now().UTC(),
			},
		)
		require.NoError(t, err)
		liveOps = append(liveOps, op)
	}
	deadOp := liveOps[0]
	require.NoError(t, opSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, deadOp.ID))

	// There is no in-use guard: the delete cascades over the LIVE operations.
	require.NoError(t, debtorSvc.Delete(ctx, domain.Scope{HouseholdID: userHH, ActorID: user.ID}, debtor.ID))

	// The debtor and its live operations are gone.
	_, err = debtorSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, debtor.ID)
	require.ErrorIs(t, err, domain.ErrDebtorNotFound)
	for _, op := range liveOps[1:] {
		_, err := opSvc.Get(ctx, domain.Scope{HouseholdID: userHH}, op.ID)
		require.ErrorIs(t, err, domain.ErrDebtOperationNotFound, "live operation must be cascaded")
	}

	// The change log carries the expected tombstones: the debtor and the
	// one live operation (the cascade), plus deadOp's own pre-delete. Each
	// carries the record's bumped version, and nothing is re-tombstoned.
	changes, err := store.PullChanges(ctx, domain.Scope{HouseholdID: userHH}, 0, 100)
	require.NoError(t, err)
	tombstones := map[uuid.UUID]int{}
	for _, c := range changes {
		if c.Action == domain.SyncChangeTombstone {
			tombstones[c.ID]++
			assert.Equalf(t, 2, c.Version, "tombstone of %s carries the bumped version", c.ID)
		}
	}
	assert.Len(t, tombstones, 3)
	assert.Equal(t, 1, tombstones[debtor.ID])
	assert.Equal(t, 1, tombstones[liveOps[1].ID])
	assert.Equal(t, 1, tombstones[deadOp.ID], "only its own pre-delete tombstone - the cascade skips dead operations")
	assert.NotContains(t, tombstones, other.ID, "another debtor is untouched")
	assert.NotContains(t, tombstones, otherOp.ID, "another debtor's operation is untouched")
	// The freed name can be recreated.
	_, err = debtorSvc.Create(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		domain.CreateDebtorParams{Name: "Анна"},
	)
	require.NoError(t, err)
}

func TestDebtOperationService_Rules(t *testing.T) {
	t.Parallel()
	debtorSvc, opSvc, store := debtServices(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	debtor := seedDebtor(t, debtorSvc, userHH, user.ID, "Анна")

	t.Run("unknown debtor reference rejected", func(t *testing.T) {
		t.Parallel()
		_, err := opSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateDebtOperationParams{
				DebtorID: uuid.New(), Direction: domain.DebtDirectionPayable,
				Kind: domain.DebtOperationKindDebt, Amount: 100, OccurredAt: time.Now().UTC(),
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtOperationDebtorNotFound)
	})

	t.Run("create and update with version CAS", func(t *testing.T) {
		t.Parallel()
		created, err := opSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateDebtOperationParams{
				DebtorID: debtor.ID, Direction: domain.DebtDirectionReceivable,
				Kind: domain.DebtOperationKindDebt, Amount: 100, OccurredAt: time.Now().UTC(),
			},
		)
		require.NoError(t, err)
		assert.Equal(t, int64(100), created.Amount)

		updated, err := opSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateDebtOperationParams{
				Amount: i64(250), Version: created.Version,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, int64(250), updated.Amount)
		assert.Equal(t, 2, updated.Version)

		_, err = opSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateDebtOperationParams{
				Amount: i64(999), Version: created.Version,
			},
		)
		require.ErrorIs(t, err, domain.ErrDebtOperationVersionConflict)
	})

	t.Run("empty update rejected", func(t *testing.T) {
		t.Parallel()
		created, err := opSvc.Create(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			domain.CreateDebtOperationParams{
				DebtorID: debtor.ID, Direction: domain.DebtDirectionPayable,
				Kind: domain.DebtOperationKindRepayment, Amount: 100, OccurredAt: time.Now().UTC(),
			},
		)
		require.NoError(t, err)
		_, err = opSvc.Update(
			ctx,
			domain.Scope{HouseholdID: userHH, ActorID: user.ID},
			created.ID,
			domain.UpdateDebtOperationParams{Version: created.Version},
		)
		require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)
	})

	t.Run("list filter by debtor", func(t *testing.T) {
		t.Parallel()
		first := seedDebtor(t, debtorSvc, userHH, user.ID, "Михаил")
		second := seedDebtor(t, debtorSvc, userHH, user.ID, "Ольга")
		for _, id := range []uuid.UUID{first.ID, second.ID} {
			_, err := opSvc.Create(
				ctx,
				domain.Scope{HouseholdID: userHH, ActorID: user.ID},
				domain.CreateDebtOperationParams{
					DebtorID: id, Direction: domain.DebtDirectionReceivable,
					Kind: domain.DebtOperationKindDebt, Amount: 100, OccurredAt: time.Now().UTC(),
				},
			)
			require.NoError(t, err)
		}
		ops, err := opSvc.List(
			ctx,
			domain.Scope{HouseholdID: userHH},
			domain.GetDebtOperationsParams{DebtorID: &first.ID},
		)
		require.NoError(t, err)
		assert.Len(t, ops, 1)
		assert.Equal(t, first.ID, ops[0].DebtorID)

		all, err := opSvc.List(ctx, domain.Scope{HouseholdID: userHH}, domain.GetDebtOperationsParams{})
		require.NoError(t, err)
		// Parallel sibling subtests add operations for the same user; only the
		// floor is deterministic here.
		assert.GreaterOrEqual(t, len(all), 2)
	})
}
