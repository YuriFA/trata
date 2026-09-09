package auth_test

import (
	"testing"

	"github.com/yurifa/trata/backend/internal/auth"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateSessionToken(t *testing.T) {
	t.Parallel()
	t.Run("generates a unique token", func(t *testing.T) {
		t.Parallel()
		token1, err := auth.GenerateSessionToken()
		require.NoError(t, err)
		token2, err := auth.GenerateSessionToken()
		require.NoError(t, err)

		assert.NotEmpty(t, token1)
		assert.NotEmpty(t, token2)
		assert.Len(t, token1, 64, "Expected token length of 64 characters")
		assert.Len(t, token2, 64, "Expected token length of 64 characters")
		require.NotEqual(t, token1, token2, "Expected unique tokens, but got the same")
	})
}
