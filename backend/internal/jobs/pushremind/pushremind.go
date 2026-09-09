// Package pushremind is the Web Push reminder dispatcher for planned
// payments (web-push change, ADR-0004): a minute-tick background job that,
// for every live plan with a reminder setting, sends one notification per
// occurrence - day_before at 10:00 subscriber-local the day before the
// scheduled date, on_day at 10:00 subscriber-local on the date - to every
// registered device of every member of the household owning the plan
// (household parity).
//
// Idempotency is durable, not computed: a marker row (plan, occurrence,
// subscription) is written only after a successful send, so restarts and
// tick jitter can never duplicate a push, and a failed send (4xx/5xx)
// leaves no marker and retries on the next sweep. Occurrences whose
// reminder moment already passed outside the lookback window are skipped -
// there are no catch-up pushes for long-overdue plans (the dashboard
// attention card owns that visibility). on_day occurrences already handled
// (auto-executed by the server or manually confirmed early - both advanced
// next_due past today) are filtered out in the candidate query.
package pushremind

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	// Embedded IANA tz database: the alpine runtime image carries no
	// /usr/share/zoneinfo, and reminder instants are computed in Go
	// (time.LoadLocation) - without this import every zone lookup fails.
	_ "time/tzdata"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/logger"
)

// reminderHour is the wall-clock hour of every reminder, matching the
// mobile model (10:00 device-local). reminderTTL bounds how long the push
// service keeps an undelivered message (minutes, not hours: a reminder the
// device never receives is noise by the time it reconnects).
const (
	reminderHour = 10
	reminderTTL  = 15 * time.Minute
)

// staleMarkerCutoff: sent markers are only ever matched against the plan's
// CURRENT next_due, so anything a week past is dead weight.
const staleMarkerCutoff = 7 * 24 * time.Hour

// hoursPerDay calendar constant (mnd).
const hoursPerDay = 24

// Sender delivers one encrypted Web Push message to a subscription. It is
// an interface so the job is testable against a fake; the production
// implementation is the VAPID-signed webpush-go client.
type Sender interface {
	Send(ctx context.Context, sub domain.PushSubscription, payload []byte) error
}

// Store is the repository surface the job needs: candidates, the
// at-most-once markers, and subscription/marker pruning.
type Store interface {
	DuePushReminderCandidates(
		ctx context.Context,
		today time.Time,
	) ([]domain.PushReminderCandidate, error)
	MarkPushReminderSent(
		ctx context.Context,
		planID uuid.UUID,
		occurrence time.Time,
		subscriptionID uuid.UUID,
	) error
	PrunePushSubscription(ctx context.Context, id uuid.UUID) error
	PrunePushRemindersSent(ctx context.Context, cutoff time.Time) (int64, error)
}

type Job struct {
	db       Store
	sender   Sender
	log      *slog.Logger
	interval time.Duration
	// nowFn is the sweep clock (UTC); injectable for tests.
	nowFn func() time.Time
}

func New(db Store, sender Sender, log *slog.Logger, interval time.Duration) *Job {
	return &Job{
		db:       db,
		sender:   sender,
		log:      logger.WithComponent(log, "pushremind"),
		interval: interval,
		nowFn:    func() time.Time { return time.Now().UTC() },
	}
}

// WithClock overrides the sweep clock (UTC). Test seam: production runs on
// wall time, deterministic window assertions need a fixed clock.
func (j *Job) WithClock(now func() time.Time) *Job {
	j.nowFn = now
	return j
}

// SweepOnce performs a single dispatch sweep. Exported as the deterministic
// half of Run (tests drive it with WithClock; it is also a safe manual
// trigger - the sweep is idempotent by design).
func (j *Job) SweepOnce(ctx context.Context) { j.runOnce(ctx) }

// Run blocks until ctx is cancelled. One sweep immediately (startup pass),
// then per tick. Per-candidate errors are logged and never stop the loop.
func (j *Job) Run(ctx context.Context) error {
	j.log.InfoContext(ctx, "push-remind job started", slog.Duration("interval", j.interval))

	j.runOnce(ctx)

	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			j.log.InfoContext(ctx, "push-remind job stopped")
			return nil
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

// lookback is the half-open scan window (now-lookback, now]: generous
// relative to the tick so a slow sweep still catches its instants, while
// the sent markers keep it at-most-once.
func (j *Job) lookback() time.Duration {
	return 2*j.interval + 30*time.Second
}

func (j *Job) runOnce(ctx context.Context) {
	now := j.nowFn().UTC()
	windowStart := now.Add(-j.lookback())
	today := now.Truncate(hoursPerDay * time.Second)

	candidates, err := j.db.DuePushReminderCandidates(ctx, today)
	if err != nil {
		j.log.WarnContext(ctx, "failed to list reminder candidates", logger.Error(err))
		return
	}

	sent := 0
	for _, c := range candidates {
		instant, err := ReminderInstant(c)
		if err != nil {
			// A bad timezone poisons only this candidate's send (validated
			// at upsert; this is belt-and-suspenders), never the sweep.
			j.log.WarnContext(ctx, "skipping candidate with unusable timezone",
				logger.Error(err), slog.String("subscriptionId", c.Subscription.ID.String()))
			continue
		}
		if !instant.After(windowStart) || instant.After(now) {
			continue
		}

		payload, err := json.Marshal(NewReminderPayload(c))
		if err != nil {
			j.log.WarnContext(ctx, "failed to encode reminder payload", logger.Error(err))
			continue
		}

		if err := j.sender.Send(ctx, c.Subscription, payload); err != nil {
			if IsGone(err) {
				if perr := j.db.PrunePushSubscription(ctx, c.Subscription.ID); perr != nil {
					j.log.WarnContext(ctx, "failed to prune dead subscription", logger.Error(perr))
				}
				continue
			}
			// No marker on failure: the next sweep retries within the
			// window; past it, the occurrence stays unnotified by design.
			j.log.WarnContext(ctx, "reminder delivery failed",
				logger.Error(err), slog.String("subscriptionId", c.Subscription.ID.String()))
			continue
		}

		if err := j.db.MarkPushReminderSent(ctx, c.PlanID, c.Occurrence, c.Subscription.ID); err != nil {
			j.log.WarnContext(ctx, "failed to record sent marker",
				logger.Error(err), slog.String("subscriptionId", c.Subscription.ID.String()))
		}
		sent++
	}

	if sent > 0 {
		j.log.InfoContext(ctx, "planned payment reminders sent", slog.Int("count", sent))
	}

	if pruned, err := j.db.PrunePushRemindersSent(ctx, today.Add(-staleMarkerCutoff)); err != nil {
		j.log.WarnContext(ctx, "failed to prune stale sent markers", logger.Error(err))
	} else if pruned > 0 {
		j.log.InfoContext(ctx, "stale sent markers pruned", slog.Int64("count", pruned))
	}
}

// ReminderInstant is the 10:00 subscriber-local moment of the candidate's
// reminder: the occurrence's calendar date, minus one day for day_before.
// Exported because the service-worker contract tests assert the same
// instants the job computes.
func ReminderInstant(c domain.PushReminderCandidate) (time.Time, error) {
	loc, err := time.LoadLocation(c.Subscription.TimeZone)
	if err != nil {
		return time.Time{}, err
	}
	day := c.Occurrence
	if c.Reminder == domain.PlannedReminderDayBefore {
		day = day.AddDate(0, 0, -1)
	}
	return time.Date(day.Year(), day.Month(), day.Day(), reminderHour, 0, 0, 0, loc), nil
}

// ReminderPayload is the wire shape the service worker's push handler
// consumes. It is presentational only: correctness on activation comes
// from local data + sync, never from this payload.
type ReminderPayload struct {
	PlanID      string `json:"planId"`
	PlanName    string `json:"planName"`
	ConfirmMode string `json:"confirmMode"` // manual | auto
	Type        string `json:"type"`        // expense | income
	AmountMinor int64  `json:"amountMinor"`
}

// NewReminderPayload builds the wire payload for one candidate; the
// service worker's push handler parses exactly this shape.
func NewReminderPayload(c domain.PushReminderCandidate) ReminderPayload {
	return ReminderPayload{
		PlanID:      c.PlanID.String(),
		PlanName:    c.PlanName,
		ConfirmMode: string(c.ConfirmMode),
		Type:        string(c.PlanType),
		AmountMinor: c.PlanAmount,
	}
}
