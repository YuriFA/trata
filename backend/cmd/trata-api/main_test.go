package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Version defaults to "dev" for builds without the ldflags injection
// (go run, go test): seeing "dev" on a deployed host is the tell that the
// version build argument was not passed (spec: app-version).
func TestVersionDefaultsToDev(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "dev", Version())
}
