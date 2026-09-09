package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/auth"
	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/service"
)

func TestAuth_RegisterAndLogin(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, _, _ := services(t)
	ctx := context.Background()

	// Register starts a session (returns a fresh session id).
	sess, err := authSvc.Register(ctx, "alice@example.com", "supersecret")
	require.NoError(t, err)
	assert.Equal(t, "alice@example.com", sess.User.Email)
	assert.NotEmpty(t, sess.SessionID)
	assert.False(t, sess.User.EmailVerified, "freshly registered user is not verified")

	// Duplicate email -> already exists.
	_, err = authSvc.Register(ctx, "alice@example.com", "other")
	require.ErrorIs(t, err, domain.ErrUserAlreadyExists)

	// Login with correct password.
	sess2, err := authSvc.Login(ctx, "alice@example.com", "supersecret")
	require.NoError(t, err)
	assert.NotEmpty(t, sess2.SessionID)
	assert.NotEqual(t, sess.SessionID, sess2.SessionID, "fresh session id per login")

	// Anti-enumeration: wrong password AND unknown email both -> INVALID_CREDENTIALS.
	_, err = authSvc.Login(ctx, "alice@example.com", "wrong")
	require.ErrorIs(t, err, domain.ErrInvalidCredentials)
	_, err = authSvc.Login(ctx, "nobody@example.com", "whatever")
	require.ErrorIs(t, err, domain.ErrInvalidCredentials)
}

func TestAuth_VerifyEmail(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	// Issue a code directly through the store to know the value.
	require.NoError(
		t,
		store.CreateEmailVerificationCode(ctx, user.ID, "654321", time.Now().UTC().Add(domain.VerificationCodeTTL)),
	)

	// Wrong code.
	require.ErrorIs(t, authSvc.VerifyEmail(ctx, user.ID, "000000"), domain.ErrInvalidVerificationCode)
	// Correct code -> verified.
	require.NoError(t, authSvc.VerifyEmail(ctx, user.ID, "654321"))
	// Verify again -> already verified.
	require.ErrorIs(t, authSvc.VerifyEmail(ctx, user.ID, "654321"), domain.ErrEmailAlreadyVerified)
}

func TestAuth_ResendThrottle(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)
	require.NoError(t, authSvc.ResendVerification(ctx, user.ID)) // first resend ok

	// Immediate second resend -> throttled with RetryAfter.
	err := authSvc.ResendVerification(ctx, user.ID)
	require.Error(t, err)
	var throttle *service.ThrottleError
	require.ErrorAs(t, err, &throttle)
	assert.Positive(t, throttle.RetryAfterSeconds)
}

func TestAuth_PasswordReset_AntiEnumeration(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)

	// Reset request for a real user: silent success (returns nil).
	require.NoError(t, authSvc.RequestPasswordReset(ctx, user.Email))

	// Reset request for a NON-existent user: ALSO silent success (anti-enumeration).
	require.NoError(t, authSvc.RequestPasswordReset(ctx, "ghost@example.com"))
}

func TestAuth_PasswordResetConfirm(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, _, store := services(t)
	ctx := context.Background()

	user := seedFakeUser(t, store)

	// Issue a token directly via the store: tokenHash = sha256("mytoken").
	token := "mytoken"
	require.NoError(
		t,
		store.CreatePasswordResetToken(
			ctx,
			user.ID,
			auth.HashToken(token),
			time.Now().UTC().Add(domain.PasswordResetTokenTTL),
		),
	)

	// Wrong token -> not found.
	require.ErrorIs(t, authSvc.ConfirmPasswordReset(ctx, "wrong", "newpassword"), domain.ErrPasswordResetTokenNotFound)

	// Correct token -> success; the service hashes the new password.
	require.NoError(t, authSvc.ConfirmPasswordReset(ctx, token, "newpassword123"))

	// Single-use: re-confirm fails.
	require.ErrorIs(t, authSvc.ConfirmPasswordReset(ctx, token, "again"), domain.ErrPasswordResetTokenNotFound)

	// Sessions were revoked: there are none for the user now.
	sessions, err := store.GetSessionsByUser(ctx, user.ID)
	require.NoError(t, err)
	assert.Empty(t, sessions)
}

func TestAccountService_NoFieldsToUpdate(t *testing.T) {
	t.Parallel()
	acctSvc, _, _, _, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	a := seedFakeAccount(t, store, domain.Scope{HouseholdID: userHH}, user.ID)

	_, err := acctSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		a.ID,
		domain.UpdateAccountParams{},
	)
	require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)
}

func TestCategoryService_NoFieldsToUpdate(t *testing.T) {
	t.Parallel()
	_, catSvc, _, _, _, store := services(t)
	ctx := context.Background()
	user := seedFakeUser(t, store)
	userHH := householdOf(t, store, user.ID)
	c := seedFakeCategory(t, store, domain.Scope{HouseholdID: userHH}, user.ID, "Z", domain.TransactionTypeIncome)

	_, err := catSvc.Update(
		ctx,
		domain.Scope{HouseholdID: userHH, ActorID: user.ID},
		c.ID,
		domain.UpdateCategoryParams{},
	)
	require.ErrorIs(t, err, service.ErrNoFieldsToUpdate)
}

func TestSessionService_ListAndRevoke(t *testing.T) {
	t.Parallel()
	_, _, _, authSvc, sessSvc, _ := services(t)
	ctx := context.Background()

	// Register creates a session.
	sess, err := authSvc.Register(ctx, "sess@example.com", "supersecret")
	require.NoError(t, err)

	// Start a second session.
	_, err = authSvc.Login(ctx, "sess@example.com", "supersecret")
	require.NoError(t, err)

	list, err := sessSvc.List(ctx, sess.User.ID)
	require.NoError(t, err)
	assert.Len(t, list, 2)

	// Revoke all except current.
	n, err := sessSvc.DeleteAllExcept(ctx, sess.User.ID, sess.SessionID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), n)

	list, _ = sessSvc.List(ctx, sess.User.ID)
	assert.Len(t, list, 1)
}
