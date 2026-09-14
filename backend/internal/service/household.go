package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// HouseholdService owns the household read model and the join lifecycle
// (household-join change): invitations, the home code, membership moves
// (join/leave/remove/dissolve), and the household display name. Membership
// itself is resolved by the auth middleware (single-hop by user); this
// service serves the household endpoints.
type HouseholdService struct {
	households repository.HouseholdRepository
	users      repository.UserRepository
	mailer     Mailer
	log        *slog.Logger
	cfg        HouseholdJoinConfig
	now        func() time.Time
}

// defaultInvitationTTL is the spec's 7-day accept-token validity.
const defaultInvitationTTL = 7 * 24 * time.Hour

// HouseholdJoinConfig tunes the join lifecycle (design D1/D2 + the mailer
// risk trade-off).
type HouseholdJoinConfig struct {
	// InvitationTTL is how long an accept token stays valid (default 7d).
	InvitationTTL time.Duration
	// MaxInvitationSendsPerDay is the per-household send budget (creates +
	// refreshes) inside a rolling 24h window.
	MaxInvitationSendsPerDay int
	// WebAppBaseURL prefixes the emailed accept link
	// (WebAppBaseURL + "/invite/" + token). Empty disables the link (the
	// email still carries the raw token).
	WebAppBaseURL string
}

func (c HouseholdJoinConfig) withDefaults() HouseholdJoinConfig {
	if c.InvitationTTL <= 0 {
		c.InvitationTTL = defaultInvitationTTL
	}
	if c.MaxInvitationSendsPerDay <= 0 {
		c.MaxInvitationSendsPerDay = 20
	}
	return c
}

func NewHouseholdService(
	households repository.HouseholdRepository,
	users repository.UserRepository,
	mailer Mailer,
	log *slog.Logger,
	cfg HouseholdJoinConfig,
) *HouseholdService {
	return NewHouseholdServiceWithClock(households, users, mailer, log, cfg, time.Now)
}

// NewHouseholdServiceWithClock is NewHouseholdService with an injectable
// clock (invitation-expiry checks in tests).
func NewHouseholdServiceWithClock(
	households repository.HouseholdRepository,
	users repository.UserRepository,
	mailer Mailer,
	log *slog.Logger,
	cfg HouseholdJoinConfig,
	now func() time.Time,
) *HouseholdService {
	svc := &HouseholdService{
		households: households,
		users:      users,
		mailer:     mailer,
		log:        log,
		cfg:        cfg.withDefaults(),
		now:        now,
	}
	if svc.now == nil {
		svc.now = time.Now
	}
	return svc
}

// membershipScope is the household service's Scope construction: household
// services are membership-scoped (resolved once by the transport), so both
// scope ids come from the same membership record.
func membershipScope(membership *domain.Membership) domain.Scope {
	return domain.Scope{HouseholdID: membership.HouseholdID, ActorID: membership.UserID}
}

// Get returns the household with all of its members (email, display name,
// role, joined date).
func (s *HouseholdService) Get(ctx context.Context, scope domain.Scope) (*domain.Household, error) {
	const op = "service.household.Get"
	h, err := s.households.GetHouseholdWithMembers(ctx, scope)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return h, nil
}

// Update sets or clears the household display name (owner only; `nil` name
// resets it) and optionally changes the base currency. A currency change
// never rewrites stored amounts - it only moves the presentation conversion
// target.
func (s *HouseholdService) Update(
	ctx context.Context,
	membership *domain.Membership,
	name *string,
	currency *string,
) (*domain.Household, error) {
	const op = "service.household.Update"
	if err := s.requireOwner(membership); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" || len(trimmed) > 100 {
			return nil, fmt.Errorf("%s: %w", op, domain.ErrInvalidDisplayName)
		}
		name = &trimmed
	}
	if currency != nil {
		if err := domain.ValidateCurrency(*currency); err != nil {
			return nil, fmt.Errorf("%s: %w", op, domain.ErrInvalidCurrency)
		}
	}
	if err := s.households.UpdateHousehold(ctx, membershipScope(membership), name, currency); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return s.Get(ctx, membershipScope(membership))
}

func (s *HouseholdService) requireOwner(membership *domain.Membership) error {
	if membership.Role != domain.HouseholdRoleOwner {
		return domain.ErrHouseholdOwnerRequired
	}
	return nil
}

// CreateInvitation invites an email (owner only): refresh-not-duplicate for a
// pending same-email invitation, already-member rejection, per-household/day
// send budget, and a best-effort email with the accept link.
func (s *HouseholdService) CreateInvitation(
	ctx context.Context,
	membership *domain.Membership,
	email string,
) (*domain.HouseholdInvitation, error) {
	const op = "service.household.CreateInvitation"
	if err := s.requireOwner(membership); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	email = strings.TrimSpace(email)

	// Inviting an existing member is pointless and confusing - reject clearly.
	h, err := s.households.GetHouseholdWithMembers(ctx, membershipScope(membership))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	for _, m := range h.Members {
		if strings.EqualFold(m.Email, email) {
			return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationAlreadyMember)
		}
	}

	sends, err := s.households.CountHouseholdInvitationSends(ctx, membershipScope(membership))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	if sends >= s.cfg.MaxInvitationSendsPerDay {
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationRateLimited)
	}

	invitation, err := s.households.CreateHouseholdInvitation(
		ctx, membership.HouseholdID, email, membership.UserID, s.cfg.InvitationTTL,
	)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	// Best-effort delivery, mirroring the verification/reset emails: a mailer
	// hiccup must not fail the (already persisted) invitation.
	link := s.cfg.WebAppBaseURL + "/invite/" + invitation.Token.String()
	if err := s.mailer.SendHouseholdInvitation(ctx, email, link); err != nil {
		s.log.WarnContext(ctx, "household invitation email failed",
			slog.String("household_id", membership.HouseholdID.String()),
			slog.String("email", email),
			slog.String("error", err.Error()),
		)
	}
	return invitation, nil
}

// ListInvitations returns the household's invitations (owner only).
func (s *HouseholdService) ListInvitations(
	ctx context.Context,
	membership *domain.Membership,
) ([]domain.HouseholdInvitation, error) {
	const op = "service.household.ListInvitations"
	if err := s.requireOwner(membership); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return s.households.ListHouseholdInvitations(ctx, membershipScope(membership))
}

// RevokeInvitation revokes an invitation (owner only, idempotent).
func (s *HouseholdService) RevokeInvitation(
	ctx context.Context,
	membership *domain.Membership,
	invitationID uuid.UUID,
) error {
	const op = "service.household.RevokeInvitation"
	if err := s.requireOwner(membership); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if err := s.households.RevokeHouseholdInvitation(ctx, membershipScope(membership), invitationID); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// loadInvitation fetches the invitation by token in any state and maps every
// non-pending state to its lifecycle error. `acceptorNoop` relaxes the
// already-accepted rejection for accept: a user re-accepting an invitation
// into their CURRENT household gets the no-op success instead (the spec's
// repeated-accept idempotency).
func (s *HouseholdService) loadInvitation(
	ctx context.Context,
	op string,
	token uuid.UUID,
	user *domain.User,
	acceptorNoop bool,
) (*domain.HouseholdInvitation, error) {
	invitation, err := s.households.GetHouseholdInvitationByToken(ctx, token)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	if invitation == nil {
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationNotFound)
	}
	if invitation.AcceptedAt != nil && acceptorNoop {
		membership, err := s.households.GetMembershipByUser(ctx, user.ID)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", op, err)
		}
		if membership.HouseholdID == invitation.HouseholdID {
			return invitation, nil
		}
	}
	switch {
	case invitation.AcceptedAt != nil:
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationAlreadyAccepted)
	case invitation.RevokedAt != nil:
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationRevoked)
	case s.now().After(invitation.ExpiresAt):
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationExpired)
	}
	return invitation, nil
}

// PreviewInvitation is the acceptor-side view (household name, members count,
// inviter) for accounts whose email matches the invitation.
func (s *HouseholdService) PreviewInvitation(
	ctx context.Context,
	user *domain.User,
	token uuid.UUID,
) (*domain.HouseholdInvitationPreview, error) {
	const op = "service.household.PreviewInvitation"

	invitation, err := s.loadInvitation(ctx, op, token, user, false)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(user.Email, invitation.Email) {
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationEmailMismatch)
	}

	h, err := s.households.GetHouseholdWithMembers(
		ctx,
		domain.Scope{HouseholdID: invitation.HouseholdID},
	)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	inviter, err := s.users.GetUserByID(ctx, invitation.CreatedBy)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	return &domain.HouseholdInvitationPreview{
		HouseholdName:      h.Name,
		MembersCount:       len(h.Members),
		InviterEmail:       inviter.Email,
		InviterDisplayName: inviter.DisplayName,
		ExpiresAt:          invitation.ExpiresAt,
	}, nil
}

// AcceptInvitation performs the join (membership swap + orphaning, D3) after
// the email-match and lifecycle checks; join idempotency lives in the
// repository transaction.
func (s *HouseholdService) AcceptInvitation(
	ctx context.Context,
	user *domain.User,
	token uuid.UUID,
) (*domain.Household, error) {
	const op = "service.household.AcceptInvitation"

	invitation, err := s.loadInvitation(ctx, op, token, user, true)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(user.Email, invitation.Email) {
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvitationEmailMismatch)
	}

	h, err := s.households.JoinHousehold(ctx, user.ID, invitation.HouseholdID, &invitation.ID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return h, nil
}

// JoinByCode resolves an active code and performs the same join transaction
// as AcceptInvitation (codes bind no identity - any authenticated user).
func (s *HouseholdService) JoinByCode(
	ctx context.Context,
	user *domain.User,
	code string,
) (*domain.Household, error) {
	const op = "service.household.JoinByCode"

	target, err := s.households.FindHouseholdByActiveCode(ctx, strings.TrimSpace(code))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	if target == uuid.Nil {
		return nil, fmt.Errorf("%s: %w", op, domain.ErrHouseholdCodeInvalid)
	}

	h, err := s.households.JoinHousehold(ctx, user.ID, target, nil)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return h, nil
}

// GenerateCode issues (owner only) or rotates the household's join code.
func (s *HouseholdService) GenerateCode(
	ctx context.Context,
	membership *domain.Membership,
) (*domain.HouseholdCode, error) {
	const op = "service.household.GenerateCode"
	if err := s.requireOwner(membership); err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	code, err := s.households.GenerateHouseholdCode(ctx, membershipScope(membership))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return code, nil
}

// RevokeCode deactivates the household's join code (owner only, idempotent).
func (s *HouseholdService) RevokeCode(ctx context.Context, membership *domain.Membership) error {
	const op = "service.household.RevokeCode"
	if err := s.requireOwner(membership); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if err := s.households.RevokeHouseholdCode(ctx, membershipScope(membership)); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// Leave removes the caller's membership and hands them a fresh personal
// household. The owner cannot leave while other members remain (removal or
// dissolution are the exits); a lone owner may leave (their household is
// orphaned like any join).
func (s *HouseholdService) Leave(
	ctx context.Context,
	membership *domain.Membership,
) (*domain.Household, error) {
	const op = "service.household.Leave"

	if membership.Role == domain.HouseholdRoleOwner {
		h, err := s.households.GetHouseholdWithMembers(ctx, membershipScope(membership))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", op, err)
		}
		if len(h.Members) > 1 {
			return nil, fmt.Errorf("%s: %w", op, domain.ErrHouseholdOwnerWithMembers)
		}
	}

	h, err := s.households.LeaveHousehold(ctx, membership.UserID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return h, nil
}

// RemoveMember removes a member (owner only; the owner cannot be removed).
func (s *HouseholdService) RemoveMember(
	ctx context.Context,
	membership *domain.Membership,
	targetUserID uuid.UUID,
) error {
	const op = "service.household.RemoveMember"
	if err := s.requireOwner(membership); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if err := s.households.RemoveHouseholdMember(ctx, membership.HouseholdID, targetUserID); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// Dissolve deletes the household with all of its data (owner only); the
// explicit confirm is the transport contract's requirement.
func (s *HouseholdService) Dissolve(
	ctx context.Context,
	membership *domain.Membership,
	confirm bool,
) error {
	const op = "service.household.Dissolve"
	if err := s.requireOwner(membership); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if !confirm {
		return fmt.Errorf("%s: %w", op, domain.ErrHouseholdDissolveConfirmRequired)
	}
	if err := s.households.DissolveHousehold(ctx, membershipScope(membership)); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}
