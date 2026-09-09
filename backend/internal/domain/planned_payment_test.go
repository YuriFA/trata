package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
)

func d(y int, m time.Month, day int) time.Time {
	return time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
}

// TestAdvanceNextDue pins the shared calendar vectors (mirrored by the mobile
// recurrence tests): clamping to shorter months must not poison the anchor.
func TestAdvanceNextDue(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		nextDue    time.Time
		anchor     time.Time
		regularity domain.PlannedRegularity
		want       time.Time
	}{
		{"daily", d(2026, 8, 31), d(2026, 8, 31), domain.PlannedRegularityDaily, d(2026, 9, 1)},
		{
			"weekly keeps the weekday",
			d(2026, 8, 25),
			d(2026, 8, 25),
			domain.PlannedRegularityWeekly,
			d(2026, 9, 1),
		}, // Tuesday → Tuesday
		{
			"monthly same-day",
			d(2026, 8, 5),
			d(2026, 8, 5),
			domain.PlannedRegularityMonthly,
			d(2026, 9, 5),
		},
		{
			"monthly 31 clamps to Feb 28",
			d(2026, 1, 31),
			d(2026, 1, 31),
			domain.PlannedRegularityMonthly,
			d(2026, 2, 28),
		},
		{
			"monthly 31 recovers in Mar after Feb",
			d(2026, 2, 28),
			d(2026, 1, 31),
			domain.PlannedRegularityMonthly,
			d(2026, 3, 31),
		},
		{
			"monthly 31 clamps to Apr 30 and recovers",
			d(2026, 3, 31),
			d(2026, 1, 31),
			domain.PlannedRegularityMonthly,
			d(2026, 4, 30),
		},
		{
			"monthly 30 in Feb leap year",
			d(2024, 1, 30),
			d(2024, 1, 30),
			domain.PlannedRegularityMonthly,
			d(2024, 2, 29),
		},
		{
			"monthly year rollover",
			d(2026, 12, 15),
			d(2026, 12, 15),
			domain.PlannedRegularityMonthly,
			d(2027, 1, 15),
		},
		{
			"yearly same date",
			d(2026, 9, 1),
			d(2026, 9, 1),
			domain.PlannedRegularityYearly,
			d(2027, 9, 1),
		},
		{
			"yearly Feb 29 clamps to Feb 28",
			d(2024, 2, 29),
			d(2024, 2, 29),
			domain.PlannedRegularityYearly,
			d(2025, 2, 28),
		},
		{
			"yearly anchor day kept after clamped step",
			d(2025, 2, 28),
			d(2024, 2, 29),
			domain.PlannedRegularityYearly,
			d(2026, 2, 28),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := domain.AdvanceNextDue(tc.nextDue, tc.anchor, tc.regularity)
			assert.True(
				t,
				got.Equal(tc.want),
				"got %s, want %s",
				got.Format(time.DateOnly),
				tc.want.Format(time.DateOnly),
			)
		})
	}
}

// TestAdvanceNextDueCatchUpSequence walks a plan three monthly occurrences
// behind and asserts one advance per occurrence with no skipping.
func TestAdvanceNextDueCatchUpSequence(t *testing.T) {
	t.Parallel()

	anchor := d(2026, 6, 5)
	next := d(2026, 6, 5)
	want := []time.Time{d(2026, 7, 5), d(2026, 8, 5), d(2026, 9, 5)}
	for i, w := range want {
		next = domain.AdvanceNextDue(next, anchor, domain.PlannedRegularityMonthly)
		assert.True(
			t,
			next.Equal(w),
			"step %d: got %s, want %s",
			i,
			next.Format(time.DateOnly),
			w.Format(time.DateOnly),
		)
	}
}

// TestDateJSONRoundTrip pins the wire format: YYYY-MM-DD both ways (sync
// payloads and server states replay verbatim).
func TestDateJSONRoundTrip(t *testing.T) {
	t.Parallel()

	original := domain.Date{Time: d(2026, 8, 24)}
	b, err := original.MarshalJSON()
	require.NoError(t, err)
	assert.Equal(t, `"2026-08-24"`, string(b))

	var parsed domain.Date
	require.NoError(t, parsed.UnmarshalJSON([]byte(`"2026-12-01"`)))
	assert.True(t, parsed.Equal(d(2026, 12, 1)))

	require.Error(t, parsed.UnmarshalJSON([]byte(`"2026-12-01T00:00:00Z"`)))
	require.Error(t, parsed.UnmarshalJSON([]byte(`"oops"`)))
}
