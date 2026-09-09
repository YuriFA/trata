// Package retention is a background subsystem that periodically hard-deletes
// tombstoned rows older than the retention window, so soft-deleted data does
// not grow without bound. The change_log is never pruned: pulls serve
// tombstones from the log alone, so a device offline during the whole window
// still converges to the deleted state on its next pull. Records deleted
// locally after the window closed keep their tombstone log entries forever,
// which bounds correctness loss to devices offline longer than the window
// seeing nil-data upserts (skipped by the client) before the tombstone.
package retention

import (
	"context"
	"log/slog"
	"time"

	"github.com/yurifa/trata/backend/internal/logger"
)

// Store is the repository surface the job needs.
type Store interface {
	DeleteTombstonedTransactionsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedPlannedPaymentsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedCategoriesBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedAccountsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedDebtOperationsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedDebtorsBefore(ctx context.Context, cutoff time.Time) (int64, error)
}

type Job struct {
	db       Store
	log      *slog.Logger
	window   time.Duration
	interval time.Duration
}

func New(db Store, log *slog.Logger, window, interval time.Duration) *Job {
	return &Job{
		db:       db,
		log:      logger.WithComponent(log, "retention"),
		window:   window,
		interval: interval,
	}
}

// Run blocks until ctx is cancelled. It performs one sweep immediately
// (startup pass), then repeats on every interval tick. Per-pass errors are
// logged and never stop the loop, so Run always returns nil.
func (j *Job) Run(ctx context.Context) error {
	j.log.InfoContext(ctx, "retention job started",
		slog.Duration("window", j.window),
		slog.Duration("interval", j.interval),
	)

	j.runOnce(ctx)

	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			j.log.InfoContext(ctx, "retention job stopped")
			return nil
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

// runOnce deletes in FK-safe order: transactions and planned payments
// reference categories and accounts, and debt operations reference debtors,
// so the referencing tombstoned rows must go first.
func (j *Job) runOnce(ctx context.Context) {
	cutoff := time.Now().UTC().Add(-j.window)

	if n, err := j.db.DeleteTombstonedTransactionsBefore(ctx, cutoff); err != nil {
		j.log.WarnContext(ctx, "failed to delete tombstoned transactions", logger.Error(err))
	} else if n > 0 {
		j.log.InfoContext(ctx, "tombstoned transactions deleted", slog.Int64("count", n))
	}

	if n, err := j.db.DeleteTombstonedPlannedPaymentsBefore(ctx, cutoff); err != nil {
		j.log.WarnContext(ctx, "failed to delete tombstoned planned payments", logger.Error(err))
	} else if n > 0 {
		j.log.InfoContext(ctx, "tombstoned planned payments deleted", slog.Int64("count", n))
	}

	if n, err := j.db.DeleteTombstonedCategoriesBefore(ctx, cutoff); err != nil {
		j.log.WarnContext(ctx, "failed to delete tombstoned categories", logger.Error(err))
	} else if n > 0 {
		j.log.InfoContext(ctx, "tombstoned categories deleted", slog.Int64("count", n))
	}

	if n, err := j.db.DeleteTombstonedAccountsBefore(ctx, cutoff); err != nil {
		j.log.WarnContext(ctx, "failed to delete tombstoned accounts", logger.Error(err))
	} else if n > 0 {
		j.log.InfoContext(ctx, "tombstoned accounts deleted", slog.Int64("count", n))
	}

	if n, err := j.db.DeleteTombstonedDebtOperationsBefore(ctx, cutoff); err != nil {
		j.log.WarnContext(ctx, "failed to delete tombstoned debt operations", logger.Error(err))
	} else if n > 0 {
		j.log.InfoContext(ctx, "tombstoned debt operations deleted", slog.Int64("count", n))
	}

	if n, err := j.db.DeleteTombstonedDebtorsBefore(ctx, cutoff); err != nil {
		j.log.WarnContext(ctx, "failed to delete tombstoned debtors", logger.Error(err))
	} else if n > 0 {
		j.log.InfoContext(ctx, "tombstoned debtors deleted", slog.Int64("count", n))
	}
}
