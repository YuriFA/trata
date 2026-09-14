package postgres

import (
	"context"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// GetMembershipByUser resolves the user's (single, v1) membership - the auth
// middleware's household resolution hop. Missing row -> ErrMembershipNotFound
// (a data-invariant violation: every user owns exactly one household).
func (r *Repository) GetMembershipByUser(
	ctx context.Context,
	userID uuid.UUID,
) (*domain.Membership, error) {
	const op = "repository.postgres.GetMembershipByUser"

	row, err := r.q.GetMembershipByUser(ctx, userID)
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrMembershipNotFound
		}
		return nil, opWrap(op, err)
	}
	return &domain.Membership{
		HouseholdID: row.HouseholdID,
		UserID:      row.UserID,
		Role:        domain.HouseholdRole(row.Role),
		JoinedAt:    row.JoinedAt,
	}, nil
}

// GetHouseholdWithMembers loads the household with its full member listing
// (email, display name, role, joined date). Unknown id -> ErrHouseholdNotFound.
func (r *Repository) GetHouseholdWithMembers(
	ctx context.Context,
	scope domain.Scope,
) (*domain.Household, error) {
	householdID := scope.HouseholdID
	const op = "repository.postgres.GetHouseholdWithMembers"

	h, err := r.q.GetHouseholdByID(ctx, householdID)
	if err != nil {
		if errNoRows(err) {
			return nil, domain.ErrHouseholdNotFound
		}
		return nil, opWrap(op, err)
	}

	rows, err := r.q.GetHouseholdMembers(ctx, householdID)
	if err != nil {
		return nil, opWrap(op, err)
	}
	members := make([]domain.HouseholdMember, 0, len(rows))
	for _, row := range rows {
		members = append(members, domain.HouseholdMember{
			UserID:      row.UserID,
			Email:       row.Email,
			DisplayName: row.DisplayName,
			Role:        domain.HouseholdRole(row.Role),
			JoinedAt:    row.JoinedAt,
		})
	}
	return &domain.Household{
		ID:        h.ID,
		CreatedAt: h.CreatedAt,
		Name:      h.Name,
		Currency:  h.Currency,
		Members:   members,
	}, nil
}
