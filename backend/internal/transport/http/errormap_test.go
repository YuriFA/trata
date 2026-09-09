package http //nolint:testpackage // needs the unexported domainErrorStatus table

import (
	"testing"

	"github.com/yurifa/trata/backend/internal/domain"
)

// TestDomainErrorStatusCoverage guards the split error tables: every sentinel
// the transport maps to an HTTP status must also carry a wire spec
// (code + message) in domain.errorSpecs, or writeDomainError would fall
// through to 500 on a known sentinel.
func TestDomainErrorStatusCoverage(t *testing.T) {
	t.Parallel()

	for sentinel := range domainErrorStatus {
		if _, ok := domain.ErrorSpecFor(sentinel); !ok {
			t.Errorf("sentinel %v has an HTTP status but no domain.ErrorSpec row", sentinel)
		}
	}
}
