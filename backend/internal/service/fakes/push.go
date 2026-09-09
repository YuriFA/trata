package fakes

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// --- PushSubscriptionRepository ----------------------------------------------

// Push subscriptions in the fake store: endpoint-keyed (the upsert key),
// user-owned. No change_log participation, matching the real store.

func (s *Store) UpsertPushSubscription(
	_ context.Context,
	params domain.UpsertPushSubscriptionParams,
) (*domain.PushSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	if existing, ok := s.pushSubscriptionsByEndpoint(params.Endpoint); ok {
		existing.P256dh = params.P256dh
		existing.Auth = params.Auth
		existing.TimeZone = params.TimeZone
		existing.UpdatedAt = now
		return clonePushSubscription(existing), nil
	}
	sub := &domain.PushSubscription{
		ID:        uuid.New(),
		UserID:    params.UserID,
		Endpoint:  params.Endpoint,
		P256dh:    params.P256dh,
		Auth:      params.Auth,
		TimeZone:  params.TimeZone,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.pushSubs[sub.ID] = sub
	return clonePushSubscription(sub), nil
}

func (s *Store) DeletePushSubscription(_ context.Context, userID, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, ok := s.pushSubs[id]
	if !ok || sub.UserID != userID {
		return domain.ErrPushSubscriptionNotFound
	}
	delete(s.pushSubs, id)
	return nil
}

func (s *Store) pushSubscriptionsByEndpoint(endpoint string) (*domain.PushSubscription, bool) {
	for _, sub := range s.pushSubs {
		if sub.Endpoint == endpoint {
			return sub, true
		}
	}
	return nil, false
}

func clonePushSubscription(sub *domain.PushSubscription) *domain.PushSubscription {
	copied := *sub
	return &copied
}
