// Package cleanup is a background subsystem that periodically deletes expired
// sessions and idempotency keys, so their tables do not grow without bound.
package cleanup

import (
	"context"
	"log/slog"
	"time"

	"github.com/yurifa/trata/backend/internal/logger"
)

// Cleaner is the repository surface the job needs.
type Cleaner interface {
	DeleteExpiredSessions(ctx context.Context) (int64, error)
	DeleteExpiredIdempotencyKeys(ctx context.Context) (int64, error)
}

type Cleanup struct {
	db       Cleaner
	log      *slog.Logger
	interval time.Duration
}

func New(db Cleaner, log *slog.Logger, interval time.Duration) *Cleanup {
	return &Cleanup{
		db:       db,
		log:      logger.WithComponent(log, "cleanup"),
		interval: interval,
	}
}

// Run blocks until ctx is cancelled. It performs one cleanup pass immediately
// (startup sweep), then repeats on every interval tick. Per-pass errors are
// logged and never stop the loop, so Run always returns nil.
func (c *Cleanup) Run(ctx context.Context) error {
	c.log.InfoContext(ctx, "cleanup job started", slog.Duration("interval", c.interval))

	c.runOnce(ctx)

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			c.log.InfoContext(ctx, "cleanup job stopped")
			return nil
		case <-ticker.C:
			c.runOnce(ctx)
		}
	}
}

func (c *Cleanup) runOnce(ctx context.Context) {
	if n, err := c.db.DeleteExpiredSessions(ctx); err != nil {
		c.log.WarnContext(ctx, "failed to delete expired sessions", logger.Error(err))
	} else if n > 0 {
		c.log.InfoContext(ctx, "expired sessions deleted", slog.Int64("count", n))
	}

	if n, err := c.db.DeleteExpiredIdempotencyKeys(ctx); err != nil {
		c.log.WarnContext(ctx, "failed to delete expired idempotency keys", logger.Error(err))
	} else if n > 0 {
		c.log.InfoContext(ctx, "expired idempotency keys deleted", slog.Int64("count", n))
	}
}
