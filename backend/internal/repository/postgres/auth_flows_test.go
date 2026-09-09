package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/auth"
	"github.com/yurifa/trata/backend/internal/domain"
)

func TestEmailVerificationFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "verify")
	ctx := newCtx(t)

	// No active code yet.
	_, exists, err := testRepo.LatestVerificationCodeAgeSeconds(ctx, user.ID)
	require.NoError(t, err)
	assert.False(t, exists)

	// Wrong code with no code -> not found.
	require.ErrorIs(t, testRepo.VerifyEmailCode(ctx, user.ID, "000000"), domain.ErrVerificationCodeNotFound)

	// Issue a code, verify it.
	require.NoError(
		t,
		testRepo.CreateEmailVerificationCode(ctx, user.ID, "123456", time.Now().UTC().Add(domain.VerificationCodeTTL)),
	)
	require.NoError(t, testRepo.VerifyEmailCode(ctx, user.ID, "123456"))

	// User is now verified.
	after, err := testRepo.GetUserByID(ctx, user.ID)
	require.NoError(t, err)
	assert.True(t, after.EmailVerified)

	// Verifying again with the (now consumed) code -> not found.
	require.ErrorIs(t, testRepo.VerifyEmailCode(ctx, user.ID, "123456"), domain.ErrVerificationCodeNotFound)

	// Already-verified: verifying a fresh code still works idempotently (the
	// repository does not enforce the 409 policy - that lives in the service).
}

func TestEmailVerificationWrongCodeAttempts(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "attempts")
	ctx := newCtx(t)

	require.NoError(
		t,
		testRepo.CreateEmailVerificationCode(ctx, user.ID, "999999", time.Now().UTC().Add(domain.VerificationCodeTTL)),
	)

	// MaxVerificationAttempts-1 wrong guesses return ErrInvalidVerificationCode.
	for range domain.MaxVerificationAttempts - 1 {
		require.ErrorIs(t, testRepo.VerifyEmailCode(ctx, user.ID, "000000"), domain.ErrInvalidVerificationCode)
	}
	// The MaxVerificationAttempts-th wrong guess invalidates the code -> next is not found.
	require.ErrorIs(t, testRepo.VerifyEmailCode(ctx, user.ID, "000000"), domain.ErrInvalidVerificationCode)
	require.ErrorIs(t, testRepo.VerifyEmailCode(ctx, user.ID, "000000"), domain.ErrVerificationCodeNotFound)
}

func TestEmailVerificationExpired(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "expired")
	ctx := newCtx(t)

	// Code already expired.
	require.NoError(t, testRepo.CreateEmailVerificationCode(ctx, user.ID, "111111", time.Now().UTC().Add(-time.Minute)))
	require.ErrorIs(t, testRepo.VerifyEmailCode(ctx, user.ID, "111111"), domain.ErrVerificationCodeExpired)
}

func TestPasswordResetFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "reset")
	ctx := newCtx(t)

	// Start a session for the user; reset must revoke it.
	sess, err := testRepo.CreateSession(ctx, domain.CreateSessionParams{
		SessionID: "session-token-reset-test", UserID: user.ID, ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	require.NoError(t, err)
	_, err = testRepo.GetSessionByID(ctx, sess.ID)
	require.NoError(t, err)

	token := "raw-reset-token"
	tokenHash := auth.HashToken(token)
	require.NoError(
		t,
		testRepo.CreatePasswordResetToken(ctx, user.ID, tokenHash, time.Now().UTC().Add(domain.PasswordResetTokenTTL)),
	)

	// Wrong token -> not found.
	require.ErrorIs(
		t,
		testRepo.ResetPassword(ctx, auth.HashToken("wrong"), "newhash"),
		domain.ErrPasswordResetTokenNotFound,
	)

	// Correct token -> consumes, and revokes all sessions.
	require.NoError(t, testRepo.ResetPassword(ctx, tokenHash, "newhash"))
	_, err = testRepo.GetSessionByID(ctx, sess.ID)
	require.ErrorIs(t, err, domain.ErrSessionNotFound)

	// Token is single-use: re-using it fails.
	require.ErrorIs(t, testRepo.ResetPassword(ctx, tokenHash, "again"), domain.ErrPasswordResetTokenNotFound)
}

func TestSessionsListingAndRevoke(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	user := seedUser(t, "sessions")
	ctx := newCtx(t)

	s1 := createSession(t, user.ID, "s1")
	_ = createSession(t, user.ID, "s2")
	createSession(t, user.ID, "s3")

	list, err := testRepo.GetSessionsByUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Len(t, list, 3)

	// Revoke all except s1.
	n, err := testRepo.DeleteSessionsByUserExcept(ctx, user.ID, s1)
	require.NoError(t, err)
	assert.Equal(t, int64(2), n)

	list, err = testRepo.GetSessionsByUser(ctx, user.ID)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "s1", list[0].ID)
}

// createSession inserts a session row with the given id for the user.
func createSession(t *testing.T, userID uuid.UUID, id string) string {
	t.Helper()
	ctx := newCtx(t)
	_, err := testRepo.CreateSession(ctx, domain.CreateSessionParams{
		SessionID: id, UserID: userID, ExpiresAt: time.Now().UTC().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("createSession: %v", err)
	}
	return id
}
