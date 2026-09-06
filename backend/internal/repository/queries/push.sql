-- push_subscriptions (web-push change, ADR-0004): per-device Web Push
-- registrations. NOT a synced entity - no change_log, no tombstones; dead
-- subscriptions are hard-deleted. Household parity: a plan's reminders go
-- to every member's subscription (join through household_members).

-- name: UpsertPushSubscription :one
-- One row per endpoint: re-registration refreshes keys + timezone.
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, time_zone)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (endpoint) DO UPDATE SET
    p256dh    = EXCLUDED.p256dh,
    auth      = EXCLUDED.auth,
    time_zone = EXCLUDED.time_zone,
    updated_at = now()
RETURNING id, user_id, endpoint, p256dh, auth, time_zone, created_at, updated_at;

-- name: DeletePushSubscription :execrows
-- Scoped to the owner: another user's subscription deletes zero rows and
-- reads as not-found (nothing leaks).
DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2;

-- name: DuePushReminderCandidates :many
-- Live plans with reminders joined to EVERY member's subscription of the
-- owning household (household parity), minus occurrences already sent and
-- minus on_day occurrences already handled (auto-executed by the server or
-- manually confirmed early - both advanced next_due past today). The
-- 10:00-subscriber-local reminder instant is computed in Go (exact IANA
-- math with embedded tzdata), not SQL, so a bad timezone row poisons at
-- most its own send, never the whole sweep.
SELECT
    p.id AS plan_id, p.name AS plan_name, p.type AS plan_type, p.amount AS plan_amount,
    p.reminder, p.confirm_mode, p.next_due AS occurrence_date,
    s.id AS subscription_id, s.endpoint, s.p256dh, s.auth, s.time_zone
FROM planned_payments p
JOIN household_members hm ON hm.household_id = p.household_id
JOIN push_subscriptions s ON s.user_id = hm.user_id
WHERE p.deleted_at IS NULL
  AND p.reminder <> 'off'
  AND NOT (p.reminder = 'on_day' AND p.next_due > @today)
  AND NOT EXISTS (
      SELECT 1 FROM push_reminders_sent m
      WHERE m.plan_id = p.id
        AND m.subscription_id = s.id
        AND m.occurrence_date = p.next_due
  );

-- name: InsertPushReminderSent :exec
-- Written only after a successful send; the PK is the at-most-once guard.
INSERT INTO push_reminders_sent (plan_id, occurrence_date, subscription_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: DeletePushSubscriptionByID :exec
-- Pruning after the push service reports a subscription gone (410/404):
-- markers cascade, the device simply re-registers if it ever returns.
DELETE FROM push_subscriptions WHERE id = $1;

-- name: PrunePushRemindersSent :execrows
-- Markers only matter while their occurrence is the plan's current next_due
-- (lookback is minutes); anything a week stale is dead weight.
DELETE FROM push_reminders_sent WHERE occurrence_date < @cutoff;
