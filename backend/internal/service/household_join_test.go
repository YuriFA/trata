package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/service"
	"github.com/yurifa/trata/backend/internal/service/fakes"
)

// householdJoinFixture wires a household service over the fake store with an
// injectable clock (expiry checks) and captures invitation emails.
type householdJoinFixture struct {
	svc    *service.HouseholdService
	store  *fakes.Store
	mailer *captureInvitationMailer
	owner  *domain.User
	member *domain.User
	now    time.Time
}

type captureInvitationMailer struct {
	links []string
	fail  bool
}

func (m *captureInvitationMailer) SendVerificationCode(_ context.Context, _, _ string) error {
	return nil
}
func (m *captureInvitationMailer) SendPasswordResetToken(_ context.Context, _, _ string) error {
	return nil
}
func (m *captureInvitationMailer) SendHouseholdInvitation(_ context.Context, _, link string) error {
	if m.fail {
		return errMailerDown
	}
	m.links = append(m.links, link)
	return nil
}

func newHouseholdJoinFixture(t *testing.T, cfg service.HouseholdJoinConfig) *householdJoinFixture {
	t.Helper()
	store := fakes.New()
	mailer := &captureInvitationMailer{}
	f := &householdJoinFixture{
		store:  store,
		mailer: mailer,
		now:    time.Now().UTC(),
	}
	clock := func() time.Time { return f.now }
	store.SetClock(clock)
	f.svc = service.NewHouseholdServiceWithClock(
		store,
		store,
		mailer,
		logger.NewDiscardLogger(),
		cfg,
		clock,
	)
	f.owner = seedFakeUser(t, store)
	f.member = seedFakeUser(t, store)
	return f
}

func (f *householdJoinFixture) ownerMembership(t *testing.T) *domain.Membership {
	t.Helper()
	m, err := f.store.GetMembershipByUser(context.Background(), f.owner.ID)
	require.NoError(t, err)
	return m
}

func (f *householdJoinFixture) membershipOf(t *testing.T, userID uuid.UUID) *domain.Membership {
	t.Helper()
	m, err := f.store.GetMembershipByUser(context.Background(), userID)
	require.NoError(t, err)
	return m
}

func TestHouseholdService_InvitationExpiry(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(t, service.HouseholdJoinConfig{})
	ctx := context.Background()

	invitee := seedFakeUser(t, f.store)
	invitation, err := f.svc.CreateInvitation(ctx, f.ownerMembership(t), invitee.Email)
	require.NoError(t, err)

	// Before expiry: preview + accept work.
	_, err = f.svc.PreviewInvitation(ctx, invitee, invitation.Token)
	require.NoError(t, err)

	// Advance past the 7-day TTL: both preview and accept refuse.
	f.now = f.now.Add(8 * 24 * time.Hour)
	_, err = f.svc.PreviewInvitation(ctx, invitee, invitation.Token)
	require.ErrorIs(t, err, domain.ErrInvitationExpired)
	_, err = f.svc.AcceptInvitation(ctx, invitee, invitation.Token)
	require.ErrorIs(t, err, domain.ErrInvitationExpired)

	// The invitation stayed pending (expiry is derived, not a write).
	stored, err := f.store.GetHouseholdInvitationByToken(ctx, invitation.Token)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Nil(t, stored.AcceptedAt)
	assert.Nil(t, stored.RevokedAt)
}

func TestHouseholdService_InvitationRateLimit(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(t, service.HouseholdJoinConfig{MaxInvitationSendsPerDay: 2})
	ctx := context.Background()
	m := f.ownerMembership(t)

	for i := range 2 {
		_, err := f.svc.CreateInvitation(ctx, m, "friend"+string(rune('a'+i))+"@example.com")
		require.NoError(t, err)
	}
	// Refreshing a pending invitation also consumes the budget (it re-sends).
	_, err := f.svc.CreateInvitation(ctx, m, "frienda@example.com")
	require.ErrorIs(t, err, domain.ErrInvitationRateLimited)
	_, err = f.svc.CreateInvitation(ctx, m, "friendc@example.com")
	require.ErrorIs(t, err, domain.ErrInvitationRateLimited)

	// A day passes: the budget resets.
	f.now = f.now.Add(25 * time.Hour)
	_, err = f.svc.CreateInvitation(ctx, m, "friendd@example.com")
	require.NoError(t, err)
}

func TestHouseholdService_JoinOrphansOldHousehold(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(t, service.HouseholdJoinConfig{})
	ctx := context.Background()

	oldHousehold := f.membershipOf(t, f.member.ID).HouseholdID
	invitation, err := f.svc.CreateInvitation(ctx, f.ownerMembership(t), f.member.Email)
	require.NoError(t, err)

	h, err := f.svc.AcceptInvitation(ctx, f.member, invitation.Token)
	require.NoError(t, err)
	assert.Equal(t, f.ownerMembership(t).HouseholdID, h.ID)

	// The joiner's membership moved; the old household no longer resolves.
	after := f.membershipOf(t, f.member.ID)
	assert.Equal(t, h.ID, after.HouseholdID)
	assert.Equal(t, domain.HouseholdRoleMember, after.Role)
	assert.NotEqual(t, oldHousehold, after.HouseholdID)

	// Idempotent: accepting again is a no-op success.
	h2, err := f.svc.AcceptInvitation(ctx, f.member, invitation.Token)
	require.NoError(t, err)
	assert.Equal(t, h.ID, h2.ID)
}

func TestHouseholdService_JoinByCodeInvalid(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(t, service.HouseholdJoinConfig{})
	ctx := context.Background()

	code, err := f.svc.GenerateCode(ctx, f.ownerMembership(t))
	require.NoError(t, err)

	h, err := f.svc.JoinByCode(ctx, f.member, code.Code)
	require.NoError(t, err)
	assert.Equal(t, f.ownerMembership(t).HouseholdID, h.ID)

	// Idempotent no-op for the current household.
	h2, err := f.svc.JoinByCode(ctx, f.member, code.Code)
	require.NoError(t, err)
	assert.Equal(t, h.ID, h2.ID)

	// Unknown code.
	_, err = f.svc.JoinByCode(ctx, f.owner, "ZZZZZZZZ")
	require.ErrorIs(t, err, domain.ErrHouseholdCodeInvalid)

	// Revoked code.
	require.NoError(t, f.svc.RevokeCode(ctx, f.ownerMembership(t)))
	_, err = f.svc.JoinByCode(ctx, seedFakeUser(t, f.store), code.Code)
	require.ErrorIs(t, err, domain.ErrHouseholdCodeInvalid)
}

func TestHouseholdService_OwnerGuards(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(t, service.HouseholdJoinConfig{})
	ctx := context.Background()

	// Make the member a member of the owner's household via a code join.
	code, err := f.svc.GenerateCode(ctx, f.ownerMembership(t))
	require.NoError(t, err)
	_, err = f.svc.JoinByCode(ctx, f.member, code.Code)
	require.NoError(t, err)
	memberMembership := f.membershipOf(t, f.member.ID)

	_, err = f.svc.CreateInvitation(ctx, memberMembership, "x@example.com")
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	_, err = f.svc.ListInvitations(ctx, memberMembership)
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	err = f.svc.RevokeInvitation(ctx, memberMembership, uuid.New())
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	_, err = f.svc.GenerateCode(ctx, memberMembership)
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	err = f.svc.RevokeCode(ctx, memberMembership)
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	_, err = f.svc.Update(ctx, memberMembership, strPtr("Захват"), nil)
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	err = f.svc.RemoveMember(ctx, memberMembership, f.owner.ID)
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)
	err = f.svc.Dissolve(ctx, memberMembership, true)
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerRequired)

	// The owner cannot leave with members; can remove the member; then can leave.
	_, err = f.svc.Leave(ctx, f.ownerMembership(t))
	require.ErrorIs(t, err, domain.ErrHouseholdOwnerWithMembers)

	err = f.svc.RemoveMember(ctx, f.ownerMembership(t), f.member.ID)
	require.NoError(t, err)
	assert.NotEqual(t, memberMembership.HouseholdID, f.membershipOf(t, f.member.ID).HouseholdID)

	fresh, err := f.svc.Leave(ctx, f.ownerMembership(t))
	require.NoError(t, err)
	assert.Len(t, fresh.Members, 1)
}

func TestHouseholdService_DissolveRequiresConfirm(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(t, service.HouseholdJoinConfig{})
	ctx := context.Background()

	err := f.svc.Dissolve(ctx, f.ownerMembership(t), false)
	require.ErrorIs(t, err, domain.ErrHouseholdDissolveConfirmRequired)
	err = f.svc.Dissolve(ctx, f.ownerMembership(t), true)
	require.NoError(t, err)
}

func TestHouseholdService_InvitationEmailBestEffort(t *testing.T) {
	t.Parallel()
	f := newHouseholdJoinFixture(
		t,
		service.HouseholdJoinConfig{WebAppBaseURL: "https://app.example.com"},
	)
	ctx := context.Background()

	// Happy delivery: the emailed link is the web accept URL with the token.
	invitation, err := f.svc.CreateInvitation(ctx, f.ownerMembership(t), f.member.Email)
	require.NoError(t, err)
	require.Len(t, f.mailer.links, 1)
	assert.Equal(t, "https://app.example.com/invite/"+invitation.Token.String(), f.mailer.links[0])

	// Delivery failure is best-effort: the invitation still persists.
	f.mailer.fail = true
	other := seedFakeUser(t, f.store)
	invitation2, err := f.svc.CreateInvitation(ctx, f.ownerMembership(t), other.Email)
	require.NoError(t, err)
	stored, err := f.store.GetHouseholdInvitationByToken(ctx, invitation2.Token)
	require.NoError(t, err)
	require.NotNil(t, stored)
}

var errMailerDown = errors.New("mailer down")
