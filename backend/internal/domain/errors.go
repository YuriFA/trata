package domain

import (
	"errors"
	"time"
)

// Auth/verification policy constants. Centralized here so services and the
// repository layer share one definition of the policy.
const (
	VerificationCodeTTL          = 10 * time.Minute
	MaxVerificationAttempts      = 5
	VerificationResendThrottle   = 60 * time.Second
	PasswordResetTokenTTL        = 15 * time.Minute
	PasswordResetRequestThrottle = 60 * time.Second
)

// Sentinel domain errors. Services return these; the transport layer maps them
// to HTTP status + code in one central place (transport/http/errormap.go).
//
// Note on the ACCOUNT_NOT_FOUND duality: ErrAccountNotFound is 404 when an
// account is fetched by id, but 422 when an account is referenced as an FK
// inside a transaction. The transaction-FK case uses distinct errors below
// (ErrTransactionAccountNotFound / ErrTransactionFromAccountNotFound /
// ErrTransactionToAccountNotFound) so the mapper stays a pure 1:1 function.
var (
	ErrUserNotFound                       = errors.New("user not found")
	ErrUserAlreadyExists                  = errors.New("user already exists")
	ErrSessionNotFound                    = errors.New("session not found")
	ErrSessionExpired                     = errors.New("session expired")
	ErrAccountNotFound                    = errors.New("account not found")
	ErrAccountAlreadyExists               = errors.New("account already exists")
	ErrAccountVersionConflict             = errors.New("account version conflict")
	ErrCategoryNotFound                   = errors.New("category not found")
	ErrCategoryAlreadyExists              = errors.New("category already exists")
	ErrCategoryVersionConflict            = errors.New("category version conflict")
	ErrCategoryTypeMismatch               = errors.New("category type mismatch")
	ErrTransactionNotFound                = errors.New("transaction not found")
	ErrTransactionAlreadyExists           = errors.New("transaction already exists")
	ErrTransactionVersionConflict         = errors.New("transaction version conflict")
	ErrAccountHasTransactions             = errors.New("account has transactions and cannot be deleted")
	ErrCategoryHasTransactions            = errors.New("category has transactions and cannot be deleted")
	ErrRecordDeleted                      = errors.New("record is deleted on the server")
	ErrSyncOpIDReused                     = errors.New("sync operation id reused for a different operation")
	ErrInvalidRefs                        = errors.New("invalid references in transaction")
	ErrInvalidAmount                      = errors.New("invalid transaction amount")
	ErrSameAccountTransfer                = errors.New("transfer cannot be made to the same account")
	ErrTransactionTypeImmutable           = errors.New("transaction type is immutable")
	ErrTransactionAccountNotFound         = errors.New("transaction references an account that does not exist")
	ErrTransactionCategoryNotFound        = errors.New("transaction references a category that does not exist")
	ErrTransactionFromAccountNotFound     = errors.New("transaction references a from-account that does not exist")
	ErrTransactionToAccountNotFound       = errors.New("transaction references a to-account that does not exist")
	ErrDebtorNotFound                     = errors.New("debtor not found")
	ErrDebtorAlreadyExists                = errors.New("debtor already exists")
	ErrDebtorVersionConflict              = errors.New("debtor version conflict")
	ErrDebtorHasOperations                = errors.New("debtor has debt operations and cannot be deleted")
	ErrDebtOperationNotFound              = errors.New("debt operation not found")
	ErrDebtOperationAlreadyExists         = errors.New("debt operation already exists")
	ErrDebtOperationVersionConflict       = errors.New("debt operation version conflict")
	ErrDebtOperationDebtorNotFound        = errors.New("debt operation references a debtor that does not exist")
	ErrDebtOperationImmutable             = errors.New("debt operation debtor, direction, and kind are immutable")
	ErrPlannedPaymentNotFound             = errors.New("planned payment not found")
	ErrPlannedPaymentAlreadyExists        = errors.New("planned payment already exists")
	ErrPlannedPaymentVersionConflict      = errors.New("planned payment version conflict")
	ErrPlannedPaymentAccountNotFound      = errors.New("planned payment references an account that does not exist")
	ErrPlannedPaymentCategoryNotFound     = errors.New("planned payment references a category that does not exist")
	ErrPlannedPaymentCategoryTypeMismatch = errors.New("planned payment category type does not match the plan type")
	ErrCategoryArchived                   = errors.New("category is archived and not available for new transactions")
	ErrPlannedPaymentCategoryArchived     = errors.New("planned payment category is archived")
	ErrPlannedPaymentTypeImmutable        = errors.New("planned payment type is immutable")
	ErrPushSubscriptionNotFound           = errors.New("push subscription not found")
	ErrPushSubscriptionTimezoneInvalid    = errors.New("push subscription timezone is not a known IANA zone")
	ErrAccountHasPlannedPayments          = errors.New("account has planned payments and cannot be deleted")
	ErrCategoryHasPlannedPayments         = errors.New("category has planned payments and cannot be deleted")
	ErrInvalidDate                        = errors.New("date must be YYYY-MM-DD")
	ErrIdempotencyKeyNotFound             = errors.New("idempotency key not found")
	ErrIdempotencyKeyInUse                = errors.New("idempotency key is already in use")
	ErrVerificationCodeNotFound           = errors.New("verification code not found")
	ErrVerificationCodeExpired            = errors.New("verification code expired")
	ErrInvalidVerificationCode            = errors.New("invalid verification code")
	ErrPasswordResetTokenNotFound         = errors.New("password reset token not found")
	ErrEmailAlreadyVerified               = errors.New("email already verified")
	ErrInvalidCredentials                 = errors.New("invalid credentials")
	ErrHouseholdNotFound                  = errors.New("household not found")
	ErrMembershipNotFound                 = errors.New("user has no household membership")
	ErrInvalidDisplayName                 = errors.New("display name must be 1-100 characters after trimming")

	// ErrHouseholdOwnerRequired and the sentinels below it carry the
	// household join lifecycle (household-join change): invitations, home
	// code, membership moves, dissolution.
	ErrHouseholdOwnerRequired           = errors.New("only the household owner may perform this action")
	ErrInvitationNotFound               = errors.New("household invitation not found")
	ErrInvitationEmailMismatch          = errors.New("invitation was sent to a different email address")
	ErrInvitationExpired                = errors.New("household invitation expired")
	ErrInvitationRevoked                = errors.New("household invitation revoked")
	ErrInvitationAlreadyAccepted        = errors.New("household invitation already accepted")
	ErrInvitationAlreadyMember          = errors.New("email is already a member of the household")
	ErrInvitationRateLimited            = errors.New("household invitation rate limit exceeded")
	ErrHouseholdCodeInvalid             = errors.New("unknown or revoked household code")
	ErrHouseholdOwnerWithMembers        = errors.New("the owner cannot leave a household with other members")
	ErrHouseholdMemberNotFound          = errors.New("household member not found")
	ErrHouseholdMemberIsOwner           = errors.New("the owner cannot be removed from the household")
	ErrHouseholdDissolveConfirmRequired = errors.New("household dissolution requires an explicit confirm")
	ErrUnknownSyncEntity                = errors.New("unknown sync entity kind")

	// ErrNoFieldsToUpdate and ErrInvalidCursor are request-shape errors of
	// the PATCH services / list endpoints. They live here (not in service)
	// because they carry wire specs in errorSpecs like every sentinel; the
	// service package keeps aliases for its callers and tests.
	ErrNoFieldsToUpdate = errors.New("no fields to update")
	ErrInvalidCursor    = errors.New("invalid cursor")
)
