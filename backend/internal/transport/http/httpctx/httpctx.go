// Package httpctx provides typed accessors for request-scoped values set by
// middleware (the authenticated user, the current session id, the request id).
package httpctx

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/transport/http/keys"
)

// CurrentUser returns the authenticated user set by the auth middleware, or nil.
func CurrentUser(c *gin.Context) *domain.User {
	val, exists := c.Get(keys.CurrentUserKey)
	if !exists {
		return nil
	}
	user, ok := val.(*domain.User)
	if !ok {
		return nil
	}
	return user
}

// CurrentSessionID returns the current session id set by the auth middleware.
func CurrentSessionID(c *gin.Context) string {
	return c.GetString(keys.CurrentSessionIDKey)
}

// CurrentHouseholdID returns the household id of the user's (single, v1)
// membership, resolved by the auth middleware. It panics only if the auth
// middleware did not run (a programming error on a protected route).
func CurrentHouseholdID(c *gin.Context) uuid.UUID {
	val, exists := c.Get(keys.CurrentHouseholdKey)
	if !exists {
		return uuid.Nil
	}
	id, ok := val.(uuid.UUID)
	if !ok {
		return uuid.Nil
	}
	return id
}

// CurrentHouseholdRole returns the requester's role in their (single, v1)
// household, resolved by the auth middleware ("" only if the middleware did
// not run).
func CurrentHouseholdRole(c *gin.Context) domain.HouseholdRole {
	val, exists := c.Get(keys.CurrentHouseholdRoleKey)
	if !exists {
		return ""
	}
	role, ok := val.(domain.HouseholdRole)
	if !ok {
		return ""
	}
	return role
}

// RequestID returns the X-Request-ID for the request.
func RequestID(c *gin.Context) string {
	return c.GetHeader(keys.RequestIDHeader)
}
