package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/expense-tracker-api/internal/domain"
)

// PushService owns the REST surface of Web Push subscriptions (web-push
// change, ADR-0004). It is deliberately thin: the endpoint/keys payload is
// opaque server-side (the push service, not us, consumes it), and the only
// domain rule is timezone validity - reminder dispatch computes 10:00
// subscriber-local instants, so an unknown IANA name would poison that
// subscription's sends; it is rejected here instead.

// PushSubscriptionStore is the repository surface the service needs.
type PushSubscriptionStore interface {
	UpsertPushSubscription(
		ctx context.Context,
		params domain.UpsertPushSubscriptionParams,
	) (*domain.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID, id uuid.UUID) error
}

type PushService struct {
	repo PushSubscriptionStore
}

func NewPushService(repo PushSubscriptionStore) *PushService {
	return &PushService{repo: repo}
}

// UpsertSubscription registers (or refreshes) a device's subscription.
// Re-registration with the same endpoint overwrites keys and timezone.
func (s *PushService) UpsertSubscription(
	ctx context.Context,
	userID uuid.UUID,
	endpoint, p256dh, auth, timeZone string,
) (*domain.PushSubscription, error) {
	if _, err := time.LoadLocation(timeZone); err != nil {
		return nil, domain.ErrPushSubscriptionTimezoneInvalid
	}
	return s.repo.UpsertPushSubscription(ctx, domain.UpsertPushSubscriptionParams{
		UserID:   userID,
		Endpoint: endpoint,
		P256dh:   p256dh,
		Auth:     auth,
		TimeZone: timeZone,
	})
}

// DeleteSubscription removes the caller's own subscription; another user's
// or a missing id behaves as not-found.
func (s *PushService) DeleteSubscription(ctx context.Context, userID, id uuid.UUID) error {
	return s.repo.DeletePushSubscription(ctx, userID, id)
}
