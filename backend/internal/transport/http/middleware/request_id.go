package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/transport/http/keys"
)

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader(keys.RequestIDHeader)

		if rid == "" {
			rid = uuid.NewString()
			c.Request.Header.Set(keys.RequestIDHeader, rid)
		} else if err := uuid.Validate(rid); err != nil {
			rid = uuid.NewString()
			c.Request.Header.Set(keys.RequestIDHeader, rid)
		}
		c.Header(keys.RequestIDHeader, rid)
		c.Next()
	}
}
