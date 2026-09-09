package middleware

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/yurifa/trata/backend/internal/config"
	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
	"github.com/yurifa/trata/backend/internal/transport/http/cookie"
	"github.com/yurifa/trata/backend/internal/transport/http/httpctx"
	"github.com/yurifa/trata/backend/internal/transport/http/httperr"
	"github.com/yurifa/trata/backend/internal/transport/http/keys"
)

// AuthRequired validates the session_id cookie against the SessionRepository,
// loads the user, resolves the user's (single, v1) household membership,
// applies sliding expiration, and stores the user + household id + session id
// in the gin context for handlers. A user without a membership is a violated
// data invariant (every user owns exactly one household), not an auth failure:
// it surfaces as 500 so it is logged and noticed.
func AuthRequired(
	sessions repository.SessionRepository,
	users repository.UserRepository,
	households repository.HouseholdRepository,
	log *slog.Logger,
	cfg *config.HTTPServer,
) gin.HandlerFunc {
	op := "transport.http.middleware.AuthRequired"

	return func(c *gin.Context) {
		log := log.With(
			slog.String("op", op),
			slog.String("request_id", httpctx.RequestID(c)),
		)

		cookieVal, err := c.Request.Cookie(cfg.SessionConfig.CookieName)
		if err != nil {
			httperr.Write(c, http.StatusUnauthorized, httperr.ErrCodeUnauthorized, "missing session cookie")
			return
		}

		session, err := sessions.GetSessionByID(c.Request.Context(), cookieVal.Value)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound) {
				log.Info("invalid or expired session")
				httperr.Write(c, http.StatusUnauthorized, httperr.ErrCodeUnauthorized, "invalid or expired session")
				return
			}
			log.Error("failed to get session by id", slog.String("error", err.Error()))
			httperr.Write(c, http.StatusInternalServerError, httperr.ErrCodeInternal, "internal server error")
			return
		}

		user, err := users.GetUserByID(c.Request.Context(), session.UserID)
		if err != nil {
			log.Error("failed to get user by id", slog.String("error", err.Error()))
			httperr.Write(c, http.StatusUnauthorized, httperr.ErrCodeUnauthorized, "invalid or expired session")
			return
		}

		membership, err := households.GetMembershipByUser(c.Request.Context(), user.ID)
		if err != nil {
			log.Error("failed to resolve household membership", slog.String("error", err.Error()))
			httperr.Write(c, http.StatusInternalServerError, httperr.ErrCodeInternal, "internal server error")
			return
		}

		// Sliding expiration: extend if < 25% of the TTL remains.
		if cfg.SessionConfig.SlidingExpiration && time.Until(session.ExpiresAt) < cfg.SessionConfig.TTL/4 {
			newExpiresAt := time.Now().UTC().Add(cfg.SessionConfig.TTL)
			if err := sessions.ExtendSession(c.Request.Context(), session.ID, newExpiresAt); err != nil {
				log.Error("failed to extend session", slog.String("error", err.Error()))
				httperr.Write(c, http.StatusInternalServerError, httperr.ErrCodeInternal, "internal server error")
				return
			}
			c.SetCookieData(cookie.BuildSession(cfg.SessionConfig, session.ID, int(cfg.SessionConfig.TTL.Seconds())))
		}

		c.Set(keys.CurrentUserKey, user)
		c.Set(keys.CurrentSessionIDKey, session.ID)
		c.Set(keys.CurrentHouseholdKey, membership.HouseholdID)
		c.Set(keys.CurrentHouseholdRoleKey, membership.Role)
		c.Next()
	}
}
