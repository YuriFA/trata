package auth_test

import (
	"testing"

	"github.com/yurifa/trata/backend/internal/auth"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword(t *testing.T) {
	t.Parallel()
	t.Run("success", func(t *testing.T) {
		t.Parallel()
		password := "mysecretpassword"
		hash, err := auth.HashPassword(password)
		require.NoError(t, err)
		require.NoError(t, auth.VerifyPassword(hash, password))
		require.Error(t, auth.VerifyPassword(hash, "wrongpassword"))
	})

	t.Run("extra long password", func(t *testing.T) {
		t.Parallel()
		password := "thisisaverylongpasswordthatexceedstheusualmaximumlengthandshouldstillworkproperly"
		_, err := auth.HashPassword(password)
		require.ErrorIs(t, err, bcrypt.ErrPasswordTooLong)
	})
}

func TestVerifyPassword(t *testing.T) {
	t.Parallel()
	t.Run("success", func(t *testing.T) {
		t.Parallel()
		password := "mysecretpassword"
		hash, err := auth.HashPassword(password)
		require.NoError(t, err)
		require.NoError(t, auth.VerifyPassword(hash, password))
		require.Error(t, auth.VerifyPassword(hash, "wrongpassword"))
	})

	t.Run("invalid hash", func(t *testing.T) {
		t.Parallel()
		require.Error(t, auth.VerifyPassword("invalidhash", "password"))
	})
}
