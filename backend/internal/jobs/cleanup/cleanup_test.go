package cleanup_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/jobs/cleanup"
	"github.com/yurifa/trata/backend/internal/logger"
)

// fakeCleaner is an in-memory Cleaner for the cleanup job (no database).
type fakeCleaner struct {
	sessionsDeleted       atomic.Int64
	idempotencyDeleted    atomic.Int64
	expiredSessionErr     error
	expiredIdempotencyErr error
}

func (f *fakeCleaner) DeleteExpiredSessions(_ context.Context) (int64, error) {
	if f.expiredSessionErr != nil {
		return 0, f.expiredSessionErr
	}
	return f.sessionsDeleted.Swap(0), nil
}

func (f *fakeCleaner) DeleteExpiredIdempotencyKeys(_ context.Context) (int64, error) {
	if f.expiredIdempotencyErr != nil {
		return 0, f.expiredIdempotencyErr
	}
	return f.idempotencyDeleted.Swap(0), nil
}

func TestCleanup_Run_DeletesExpiredOnStartupSweep(t *testing.T) {
	t.Parallel()

	cleaner := &fakeCleaner{}
	cleaner.sessionsDeleted.Store(3)
	cleaner.idempotencyDeleted.Store(5)

	job := cleanup.New(cleaner, logger.NewDiscardLogger(), time.Hour)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- job.Run(ctx) }()

	// The startup sweep runs before the first tick; give it a moment.
	require.Eventually(t, func() bool {
		return cleaner.sessionsDeleted.Load() == 0 && cleaner.idempotencyDeleted.Load() == 0
	}, time.Second, 10*time.Millisecond, "startup sweep should delete expired rows")

	cancel()
	require.NoError(t, <-done)
}

type failingCleaner struct{ fakeCleaner }

func (f *failingCleaner) DeleteExpiredSessions(_ context.Context) (int64, error) {
	return 0, assertError("boom")
}

type errValError struct{ msg string }

func (e errValError) Error() string { return e.msg }

func assertError(msg string) error { return errValError{msg: msg} }

func TestCleanup_Run_KeepsLoopingOnError(t *testing.T) {
	t.Parallel()

	// Errors during a sweep must not stop the loop.
	cleaner := &failingCleaner{}
	job := cleanup.New(cleaner, logger.NewDiscardLogger(), 20*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- job.Run(ctx) }()

	// Let a couple of ticks pass, then cancel; Run must still return nil.
	time.Sleep(80 * time.Millisecond)
	cancel()
	require.NoError(t, <-done, "Run returns nil even when sweeps error")
}
