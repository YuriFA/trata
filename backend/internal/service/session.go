package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// SessionService owns active-session listing and bulk revocation.
type SessionService struct {
	sessions repository.SessionRepository
}

func NewSessionService(sessions repository.SessionRepository) *SessionService {
	return &SessionService{sessions: sessions}
}

// List returns the user's active sessions (newest first). The transport layer
// marks the current one.
func (s *SessionService) List(ctx context.Context, userID uuid.UUID) ([]domain.Session, error) {
	const op = "service.session.List"
	sessions, err := s.sessions.GetSessionsByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return sessions, nil
}

// DeleteAllExcept revokes every session for the user except the current one.
func (s *SessionService) DeleteAllExcept(
	ctx context.Context,
	userID uuid.UUID,
	currentSessionID string,
) (int64, error) {
	const op = "service.session.DeleteAllExcept"
	n, err := s.sessions.DeleteSessionsByUserExcept(ctx, userID, currentSessionID)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return n, nil
}
