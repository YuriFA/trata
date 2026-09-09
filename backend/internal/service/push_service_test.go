package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// Push service: the only domain rules are timezone validity (a bad IANA
// name would poison the dispatch job's 10:00-local math, so it is rejected
// at the door) and owner-scoped delete. Upsert/refresh semantics are
// covered end-to-end by the e2e suite against real storage.

func newPushService() *service.PushService {
	return service.NewPushService(fakes.New())
}

func TestPushService_UpsertRejectsUnknownTimezone(t *testing.T) {
	t.Parallel()

	svc := newPushService()

	_, err := svc.UpsertSubscription(
		context.Background(), uuid.New(),
		"https://push.example.com/dev1", "p256dh", "auth", "Mars/Olympus",
	)
	if !errors.Is(err, domain.ErrPushSubscriptionTimezoneInvalid) {
		t.Fatalf("err = %v, want ErrPushSubscriptionTimezoneInvalid", err)
	}
}

func TestPushService_UpsertAndDelete(t *testing.T) {
	t.Parallel()

	svc := newPushService()
	ctx := context.Background()
	user := uuid.New()

	sub, err := svc.UpsertSubscription(
		ctx, user, "https://push.example.com/dev1", "p256dh", "auth", "Europe/Moscow",
	)
	if err != nil {
		t.Fatal(err)
	}

	other := uuid.New()
	if err := svc.DeleteSubscription(ctx, other, sub.ID); !errors.Is(err, domain.ErrPushSubscriptionNotFound) {
		t.Fatalf("delete by non-owner err = %v, want ErrPushSubscriptionNotFound", err)
	}
	if err := svc.DeleteSubscription(ctx, user, sub.ID); err != nil {
		t.Fatalf("delete by owner: %v", err)
	}
	if err := svc.DeleteSubscription(ctx, user, sub.ID); !errors.Is(err, domain.ErrPushSubscriptionNotFound) {
		t.Fatalf("double delete err = %v, want ErrPushSubscriptionNotFound", err)
	}
}
