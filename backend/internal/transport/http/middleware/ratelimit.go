package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/yurifa/trata/backend/internal/transport/http/httperr"
)

type attemptInfo struct {
	count       int
	lockedUntil time.Time
}

// FailureRateLimiter throttles failed attempts per key (ClientIP). After
// maxAttempts failures the key is locked for lockoutDuration; a success resets
// the counter.
type FailureRateLimiter struct {
	mu              sync.Mutex
	attempts        map[string]*attemptInfo
	maxAttempts     int
	lockoutDuration time.Duration
}

func NewFailureRateLimiter(maxAttempts int, lockoutDuration time.Duration) *FailureRateLimiter {
	return &FailureRateLimiter{
		attempts:        make(map[string]*attemptInfo),
		maxAttempts:     maxAttempts,
		lockoutDuration: lockoutDuration,
	}
}

func (rl *FailureRateLimiter) IsLocked(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	a, exists := rl.attempts[key]
	if !exists {
		return false
	}
	return time.Now().Before(a.lockedUntil)
}

func (rl *FailureRateLimiter) RetryAfter(key string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	a, exists := rl.attempts[key]
	if !exists {
		return 0
	}
	remaining := time.Until(a.lockedUntil)
	if remaining <= 0 {
		return 0
	}
	return int(remaining.Seconds())
}

func (rl *FailureRateLimiter) RecordFailure(key string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	a, exists := rl.attempts[key]
	if !exists {
		a = &attemptInfo{}
		rl.attempts[key] = a
	}
	a.count++
	if a.count >= rl.maxAttempts {
		a.lockedUntil = time.Now().Add(rl.lockoutDuration)
		a.count = 0
	}
}

func (rl *FailureRateLimiter) RecordSuccess(key string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.attempts, key)
}

// RateLimit throttles failed attempts per client IP. Attach only to routes
// where 2xx genuinely means the client succeeded at a sensitive action.
func RateLimit(rl *FailureRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if rl.IsLocked(key) {
			if retry := rl.RetryAfter(key); retry > 0 {
				c.Header("Retry-After", strconv.Itoa(retry))
			}
			httperr.Write(c, http.StatusTooManyRequests, httperr.ErrCodeTooManyRequests,
				"too many failed attempts, please try again later")
			return
		}

		c.Next()

		status := c.Writer.Status()
		switch {
		case status == http.StatusUnauthorized || status == http.StatusForbidden:
			rl.RecordFailure(key)
		case status >= http.StatusOK && status < http.StatusMultipleChoices:
			rl.RecordSuccess(key)
		}
	}
}

// AttemptRateLimiter throttles ALL attempts per key (ClientIP) — successful or
// not. It is the sibling of FailureRateLimiter for endpoints where the attempt
// itself is the abuse surface (e.g. registration: account creation is the
// abuse, not the failure). After maxAttempts the key is locked for
// lockoutDuration; the budget then resets.
type AttemptRateLimiter struct {
	mu              sync.Mutex
	attempts        map[string]*attemptInfo
	maxAttempts     int
	lockoutDuration time.Duration
}

func NewAttemptRateLimiter(maxAttempts int, lockoutDuration time.Duration) *AttemptRateLimiter {
	return &AttemptRateLimiter{
		attempts:        make(map[string]*attemptInfo),
		maxAttempts:     maxAttempts,
		lockoutDuration: lockoutDuration,
	}
}

func (rl *AttemptRateLimiter) IsLocked(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	a, exists := rl.attempts[key]
	if !exists {
		return false
	}
	return time.Now().Before(a.lockedUntil)
}

func (rl *AttemptRateLimiter) RetryAfter(key string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	a, exists := rl.attempts[key]
	if !exists {
		return 0
	}
	remaining := time.Until(a.lockedUntil)
	if remaining <= 0 {
		return 0
	}
	return int(remaining.Seconds())
}

// RecordAttempt counts one attempt regardless of outcome and locks the key for
// lockoutDuration once the budget is spent.
func (rl *AttemptRateLimiter) RecordAttempt(key string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	a, exists := rl.attempts[key]
	if !exists {
		a = &attemptInfo{}
		rl.attempts[key] = a
	}
	a.count++
	if a.count >= rl.maxAttempts {
		a.lockedUntil = time.Now().Add(rl.lockoutDuration)
		a.count = 0
	}
}

// AttemptRateLimit throttles every attempt per client IP, counting the attempt
// before it runs. code/message parameterize the rejection so the wrapper stays
// endpoint-agnostic.
func AttemptRateLimit(rl *AttemptRateLimiter, code, message string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if rl.IsLocked(key) {
			if retry := rl.RetryAfter(key); retry > 0 {
				c.Header("Retry-After", strconv.Itoa(retry))
			}
			httperr.Write(c, http.StatusTooManyRequests, code, message)
			return
		}
		rl.RecordAttempt(key)
		c.Next()
	}
}
