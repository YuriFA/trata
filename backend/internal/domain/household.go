package domain

import (
	"time"

	"github.com/google/uuid"
)

// HouseholdRole is a member's role in a household. Roles are stored in v1 but
// carry no behavioral split yet (ADR-0002); both roles see and modify all of
// the household's data equally.
type HouseholdRole string

const (
	HouseholdRoleOwner  HouseholdRole = "owner"
	HouseholdRoleMember HouseholdRole = "member"
)

// Household is the shared data space: every account, category, transaction,
// debtor, debt operation, and planned payment belongs to exactly one
// household, and members access it equally. Name is the optional owner-set
// display name (nil = never set; consumers derive a label from the owner).
// Currency is the base currency - the presentation conversion target; editing
// it never rewrites stored amounts.
type Household struct {
	ID        uuid.UUID
	CreatedAt time.Time
	Name      *string
	Currency  string
	Members   []HouseholdMember
}

// HouseholdMember is one user's membership in a household, joined with the
// profile fields the member listing exposes. DisplayName is nil when never
// set (consumers fall back to Email).
type HouseholdMember struct {
	UserID      uuid.UUID
	Email       string
	DisplayName *string
	Role        HouseholdRole
	JoinedAt    time.Time
}

// Membership is a user's single (v1) household membership row - the auth
// middleware's household resolution input.
type Membership struct {
	HouseholdID uuid.UUID
	UserID      uuid.UUID
	Role        HouseholdRole
	JoinedAt    time.Time
}

// HouseholdInvitationStatus is the owner-side listing state of an
// invitation; Expired is derived at read time (pending + past ExpiresAt).
type HouseholdInvitationStatus string

const (
	HouseholdInvitationPending  HouseholdInvitationStatus = "pending"
	HouseholdInvitationAccepted HouseholdInvitationStatus = "accepted"
	HouseholdInvitationRevoked  HouseholdInvitationStatus = "revoked"
	HouseholdInvitationExpired  HouseholdInvitationStatus = "expired"
)

// HouseholdInvitation is an owner-issued email invitation. The accept token
// is single-use, delivered by email, and refreshed (not duplicated) when the
// owner re-invites the same pending email.
type HouseholdInvitation struct {
	ID          uuid.UUID
	HouseholdID uuid.UUID
	Email       string
	Token       uuid.UUID
	CreatedBy   uuid.UUID
	CreatedAt   time.Time
	ExpiresAt   time.Time
	AcceptedAt  *time.Time
	RevokedAt   *time.Time
}

// Status derives the listing state: accepted/revoked win, then expiry.
func (i HouseholdInvitation) Status(now time.Time) HouseholdInvitationStatus {
	switch {
	case i.AcceptedAt != nil:
		return HouseholdInvitationAccepted
	case i.RevokedAt != nil:
		return HouseholdInvitationRevoked
	case now.After(i.ExpiresAt):
		return HouseholdInvitationExpired
	default:
		return HouseholdInvitationPending
	}
}

// HouseholdInvitationPreview is the acceptor-side view of a pending
// invitation: what the accept screen shows before the data choice.
type HouseholdInvitationPreview struct {
	HouseholdName      *string
	MembersCount       int
	InviterEmail       string
	InviterDisplayName *string
	ExpiresAt          time.Time
}

// HouseholdCode is the household's multi-use join code (family fallback; binds
// no identity). Exactly one code row per household: rotate replaces, revoke
// deactivates.
type HouseholdCode struct {
	HouseholdID uuid.UUID
	Code        string
	CreatedAt   time.Time
	RevokedAt   *time.Time
}
