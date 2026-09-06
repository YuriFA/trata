package http

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/yurifa/expense-tracker-api/internal/domain"
	"github.com/yurifa/expense-tracker-api/internal/logger"
	"github.com/yurifa/expense-tracker-api/internal/service"
	"github.com/yurifa/expense-tracker-api/internal/transport/http/httperr"
)

// writeDomainError is the ONE central domain-error -> HTTP mapper, wired in as
// the oapi-codegen HandlerErrorFunc (see NewEngine). Handlers therefore just
// `return nil, err`: this place decides the HTTP status, and the machine code
// + message come from the domain wire-spec table (domain.ErrorSpecFor), which
// the sync push results share.
func writeDomainError(c *gin.Context, log *slog.Logger, err error) {
	// Throttle is a wrapped error type (not a sentinel): it needs a Retry-After
	// header, so handle it before the table lookups.
	var throttle *service.ThrottleError
	if errors.As(err, &throttle) {
		c.Header("Retry-After", strconv.Itoa(throttle.RetryAfterSeconds))
		httperr.Write(
			c,
			http.StatusTooManyRequests,
			httperr.ErrCodeTooManyRequests,
			"please wait before requesting a new code",
		)
		return
	}

	for sentinel, status := range domainErrorStatus {
		if errors.Is(err, sentinel) {
			if spec, ok := domain.ErrorSpecFor(err); ok {
				httperr.Write(c, status, spec.Code, spec.Message)
				return
			}
			break
		}
	}

	log.Error("unhandled domain error", logger.Error(err))
	httperr.Write(c, http.StatusInternalServerError, httperr.ErrCodeInternal, "internal server error")
}

// domainErrorStatus is the sentinel -> HTTP status mapping: the transport's
// only share of the domain error surface. Codes and messages live in
// domain.errorSpecs; every sentinel here must also have a spec row (guarded
// by TestDomainErrorStatusCoverage).
//
// Nuance preserved: ErrAccountNotFound is 404 when an account is fetched by
// id, but the transaction-FK case uses DISTINCT errors
// (ErrTransactionAccountNotFound / ErrTransactionFromAccountNotFound /
// ErrTransactionToAccountNotFound) that map to 422, so this table stays a
// pure 1:1 mapping.
//
//nolint:gochecknoglobals // immutable lookup table; the idiomatic home for constant dispatch data
var domainErrorStatus = map[error]int{
	// --- resource not found by id ---
	domain.ErrAccountNotFound:        http.StatusNotFound,
	domain.ErrCategoryNotFound:       http.StatusNotFound,
	domain.ErrTransactionNotFound:    http.StatusNotFound,
	domain.ErrDebtorNotFound:         http.StatusNotFound,
	domain.ErrDebtOperationNotFound:  http.StatusNotFound,
	domain.ErrPlannedPaymentNotFound: http.StatusNotFound,

	// --- push subscriptions (web-push change) ---
	domain.ErrPushSubscriptionNotFound:        http.StatusNotFound,
	domain.ErrPushSubscriptionTimezoneInvalid: http.StatusUnprocessableEntity,

	// --- conflict ---
	domain.ErrUserAlreadyExists:             http.StatusConflict,
	domain.ErrCategoryAlreadyExists:         http.StatusConflict,
	domain.ErrAccountAlreadyExists:          http.StatusConflict,
	domain.ErrTransactionAlreadyExists:      http.StatusConflict,
	domain.ErrDebtorAlreadyExists:           http.StatusConflict,
	domain.ErrDebtOperationAlreadyExists:    http.StatusConflict,
	domain.ErrPlannedPaymentAlreadyExists:   http.StatusConflict,
	domain.ErrAccountVersionConflict:        http.StatusConflict,
	domain.ErrCategoryVersionConflict:       http.StatusConflict,
	domain.ErrTransactionVersionConflict:    http.StatusConflict,
	domain.ErrDebtorVersionConflict:         http.StatusConflict,
	domain.ErrDebtOperationVersionConflict:  http.StatusConflict,
	domain.ErrPlannedPaymentVersionConflict: http.StatusConflict,
	domain.ErrAccountHasTransactions:        http.StatusConflict,
	domain.ErrCategoryHasTransactions:       http.StatusConflict,
	domain.ErrDebtorHasOperations:           http.StatusConflict,
	domain.ErrAccountHasPlannedPayments:     http.StatusConflict,
	domain.ErrCategoryHasPlannedPayments:    http.StatusConflict,
	domain.ErrEmailAlreadyVerified:          http.StatusConflict,

	// --- auth ---
	domain.ErrInvalidCredentials:      http.StatusUnauthorized,
	domain.ErrInvalidVerificationCode: http.StatusForbidden,

	// --- verification / password-reset code states ---
	domain.ErrPasswordResetTokenNotFound: http.StatusBadRequest,
	domain.ErrVerificationCodeExpired:    http.StatusBadRequest,
	domain.ErrVerificationCodeNotFound:   http.StatusBadRequest,

	// --- transaction business-rule violations ---
	domain.ErrTransactionAccountNotFound:         http.StatusUnprocessableEntity,
	domain.ErrTransactionCategoryNotFound:        http.StatusUnprocessableEntity,
	domain.ErrTransactionFromAccountNotFound:     http.StatusUnprocessableEntity,
	domain.ErrTransactionToAccountNotFound:       http.StatusUnprocessableEntity,
	domain.ErrCategoryTypeMismatch:               http.StatusUnprocessableEntity,
	domain.ErrCategoryArchived:                   http.StatusUnprocessableEntity,
	domain.ErrSameAccountTransfer:                http.StatusUnprocessableEntity,
	domain.ErrTransactionTypeImmutable:           http.StatusUnprocessableEntity,
	domain.ErrDebtOperationDebtorNotFound:        http.StatusUnprocessableEntity,
	domain.ErrDebtOperationImmutable:             http.StatusUnprocessableEntity,
	domain.ErrPlannedPaymentAccountNotFound:      http.StatusUnprocessableEntity,
	domain.ErrPlannedPaymentCategoryNotFound:     http.StatusUnprocessableEntity,
	domain.ErrPlannedPaymentCategoryTypeMismatch: http.StatusUnprocessableEntity,
	domain.ErrPlannedPaymentCategoryArchived:     http.StatusUnprocessableEntity,
	domain.ErrPlannedPaymentTypeImmutable:        http.StatusUnprocessableEntity,
	domain.ErrInvalidRefs:                        http.StatusUnprocessableEntity,
	domain.ErrInvalidAmount:                      http.StatusUnprocessableEntity,

	// --- request shape ---
	domain.ErrInvalidDate:        http.StatusBadRequest,
	domain.ErrNoFieldsToUpdate:   http.StatusBadRequest,
	domain.ErrInvalidCursor:      http.StatusBadRequest,
	domain.ErrInvalidDisplayName: http.StatusBadRequest,

	// --- household / profile ---
	// The household endpoints operate on the middleware-resolved membership, so
	// a missing household/membership is a violated data invariant, not a client
	// error: it surfaces as 500 so it is logged and noticed.
	domain.ErrHouseholdNotFound:  http.StatusInternalServerError,
	domain.ErrMembershipNotFound: http.StatusInternalServerError,

	// --- household join lifecycle ---
	domain.ErrHouseholdOwnerRequired:           http.StatusForbidden,
	domain.ErrInvitationNotFound:               http.StatusNotFound,
	domain.ErrInvitationEmailMismatch:          http.StatusForbidden,
	domain.ErrInvitationExpired:                http.StatusBadRequest,
	domain.ErrInvitationRevoked:                http.StatusBadRequest,
	domain.ErrInvitationAlreadyAccepted:        http.StatusConflict,
	domain.ErrInvitationAlreadyMember:          http.StatusConflict,
	domain.ErrInvitationRateLimited:            http.StatusTooManyRequests,
	domain.ErrHouseholdCodeInvalid:             http.StatusBadRequest,
	domain.ErrHouseholdOwnerWithMembers:        http.StatusConflict,
	domain.ErrHouseholdMemberNotFound:          http.StatusNotFound,
	domain.ErrHouseholdMemberIsOwner:           http.StatusConflict,
	domain.ErrHouseholdDissolveConfirmRequired: http.StatusBadRequest,
}
