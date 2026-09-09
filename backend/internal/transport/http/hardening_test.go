package http_test

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/config"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/transport/http/httperr"
	"github.com/yurifa/trata/backend/internal/transport/http/middleware"
)

// --- CSRF Origin check (ADR-0001) -----------------------------------------

// A state-changing request from an allowlisted Origin is processed exactly as
// without the check.
func TestOriginCheckAllowedOriginPasses(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)

	rec := client.do("POST", "/api/auth/register",
		map[string]any{"email": "origin-ok@example.com", "password": "supersecret1"},
		map[string]string{"Origin": "http://localhost:5173"},
	)
	require.Equal(t, 201, rec.Code, rec.Body.String())
}

// A state-changing request with a foreign Origin is rejected with 403
// ORIGIN_REJECTED and performs no state change: the credentials it carried
// cannot log in afterwards.
func TestOriginCheckForeignOriginRejected(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)

	rec := client.do("POST", "/api/auth/register",
		map[string]any{"email": "origin-blocked@example.com", "password": "supersecret1"},
		map[string]string{"Origin": "https://evil.example.net"},
	)
	require.Equal(t, 403, rec.Code, rec.Body.String())

	var errResp httperr.ErrorResponse
	decode(t, rec, &errResp)
	assert.Equal(t, "ORIGIN_REJECTED", errResp.Code)

	// The rejected registration created no user.
	rec = client.do("POST", "/api/auth/login",
		map[string]any{"email": "origin-blocked@example.com", "password": "supersecret1"},
		nil,
	)
	assert.Equal(t, 401, rec.Code, "no user may exist after an origin-rejected register")
}

// Requests without an Origin header (native clients, tests) pass.
func TestOriginCheckNoOriginPasses(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)

	rec := client.do("POST", "/api/auth/register",
		map[string]any{"email": "origin-none@example.com", "password": "supersecret1"},
		nil,
	)
	require.Equal(t, 201, rec.Code, rec.Body.String())
}

// GET requests are never blocked by the Origin check itself: exercised at the
// middleware level because through the full engine the CORS middleware
// (gin-contrib/cors) independently 403s every disallowed-origin request —
// pre-existing behavior, out of scope for this check.
func TestOriginCheckGetNeverBlocked(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(middleware.OriginCheck([]string{"https://app.example.com"}, discardLogger()))
	router.GET("/read", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.POST("/mutate", func(c *gin.Context) { c.Status(http.StatusOK) })

	get := httptest.NewRequest(http.MethodGet, "/read", nil)
	get.Header.Set("Origin", "https://evil.example.net")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, get)
	require.Equal(t, http.StatusOK, rec.Code, "GET with foreign origin passes the check")

	post := httptest.NewRequest(http.MethodPost, "/mutate", nil)
	post.Header.Set("Origin", "https://evil.example.net")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, post)
	require.Equal(t, http.StatusForbidden, rec.Code, "sanity: POST with the same origin is rejected")
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(&strings.Builder{}, nil))
}

// A wildcard entry in the allowlist matches nothing and logs a startup
// warning (fail closed, visibly). The full engine already panics on wildcard
// CORS origins, so the middleware is exercised directly here.
func TestOriginCheckWildcardMatchesNothing(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	var buf strings.Builder
	log := slog.New(slog.NewTextHandler(&buf, nil))
	router := gin.New()
	router.Use(middleware.OriginCheck([]string{"*", "https://app.example.com"}, log))
	router.POST("/mutate", func(c *gin.Context) { c.Status(http.StatusOK) })

	do := func(origin string) int {
		req := httptest.NewRequest(http.MethodPost, "/mutate", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	assert.Equal(t, http.StatusOK, do("https://app.example.com"), "explicit member still passes")
	assert.Equal(t, http.StatusForbidden, do("https://anything.example"), "wildcard must not match")
	assert.Equal(t, http.StatusOK, do(""), "no Origin passes")
	assert.Contains(t, buf.String(), "wildcard/empty entry", "startup warning is logged")
}

// --- Registration rate limit (count-all-attempts) --------------------------

func TestRegisterRateLimitWithinBudget(t *testing.T) {
	t.Parallel()
	cfg := testHTTPConfig()
	cfg.RegisterRateLimit = config.RegisterRateLimit{MaxAttempts: 2, LockoutDuration: time.Minute}
	engine := newTestEngineWithConfig(t, cfg)
	client := newClient(t, engine)

	for i := range 2 {
		rec := client.do("POST", "/api/auth/register",
			map[string]any{"email": "budget" + string(rune('a'+i)) + "@example.com", "password": "supersecret1"},
			nil,
		)
		require.Equal(t, 201, rec.Code, rec.Body.String())
	}
}

// Attempt over the budget: 429 REGISTER_RATE_LIMITED, no user created, and
// other endpoints from the same IP are unaffected.
func TestRegisterRateLimitOverBudget(t *testing.T) {
	t.Parallel()
	cfg := testHTTPConfig()
	cfg.RegisterRateLimit = config.RegisterRateLimit{MaxAttempts: 2, LockoutDuration: time.Minute}
	engine := newTestEngineWithConfig(t, cfg)
	client := newClient(t, engine)

	// Spend the budget (2) with two successful registrations.
	for _, email := range []string{"budget-a@example.com", "budget-b@example.com"} {
		rec := client.do("POST", "/api/auth/register",
			map[string]any{"email": email, "password": "supersecret1"},
			nil,
		)
		require.Equal(t, 201, rec.Code, rec.Body.String())
	}

	var rec *httptest.ResponseRecorder
	rec = client.do("POST", "/api/auth/register",
		map[string]any{"email": "budget-over@example.com", "password": "supersecret1"},
		nil,
	)
	require.Equal(t, 429, rec.Code, rec.Body.String())

	var errResp httperr.ErrorResponse
	decode(t, rec, &errResp)
	assert.Equal(t, "REGISTER_RATE_LIMITED", errResp.Code)
	assert.NotEmpty(t, rec.Header().Get("Retry-After"))

	// The over-budget attempt created no user.
	rec = client.do("POST", "/api/auth/login",
		map[string]any{"email": "budget-over@example.com", "password": "supersecret1"},
		nil,
	)
	assert.Equal(t, 401, rec.Code)

	// Other endpoints from the same IP are unaffected: login (own failure
	// limiter) and health (no limiter) still work.
	rec = client.do("POST", "/api/auth/login",
		map[string]any{"email": "budget-a@example.com", "password": "supersecret1"},
		nil,
	)
	assert.Equal(t, 200, rec.Code)

	rec = client.do("GET", "/api/health", nil, nil)
	assert.Equal(t, 200, rec.Code)
}

// --- Health endpoint --------------------------------------------------------

func TestGetHealthUnauthenticated(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)

	rec := client.do("GET", "/api/health", nil, nil)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	assert.JSONEq(t, `{"status":"ok","version":"dev"}`, rec.Body.String())
}

// A build produced with the version build argument reports it in the health
// payload (spec: app-version, "deployed build reports its commit").
func TestGetHealthReportsInjectedVersion(t *testing.T) {
	t.Parallel()
	engine := wireTestEngineWithVersion(t, testHTTPConfig(), logger.NewDiscardLogger(), "sha-deadbee")
	client := newClient(t, engine)

	rec := client.do("GET", "/api/health", nil, nil)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	assert.JSONEq(t, `{"status":"ok","version":"sha-deadbee"}`, rec.Body.String())
}
