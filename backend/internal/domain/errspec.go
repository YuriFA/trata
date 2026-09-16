package domain

import "errors"

// ErrorSpec is the machine code + human message pair every sentinel domain
// error carries on every surface: REST ErrorResponse bodies (the values
// documented in openapi.yaml) and the per-item sync push results. The
// transport layer adds the HTTP status; the sync adapters return the same
// pair inside SyncPushResult. One table so the two surfaces can never drift.
type ErrorSpec struct {
	Code    string
	Message string
}

// ErrorSpecFor returns the wire spec of err. ok=false when err is not a
// known sentinel: REST answers 500 (and logs), sync falls back to its
// protocol-level generic result.
func ErrorSpecFor(err error) (ErrorSpec, bool) {
	for sentinel, spec := range errorSpecs {
		if errors.Is(err, sentinel) {
			return spec, true
		}
	}
	return ErrorSpec{}, false
}

// errorSpecs maps every sentinel error to its wire spec. Add a row when a
// new sentinel error gets a machine code; the values are the client-facing
// contract and are parity-checked against openapi.yaml `code:` examples by
// errspec_parity_test.go.
//
// Nuance preserved: ErrAccountNotFound is 404 when an account is fetched by
// id, but the transaction-FK case uses DISTINCT errors
// (ErrTransactionAccountNotFound / ErrTransactionFromAccountNotFound /
// ErrTransactionToAccountNotFound) whose specs carry the same
// ACCOUNT_NOT_FOUND code, so this table stays a pure 1:1 mapping and the
// transport status table decides 404 vs 422.
//
//nolint:gochecknoglobals // immutable lookup table; the idiomatic home for constant dispatch data
var errorSpecs = map[error]ErrorSpec{
	// --- resource not found by id ---
	ErrAccountNotFound:        {"ACCOUNT_NOT_FOUND", "account not found"},
	ErrCategoryNotFound:       {"CATEGORY_NOT_FOUND", "category not found"},
	ErrTransactionNotFound:    {"TRANSACTION_NOT_FOUND", "transaction not found"},
	ErrDebtorNotFound:         {"DEBTOR_NOT_FOUND", "debtor not found"},
	ErrDebtOperationNotFound:  {"DEBT_OPERATION_NOT_FOUND", "debt operation not found"},
	ErrPlannedPaymentNotFound: {"PLANNED_PAYMENT_NOT_FOUND", "planned payment not found"},

	// --- push subscriptions (web-push change) ---
	ErrPushSubscriptionNotFound: {
		"PUSH_SUBSCRIPTION_NOT_FOUND",
		"push subscription not found",
	},
	ErrPushSubscriptionTimezoneInvalid: {"PUSH_SUBSCRIPTION_TIMEZONE_INVALID", "unknown timezone"},

	// --- conflict ---
	ErrUserAlreadyExists:        {"USER_ALREADY_EXISTS", "user already exists"},
	ErrCategoryAlreadyExists:    {"CATEGORY_ALREADY_EXISTS", "category already exists"},
	ErrAccountAlreadyExists:     {"ACCOUNT_ALREADY_EXISTS", "account already exists"},
	ErrTransactionAlreadyExists: {"TRANSACTION_ALREADY_EXISTS", "transaction already exists"},
	ErrDebtorAlreadyExists:      {"DEBTOR_ALREADY_EXISTS", "debtor already exists"},
	ErrDebtOperationAlreadyExists: {
		"DEBT_OPERATION_ALREADY_EXISTS",
		"debt operation already exists",
	},
	ErrPlannedPaymentAlreadyExists: {
		"PLANNED_PAYMENT_ALREADY_EXISTS",
		"planned payment already exists",
	},
	ErrAccountVersionConflict: {
		"ACCOUNT_VERSION_CONFLICT",
		"account was modified by another request, please refetch and retry",
	},
	ErrCategoryVersionConflict: {
		"CATEGORY_VERSION_CONFLICT",
		"category was modified by another request, please refetch and retry",
	},
	ErrTransactionVersionConflict: {
		"TRANSACTION_VERSION_CONFLICT",
		"transaction was modified by another request, please refetch and retry",
	},
	ErrDebtorVersionConflict: {
		"DEBTOR_VERSION_CONFLICT",
		"debtor was modified by another request, please refetch and retry",
	},
	ErrDebtOperationVersionConflict: {
		"DEBT_OPERATION_VERSION_CONFLICT",
		"debt operation was modified by another request, please refetch and retry",
	},
	ErrPlannedPaymentVersionConflict: {
		"PLANNED_PAYMENT_VERSION_CONFLICT",
		"planned payment was modified by another request, please refetch and retry",
	},
	ErrAccountHasTransactions: {
		"ACCOUNT_IN_USE",
		"account has transactions and cannot be deleted",
	},
	ErrCategoryHasTransactions: {
		"CATEGORY_IN_USE",
		"category has transactions and cannot be deleted",
	},
	ErrAccountHasPlannedPayments: {
		"ACCOUNT_IN_USE",
		"account has planned payments and cannot be deleted",
	},
	ErrCategoryHasPlannedPayments: {
		"CATEGORY_IN_USE",
		"category has planned payments and cannot be deleted",
	},
	ErrEmailAlreadyVerified: {"EMAIL_ALREADY_VERIFIED", "email already verified"},

	// --- auth (401/403) ---
	ErrInvalidCredentials:      {"INVALID_CREDENTIALS", "invalid credentials"},
	ErrInvalidVerificationCode: {"INVALID_VERIFICATION_CODE", "invalid verification code"},

	// --- verification / password-reset code states ---
	ErrPasswordResetTokenNotFound: {
		"INVALID_PASSWORD_RESET_TOKEN",
		"invalid or expired reset token",
	},
	ErrVerificationCodeExpired: {
		"VERIFICATION_CODE_EXPIRED",
		"verification code expired, request a new one",
	},
	ErrVerificationCodeNotFound: {
		"VERIFICATION_CODE_NOT_FOUND",
		"no active verification code, request a new one",
	},

	// --- transaction business-rule violations ---
	ErrTransactionAccountNotFound: {"ACCOUNT_NOT_FOUND", "account not found"},
	ErrTransactionCategoryNotFound: {
		"CATEGORY_NOT_FOUND",
		"category not found",
	},
	ErrTransactionFromAccountNotFound: {"ACCOUNT_NOT_FOUND", "account not found"},
	ErrTransactionToAccountNotFound:   {"ACCOUNT_NOT_FOUND", "account not found"},
	ErrCategoryTypeMismatch: {
		"CATEGORY_TYPE_MISMATCH",
		"transaction type does not match category type",
	},
	ErrCategoryArchived: {
		"CATEGORY_ARCHIVED",
		"category is archived and not available for new transactions",
	},
	ErrSameAccountTransfer: {
		"SAME_ACCOUNT_TRANSFER",
		"transaction from and to accounts are the same",
	},
	ErrTransferDestinationAmountRequired: {
		"INVALID_AMOUNT",
		"cross-currency transfer requires a destination amount",
	},
	ErrTransferDestinationAmountForbidden: {
		"INVALID_AMOUNT",
		"destination amount is only allowed for a cross-currency transfer",
	},
	ErrTransactionTypeImmutable: {"VALIDATION_FAILED", "transaction type is immutable"},
	ErrInvalidDebtorCurrency: {
		"VALIDATION_FAILED",
		"debtor currency is not in the supported catalog",
	},
	ErrDebtOperationDebtorNotFound: {
		"DEBT_OPERATION_DEBTOR_NOT_FOUND",
		"debtor not found",
	},
	ErrDebtOperationImmutable: {"VALIDATION_FAILED", "debtor, direction, and kind are immutable"},
	ErrPlannedPaymentAccountNotFound: {
		"PLANNED_PAYMENT_ACCOUNT_NOT_FOUND",
		"account not found",
	},
	ErrPlannedPaymentCategoryNotFound: {
		"PLANNED_PAYMENT_CATEGORY_NOT_FOUND",
		"category not found",
	},
	ErrPlannedPaymentCategoryTypeMismatch: {
		"PLANNED_PAYMENT_CATEGORY_NOT_FOUND",
		"plan type does not match category type",
	},
	ErrPlannedPaymentCategoryArchived: {
		"PLANNED_PAYMENT_CATEGORY_ARCHIVED",
		"category is archived and not available for planned payments",
	},
	ErrPlannedPaymentTypeImmutable: {"VALIDATION_FAILED", "plan type is immutable"},
	ErrInvalidDate:                 {"VALIDATION_FAILED", "date must be YYYY-MM-DD"},
	ErrInvalidRefs:                 {"INVALID_REFS", "invalid references"},
	ErrInvalidAmount:               {"INVALID_AMOUNT", "invalid amount"},

	// --- PATCH / cursor request-shape errors ---
	ErrNoFieldsToUpdate: {"VALIDATION_FAILED", "no fields to update"},
	ErrInvalidCursor:    {"INVALID_REQUEST", "invalid cursor"},

	// --- household / profile ---
	ErrInvalidCurrency: {
		"VALIDATION_FAILED",
		"unsupported currency",
	},
	ErrInvalidDisplayName: {
		"VALIDATION_FAILED",
		"display name must be 1-100 characters after trimming",
	},
	// The household endpoints operate on the middleware-resolved membership,
	// so a missing household/membership is a violated data invariant, not a
	// client error: the transport maps it to 500.
	ErrHouseholdNotFound:  {"INTERNAL_ERROR", "internal server error"},
	ErrMembershipNotFound: {"INTERNAL_ERROR", "internal server error"},

	// --- household join lifecycle ---
	ErrHouseholdOwnerRequired: {
		"FORBIDDEN",
		"only the household owner may perform this action",
	},
	ErrInvitationNotFound: {"HOUSEHOLD_INVITATION_NOT_FOUND", "invitation not found"},
	ErrInvitationEmailMismatch: {
		"HOUSEHOLD_INVITATION_EMAIL_MISMATCH",
		"this invitation was sent to a different email address",
	},
	ErrInvitationExpired: {"HOUSEHOLD_INVITATION_EXPIRED", "invitation expired"},
	ErrInvitationRevoked: {"HOUSEHOLD_INVITATION_REVOKED", "invitation revoked"},
	ErrInvitationAlreadyAccepted: {
		"HOUSEHOLD_INVITATION_ALREADY_ACCEPTED",
		"invitation already accepted",
	},
	ErrInvitationAlreadyMember: {
		"HOUSEHOLD_INVITATION_ALREADY_MEMBER",
		"this email is already a member of the household",
	},
	ErrInvitationRateLimited: {
		"HOUSEHOLD_INVITATION_RATE_LIMITED",
		"household invitation rate limit exceeded, try again later",
	},
	ErrHouseholdCodeInvalid: {"HOUSEHOLD_CODE_INVALID", "unknown or revoked household code"},
	ErrHouseholdOwnerWithMembers: {
		"HOUSEHOLD_OWNER_WITH_MEMBERS",
		"the owner cannot leave a household with other members; remove them or dissolve the household",
	},
	ErrHouseholdMemberNotFound: {"HOUSEHOLD_MEMBER_NOT_FOUND", "member not found"},
	ErrHouseholdMemberIsOwner: {
		"HOUSEHOLD_MEMBER_IS_OWNER",
		"the owner cannot be removed; dissolve the household instead",
	},
	ErrHouseholdDissolveConfirmRequired: {
		"HOUSEHOLD_DISSOLVE_CONFIRM_REQUIRED",
		"dissolution requires an explicit confirm",
	},
}
