package e2e_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/expense-tracker-api/internal/config"
	"github.com/yurifa/expense-tracker-api/internal/logger"
	"github.com/yurifa/expense-tracker-api/internal/service"
	httptransport "github.com/yurifa/expense-tracker-api/internal/transport/http"
)

// e2eEngineWithCfg builds a second full-stack engine over the shared e2e
// repository with a custom HTTP config, so a test can pin e.g. a small
// register budget without poisoning the shared engine's limiters.
func e2eEngineWithCfg(cfg *config.HTTPServer) http.Handler {
	authSvc := service.NewAuthService(e2eRepo, e2eRepo, e2eRepo, e2eRepo, mailer,
		service.AuthConfig{SessionTTL: time.Hour})
	txnSvc := service.NewTransactionService(e2eRepo, e2eRepo, e2eRepo)
	householdSvc := service.NewHouseholdService(
		e2eRepo, e2eRepo, mailer, logger.NewDiscardLogger(), service.HouseholdJoinConfig{},
	)
	server := httptransport.NewServer(
		cfg, discardLogger(),
		"dev",
		service.NewAccountService(e2eRepo),
		service.NewCategoryService(e2eRepo),
		txnSvc,
		service.NewDebtorService(e2eRepo),
		service.NewDebtOperationService(e2eRepo, e2eRepo),
		service.NewPlannedPaymentService(e2eRepo, e2eRepo, e2eRepo),
		service.NewPushService(e2eRepo),
		config.PushConfig{},
		authSvc,
		service.NewSessionService(e2eRepo),
		householdSvc,
		service.NewSyncService(e2eRepo),
	)
	return httptransport.NewEngine(cfg, discardLogger(), server, e2eRepo, e2eRepo, e2eRepo, e2eRepo)
}

func doJSON(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// Registration is count-all-attempts rate limited per client IP: within-budget
// attempts succeed; the over-budget attempt is rejected with
// REGISTER_RATE_LIMITED, creates no user, and leaves login (own failure
// limiter) working from the same IP.
func TestE2E_RegisterRateLimit(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	cfg := testCfg()
	cfg.RegisterRateLimit = config.RegisterRateLimit{MaxAttempts: 2, LockoutDuration: time.Minute}
	engine := e2eEngineWithCfg(cfg)

	// Within budget: two registrations succeed.
	first, second := uniqueEmail(), uniqueEmail()
	for _, email := range []string{first, second} {
		rec := doJSON(t, engine, "POST", "/api/auth/register",
			map[string]string{"email": email, "password": "supersecret1"})
		require.Equal(t, 201, rec.Code, rec.Body.String())
	}

	// Over budget: 429 + machine code + Retry-After.
	over := uniqueEmail()
	rec := doJSON(t, engine, "POST", "/api/auth/register",
		map[string]string{"email": over, "password": "supersecret1"})
	require.Equal(t, 429, rec.Code, rec.Body.String())
	var resp struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "REGISTER_RATE_LIMITED", resp.Code)
	assert.NotEmpty(t, rec.Header().Get("Retry-After"))

	// No user was created by the rejected attempt.
	rec = doJSON(t, engine, "POST", "/api/auth/login",
		map[string]string{"email": over, "password": "supersecret1"})
	assert.Equal(t, 401, rec.Code)

	// Other endpoints from the same IP are unaffected.
	rec = doJSON(t, engine, "POST", "/api/auth/login",
		map[string]string{"email": first, "password": "supersecret1"})
	assert.Equal(t, 200, rec.Code, rec.Body.String())
}

// GET /api/health is an unauthenticated liveness probe over the full stack.
func TestE2E_HealthUnauthenticated(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}
	rec := doJSON(t, e2eEngine, "GET", "/api/health", nil)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	assert.JSONEq(t, `{"status":"ok","version":"dev"}`, rec.Body.String())
}
