package http_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/expense-tracker-api/internal/config"
	"github.com/yurifa/expense-tracker-api/internal/logger"
	"github.com/yurifa/expense-tracker-api/internal/service"
	"github.com/yurifa/expense-tracker-api/internal/service/fakes"
	httptransport "github.com/yurifa/expense-tracker-api/internal/transport/http"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// TestDocsRoutesServeEmbeddedSpec pins the fix for the /docs routes (finding
// A3): they used to read relative spec files that only resolved when the
// process ran from the repo root. The embedded spec has no filesystem
// dependency, and the test's working directory (this package) is exactly the
// environment where the old implementation 404'd.
func TestDocsRoutesServeEmbeddedSpec(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)

	resp := httptest.NewRecorder()
	engine.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/docs", nil))
	require.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `redoc spec-url="/docs/openapi.json"`)

	resp = httptest.NewRecorder()
	engine.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/docs/openapi.json", nil))
	require.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "application/json", resp.Header().Get("Content-Type"))
	assert.Contains(t, resp.Body.String(), `"openapi":"3.0.3"`)
}

// TestNewEngineRejectsWildcardCorsOrigin pins the ADR-0001 fail-fast:
// credentialed CORS forbids wildcard/empty allowed origins.
func TestNewEngineRejectsWildcardCorsOrigin(t *testing.T) {
	t.Parallel()
	for _, origin := range []string{"*", ""} {
		cfg := testHTTPConfig()
		cfg.CorsConfig.AllowedOrigins = []string{"https://ok.example", origin}
		assert.Panics(t, func() { newTestEngineWithConfig(t, cfg) })
	}
}

func newTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	return newTestEngineWithLogger(t, logger.NewDiscardLogger())
}

func newTestEngineWithLogger(t *testing.T, log *slog.Logger) *gin.Engine {
	t.Helper()
	return wireTestEngine(t, testHTTPConfig(), log)
}

func newTestEngineWithConfig(t *testing.T, cfg *config.HTTPServer) *gin.Engine {
	t.Helper()
	return wireTestEngine(t, cfg, logger.NewDiscardLogger())
}

func wireTestEngine(t *testing.T, cfg *config.HTTPServer, log *slog.Logger) *gin.Engine {
	t.Helper()
	return wireTestEngineWithVersion(t, cfg, log, "dev")
}

func wireTestEngineWithVersion(t *testing.T, cfg *config.HTTPServer, log *slog.Logger, version string) *gin.Engine {
	t.Helper()
	store := fakes.New()
	authSvc := service.NewAuthService(
		store,
		store,
		store,
		store,
		service.NewLogMailer(log),
		service.AuthConfig{SessionTTL: time.Hour},
	)
	accountSvc := service.NewAccountService(store)
	categorySvc := service.NewCategoryService(store)
	txnSvc := service.NewTransactionService(store, store, store)
	debtorSvc := service.NewDebtorService(store)
	debtOpSvc := service.NewDebtOperationService(store, store)
	planSvc := service.NewPlannedPaymentService(store, store, store)
	sessionSvc := service.NewSessionService(store)
	householdSvc := service.NewHouseholdService(
		store,
		store,
		service.NewLogMailer(logger.NewDiscardLogger()),
		logger.NewDiscardLogger(),
		service.HouseholdJoinConfig{},
	)

	server := httptransport.NewServer(
		cfg,
		log,
		version,
		accountSvc,
		categorySvc,
		txnSvc,
		debtorSvc,
		debtOpSvc,
		planSvc,
		service.NewPushService(store),
		config.PushConfig{},
		authSvc,
		sessionSvc,
		householdSvc,
		service.NewSyncService(store),
	)
	return httptransport.NewEngine(cfg, log, server, store, store, store, store)
}

func testHTTPConfig() *config.HTTPServer {
	return &config.HTTPServer{
		Address: "127.0.0.1:0",
		CorsConfig: config.CORSConfig{
			AllowedOrigins: []string{"http://localhost:5173"},
			AllowedMethods: []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders: []string{"Content-Type"},
		},
		SessionConfig: config.SessionConfig{
			TTL:               time.Hour,
			CookieName:        "session_id",
			Secure:            false,
			SameSite:          "lax",
			SlidingExpiration: true,
		},
		FailureRateLimit:  config.FailureRateLimit{MaxAttempts: 100, LockoutDuration: time.Minute},
		RegisterRateLimit: config.RegisterRateLimit{MaxAttempts: 100, LockoutDuration: time.Minute},
	}
}

type apiClient struct {
	t   *testing.T
	jar map[string]string
	h   http.Handler
}

func (c *apiClient) do(method, path string, body any, extraHeaders map[string]string) *httptest.ResponseRecorder {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(c.t, err)
		rdr = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range c.jar {
		req.AddCookie(&http.Cookie{Name: k, Value: v})
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, req)
	for _, sc := range w.Result().Cookies() {
		if sc.Value != "" {
			c.jar[sc.Name] = sc.Value
		} else {
			delete(c.jar, sc.Name)
		}
	}
	return w
}

func newClient(t *testing.T, h http.Handler) *apiClient {
	return &apiClient{t: t, jar: map[string]string{}, h: h}
}

func decode(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	require.NoErrorf(t, json.Unmarshal(rec.Body.Bytes(), v), "body: %s", rec.Body.String())
}

func TestTransport_RegisterLoginCreateFlow(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)

	// Register -> 201 + session cookie. The category list starts empty
	// (registration no longer seeds anything), so the flow creates its own
	// category below.
	rec := client.do(
		"POST",
		"/api/auth/register",
		map[string]any{"email": "flow@example.com", "password": "supersecret1"},
		nil,
	)
	require.Equal(t, 201, rec.Code, rec.Body.String())
	require.NotEmpty(t, client.jar["session_id"], "register sets a session cookie")

	// Me -> 200 (auth works).
	rec = client.do("GET", "/api/auth/me", nil, nil)
	require.Equal(t, 200, rec.Code, rec.Body.String())

	// Create account.
	rec = client.do(
		"POST",
		"/api/accounts",
		map[string]any{"name": "Wallet", "currency": "USD", "openingBalance": 10000},
		nil,
	)
	require.Equal(t, 201, rec.Code, rec.Body.String())
	var acct map[string]any
	decode(t, rec, &acct)
	assert.InDelta(t, float64(10000), acct["balance"], 0)
	accountID := acct["id"].(string)

	// Create an income category for the transaction.
	rec = client.do("POST", "/api/categories", map[string]any{
		"name": "Salary", "type": "income", "icon": "💼", "color": "#7c3aed",
	}, nil)
	require.Equal(t, 201, rec.Code, rec.Body.String())
	var createdCat map[string]any
	decode(t, rec, &createdCat)
	catID := createdCat["id"].(string)

	// Create transaction referencing the account + category (idempotent).
	rec = client.do("POST", "/api/transactions", map[string]any{
		"type": "income", "amount": 5000, "description": "pay", "occurredAt": "2026-01-15T10:00:00Z",
		"accountId": accountID, "categoryId": catID,
	}, map[string]string{"Idempotency-Key": "k-1"})
	require.Equal(t, 201, rec.Code, rec.Body.String())

	// Idempotency replay: same key + body -> 201 (replayed).
	rec = client.do("POST", "/api/transactions", map[string]any{
		"type": "income", "amount": 5000, "description": "pay", "occurredAt": "2026-01-15T10:00:00Z",
		"accountId": accountID, "categoryId": catID,
	}, map[string]string{"Idempotency-Key": "k-1"})
	require.Equal(t, 201, rec.Code, rec.Body.String())

	// Balance now reflects the income.
	rec = client.do("GET", "/api/accounts/"+accountID, nil, nil)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	decode(t, rec, &acct)
	assert.InDelta(t, float64(15000), acct["balance"], 0)
}

func TestTransport_UnauthReturns401(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)
	rec := client.do("GET", "/api/accounts", nil, nil)
	assert.Equal(t, 401, rec.Code, rec.Body.String())
}

func TestTransport_SpecValidationRejectsBadBody(t *testing.T) {
	t.Parallel()
	engine := newTestEngine(t)
	client := newClient(t, engine)

	_ = client.do(
		"POST",
		"/api/auth/register",
		map[string]string{"email": "v@example.com", "password": "supersecret1"},
		nil,
	)

	// Account create missing required openingBalance -> 400 validation.
	rec := client.do("POST", "/api/accounts", map[string]any{"name": "X", "currency": "USD"}, nil)
	assert.Equal(t, 400, rec.Code, rec.Body.String())
}
