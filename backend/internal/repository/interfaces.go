// Package repository defines the data-access interfaces implemented by the
// Postgres layer and consumed by the service layer.
//
// Every resource query is scoped by the household of the authenticated
// member (IDOR protection: an access from outside the household returns
// "not found", never the row); household-scoped methods take that scope as
// one domain.Scope value (household + acting member), built once by the
// transport layer from the session/membership resolution - never from a
// request body.
package repository

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
)

// UserRepository owns the users table (identity). Not household-scoped (the
// user IS the identity).
type UserRepository interface {
	RegisterUser(ctx context.Context, params domain.RegisterUserParams) (*domain.User, error)
	GetUserByEmail(ctx context.Context, email string) (*domain.User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
	UpdateDisplayName(
		ctx context.Context,
		userID uuid.UUID,
		displayName string,
	) (*domain.User, error)
}

// HouseholdRepository owns households + membership (the scoping unit). The
// by-user membership lookup is the auth middleware's single-hop household
// resolution.
type HouseholdRepository interface {
	GetMembershipByUser(ctx context.Context, userID uuid.UUID) (*domain.Membership, error)
	GetHouseholdWithMembers(ctx context.Context, scope domain.Scope) (*domain.Household, error)

	// Join lifecycle (household-join change). Owner-side guards (role checks)
	// live in the service; these are the persistence moves.
	UpdateHousehold(ctx context.Context, scope domain.Scope, name, currency *string) error
	CountHouseholdInvitationSends(ctx context.Context, scope domain.Scope) (int, error)
	CreateHouseholdInvitation(
		ctx context.Context,
		householdID uuid.UUID,
		email string,
		createdBy uuid.UUID,
		ttl time.Duration,
	) (*domain.HouseholdInvitation, error)
	ListHouseholdInvitations(
		ctx context.Context,
		scope domain.Scope,
	) ([]domain.HouseholdInvitation, error)
	RevokeHouseholdInvitation(ctx context.Context, scope domain.Scope, invitationID uuid.UUID) error
	GetHouseholdInvitationByToken(
		ctx context.Context,
		token uuid.UUID,
	) (*domain.HouseholdInvitation, error)
	JoinHousehold(
		ctx context.Context,
		userID, targetHouseholdID uuid.UUID,
		invitationID *uuid.UUID,
	) (*domain.Household, error)
	GenerateHouseholdCode(ctx context.Context, scope domain.Scope) (*domain.HouseholdCode, error)
	RevokeHouseholdCode(ctx context.Context, scope domain.Scope) error
	FindHouseholdByActiveCode(ctx context.Context, code string) (uuid.UUID, error)
	LeaveHousehold(ctx context.Context, userID uuid.UUID) (*domain.Household, error)
	RemoveHouseholdMember(ctx context.Context, householdID, targetUserID uuid.UUID) error
	DissolveHousehold(ctx context.Context, scope domain.Scope) error
}

// SessionRepository owns stateful auth sessions.
type SessionRepository interface {
	CreateSession(ctx context.Context, params domain.CreateSessionParams) (*domain.Session, error)
	GetSessionByID(ctx context.Context, id string) (*domain.Session, error)
	DeleteSession(ctx context.Context, id string) error
	ExtendSession(ctx context.Context, id string, newExpiresAt time.Time) error
	DeleteExpiredSessions(ctx context.Context) (int64, error)
	GetSessionsByUser(ctx context.Context, userID uuid.UUID) ([]domain.Session, error)
	DeleteSessionsByUserExcept(
		ctx context.Context,
		userID uuid.UUID,
		exceptSessionID string,
	) (int64, error)
	DeleteSessionsByUser(ctx context.Context, userID uuid.UUID) (int64, error)
}

// AccountRepository owns accounts + their computed balances.
type AccountRepository interface {
	CreateAccount(ctx context.Context, params domain.CreateAccountParams) (*domain.Account, error)
	UpdateAccount(
		ctx context.Context,
		scope domain.Scope, id uuid.UUID,
		params domain.UpdateAccountParams,
	) (*domain.Account, error)
	DeleteAccount(ctx context.Context, scope domain.Scope, id uuid.UUID) error
	GetAccount(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error)
	GetAccounts(ctx context.Context, scope domain.Scope) ([]domain.Account, error)
}

// CategoryRepository owns household categories.
type CategoryRepository interface {
	CreateCategory(
		ctx context.Context,
		params domain.CreateCategoryParams,
	) (*domain.Category, error)
	UpdateCategory(
		ctx context.Context,
		scope domain.Scope, id uuid.UUID,
		params domain.UpdateCategoryParams,
	) (*domain.Category, error)
	// DeleteCategory tombstones the category; with cascade it tombstones
	// every referencing live transaction of the household atomically (one
	// transaction, a change_log row per tombstoned record). Live planned
	// payments block the delete in both modes.
	DeleteCategory(ctx context.Context, scope domain.Scope, id uuid.UUID, cascade bool) error
	GetCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
	GetCategories(
		ctx context.Context,
		scope domain.Scope,
		params domain.GetCategoriesParams,
	) ([]domain.Category, error)
}

// TransactionRepository owns transactions (keyset-cursor pagination, optimistic
// concurrency). Reference validation lives in the service layer.
type TransactionRepository interface {
	CreateTransaction(
		ctx context.Context,
		params domain.CreateTransactionParams,
	) (*domain.Transaction, error)
	UpdateTransaction(
		ctx context.Context,
		scope domain.Scope, id uuid.UUID,
		params domain.UpdateTransactionParams,
	) (*domain.Transaction, error)
	DeleteTransaction(ctx context.Context, scope domain.Scope, id uuid.UUID) error
	GetTransaction(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.Transaction, error)
	GetTransactions(
		ctx context.Context,
		scope domain.Scope,
		params domain.GetTransactionsParams,
	) ([]domain.Transaction, error)
}

// DebtorRepository owns household debtors. Balances are derived (never
// stored); DeleteDebtor cascades - the debtor and its live debt operations
// are tombstoned together.
type DebtorRepository interface {
	CreateDebtor(ctx context.Context, params domain.CreateDebtorParams) (*domain.Debtor, error)
	UpdateDebtor(
		ctx context.Context,
		scope domain.Scope, id uuid.UUID,
		params domain.UpdateDebtorParams,
	) (*domain.Debtor, error)
	DeleteDebtor(ctx context.Context, scope domain.Scope, id uuid.UUID) error
	GetDebtor(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Debtor, error)
	GetDebtors(ctx context.Context, scope domain.Scope) ([]domain.Debtor, error)
}

// DebtOperationRepository owns debt-operation ledger records (optimistic
// concurrency). Debtor-reference validation lives in the service layer.
type DebtOperationRepository interface {
	CreateDebtOperation(
		ctx context.Context,
		params domain.CreateDebtOperationParams,
	) (*domain.DebtOperation, error)
	UpdateDebtOperation(
		ctx context.Context,
		scope domain.Scope, id uuid.UUID,
		params domain.UpdateDebtOperationParams,
	) (*domain.DebtOperation, error)
	DeleteDebtOperation(ctx context.Context, scope domain.Scope, id uuid.UUID) error
	GetDebtOperation(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.DebtOperation, error)
	GetDebtOperations(
		ctx context.Context,
		scope domain.Scope,
		params domain.GetDebtOperationsParams,
	) ([]domain.DebtOperation, error)
}

// PlannedPaymentRepository owns recurring planned-payment rules (optimistic
// concurrency). Account/category-reference validation lives in the service
// layer; deletion is unguarded (a plan has no child records).
type PlannedPaymentRepository interface {
	CreatePlannedPayment(
		ctx context.Context,
		params domain.CreatePlannedPaymentParams,
	) (*domain.PlannedPayment, error)
	UpdatePlannedPayment(
		ctx context.Context,
		scope domain.Scope, id uuid.UUID,
		params domain.UpdatePlannedPaymentParams,
	) (*domain.PlannedPayment, error)
	DeletePlannedPayment(ctx context.Context, scope domain.Scope, id uuid.UUID) error
	GetPlannedPayment(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.PlannedPayment, error)
	GetPlannedPayments(
		ctx context.Context,
		scope domain.Scope,
		params domain.GetPlannedPaymentsParams,
	) ([]domain.PlannedPayment, error)
}

// PushSubscriptionRepository owns per-device Web Push registrations
// (web-push change, ADR-0004): plain CRUD with no sync participation -
// no change_log, no tombstones. IANA timezone validation lives in the
// service layer; the endpoint URL is a bearer secret never logged.
type PushSubscriptionRepository interface {
	UpsertPushSubscription(
		ctx context.Context,
		params domain.UpsertPushSubscriptionParams,
	) (*domain.PushSubscription, error)
	DeletePushSubscription(ctx context.Context, userID, id uuid.UUID) error
}

// SyncCore is the entity-agnostic push core: durable op-id idempotency (the
// applied-operations store) and the cross-household adoption check. It is the
// shared half of the per-batch unit-of-work; the per-entity halves are the
// *SyncTx contracts below (ADR-0003).
type SyncCore interface {
	GetAppliedOperation(
		ctx context.Context,
		scope domain.Scope,
		opID uuid.UUID,
	) (*domain.AppliedOperation, error)
	InsertAppliedOperation(ctx context.Context, rec domain.AppliedOperation) error

	// AdoptOrphanedID (household-join D3/D4): a base-0 create whose id exists
	// in ANOTHER household is legal only when that household is orphaned (no
	// members left - typically the pusher's former personal household): the
	// row is deleted so the caller's create re-inserts it with the same id
	// into the pusher's household. A row in a still-live household is never
	// stolen: the call reports that row's state for an already-exists
	// conflict. Nil return = free to create.
	AdoptOrphanedID(
		ctx context.Context,
		entity string,
		entityID uuid.UUID, scope domain.Scope,
	) (*domain.SyncServerState, error)
}

// AccountSyncTx is the account's push contract: the tombstone-inclusive read,
// the create/replace/tombstone writes, and the guard reads the account's
// push/delete paths call. Reference-validation reads for OTHER entities'
// adapters (LiveAccountExists) live here too - Go's structural interfaces make
// that a cheap cross-contract dependency.
type AccountSyncTx interface {
	// Read including tombstones (nil, nil when the id was never created).
	GetAccountAny(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error)
	// Live-only read for reference validation.
	LiveAccountExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	// Currency of the live account (reference validation needs it for the
	// cross-currency transfer rule). Errors when the account is missing or
	// tombstoned.
	LiveAccountCurrency(ctx context.Context, scope domain.Scope, id uuid.UUID) (string, error)
	// In-use guards for deletes.
	HasLiveTransactionsForAccount(
		ctx context.Context,
		scope domain.Scope,
		accountID uuid.UUID,
	) (bool, error)
	HasLivePlannedPaymentsForAccount(
		ctx context.Context,
		scope domain.Scope,
		accountID uuid.UUID,
	) (bool, error)
	// Writes; each appends its change_log row on the same transaction. The
	// Replace/Tombstone methods enforce the CAS/liveness invariants and return
	// the classified domain sentinel on failure (Err*VersionConflict,
	// ErrRecordDeleted, Err*NotFound).
	CreateAccount(ctx context.Context, params domain.CreateAccountParams) (*domain.Account, error)
	ReplaceAccount(
		ctx context.Context, scope domain.Scope, id uuid.UUID, baseVersion int, st domain.AccountFullState,
	) (*domain.Account, error)
	TombstoneAccount(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Account, error)
}

// CategorySyncTx is the category's push contract: the tombstone-inclusive
// read, the create/replace/tombstone writes, the live-name uniqueness
// pre-check, and the delete in-use guards.
type CategorySyncTx interface {
	// Read including tombstones (nil, nil when the id was never created).
	GetCategoryAny(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
	// Live-only read for reference validation.
	LiveCategory(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error)
	// Live-name uniqueness, pre-checked under the advisory lock so a violation
	// surfaces as a per-item error, never an aborted batch.
	CategoryNameTaken(
		ctx context.Context,
		scope domain.Scope,
		name string,
		exceptID uuid.UUID,
	) (bool, error)
	// In-use guards for deletes.
	HasLiveTransactionsForCategory(
		ctx context.Context,
		scope domain.Scope,
		categoryID uuid.UUID,
	) (bool, error)
	HasLivePlannedPaymentsForCategory(
		ctx context.Context,
		scope domain.Scope,
		categoryID uuid.UUID,
	) (bool, error)
	// Writes; each appends its change_log row on the same transaction. The
	// Replace/Tombstone methods enforce the CAS/liveness invariants and return
	// the classified domain sentinel on failure (Err*VersionConflict,
	// ErrRecordDeleted, Err*NotFound).
	CreateCategory(
		ctx context.Context,
		params domain.CreateCategoryParams,
	) (*domain.Category, error)
	ReplaceCategory(
		ctx context.Context, scope domain.Scope, id uuid.UUID, baseVersion int, st domain.CategoryFullState,
	) (*domain.Category, error)
	TombstoneCategory(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.Category, error)
	// CascadeTombstoneCategory tombstones the category plus every live
	// transaction referencing it, appending a change_log row per tombstoned
	// record on the same transaction. Used by cascade-flagged category delete
	// push operations (the in-use guard reduced to live planned payments).
	CascadeTombstoneCategory(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.Category, error)
}

// TransactionSyncTx is the transaction's push contract: the
// tombstone-inclusive read and the create/replace/tombstone writes.
type TransactionSyncTx interface {
	// Read including tombstones (nil, nil when the id was never created).
	GetTransactionAny(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.Transaction, error)
	// Writes; each appends its change_log row on the same transaction. The
	// Replace/Tombstone methods enforce the CAS/liveness invariants and return
	// the classified domain sentinel on failure (Err*VersionConflict,
	// ErrRecordDeleted, Err*NotFound).
	CreateTransaction(
		ctx context.Context,
		params domain.CreateTransactionParams,
	) (*domain.Transaction, error)
	ReplaceTransaction(
		ctx context.Context, scope domain.Scope, id uuid.UUID, baseVersion int, st domain.TransactionFullState,
	) (*domain.Transaction, error)
	TombstoneTransaction(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.Transaction, error)
}

// DebtorSyncTx is the debtor's push contract: the tombstone-inclusive read,
// the create/replace/tombstone writes, and the live-name uniqueness
// pre-check. TombstoneDebtor cascades: it also tombstones every live debt
// operation of the debtor (each with its change_log row), the same cascade
// the REST delete runs.
type DebtorSyncTx interface {
	// Read including tombstones (nil, nil when the id was never created).
	GetDebtorAny(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Debtor, error)
	// Live-only read for reference validation.
	LiveDebtorExists(ctx context.Context, scope domain.Scope, id uuid.UUID) (bool, error)
	// Live-name uniqueness, pre-checked under the advisory lock so a violation
	// surfaces as a per-item error, never an aborted batch.
	DebtorNameTaken(
		ctx context.Context,
		scope domain.Scope,
		name string,
		exceptID uuid.UUID,
	) (bool, error)
	// Writes; each appends its change_log row on the same transaction. The
	// Replace/Tombstone methods enforce the CAS/liveness invariants and return
	// the classified domain sentinel on failure (Err*VersionConflict,
	// ErrRecordDeleted, Err*NotFound).
	CreateDebtor(ctx context.Context, params domain.CreateDebtorParams) (*domain.Debtor, error)
	ReplaceDebtor(
		ctx context.Context, scope domain.Scope, id uuid.UUID, baseVersion int, st domain.DebtorFullState,
	) (*domain.Debtor, error)
	TombstoneDebtor(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Debtor, error)
}

// DebtOperationSyncTx is the debt operation's push contract: the
// tombstone-inclusive read and the create/replace/tombstone writes.
type DebtOperationSyncTx interface {
	// Read including tombstones (nil, nil when the id was never created).
	GetDebtOperationAny(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.DebtOperation, error)
	// Writes; each appends its change_log row on the same transaction. The
	// Replace/Tombstone methods enforce the CAS/liveness invariants and return
	// the classified domain sentinel on failure (Err*VersionConflict,
	// ErrRecordDeleted, Err*NotFound).
	CreateDebtOperation(
		ctx context.Context,
		params domain.CreateDebtOperationParams,
	) (*domain.DebtOperation, error)
	ReplaceDebtOperation(
		ctx context.Context, scope domain.Scope, id uuid.UUID, baseVersion int, st domain.DebtOperationFullState,
	) (*domain.DebtOperation, error)
	TombstoneDebtOperation(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.DebtOperation, error)
}

// PlannedPaymentSyncTx is the planned payment's push contract: the
// tombstone-inclusive read, the create/replace/tombstone writes, and the
// auto-confirm job's due scan/advancement (they run under the same advisory
// lock, so they ride the tx handle).
type PlannedPaymentSyncTx interface {
	// Read including tombstones (nil, nil when the id was never created).
	GetPlannedPaymentAny(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.PlannedPayment, error)
	// The auto-confirm job's due scan (live auto plans, next_due <= today).
	DueAutoPlannedPayments(
		ctx context.Context,
		scope domain.Scope,
		today time.Time,
	) ([]domain.PlannedPayment, error)
	// Writes; each appends its change_log row on the same transaction. The
	// Replace/Tombstone methods enforce the CAS/liveness invariants and return
	// the classified domain sentinel on failure (Err*VersionConflict,
	// ErrRecordDeleted, Err*NotFound).
	CreatePlannedPayment(
		ctx context.Context,
		params domain.CreatePlannedPaymentParams,
	) (*domain.PlannedPayment, error)
	ReplacePlannedPayment(
		ctx context.Context, scope domain.Scope, id uuid.UUID, baseVersion int, st domain.PlannedPaymentFullState,
	) (*domain.PlannedPayment, error)
	TombstonePlannedPayment(
		ctx context.Context,
		scope domain.Scope,
		id uuid.UUID,
	) (*domain.PlannedPayment, error)
	// AdvancePlannedPayment moves next_due to the already-computed next
	// occurrence (auto-confirm job only; runs under the advisory lock). The
	// actor stamp is the plan's author (the job acts on their behalf).
	AdvancePlannedPayment(
		ctx context.Context, scope domain.Scope, id uuid.UUID, nextDue time.Time,
	) (*domain.PlannedPayment, error)
}

// SyncTx is the unit-of-work handed to SyncRepository.WithinHouseholdTx: every
// method operates on the SAME open database transaction (which holds the
// household's change-log advisory lock), so a whole push batch commits
// atomically and its change_log rows order with commit visibility. It is the
// composition of the shared core and the per-entity contracts; the push
// engine consumes each entity's adapter through its own narrow contract, so a
// new synced entity adds a contract + adapter instead of widening every
// implementor (ADR-0003).
type SyncTx interface {
	SyncCore
	AccountSyncTx
	CategorySyncTx
	TransactionSyncTx
	DebtorSyncTx
	DebtOperationSyncTx
	PlannedPaymentSyncTx
}

// SyncRepository backs /api/sync: batched pushes (one transaction per batch)
// and the cursor pull.
type SyncRepository interface {
	// WithinHouseholdTx opens the per-batch transaction, takes the household's
	// change-log advisory lock, runs fn, and commits iff fn succeeds.
	WithinHouseholdTx(ctx context.Context, scope domain.Scope, fn func(t SyncTx) error) error
	// PullChanges returns up to limit changes with seq > afterSeq in seq
	// order. The caller derives nextCursor (last seq when the page is full,
	// nil when caught up).
	PullChanges(
		ctx context.Context,
		scope domain.Scope,
		afterSeq int64,
		limit int,
	) ([]domain.SyncChange, error)
}

// IdempotencyRepository caches POST /api/transactions responses for replay.
// User-scoped (keyed by the requester), not household-scoped: a replayed
// cached response is per-requester by definition.
type IdempotencyRepository interface {
	CreateIdempotencyKey(
		ctx context.Context,
		params domain.CreateIdempotencyKeyParams,
	) (*domain.IdempotencyKey, error)
	UpdateIdempotencyKey(
		ctx context.Context,
		userID, id uuid.UUID,
		params domain.UpdateIdempotencyKeyParams,
	) (*domain.IdempotencyKey, error)
	GetByUserAndKey(
		ctx context.Context,
		userID uuid.UUID,
		key string,
	) (*domain.IdempotencyKey, error)
	DeleteIdempotencyKey(ctx context.Context, userID, id uuid.UUID) error
	DeleteExpiredIdempotencyKeys(ctx context.Context) (int64, error)
}

// TombstoneRetention backs the retention job: hard-deleting soft-deleted
// rows once they are older than the retention cutoff. The change_log is NOT
// touched - pulls keep serving the tombstones - and callers must delete
// referencing rows first (transactions and planned payments before
// categories/accounts, debt operations before debtors).
type TombstoneRetention interface {
	DeleteTombstonedTransactionsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedPlannedPaymentsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedCategoriesBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedAccountsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedDebtOperationsBefore(ctx context.Context, cutoff time.Time) (int64, error)
	DeleteTombstonedDebtorsBefore(ctx context.Context, cutoff time.Time) (int64, error)
}

// EmailVerificationRepository owns OTP verification (atomic consume flow).
type EmailVerificationRepository interface {
	CreateEmailVerificationCode(
		ctx context.Context,
		userID uuid.UUID,
		code string,
		expiresAt time.Time,
	) error
	VerifyEmailCode(ctx context.Context, userID uuid.UUID, code string) error
	LatestVerificationCodeAgeSeconds(ctx context.Context, userID uuid.UUID) (int, bool, error)
}

// PasswordResetRepository owns hashed reset tokens (atomic consume + revoke).
type PasswordResetRepository interface {
	CreatePasswordResetToken(
		ctx context.Context,
		userID uuid.UUID,
		tokenHash string,
		expiresAt time.Time,
	) error
	ResetPassword(ctx context.Context, tokenHash, passwordHash string) error
	LatestPasswordResetTokenAgeSeconds(ctx context.Context, userID uuid.UUID) (int, bool, error)
}
