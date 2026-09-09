package middleware

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yurifa/trata/backend/internal/transport/http/httperr"
)

// OriginCheck enforces the ADR-0001 server-side CSRF control: a browser may
// only mutate state from an allowlisted origin. Any non-GET request whose
// Origin header is present and not an exact member of the allowlist is
// rejected with 403 ORIGIN_REJECTED before any state change. Requests without
// Origin (native clients, tests) and GET requests pass through untouched.
func OriginCheck(allowedOrigins []string, log *slog.Logger) gin.HandlerFunc {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		// Wildcard/empty entries match nothing: credentialed CORS requires
		// explicit origins (ADR-0001 finding A6). Fail closed, loudly.
		if origin == "*" || origin == "" {
			log.Warn(
				"origin check: wildcard/empty entry in allowed origins matches nothing; "+
					"configure explicit origins (ADR-0001)",
				slog.String("origin", origin),
			)
			continue
		}
		allowed[origin] = true
	}

	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet {
			c.Next()
			return
		}
		origin := c.Request.Header.Get("Origin")
		if origin == "" || allowed[origin] {
			c.Next()
			return
		}
		httperr.Write(c, http.StatusForbidden, httperr.ErrCodeOriginRejected, "request origin is not allowed")
	}
}
