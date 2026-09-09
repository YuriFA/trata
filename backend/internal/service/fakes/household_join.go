// In-memory household join lifecycle (household-join change): invitations,
// codes, and the membership moves, mirroring the Postgres semantics closely
// enough for service-level tests (refresh-not-duplicate, token states,
// idempotent join, owner guards are exercised through the service).

package fakes

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

func (s *Store) UpdateHouseholdName(_ context.Context, scope domain.Scope, name *string) error {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	h, ok := s.households[householdID]
	if !ok {
		return domain.ErrHouseholdNotFound
	}
	h.Name = name
	return nil
}

func (s *Store) CountHouseholdInvitationSends(_ context.Context, scope domain.Scope) (int, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	cutoff := s.now().Add(-24 * time.Hour)
	for _, inv := range s.invitations {
		if inv.HouseholdID == householdID && !inv.CreatedAt.Before(cutoff) {
			count++
		}
	}
	return count, nil
}

func (s *Store) CreateHouseholdInvitation(
	_ context.Context,
	householdID uuid.UUID,
	email string,
	createdBy uuid.UUID,
	ttl time.Duration,
) (*domain.HouseholdInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for _, inv := range s.invitations {
		if inv.HouseholdID == householdID && strings.EqualFold(inv.Email, email) &&
			inv.AcceptedAt == nil && inv.RevokedAt == nil {
			inv.Token = uuid.New()
			inv.CreatedBy = createdBy
			inv.CreatedAt = now
			inv.ExpiresAt = now.Add(ttl)
			c := *inv
			return &c, nil
		}
	}
	inv := &domain.HouseholdInvitation{
		ID:          uuid.New(),
		HouseholdID: householdID,
		Email:       email,
		Token:       uuid.New(),
		CreatedBy:   createdBy,
		CreatedAt:   now,
		ExpiresAt:   now.Add(ttl),
	}
	s.invitations = append(s.invitations, inv)
	c := *inv
	return &c, nil
}

func (s *Store) ListHouseholdInvitations(
	_ context.Context,
	scope domain.Scope,
) ([]domain.HouseholdInvitation, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.HouseholdInvitation, 0)
	for _, inv := range s.invitations {
		if inv.HouseholdID == householdID {
			out = append(out, *inv)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return uuidLess(out[i].ID, out[j].ID)
	})
	return out, nil
}

func (s *Store) RevokeHouseholdInvitation(_ context.Context, scope domain.Scope, invitationID uuid.UUID) error {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, inv := range s.invitations {
		if inv.ID == invitationID && inv.HouseholdID == householdID {
			if inv.RevokedAt == nil {
				now := s.now()
				inv.RevokedAt = &now
			}
			return nil
		}
	}
	return domain.ErrInvitationNotFound
}

func (s *Store) GetHouseholdInvitationByToken(_ context.Context, token uuid.UUID) (*domain.HouseholdInvitation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, inv := range s.invitations {
		if inv.Token == token {
			c := *inv
			return &c, nil
		}
	}
	return nil, nil //nolint:nilnil // (nil, nil) is the documented "absent" signal
}

// householdWithMembersLocked builds the household listing while the store
// lock is held (the public GetHouseholdWithMembers wraps it).
func (s *Store) householdWithMembersLocked(householdID uuid.UUID) (*domain.Household, error) {
	h, ok := s.households[householdID]
	if !ok {
		return nil, domain.ErrHouseholdNotFound
	}
	var members []domain.HouseholdMember
	for _, m := range s.memberships {
		if m.HouseholdID != householdID {
			continue
		}
		u := s.users[m.UserID]
		if u == nil {
			continue
		}
		members = append(members, domain.HouseholdMember{
			UserID:      m.UserID,
			Email:       u.Email,
			DisplayName: u.DisplayName,
			Role:        m.Role,
			JoinedAt:    m.JoinedAt,
		})
	}
	sort.Slice(members, func(i, j int) bool {
		if !members[i].JoinedAt.Equal(members[j].JoinedAt) {
			return members[i].JoinedAt.Before(members[j].JoinedAt)
		}
		return uuidLess(members[i].UserID, members[j].UserID)
	})
	return &domain.Household{ID: h.ID, CreatedAt: h.CreatedAt, Name: h.Name, Members: members}, nil
}

// resetToPersonalHouseholdLocked moves the user's membership to a fresh
// personal household (the leave/remove/dissolve server-side outcome).
func (s *Store) resetToPersonalHouseholdLocked(userID uuid.UUID) uuid.UUID {
	householdID := uuid.New()
	s.households[householdID] = &domain.Household{ID: householdID, CreatedAt: s.now()}
	m := s.memberships[userID]
	m.HouseholdID = householdID
	m.Role = domain.HouseholdRoleOwner
	return householdID
}

func (s *Store) JoinHousehold(
	_ context.Context,
	userID, targetHouseholdID uuid.UUID,
	invitationID *uuid.UUID,
) (*domain.Household, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.memberships[userID]
	if !ok {
		return nil, domain.ErrMembershipNotFound
	}
	if m.HouseholdID != targetHouseholdID {
		if invitationID != nil {
			if err := s.claimInvitationLocked(*invitationID); err != nil {
				return nil, err
			}
		}
		m.HouseholdID = targetHouseholdID
		m.Role = domain.HouseholdRoleMember
	}
	return s.householdWithMembersLocked(targetHouseholdID)
}

// claimInvitationLocked marks a pending invitation accepted inside the store
// lock (the join transaction's invitation claim).
func (s *Store) claimInvitationLocked(invitationID uuid.UUID) error {
	for _, inv := range s.invitations {
		if inv.ID != invitationID {
			continue
		}
		if inv.AcceptedAt != nil || inv.RevokedAt != nil {
			return domain.ErrInvitationAlreadyAccepted
		}
		now := s.now()
		inv.AcceptedAt = &now
	}
	return nil
}

func (s *Store) GenerateHouseholdCode(_ context.Context, scope domain.Scope) (*domain.HouseholdCode, error) {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	code := &domain.HouseholdCode{
		HouseholdID: householdID,
		Code:        "TESTCODE",
		CreatedAt:   s.now(),
	}
	s.codes[householdID] = code
	c := *code
	return &c, nil
}

func (s *Store) RevokeHouseholdCode(_ context.Context, scope domain.Scope) error {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	if code, ok := s.codes[householdID]; ok {
		now := s.now()
		code.RevokedAt = &now
	}
	return nil
}

func (s *Store) FindHouseholdByActiveCode(_ context.Context, code string) (uuid.UUID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.codes {
		if c.Code == code && c.RevokedAt == nil {
			return c.HouseholdID, nil
		}
	}
	return uuid.Nil, nil
}

func (s *Store) LeaveHousehold(_ context.Context, userID uuid.UUID) (*domain.Household, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.memberships[userID]; !ok {
		return nil, domain.ErrMembershipNotFound
	}
	householdID := s.resetToPersonalHouseholdLocked(userID)
	return s.householdWithMembersLocked(householdID)
}

func (s *Store) RemoveHouseholdMember(_ context.Context, householdID, targetUserID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.memberships[targetUserID]
	if !ok || m.HouseholdID != householdID {
		return domain.ErrHouseholdMemberNotFound
	}
	if m.Role == domain.HouseholdRoleOwner {
		return domain.ErrHouseholdMemberIsOwner
	}
	s.resetToPersonalHouseholdLocked(targetUserID)
	return nil
}

func (s *Store) DissolveHousehold(_ context.Context, scope domain.Scope) error {
	householdID := scope.HouseholdID
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.memberships {
		if m.HouseholdID == householdID {
			s.resetToPersonalHouseholdLocked(m.UserID)
		}
	}
	delete(s.households, householdID)
	filtered := s.invitations[:0]
	for _, inv := range s.invitations {
		if inv.HouseholdID != householdID {
			filtered = append(filtered, inv)
		}
	}
	s.invitations = filtered
	delete(s.codes, householdID)
	return nil
}
