package http

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	ginmiddleware "github.com/oapi-codegen/gin-middleware"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/config"
	"github.com/yurifa/trata/backend/internal/repository"
	"github.com/yurifa/trata/backend/internal/transport/http/httperr"
	"github.com/yurifa/trata/backend/internal/transport/http/middleware"
)

const corsMaxAge = 12 * time.Hour

// NewEngine builds the gin engine, wires middleware (request-id, recovery,
// logging, CSRF origin check, CORS, spec-driven request validation, auth,
// rate limit, idempotency) and registers the generated handlers backed by the
// StrictServerInterface.
func NewEngine(
	cfg *config.HTTPServer,
	log *slog.Logger,
	ssi api.StrictServerInterface,
	sessions repository.SessionRepository,
	users repository.UserRepository,
	households repository.HouseholdRepository,
	idempotency repository.IdempotencyRepository,
) *gin.Engine {
	router := gin.New()
	if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		panic("failed to set trusted proxies: " + err.Error())
	}

	// ADR-0001 (docs/adr/0001-auth-csrf-threat-model.md): the Origin/CORS
	// allowlist is the CSRF correctness dependency — explicit origins only.
	// Wildcard/empty origins are forbidden while credentials are enabled:
	// browsers reject credentialed wildcards, so fail fast instead.
	for _, origin := range cfg.CorsConfig.AllowedOrigins {
		if origin == "*" || origin == "" {
			panic("forbidden cors allowed origin " + origin + ": explicit origins only (ADR-0001)")
		}
	}

	router.Use(middleware.RequestID())
	router.Use(gin.Recovery())
	router.Use(middleware.SlogLogger(log))

	// ADR-0001 server-side CSRF control: browsers always send Origin on
	// cross-site mutations, so any non-GET request with a foreign Origin is
	// rejected with 403 ORIGIN_REJECTED before any state change. Mounted
	// BEFORE the CORS middleware: gin-contrib/cors pre-empts disallowed
	// origins with a bare 403, which would hide the machine code clients
	// switch on (spec: api-hardening).
	router.Use(middleware.OriginCheck(cfg.CorsConfig.AllowedOrigins, log))

	router.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsConfig.AllowedOrigins,
		AllowMethods:     cfg.CorsConfig.AllowedMethods,
		AllowHeaders:     cfg.CorsConfig.AllowedHeaders,
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           corsMaxAge,
	}))

	// API docs: served from the embedded spec (the same copy that powers
	// runtime validation), so the routes work from any working directory
	// and can never drift from the contract. Registered BEFORE the
	// spec-validation middleware — /docs is deliberately not part of the
	// OpenAPI contract, so the validator would 404 it.
	router.GET("/docs", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(redocShell))
	})
	router.GET("/docs/openapi.json", func(c *gin.Context) {
		spec, err := api.GetSpecJSON()
		if err != nil {
			httperr.Write(c, http.StatusInternalServerError, httperr.ErrCodeInternal, "failed to serialize spec")
			return
		}
		c.Data(http.StatusOK, "application/json", spec)
	})

	// Spec-driven request validation (path/query/header params + request body)
	// via the embedded OpenAPI document. Auth is NOT enforced here (see below).
	swagger, err := api.GetSpec()
	if err != nil {
		panic("failed to load embedded spec: " + err.Error())
	}
	swagger.Servers = nil // accept any host
	router.Use(ginmiddleware.OapiRequestValidatorWithOptions(swagger, &ginmiddleware.Options{
		ErrorHandler: validationErrorHandler,
		Options: openapi3filter.Options{
			AuthenticationFunc: func(_ context.Context, _ *openapi3filter.AuthenticationInput) error {
				return nil
			},
		},
	}))

	// Auth (path-aware), rate limit (login + verify failure-based, register
	// count-all-attempts), idempotency (create txn).
	publicRoutes := publicRouteSet()
	router.Use(pathAwareAuth(sessions, users, households, log, cfg, publicRoutes))
	loginRL := middleware.NewFailureRateLimiter(cfg.FailureRateLimit.MaxAttempts, cfg.FailureRateLimit.LockoutDuration)
	verifyRL := middleware.NewFailureRateLimiter(cfg.FailureRateLimit.MaxAttempts, cfg.FailureRateLimit.LockoutDuration)
	registerRL := middleware.NewAttemptRateLimiter(
		cfg.RegisterRateLimit.MaxAttempts, cfg.RegisterRateLimit.LockoutDuration,
	)
	router.Use(pathAwareRateLimit(map[string]gin.HandlerFunc{
		"POST:/api/auth/login":        middleware.RateLimit(loginRL),
		"POST:/api/auth/verify-email": middleware.RateLimit(verifyRL),
		"POST:/api/auth/register": middleware.AttemptRateLimit(
			registerRL,
			httperr.ErrCodeRegisterRateLimited,
			"too many registration attempts, please try again later",
		),
	}))
	router.Use(pathAwareIdempotency(idempotency, log))

	// Strict handlers return (ResponseObject, error); on error the central
	// domain-error -> HTTP mapper writes the response (see writeDomainError).
	strictHandler := api.NewStrictHandlerWithOptions(ssi, nil, api.StrictGinServerOptions{
		HandlerErrorFunc: func(c *gin.Context, err error) { writeDomainError(c, log, err) },
	})
	api.RegisterHandlers(router, strictHandler)

	return router
}

// validationErrorHandler maps the spec validator's failures to the project's
// VALIDATION_FAILED response shape.
func validationErrorHandler(c *gin.Context, message string, statusCode int) {
	httperr.Write(c, statusCode, httperr.ErrCodeValidationFailed, message)
}

// publicRouteSet returns the routes callable WITHOUT a valid session cookie
// (security: [] plus logout, which is idempotent and clears the cookie).
func publicRouteSet() map[string]bool {
	return map[string]bool{
		"GET:/api/health":                       true,
		"POST:/api/auth/register":               true,
		"POST:/api/auth/login":                  true,
		"POST:/api/auth/logout":                 true,
		"POST:/api/auth/password-reset/request": true,
		"POST:/api/auth/password-reset/confirm": true,
	}
}

func pathAwareAuth(
	sessions repository.SessionRepository,
	users repository.UserRepository,
	households repository.HouseholdRepository,
	log *slog.Logger,
	cfg *config.HTTPServer,
	publicRoutes map[string]bool,
) gin.HandlerFunc {
	inner := middleware.AuthRequired(sessions, users, households, log, cfg)
	return func(c *gin.Context) {
		if isPublic(c, publicRoutes) || !strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.Next()
			return
		}
		inner(c)
	}
}

func isPublic(c *gin.Context, publicRoutes map[string]bool) bool {
	return publicRoutes[c.Request.Method+":"+c.Request.URL.Path]
}

// pathAwareRateLimit dispatches to the per-path limiter handler; the map mixes
// limiter kinds (failure-counting for login/verify, count-all-attempts for
// register), each entry carrying its own rejection shape.
func pathAwareRateLimit(limiters map[string]gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		rl, ok := limiters[c.Request.Method+":"+c.Request.URL.Path]
		if !ok {
			c.Next()
			return
		}
		rl(c)
	}
}

func pathAwareIdempotency(repo repository.IdempotencyRepository, log *slog.Logger) gin.HandlerFunc {
	inner := middleware.Idempotency(repo, log)
	return func(c *gin.Context) {
		if c.Request.Method+":"+c.Request.URL.Path != "POST:/api/transactions" {
			c.Next()
			return
		}
		inner(c)
	}
}
