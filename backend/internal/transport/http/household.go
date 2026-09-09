package http

import (
	"context"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/transport/http/httpctx"
)

// currentMembership rebuilds the requester's membership (household id + role
// from the auth middleware, user from the session) for the service's
// owner-scoped join-lifecycle guards.
func (s *Server) currentMembership(ctx context.Context, user *domain.User) *domain.Membership {
	return &domain.Membership{
		HouseholdID: s.currentHouseholdID(ctx),
		UserID:      user.ID,
		Role:        httpctx.CurrentHouseholdRole(ginCtx(ctx)),
	}
}

// GetHousehold returns the requester's household with its members (email,
// display name, role, joined date). The household id comes from the auth
// middleware's membership resolution, so the listing is the requester's own
// household by construction.
func (s *Server) GetHousehold(
	ctx context.Context,
	_ api.GetHouseholdRequestObject,
) (api.GetHouseholdResponseObject, error) {
	scope := s.currentScope(ctx)
	h, err := s.households.Get(ctx, scope)
	if err != nil {
		return nil, err
	}
	return api.GetHousehold200JSONResponse(toAPIHousehold(*h)), nil
}

// UpdateHousehold sets or clears the household display name (owner only).
func (s *Server) UpdateHousehold(
	ctx context.Context,
	req api.UpdateHouseholdRequestObject,
) (api.UpdateHouseholdResponseObject, error) {
	user := s.currentUser(ctx)
	h, err := s.households.UpdateName(ctx, s.currentMembership(ctx, user), req.Body.Name)
	if err != nil {
		return nil, err
	}
	return api.UpdateHousehold200JSONResponse(toAPIHousehold(*h)), nil
}

// UpdateCurrentUser sets the requester's display name (profile edit).
func (s *Server) UpdateCurrentUser(
	ctx context.Context,
	req api.UpdateCurrentUserRequestObject,
) (api.UpdateCurrentUserResponseObject, error) {
	user := s.currentUser(ctx)
	u, err := s.auth.UpdateDisplayName(ctx, user.ID, req.Body.DisplayName)
	if err != nil {
		return nil, err
	}
	return api.UpdateCurrentUser200JSONResponse(toAPIUser(*u)), nil
}

// CreateHouseholdInvitation invites an email into the requester's household
// (owner only). A pending same-email invitation is refreshed, not duplicated.
func (s *Server) CreateHouseholdInvitation(
	ctx context.Context,
	req api.CreateHouseholdInvitationRequestObject,
) (api.CreateHouseholdInvitationResponseObject, error) {
	user := s.currentUser(ctx)
	invitation, err := s.households.CreateInvitation(
		ctx, s.currentMembership(ctx, user), string(req.Body.Email),
	)
	if err != nil {
		return nil, err
	}
	return api.CreateHouseholdInvitation200JSONResponse(toAPIHouseholdInvitation(*invitation)), nil
}

// ListHouseholdInvitations returns the household's invitations (owner only).
func (s *Server) ListHouseholdInvitations(
	ctx context.Context,
	_ api.ListHouseholdInvitationsRequestObject,
) (api.ListHouseholdInvitationsResponseObject, error) {
	user := s.currentUser(ctx)
	invitations, err := s.households.ListInvitations(ctx, s.currentMembership(ctx, user))
	if err != nil {
		return nil, err
	}
	out := make([]api.HouseholdInvitation, 0, len(invitations))
	for _, inv := range invitations {
		out = append(out, toAPIHouseholdInvitation(inv))
	}
	return api.ListHouseholdInvitations200JSONResponse{Invitations: out}, nil
}

// RevokeHouseholdInvitation revokes an invitation (owner only, idempotent).
func (s *Server) RevokeHouseholdInvitation(
	ctx context.Context,
	req api.RevokeHouseholdInvitationRequestObject,
) (api.RevokeHouseholdInvitationResponseObject, error) {
	user := s.currentUser(ctx)
	if err := s.households.RevokeInvitation(
		ctx,
		s.currentMembership(ctx, user),
		fromUUID(req.InvitationId),
	); err != nil {
		return nil, err
	}
	return api.RevokeHouseholdInvitation204Response{}, nil
}

// PreviewHouseholdInvitation is the acceptor-side preview: requires the
// authenticated account's email to match the invitation.
func (s *Server) PreviewHouseholdInvitation(
	ctx context.Context,
	req api.PreviewHouseholdInvitationRequestObject,
) (api.PreviewHouseholdInvitationResponseObject, error) {
	user := s.currentUser(ctx)
	preview, err := s.households.PreviewInvitation(ctx, user, fromUUID(req.Token))
	if err != nil {
		return nil, err
	}
	return api.PreviewHouseholdInvitation200JSONResponse{
		HouseholdName:      preview.HouseholdName,
		MembersCount:       preview.MembersCount,
		InviterEmail:       toAPIEmail(preview.InviterEmail),
		InviterDisplayName: preview.InviterDisplayName,
		ExpiresAt:          preview.ExpiresAt,
	}, nil
}

// AcceptHouseholdInvitation performs the join (membership swap, idempotent).
func (s *Server) AcceptHouseholdInvitation(
	ctx context.Context,
	req api.AcceptHouseholdInvitationRequestObject,
) (api.AcceptHouseholdInvitationResponseObject, error) {
	user := s.currentUser(ctx)
	h, err := s.households.AcceptInvitation(ctx, user, fromUUID(req.Token))
	if err != nil {
		return nil, err
	}
	return api.AcceptHouseholdInvitation200JSONResponse(toAPIHousehold(*h)), nil
}

// GenerateHouseholdCode issues or rotates the household's join code (owner).
func (s *Server) GenerateHouseholdCode(
	ctx context.Context,
	_ api.GenerateHouseholdCodeRequestObject,
) (api.GenerateHouseholdCodeResponseObject, error) {
	user := s.currentUser(ctx)
	code, err := s.households.GenerateCode(ctx, s.currentMembership(ctx, user))
	if err != nil {
		return nil, err
	}
	return api.GenerateHouseholdCode200JSONResponse{
		Code:      code.Code,
		CreatedAt: code.CreatedAt,
	}, nil
}

// RevokeHouseholdCode deactivates the household's join code (owner, idempotent).
func (s *Server) RevokeHouseholdCode(
	ctx context.Context,
	_ api.RevokeHouseholdCodeRequestObject,
) (api.RevokeHouseholdCodeResponseObject, error) {
	user := s.currentUser(ctx)
	if err := s.households.RevokeCode(ctx, s.currentMembership(ctx, user)); err != nil {
		return nil, err
	}
	return api.RevokeHouseholdCode204Response{}, nil
}

// JoinHouseholdByCode joins the household of an active code (idempotent).
func (s *Server) JoinHouseholdByCode(
	ctx context.Context,
	req api.JoinHouseholdByCodeRequestObject,
) (api.JoinHouseholdByCodeResponseObject, error) {
	user := s.currentUser(ctx)
	h, err := s.households.JoinByCode(ctx, user, req.Body.Code)
	if err != nil {
		return nil, err
	}
	return api.JoinHouseholdByCode200JSONResponse(toAPIHousehold(*h)), nil
}

// LeaveHousehold removes the caller's membership and returns the fresh
// personal household created for them.
func (s *Server) LeaveHousehold(
	ctx context.Context,
	_ api.LeaveHouseholdRequestObject,
) (api.LeaveHouseholdResponseObject, error) {
	user := s.currentUser(ctx)
	h, err := s.households.Leave(ctx, s.currentMembership(ctx, user))
	if err != nil {
		return nil, err
	}
	return api.LeaveHousehold200JSONResponse(toAPIHousehold(*h)), nil
}

// RemoveHouseholdMember removes a member (owner only).
func (s *Server) RemoveHouseholdMember(
	ctx context.Context,
	req api.RemoveHouseholdMemberRequestObject,
) (api.RemoveHouseholdMemberResponseObject, error) {
	user := s.currentUser(ctx)
	if err := s.households.RemoveMember(ctx, s.currentMembership(ctx, user), fromUUID(req.UserId)); err != nil {
		return nil, err
	}
	return api.RemoveHouseholdMember204Response{}, nil
}

// DissolveHousehold deletes the household with all of its data (owner only,
// explicit confirm in the body).
func (s *Server) DissolveHousehold(
	ctx context.Context,
	req api.DissolveHouseholdRequestObject,
) (api.DissolveHouseholdResponseObject, error) {
	user := s.currentUser(ctx)
	confirm := req.Body.Confirm
	if err := s.households.Dissolve(ctx, s.currentMembership(ctx, user), confirm); err != nil {
		return nil, err
	}
	return api.DissolveHousehold204Response{}, nil
}
