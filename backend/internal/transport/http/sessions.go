package http

import (
	"context"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/transport/http/httpctx"
)

func (s *Server) ListSessions(
	ctx context.Context,
	_ api.ListSessionsRequestObject,
) (api.ListSessionsResponseObject, error) {
	user := s.currentUser(ctx)
	sessions, err := s.sessions.List(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	current := httpctx.CurrentSessionID(ginCtx(ctx))
	out := make([]api.SessionResponse, 0, len(sessions))
	for _, sess := range sessions {
		out = append(out, api.SessionResponse{
			CreatedAt: sess.CreatedAt,
			UpdatedAt: sess.UpdatedAt,
			ExpiresAt: sess.ExpiresAt,
			IsCurrent: sess.ID == current,
		})
	}
	return api.ListSessions200JSONResponse(out), nil
}

func (s *Server) DeleteAllSessions(
	ctx context.Context,
	_ api.DeleteAllSessionsRequestObject,
) (api.DeleteAllSessionsResponseObject, error) {
	user := s.currentUser(ctx)
	current := httpctx.CurrentSessionID(ginCtx(ctx))
	if _, err := s.sessions.DeleteAllExcept(ctx, user.ID, current); err != nil {
		return nil, err
	}
	return api.DeleteAllSessions204Response{}, nil
}
