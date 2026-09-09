package pushremind_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/jobs/pushremind"
	"github.com/yurifa/trata/backend/internal/logger"
)

// fakeStore mirrors the SQL contract of the real candidate query: sent
// markers suppress the (plan, occurrence, subscription) triple, pruning
// removes the subscription (and its markers) from the candidate set.
type fakeStore struct {
	candidates  []domain.PushReminderCandidate
	markers     map[[2]uuid.UUID]bool // (planID, subscriptionID) -> sent for current occurrence
	markedCalls int
	pruned      []uuid.UUID
}

func newFakeStore(candidates ...domain.PushReminderCandidate) *fakeStore {
	return &fakeStore{
		candidates: candidates,
		markers:    map[[2]uuid.UUID]bool{},
	}
}

func (f *fakeStore) DuePushReminderCandidates(
	_ context.Context, _ time.Time,
) ([]domain.PushReminderCandidate, error) {
	out := make([]domain.PushReminderCandidate, 0, len(f.candidates))
	for _, c := range f.candidates {
		if f.markers[[2]uuid.UUID{c.PlanID, c.Subscription.ID}] {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

func (f *fakeStore) MarkPushReminderSent(
	_ context.Context, planID uuid.UUID, _ time.Time, subscriptionID uuid.UUID,
) error {
	f.markedCalls++
	f.markers[[2]uuid.UUID{planID, subscriptionID}] = true
	return nil
}

func (f *fakeStore) PrunePushSubscription(_ context.Context, id uuid.UUID) error {
	f.pruned = append(f.pruned, id)
	remaining := f.candidates[:0]
	for _, c := range f.candidates {
		if c.Subscription.ID != id {
			remaining = append(remaining, c)
		}
	}
	f.candidates = remaining
	return nil
}

func (f *fakeStore) PrunePushRemindersSent(_ context.Context, _ time.Time) (int64, error) {
	return 0, nil
}

// fakeSender records deliveries; Err (when set) fails every send.
type fakeSender struct {
	sent []domain.PushSubscription
	Err  error
}

func (f *fakeSender) Send(_ context.Context, sub domain.PushSubscription, _ []byte) error {
	if f.Err != nil {
		return f.Err
	}
	f.sent = append(f.sent, sub)
	return nil
}

func candidate(
	reminder domain.PlannedReminder,
	mode domain.PlannedConfirmMode,
	tz string,
	dueDate time.Time,
) domain.PushReminderCandidate {
	return domain.PushReminderCandidate{
		PlanID:      uuid.New(),
		PlanName:    "Netflix",
		PlanType:    domain.TransactionTypeExpense,
		PlanAmount:  59900,
		Reminder:    reminder,
		ConfirmMode: mode,
		Occurrence:  dueDate,
		Subscription: domain.PushSubscription{
			ID:       uuid.New(),
			Endpoint: "https://push.example.com/" + uuid.NewString(),
			TimeZone: tz,
		},
	}
}

// newTestJob clocks the sweep at 2026-06-04 10:00:30 UTC: the on_day 10:00
// UTC moment of a June 4th occurrence is 30 seconds past, inside the window.
func newTestJob(store *fakeStore, sender pushremind.Sender) *pushremind.Job {
	return pushremind.
		New(store, sender, logger.NewDiscardLogger(), time.Minute).
		WithClock(func() time.Time {
			return time.Date(2026, 6, 4, 10, 0, 30, 0, time.UTC)
		})
}

func TestRunOnceSendsDueReminder(t *testing.T) {
	t.Parallel()

	c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC",
		time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC))
	store := newFakeStore(c)
	sender := &fakeSender{}
	newTestJob(store, sender).SweepOnce(context.Background())

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d pushes, want 1", len(sender.sent))
	}
	if sender.sent[0].ID != c.Subscription.ID {
		t.Errorf("delivered to subscription %v, want %v", sender.sent[0].ID, c.Subscription.ID)
	}
	if store.markedCalls != 1 {
		t.Errorf("marked %d sends, want 1", store.markedCalls)
	}
}

func TestRunOnceSendsDayBeforeAtTenLocal(t *testing.T) {
	t.Parallel()

	// Moscow is UTC+3 with no DST: June 5th's day_before instant is June
	// 4th 10:00 MSK = 07:00 UTC - 30s before the overridden clock, inside
	// the window.
	c := candidate(domain.PlannedReminderDayBefore, domain.PlannedConfirmManual, "Europe/Moscow",
		time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC))
	store := newFakeStore(c)
	sender := &fakeSender{}
	pushremind.
		New(store, sender, logger.NewDiscardLogger(), time.Minute).
		WithClock(func() time.Time { return time.Date(2026, 6, 4, 7, 0, 30, 0, time.UTC) }).
		SweepOnce(context.Background())

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d pushes, want 1", len(sender.sent))
	}
}

func TestRunOnceSkipsOutsideWindow(t *testing.T) {
	t.Parallel()

	t.Run("moment still in the future", func(t *testing.T) {
		t.Parallel()

		c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC",
			time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC))
		store := newFakeStore(c)
		sender := &fakeSender{}
		newTestJob(store, sender).SweepOnce(context.Background())
		if len(sender.sent) != 0 {
			t.Fatalf("sent %d pushes, want 0 (moment not yet reached)", len(sender.sent))
		}
	})

	t.Run("moment long past means no catch-up", func(t *testing.T) {
		t.Parallel()

		c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC",
			time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC))
		store := newFakeStore(c)
		sender := &fakeSender{}
		newTestJob(store, sender).SweepOnce(context.Background())
		if len(sender.sent) != 0 {
			t.Fatalf("sent %d pushes, want 0 (overdue occurrence, no catch-up)", len(sender.sent))
		}
		if store.markedCalls != 0 {
			t.Errorf("wrote %d markers, want 0", store.markedCalls)
		}
	})
}

func TestRunOnceAtMostOncePerSubscription(t *testing.T) {
	t.Parallel()

	c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC",
		time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC))
	store := newFakeStore(c)
	sender := &fakeSender{}
	job := newTestJob(store, sender)

	job.SweepOnce(context.Background())
	job.SweepOnce(context.Background())

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d pushes across sweeps, want 1 (marker suppression)", len(sender.sent))
	}
}

func TestRunOnceDeliversEveryMembersSubscription(t *testing.T) {
	t.Parallel()

	// One plan, two household members' devices: both receive the reminder
	// (household parity), each exactly once.
	due := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)
	planID := uuid.New()
	first := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC", due)
	second := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC", due)
	first.PlanID = planID
	second.PlanID = planID
	store := newFakeStore(first, second)
	sender := &fakeSender{}
	newTestJob(store, sender).SweepOnce(context.Background())

	if len(sender.sent) != 2 {
		t.Fatalf("sent %d pushes, want 2 (both members' devices)", len(sender.sent))
	}
}

func TestRunOnceFailedSendRetriesNextSweep(t *testing.T) {
	t.Parallel()

	c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC",
		time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC))
	store := newFakeStore(c)
	failing := &fakeSender{Err: errors.New("push service 503")}

	newTestJob(store, failing).SweepOnce(context.Background())
	if store.markedCalls != 0 {
		t.Fatal("wrote marker on failed send; want 0")
	}

	// A later sweep with a healthy sender redelivers: no marker was written.
	ok := &fakeSender{}
	newTestJob(store, ok).SweepOnce(context.Background())
	if len(ok.sent) != 1 {
		t.Fatalf("sent %d pushes on retry sweep, want 1", len(ok.sent))
	}
}

func TestRunOncePrunesGoneSubscription(t *testing.T) {
	t.Parallel()

	c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC",
		time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC))
	store := newFakeStore(c)
	gone := &fakeSender{Err: fmt.Errorf("%w: endpoint returned 410 Gone", pushremind.ErrGone)}

	newTestJob(store, gone).SweepOnce(context.Background())

	if len(store.pruned) != 1 || store.pruned[0] != c.Subscription.ID {
		t.Fatalf("pruned %v, want [%s]", store.pruned, c.Subscription.ID)
	}
	if store.markedCalls != 0 {
		t.Errorf("wrote %d markers for a gone subscription, want 0", store.markedCalls)
	}

	// The pruned subscription no longer receives anything.
	ok := &fakeSender{}
	newTestJob(store, ok).SweepOnce(context.Background())
	if len(ok.sent) != 0 {
		t.Fatalf("sent %d pushes after pruning, want 0", len(ok.sent))
	}
}

func TestRunOnceBadTimezoneSkipsOnlyThatCandidate(t *testing.T) {
	t.Parallel()

	due := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)
	bad := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "Not/A_Zone", due)
	good := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmManual, "UTC", due)
	store := newFakeStore(bad, good)
	sender := &fakeSender{}
	newTestJob(store, sender).SweepOnce(context.Background())

	if len(sender.sent) != 1 || sender.sent[0].ID != good.Subscription.ID {
		t.Fatalf("delivered %v, want only the good candidate", sender.sent)
	}
}

func TestReminderInstant(t *testing.T) {
	t.Parallel()

	due := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)

	t.Run("on_day at ten subscriber-local", func(t *testing.T) {
		t.Parallel()

		c := candidate(
			domain.PlannedReminderOnDay,
			domain.PlannedConfirmManual,
			"Europe/Moscow",
			due,
		)
		instant, err := pushremind.ReminderInstant(c)
		if err != nil {
			t.Fatal(err)
		}
		want := time.Date(2026, 6, 4, 10, 0, 0, 0, mustLoc(t, "Europe/Moscow"))
		if !instant.Equal(want) {
			t.Errorf("instant = %v, want %v", instant, want)
		}
	})

	t.Run("day_before shifts one day", func(t *testing.T) {
		t.Parallel()

		c := candidate(domain.PlannedReminderDayBefore, domain.PlannedConfirmManual, "UTC", due)
		instant, err := pushremind.ReminderInstant(c)
		if err != nil {
			t.Fatal(err)
		}
		want := time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)
		if !instant.Equal(want) {
			t.Errorf("instant = %v, want %v", instant, want)
		}
	})

	t.Run("day_before rolls across month boundary", func(t *testing.T) {
		t.Parallel()

		c := candidate(domain.PlannedReminderDayBefore, domain.PlannedConfirmManual, "UTC",
			time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))
		instant, err := pushremind.ReminderInstant(c)
		if err != nil {
			t.Fatal(err)
		}
		want := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
		if !instant.Equal(want) {
			t.Errorf("instant = %v, want %v", instant, want)
		}
	})

	t.Run("unknown timezone errors", func(t *testing.T) {
		t.Parallel()

		c := candidate(
			domain.PlannedReminderOnDay,
			domain.PlannedConfirmManual,
			"Mars/Olympus",
			due,
		)
		if _, err := pushremind.ReminderInstant(c); err == nil {
			t.Error("want error for unknown timezone")
		}
	})
}

func TestReminderPayloadShape(t *testing.T) {
	t.Parallel()

	c := candidate(domain.PlannedReminderOnDay, domain.PlannedConfirmAuto, "UTC",
		time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC))
	c.PlanName = "Квартплата"
	raw, err := json.Marshal(pushremind.NewReminderPayload(c))
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf(
		`{"planId":%q,"planName":"Квартплата","confirmMode":"auto","type":"expense","amountMinor":59900}`,
		c.PlanID,
	)
	if string(raw) != want {
		t.Errorf("payload = %s, want %s", raw, want)
	}
}

func TestIsGone(t *testing.T) {
	t.Parallel()

	if !pushremind.IsGone(fmt.Errorf("wrapped: %w", pushremind.ErrGone)) {
		t.Error("wrapped ErrGone should report gone")
	}
	if pushremind.IsGone(errors.New("push service 503")) {
		t.Error("unrelated error should not report gone")
	}
}

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}
