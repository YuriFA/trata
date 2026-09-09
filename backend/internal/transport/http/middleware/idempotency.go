package middleware

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/logger"
	"github.com/yurifa/trata/backend/internal/repository"
	"github.com/yurifa/trata/backend/internal/transport/http/httpctx"
	"github.com/yurifa/trata/backend/internal/transport/http/httperr"
)

type bodyRecorder struct {
	gin.ResponseWriter

	body *bytes.Buffer
}

const (
	pendingStaleThreshold = 5 * time.Minute
	idempotencyKeyTTL     = 24 * time.Hour
)

func (r *bodyRecorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

func isPendingStale(createdAt time.Time) bool {
	return time.Since(createdAt) > pendingStaleThreshold
}

// Idempotency caches POST responses keyed by (user_id, Idempotency-Key) so a
// retried request replays the original response. Backed by IdempotencyRepository.
func Idempotency(repo repository.IdempotencyRepository, log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		log := log.With(
			slog.String("op", "transport.http.middleware.Idempotency"),
			slog.String("request_id", httpctx.RequestID(c)),
		)

		key := c.GetHeader("Idempotency-Key")
		if key == "" {
			httperr.Write(c, http.StatusBadRequest, httperr.ErrCodeIdempotencyKeyMissing, "missing idempotency key")
			return
		}

		user := httpctx.CurrentUser(c)
		if user == nil {
			httperr.Write(c, http.StatusUnauthorized, httperr.ErrCodeUnauthorized, "missing session cookie")
			return
		}

		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			httperr.Write(c, http.StatusBadRequest, httperr.ErrCodeInvalidRequest, "failed to read request body")
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		sum := sha256.Sum256(bodyBytes)
		hashStr := hex.EncodeToString(sum[:])

		ik, err := repo.CreateIdempotencyKey(c.Request.Context(), domain.CreateIdempotencyKeyParams{
			IdempotencyKey: key,
			UserID:         user.ID,
			RequestHash:    hashStr,
			ExpiresAt:      time.Now().UTC().Add(idempotencyKeyTTL),
		})
		if err == nil {
			rec := &bodyRecorder{ResponseWriter: c.Writer, body: &bytes.Buffer{}}
			c.Writer = rec
			c.Next()
			persistResponse(c.Request.Context(), repo, log, ik.ID, user.ID, rec)
			return
		}

		if !errors.Is(err, domain.ErrIdempotencyKeyInUse) {
			log.Info("failed to create idempotency key", logger.Error(err))
			httperr.Write(c, http.StatusInternalServerError, httperr.ErrCodeInternal, "internal server error")
			return
		}

		existing, gerr := repo.GetByUserAndKey(c.Request.Context(), user.ID, key)
		if gerr == nil && dispatchExisting(c, repo, log, existing, user.ID, hashStr) {
			return
		}
		httperr.Write(c, http.StatusConflict, httperr.ErrCodeIdempotencyKeyInUse, "idempotency key already used")
	}
}

func dispatchExisting(
	c *gin.Context,
	repo repository.IdempotencyRepository,
	_ *slog.Logger,
	ik *domain.IdempotencyKey,
	userID uuid.UUID,
	hashStr string,
) bool {
	if ik.ExpiresAt.Before(time.Now().UTC()) {
		_ = repo.DeleteIdempotencyKey(c.Request.Context(), userID, ik.ID)
		return false
	}

	switch ik.Status {
	case "pending":
		if isPendingStale(ik.CreatedAt) {
			_ = repo.DeleteIdempotencyKey(c.Request.Context(), userID, ik.ID)
			return false
		}
		httperr.Write(c, http.StatusConflict, httperr.ErrCodeIdempotencyKeyInUse, "idempotency key already used")
		return true
	case "completed":
		if hashStr != ik.RequestHash {
			httperr.Write(
				c,
				http.StatusConflict,
				httperr.ErrCodeIdempotencyKeyMismatch,
				"idempotency key request hash mismatch",
			)
			return true
		}
		replayResponse(c, ik)
		c.Abort()
		return true
	case "failed":
		_ = repo.DeleteIdempotencyKey(c.Request.Context(), userID, ik.ID)
		return false
	}
	return false
}

func replayResponse(c *gin.Context, ik *domain.IdempotencyKey) {
	if ik.ResponseHeaders != nil {
		var headers http.Header
		if err := json.Unmarshal([]byte(*ik.ResponseHeaders), &headers); err == nil {
			for k, vs := range headers {
				for _, v := range vs {
					c.Writer.Header().Add(k, v)
				}
			}
		}
	}
	status := http.StatusOK
	if ik.ResponseStatus != nil {
		status = *ik.ResponseStatus
	}
	c.Data(status, "", ik.ResponseBody)
}

func persistResponse(
	ctx context.Context,
	repo repository.IdempotencyRepository,
	l *slog.Logger,
	ikID uuid.UUID,
	userID uuid.UUID,
	rec *bodyRecorder,
) {
	resStatus := rec.Status()
	resBody := rec.body.Bytes()
	filtered := filterResponseHeaders(rec.Header())
	jsonHeaders, err := json.Marshal(filtered)
	if err != nil {
		l.InfoContext(ctx, "failed to marshal response headers", logger.Error(err))
		return
	}

	status := "completed"
	if resStatus >= http.StatusBadRequest {
		status = "failed"
	}
	headersStr := string(jsonHeaders)
	if _, err := repo.UpdateIdempotencyKey(ctx, userID, ikID, domain.UpdateIdempotencyKeyParams{
		Status:          &status,
		ResponseStatus:  &resStatus,
		ResponseHeaders: &headersStr,
		ResponseBody:    resBody,
	}); err != nil {
		l.InfoContext(ctx, "failed to update idempotency key", logger.Error(err))
	}
}

func filterResponseHeaders(h http.Header) http.Header {
	out := h.Clone()
	for k := range out {
		switch k {
		case "Content-Type", "Content-Length", "Location":
		default:
			out.Del(k)
		}
	}
	return out
}
