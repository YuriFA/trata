package auth_test

import (
	"testing"

	"github.com/yurifa/trata/backend/internal/auth"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashToken(t *testing.T) {
	t.Parallel()

	h1 := auth.HashToken("some-reset-token")
	h2 := auth.HashToken("some-reset-token")
	require.Equal(t, h1, h2)
	assert.Len(t, h1, 64)

	assert.NotEqual(t, h1, auth.HashToken("different-token"))
	assert.NotEqual(t, "some-reset-token", h1)
}
