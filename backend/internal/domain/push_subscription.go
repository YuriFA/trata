package domain

import (
	"time"

	"github.com/google/uuid"
)

// PushSubscription is a web device registered for planned-payment reminder
// pushes (web-push change, ADR-0004). Per-device by design: NOT a synced
// entity (no change_log rows, no tombstones - a dead subscription is
// deleted outright), invisible to other household members. The Endpoint
// URL is a bearer secret: never logged, never returned to other clients.
// TimeZone is the device's IANA name reported at registration; reminder
// pushes fire at 10:00 in that zone.
type PushSubscription struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Endpoint  string
	P256dh    string
	Auth      string
	TimeZone  string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// UpsertPushSubscriptionParams creates or refreshes (same endpoint) a
// device's subscription. Keys and timezone are always overwritten.
type UpsertPushSubscriptionParams struct {
	UserID   uuid.UUID
	Endpoint string
	P256dh   string
	Auth     string
	TimeZone string
}

// PushReminderCandidate is the pushremind job's dispatch projection: one
// (live plan with reminders enabled) x (subscription of a household member)
// pair whose occurrence is a reminder candidate (occurrence = the plan's
// current next_due). The 10:00-subscriber-local instant is computed by the
// job from Subscription.TimeZone.
type PushReminderCandidate struct {
	PlanID       uuid.UUID
	PlanName     string
	PlanType     TransactionType
	PlanAmount   int64
	Reminder     PlannedReminder
	ConfirmMode  PlannedConfirmMode
	Occurrence   time.Time
	Subscription PushSubscription
}
