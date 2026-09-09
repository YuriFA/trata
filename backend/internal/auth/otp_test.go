package auth_test

import (
	"testing"

	"github.com/yurifa/trata/backend/internal/auth"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateOTPCode(t *testing.T) {
	t.Parallel()

	code, err := auth.GenerateOTPCode()
	require.NoError(t, err)
	require.Len(t, code, 6)
	for _, r := range code {
		assert.True(t, r >= '0' && r <= '9', "code must be numeric, got %q", code)
	}

	seen := make(map[string]struct{}, 500)
	for range 500 {
		c, err := auth.GenerateOTPCode()
		require.NoError(t, err)
		seen[c] = struct{}{}
	}
	assert.Greater(t, len(seen), 450, "codes should be sufficiently random")
}
