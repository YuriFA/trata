package retention_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/jobs/retention"
	"github.com/yurifa/trata/backend/internal/logger"
)

// fakeStore is an in-memory Store for the retention job (no database). It
// records the cutoffs it was called with so tests can assert the window.
type fakeStore struct {
	transactionsDeleted atomic.Int64
	categoriesDeleted   atomic.Int64
	accountsDeleted     atomic.Int64
	debtOpsDeleted      atomic.Int64
	debtorsDeleted      atomic.Int64
	plansDeleted        atomic.Int64
	transactionsErr     error
	categoriesErr       error
	accountsErr         error
	debtOpsErr          error
	debtorsErr          error
	plansErr            error

	transactionsCutoff atomic.Pointer[time.Time]
	plansCutoff        atomic.Pointer[time.Time]
	categoriesCutoff   atomic.Pointer[time.Time]
	accountsCutoff     atomic.Pointer[time.Time]
	debtOpsCutoff      atomic.Pointer[time.Time]
	debtorsCutoff      atomic.Pointer[time.Time]
}

func (f *fakeStore) DeleteTombstonedTransactionsBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.transactionsCutoff.Store(&cutoff)
	if f.transactionsErr != nil {
		return 0, f.transactionsErr
	}
	return f.transactionsDeleted.Swap(0), nil
}

func (f *fakeStore) DeleteTombstonedPlannedPaymentsBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.plansCutoff.Store(&cutoff)
	if f.plansErr != nil {
		return 0, f.plansErr
	}
	return f.plansDeleted.Swap(0), nil
}

func (f *fakeStore) DeleteTombstonedCategoriesBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.categoriesCutoff.Store(&cutoff)
	if f.categoriesErr != nil {
		return 0, f.categoriesErr
	}
	return f.categoriesDeleted.Swap(0), nil
}

func (f *fakeStore) DeleteTombstonedAccountsBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.accountsCutoff.Store(&cutoff)
	if f.accountsErr != nil {
		return 0, f.accountsErr
	}
	return f.accountsDeleted.Swap(0), nil
}

func (f *fakeStore) DeleteTombstonedDebtOperationsBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.debtOpsCutoff.Store(&cutoff)
	if f.debtOpsErr != nil {
		return 0, f.debtOpsErr
	}
	return f.debtOpsDeleted.Swap(0), nil
}

func (f *fakeStore) DeleteTombstonedDebtorsBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.debtorsCutoff.Store(&cutoff)
	if f.debtorsErr != nil {
		return 0, f.debtorsErr
	}
	return f.debtorsDeleted.Swap(0), nil
}

func TestRetention_Run_SweepsOnStartup(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	store.transactionsDeleted.Store(2)
	store.categoriesDeleted.Store(3)
	store.accountsDeleted.Store(1)

	window := 90 * 24 * time.Hour
	job := retention.New(store, logger.NewDiscardLogger(), window, time.Hour)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- job.Run(ctx) }()

	require.Eventually(t, func() bool {
		return store.transactionsDeleted.Load() == 0 &&
			store.categoriesDeleted.Load() == 0 &&
			store.accountsDeleted.Load() == 0
	}, time.Second, 10*time.Millisecond, "startup sweep should delete tombstoned rows")

	for name, cutoff := range map[string]*time.Time{
		"transactions": store.transactionsCutoff.Load(),
		"categories":   store.categoriesCutoff.Load(),
		"accounts":     store.accountsCutoff.Load(),
	} {
		require.NotNil(t, cutoff, "%s sweep must run", name)
		require.WithinDuration(t, time.Now().UTC().Add(-window), *cutoff, time.Minute,
			"%s cutoff must be now minus the retention window", name)
	}

	cancel()
	require.NoError(t, <-done)
}

func TestRetention_Run_KeepsLoopingOnError(t *testing.T) {
	t.Parallel()

	store := &fakeStore{transactionsErr: boomError{}, categoriesErr: boomError{}, accountsErr: boomError{}}
	job := retention.New(store, logger.NewDiscardLogger(), time.Hour, 20*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- job.Run(ctx) }()

	// Let a couple of ticks pass, then cancel; Run must still return nil.
	time.Sleep(80 * time.Millisecond)
	cancel()
	require.NoError(t, <-done, "Run returns nil even when sweeps error")
}

type boomError struct{}

func (boomError) Error() string { return "boom" }
