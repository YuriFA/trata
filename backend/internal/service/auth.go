package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/auth"
	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// AuthService owns register/login/logout/me + email verification and password
// reset. It mints sessions (fresh token per login = session-fixation defense),
// keeps the sliding/anti-enumeration/revoke-on-reset semantics, and treats the
// Mailer as a stub (real delivery is out of scope).
type AuthService struct {
	users      repository.UserRepository
	sessions   repository.SessionRepository
	verify     repository.EmailVerificationRepository
	resets     repository.PasswordResetRepository
	mailer     Mailer
	sessionTTL time.Duration
	clock      func() time.Time
}

// AuthConfig is the AuthService configuration.
type AuthConfig struct {
	SessionTTL time.Duration
}

func NewAuthService(
	users repository.UserRepository,
	sessions repository.SessionRepository,
	verify repository.EmailVerificationRepository,
	resets repository.PasswordResetRepository,
	mailer Mailer,
	cfg AuthConfig,
) *AuthService {
	return &AuthService{
		users:      users,
		sessions:   sessions,
		verify:     verify,
		resets:     resets,
		mailer:     mailer,
		sessionTTL: cfg.SessionTTL,
		clock:      time.Now,
	}
}

// now returns the service's UTC clock (overridable in tests).
func (s *AuthService) now() time.Time { return s.clock().UTC() }

// AuthSession is the result of Register/Login: the user plus the freshly minted
// session id (the transport sets the cookie from it).
type AuthSession struct {
	User      *domain.User
	SessionID string
}

// Register creates a user, issues a verification code (best-effort via the
// mailer), and starts a session.
func (s *AuthService) Register(
	ctx context.Context,
	email, password string,
) (*AuthSession, error) {
	const op = "service.auth.Register"

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	user, err := s.users.RegisterUser(ctx, domain.RegisterUserParams{
		Email:        email,
		PasswordHash: passwordHash,
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	// Issue a verification code; failures are best-effort (logged via mailer/log)
	// and must NOT break registration.
	s.issueVerificationCode(ctx, user)

	sessionID, err := s.startSession(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return &AuthSession{User: user, SessionID: sessionID}, nil
}

// Login verifies credentials and starts a session. Bad email or password both
// yield ErrInvalidCredentials (anti-enumeration: one error for both).
func (s *AuthService) Login(ctx context.Context, email, password string) (*AuthSession, error) {
	const op = "service.auth.Login"

	user, err := s.users.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return nil, domain.ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	if err := auth.VerifyPassword(user.PasswordHash, password); err != nil {
		return nil, domain.ErrInvalidCredentials
	}

	sessionID, err := s.startSession(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return &AuthSession{User: user, SessionID: sessionID}, nil
}

// Logout revokes the given session. Idempotent: a missing/expired session is
// not an error.
func (s *AuthService) Logout(ctx context.Context, sessionID string) error {
	const op = "service.auth.Logout"
	if err := s.sessions.DeleteSession(ctx, sessionID); err != nil {
		if errors.Is(err, domain.ErrSessionNotFound) {
			return nil
		}
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// Me returns the current user by id.
func (s *AuthService) Me(ctx context.Context, userID uuid.UUID) (*domain.User, error) {
	const op = "service.auth.Me"
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return user, nil
}

// UpdateDisplayName sets the user's member-facing display name. The name is
// trimmed and must be non-empty within the length cap; it carries no
// access-control meaning (consumers fall back to the email when unset).
func (s *AuthService) UpdateDisplayName(
	ctx context.Context,
	userID uuid.UUID,
	displayName string,
) (*domain.User, error) {
	const op = "service.auth.UpdateDisplayName"

	name := strings.TrimSpace(displayName)
	if utf8.RuneCountInString(name) < domain.DisplayNameMinLength ||
		utf8.RuneCountInString(name) > domain.DisplayNameMaxLength {
		return nil, fmt.Errorf("%s: %w", op, domain.ErrInvalidDisplayName)
	}

	user, err := s.users.UpdateDisplayName(ctx, userID, name)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return user, nil
}

// VerifyEmail checks the 6-digit code against the latest active code for the
// user. Already-verified -> ErrEmailAlreadyVerified. Result errors mirror the
// repository (expired / not-found / invalid).
func (s *AuthService) VerifyEmail(ctx context.Context, userID uuid.UUID, code string) error {
	const op = "service.auth.VerifyEmail"

	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if user.EmailVerified {
		return domain.ErrEmailAlreadyVerified
	}

	if err := s.verify.VerifyEmailCode(ctx, userID, code); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// ResendVerification rotates the verification code (60s throttle). Already
// verified -> ErrEmailAlreadyVerified. Throttled -> *ThrottleError.
func (s *AuthService) ResendVerification(ctx context.Context, userID uuid.UUID) error {
	const op = "service.auth.ResendVerification"

	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if user.EmailVerified {
		return domain.ErrEmailAlreadyVerified
	}

	ageSeconds, exists, err := s.verify.LatestVerificationCodeAgeSeconds(ctx, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if exists {
		throttleSeconds := int(domain.VerificationResendThrottle.Seconds())
		if ageSeconds < throttleSeconds {
			return &ThrottleError{RetryAfterSeconds: max(throttleSeconds-ageSeconds, 1)}
		}
	}

	s.issueVerificationCode(ctx, user)
	return nil
}

// RequestPasswordReset issues a high-entropy reset token for the user if they
// exist and are not throttled. Anti-enumeration: a missing user is NOT an error
// (the transport always returns 204). Throttling is also silent.
func (s *AuthService) RequestPasswordReset(ctx context.Context, email string) error {
	const op = "service.auth.RequestPasswordReset"

	user, err := s.users.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return nil // anti-enumeration: silent success
		}
		return fmt.Errorf("%s: %w", op, err)
	}

	ageSeconds, exists, err := s.resets.LatestPasswordResetTokenAgeSeconds(ctx, user.ID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if exists && ageSeconds < int(domain.PasswordResetRequestThrottle.Seconds()) {
		return nil // throttled -> silent success
	}

	token, err := auth.GenerateSessionToken()
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if err := s.resets.CreatePasswordResetToken(
		ctx,
		user.ID,
		auth.HashToken(token),
		s.now().Add(domain.PasswordResetTokenTTL),
	); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}

	_ = s.mailer.SendPasswordResetToken(ctx, user.Email, token)
	return nil
}

// ConfirmPasswordReset consumes a single-use reset token and sets the new
// password; all of the user's sessions are revoked. Invalid/expired token ->
// domain.ErrPasswordResetTokenNotFound.
func (s *AuthService) ConfirmPasswordReset(ctx context.Context, token, newPassword string) error {
	const op = "service.auth.ConfirmPasswordReset"

	passwordHash, err := auth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if err := s.resets.ResetPassword(ctx, auth.HashToken(token), passwordHash); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// startSession mints a fresh, high-entropy session token and persists it. A new
// id per login is the session-fixation defense; existing sessions are NOT
// revoked (multi-session support).
func (s *AuthService) startSession(ctx context.Context, userID uuid.UUID) (string, error) {
	const op = "service.auth.startSession"

	sessionID, err := auth.GenerateSessionToken()
	if err != nil {
		return "", fmt.Errorf("%s: %w", op, err)
	}
	if _, err := s.sessions.CreateSession(ctx, domain.CreateSessionParams{
		SessionID: sessionID,
		UserID:    userID,
		ExpiresAt: s.now().Add(s.sessionTTL),
	}); err != nil {
		return "", fmt.Errorf("%s: %w", op, err)
	}
	return sessionID, nil
}

// issueVerificationCode generates a fresh OTP and delivers it via the mailer.
// Best-effort: a mailer failure is swallowed (it already logged).
func (s *AuthService) issueVerificationCode(ctx context.Context, user *domain.User) {
	code, err := auth.GenerateOTPCode()
	if err != nil {
		return
	}
	if err := s.verify.CreateEmailVerificationCode(
		ctx,
		user.ID,
		code,
		s.now().Add(domain.VerificationCodeTTL),
	); err != nil {
		return
	}
	_ = s.mailer.SendVerificationCode(ctx, user.Email, code)
}

// ThrottleError signals a resend throttle; the transport sets Retry-After from
// RetryAfterSeconds.
type ThrottleError struct {
	RetryAfterSeconds int
}

func (e *ThrottleError) Error() string { return "throttled, retry later" }
