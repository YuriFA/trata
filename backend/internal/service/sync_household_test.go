package service_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// Per-household sync semantics (household-scoping change): the change-log
// advisory lock (and with it seq allocation) is per household, pulls only ever
// deliver the requesting household's changes, and applied-opId idempotency is
// scoped by household - the same opId in another household is a fresh
// operation, never a replay of the first household's result.

func syncFixture(t *testing.T) (*service.SyncService, *domain.User, uuid.UUID, *domain.User, uuid.UUID) {
	t.Helper()
	store := fakes.New()
	userA := seedFakeUser(t, store)
	hhA := householdOf(t, store, userA.ID)
	userB := seedFakeUser(t, store)
	hhB := householdOf(t, store, userB.ID)
	return service.NewSyncService(store), userA, hhA, userB, hhB
}

func accountUpsertOp(opID, recordID uuid.UUID) domain.SyncOperation {
	return domain.SyncOperation{
		OpID: opID, Entity: domain.SyncEntityAccount, Action: domain.SyncActionUpsert,
		ID: recordID, BaseVersion: 0,
		Data: mustJSON(&domain.AccountFullState{
			Name: "Карта", Currency: "RUB", OpeningBalance: 100,
		}),
	}
}

func mustJSON(v any) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

func TestSync_PerHouseholdSeqMonotonic(t *testing.T) {
	t.Parallel()
	syncSvc, userA, hhA, userB, hhB := syncFixture(t)
	ctx := context.Background()

	// Interleave pushes from both households; each allocates seqs from the
	// same global identity column but only its own household's lock.
	var seqsA, seqsB []int64
	for i := range 3 {
		_, err := syncSvc.Push(ctx, domain.Scope{HouseholdID: hhA, ActorID: userA.ID}, []domain.SyncOperation{
			accountUpsertOp(uuid.New(), uuid.New()),
		})
		require.NoError(t, err)
		_, err = syncSvc.Push(ctx, domain.Scope{HouseholdID: hhB, ActorID: userB.ID}, []domain.SyncOperation{
			accountUpsertOp(uuid.New(), uuid.New()),
		})
		require.NoError(t, err)

		pageA, err := syncSvc.Pull(ctx, domain.Scope{HouseholdID: hhA}, lastSeq(seqsA), nil)
		require.NoError(t, err)
		seqsA = appendSeqs(seqsA, pageA)
		pageB, err := syncSvc.Pull(ctx, domain.Scope{HouseholdID: hhB}, lastSeq(seqsB), nil)
		require.NoError(t, err)
		seqsB = appendSeqs(seqsB, pageB)
		_ = i
	}

	// Each household's stream is strictly increasing (the ordering invariant
	// a stored cursor relies on under the per-household advisory lock).
	require.True(t, strictlyIncreasing(seqsA), "household A seqs: %v", seqsA)
	require.True(t, strictlyIncreasing(seqsB), "household B seqs: %v", seqsB)
	// Three changes each.
	assert.Len(t, seqsA, 3)
	assert.Len(t, seqsB, 3)
}

func TestSync_PullIsolationBetweenHouseholds(t *testing.T) {
	t.Parallel()
	syncSvc, userA, hhA, userB, hhB := syncFixture(t)
	ctx := context.Background()

	recordA := uuid.New()
	recordB := uuid.New()
	_, err := syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhA, ActorID: userA.ID},
		[]domain.SyncOperation{accountUpsertOp(uuid.New(), recordA)},
	)
	require.NoError(t, err)
	_, err = syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhB, ActorID: userB.ID},
		[]domain.SyncOperation{accountUpsertOp(uuid.New(), recordB)},
	)
	require.NoError(t, err)

	// Each pull delivers ONLY its household's records.
	pageA, err := syncSvc.Pull(ctx, domain.Scope{HouseholdID: hhA}, 0, nil)
	require.NoError(t, err)
	require.Len(t, pageA.Changes, 1)
	assert.Equal(t, recordA, pageA.Changes[0].ID)

	pageB, err := syncSvc.Pull(ctx, domain.Scope{HouseholdID: hhB}, 0, nil)
	require.NoError(t, err)
	require.Len(t, pageB.Changes, 1)
	assert.Equal(t, recordB, pageB.Changes[0].ID)

	// Authorship of the change (the acting member) rides on the log row:
	// the change data itself is the household's shared record state.
	require.NotNil(t, pageA.Changes[0].Data)
}

func TestSync_OpIdIdempotencyScopedByHousehold(t *testing.T) {
	t.Parallel()
	syncSvc, userA, hhA, userB, hhB := syncFixture(t)
	ctx := context.Background()

	// The SAME opId pushed in household A and then in household B (record ids
	// are per-client UUIDs). B must not replay A's stored result: opIds are
	// scoped by household, so B evaluates the operation fresh against its own
	// (empty) state and creates its own record.
	opID := uuid.New()

	resultsA, err := syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhA, ActorID: userA.ID},
		[]domain.SyncOperation{accountUpsertOp(opID, uuid.New())},
	)
	require.NoError(t, err)
	require.Len(t, resultsA, 1)
	assert.Equal(t, domain.SyncStatusApplied, resultsA[0].Status)

	resultsB, err := syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhB, ActorID: userB.ID},
		[]domain.SyncOperation{accountUpsertOp(opID, uuid.New())},
	)
	require.NoError(t, err)
	require.Len(t, resultsB, 1)
	assert.Equal(t, domain.SyncStatusApplied, resultsB[0].Status,
		"the same opId in another household is a fresh operation, not a replay")

	// Within one household, redelivery of the same opId replays the stored
	// result with no side effects.
	replayed, err := syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhA, ActorID: userA.ID},
		[]domain.SyncOperation{accountUpsertOp(opID, uuid.New())},
	)
	require.NoError(t, err)

	// A record id that exists in ANOTHER household reads as an
	// already-exists conflict with NO serverState: the foreign record must
	// not be revealed (IDOR-safe even at the id-collision level).
	foreignRecord := uuid.New()
	_, err = syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhA, ActorID: userA.ID},
		[]domain.SyncOperation{accountUpsertOp(uuid.New(), foreignRecord)},
	)
	require.NoError(t, err)
	probe, err := syncSvc.Push(
		ctx,
		domain.Scope{HouseholdID: hhB, ActorID: userB.ID},
		[]domain.SyncOperation{accountUpsertOp(uuid.New(), foreignRecord)},
	)
	require.NoError(t, err)
	require.Len(t, probe, 1)
	assert.Equal(t, domain.SyncStatusConflict, probe[0].Status)
	assert.Equal(t, domain.SyncCodeAlreadyExists, probe[0].Code)
	assert.Nil(t, probe[0].ServerState, "no foreign record state revealed")
	assert.Equal(t, resultsA[0].Version, replayed[0].Version)

	// Each household's pull sees its own records only: A has its original +
	// the foreign-record target, B has its own single record (the probe was a
	// conflict and created nothing).
	pageA, err := syncSvc.Pull(ctx, domain.Scope{HouseholdID: hhA}, 0, nil)
	require.NoError(t, err)
	require.Len(t, pageA.Changes, 2)
	pageB, err := syncSvc.Pull(ctx, domain.Scope{HouseholdID: hhB}, 0, nil)
	require.NoError(t, err)
	require.Len(t, pageB.Changes, 1)
}

func lastSeq(seqs []int64) int64 {
	if len(seqs) == 0 {
		return 0
	}
	return seqs[len(seqs)-1]
}

func appendSeqs(seqs []int64, page *service.SyncPullPage) []int64 {
	for _, change := range page.Changes {
		seqs = append(seqs, change.Seq)
	}
	return seqs
}

func strictlyIncreasing(seqs []int64) bool {
	for i := 1; i < len(seqs); i++ {
		if seqs[i] <= seqs[i-1] {
			return false
		}
	}
	return true
}
