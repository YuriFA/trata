package postgres

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	db "github.com/yurifa/trata/backend/internal/repository/db"
)

// Web Push subscriptions (web-push change, ADR-0004). Unlike every other
// entity these are plain rows: no change_log, no tombstones, no version -
// re-registration upserts by endpoint and dead subscriptions are deleted.
// The REST-facing pair below serves the API; the reminder-dispatch reads
// and markers (also here) serve the pushremind job.

func (r *Repository) UpsertPushSubscription(
	ctx context.Context,
	params domain.UpsertPushSubscriptionParams,
) (*domain.PushSubscription, error) {
	const op = "repository.postgres.UpsertPushSubscription"

	row, err := r.q.UpsertPushSubscription(ctx, db.UpsertPushSubscriptionParams{
		UserID:   params.UserID,
		Endpoint: params.Endpoint,
		P256dh:   params.P256dh,
		Auth:     params.Auth,
		TimeZone: params.TimeZone,
	})
	if err != nil {
		return nil, opWrap(op, err)
	}
	return pushSubscriptionFromRow(row), nil
}

func (r *Repository) DeletePushSubscription(
	ctx context.Context,
	userID, id uuid.UUID,
) error {
	const op = "repository.postgres.DeletePushSubscription"

	// Scoped to the owner: another user's (or missing) subscription deletes
	// zero rows and reads as not-found; nothing about other users leaks.
	deleted, err := r.q.DeletePushSubscription(ctx, db.DeletePushSubscriptionParams{
		ID:     id,
		UserID: userID,
	})
	if err != nil {
		return opWrap(op, err)
	}
	if deleted == 0 {
		return opWrap(op, domain.ErrPushSubscriptionNotFound)
	}
	return nil
}

func pushSubscriptionFromRow(row db.PushSubscription) *domain.PushSubscription {
	return &domain.PushSubscription{
		ID:        row.ID,
		UserID:    row.UserID,
		Endpoint:  row.Endpoint,
		P256dh:    row.P256dh,
		Auth:      row.Auth,
		TimeZone:  row.TimeZone,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

// DuePushReminderCandidates returns (plan, subscription) pairs whose
// occurrence might need a reminder push right now: live plans with
// reminders, every household member's subscription, minus already-sent and
// already-handled on_day occurrences. The 10:00-local instant filter runs
// in the job (Go tz math), not here.
func (r *Repository) DuePushReminderCandidates(
	ctx context.Context,
	today time.Time,
) ([]domain.PushReminderCandidate, error) {
	const op = "repository.postgres.DuePushReminderCandidates"

	rows, err := r.q.DuePushReminderCandidates(ctx, today)
	if err != nil {
		return nil, opWrap(op, err)
	}
	out := make([]domain.PushReminderCandidate, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.PushReminderCandidate{
			PlanID:      row.PlanID,
			PlanName:    row.PlanName,
			PlanType:    domain.TransactionType(row.PlanType),
			PlanAmount:  row.PlanAmount,
			Reminder:    domain.PlannedReminder(row.Reminder),
			ConfirmMode: domain.PlannedConfirmMode(row.ConfirmMode),
			Occurrence:  row.OccurrenceDate,
			Subscription: domain.PushSubscription{
				ID:       row.SubscriptionID,
				Endpoint: row.Endpoint,
				P256dh:   row.P256dh,
				Auth:     row.Auth,
				TimeZone: row.TimeZone,
			},
		})
	}
	return out, nil
}

// MarkPushReminderSent records a successful send (the at-most-once guard).
// ON CONFLICT DO NOTHING: a concurrent duplicate is a no-op, not an error.
func (r *Repository) MarkPushReminderSent(
	ctx context.Context,
	planID uuid.UUID,
	occurrenceDate time.Time,
	subscriptionID uuid.UUID,
) error {
	const op = "repository.postgres.MarkPushReminderSent"

	if err := r.q.InsertPushReminderSent(ctx, db.InsertPushReminderSentParams{
		PlanID:         planID,
		OccurrenceDate: occurrenceDate,
		SubscriptionID: subscriptionID,
	}); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// PrunePushSubscription deletes a subscription the push service reported
// gone (410/404). Sent markers cascade away with it.
func (r *Repository) PrunePushSubscription(ctx context.Context, id uuid.UUID) error {
	const op = "repository.postgres.PrunePushSubscription"

	if err := r.q.DeletePushSubscriptionByID(ctx, id); err != nil {
		return opWrap(op, err)
	}
	return nil
}

// PrunePushRemindersSent drops markers whose occurrence is long past (the
// job only ever matches the plan's current next_due, so a week-old marker
// is dead weight). Returns the pruned row count for logging.
func (r *Repository) PrunePushRemindersSent(ctx context.Context, cutoff time.Time) (int64, error) {
	const op = "repository.postgres.PrunePushRemindersSent"

	n, err := r.q.PrunePushRemindersSent(ctx, cutoff)
	if err != nil {
		return 0, opWrap(op, err)
	}
	return n, nil
}
