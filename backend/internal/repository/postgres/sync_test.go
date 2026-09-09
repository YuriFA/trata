package postgres_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// Applied-operation idempotency is owner-scoped: a stored opId replays only
// for the user it was applied for, never for another account.
func TestSyncAppliedOperationOwnerScoped(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	userA := seedUser(t, "sync-owner-a")
	userAHH := householdOf(t, userA.ID)
	userB := seedUser(t, "sync-owner-b")
	userBHH := householdOf(t, userB.ID)
	ctx := newCtx(t)
	opID := uuid.New()

	err := testRepo.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: userAHH}, func(tx repository.SyncTx) error {
		return tx.InsertAppliedOperation(ctx, domain.AppliedOperation{
			OpID:        opID,
			HouseholdID: userAHH,
			UserID:      userA.ID,
			Entity:      domain.SyncEntityCategory,
			EntityID:    uuid.New(),
			Result:      domain.SyncPushResult{OpID: opID, Status: domain.SyncStatusApplied, Version: 3},
		})
	})
	require.NoError(t, err, "insert applied operation")

	var foreign *domain.AppliedOperation
	err = testRepo.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: userBHH}, func(tx repository.SyncTx) error {
		found, getErr := tx.GetAppliedOperation(ctx, domain.Scope{HouseholdID: userBHH}, opID)
		foreign = found
		return getErr
	})
	require.NoError(t, err, "read as user B")
	assert.Nil(t, foreign, "another user's applied operation must not replay")

	var own *domain.AppliedOperation
	err = testRepo.WithinHouseholdTx(ctx, domain.Scope{HouseholdID: userAHH}, func(tx repository.SyncTx) error {
		found, getErr := tx.GetAppliedOperation(ctx, domain.Scope{HouseholdID: userAHH}, opID)
		own = found
		return getErr
	})
	require.NoError(t, err, "read as user A")
	if assert.NotNil(t, own, "own applied operation replays") {
		assert.Equal(t, domain.SyncStatusApplied, own.Result.Status)
		assert.Equal(t, 3, own.Result.Version)
	}
}
