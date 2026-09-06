-- Web Push subscriptions for planned-payment reminders (web-push change):
-- per-device records of authenticated users. NOT a synced entity: no
-- change_log participation, no tombstones - a dead subscription is deleted
-- outright when the push service reports it gone (410/404). The endpoint
-- URL is a bearer secret: it is never logged and never exposed to other
-- clients. time_zone is the device's IANA name reported at registration;
-- reminders fire at 10:00 in that zone (ADR-0004).

CREATE TABLE push_subscriptions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint    TEXT        NOT NULL,
    p256dh      TEXT        NOT NULL,
    auth        TEXT        NOT NULL,
    time_zone   TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upsert key: one row per endpoint (one per device); re-registration
-- refreshes keys and timezone instead of duplicating.
CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Reminder delivery markers: at most one push per plan occurrence per
-- subscription, durable across job restarts and tick jitter. Rows are
-- written only after a successful send, so a failed delivery (4xx/5xx)
-- leaves no marker and the next sweep retries. CASCADE on both ends: hard
-- deletes (retention pruning of tombstoned plans, subscription pruning)
-- take their markers along.
CREATE TABLE push_reminders_sent (
    plan_id         UUID        NOT NULL REFERENCES planned_payments (id) ON DELETE CASCADE,
    occurrence_date DATE        NOT NULL,
    subscription_id UUID        NOT NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, occurrence_date, subscription_id)
);
