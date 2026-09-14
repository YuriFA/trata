// Public API of the shared contract + data layer.
//
// This package is framework-agnostic and platform-portable: it depends only on
// the fetch-family globals (browser / Node / React Native). Apps wire their own
// client (see {@link createApiClient}) and inject a repository implementation
// (HTTP or app-local persistence) through their own DI mechanism.

// --- Generated OpenAPI contract -------------------------------------------
export type { paths, webhooks, components, operations } from './schema'

// --- Client + error mapping ------------------------------------------------
export { createApiClient, type ApiClient, type CreateApiClientOptions } from './api-client'
export {
  mapApiError,
  errorMiddleware,
  setUnauthorizedHandler,
} from './api-errors'

// --- Repository DI seam: interface + error model ---------------------------
export {
  RepositoryError,
  NotFoundError,
  ReferentialIntegrityError,
  InvalidPayloadError,
  UnknownReferencesError,
  VersionConflictError,
  AlreadyExistsError,
  UnauthorizedError,
  RateLimitedError,
  ConflictError,
  getRepositoryErrorMessage,
  type Repository,
  type RepositoryErrorCode,
  type RepositoryErrorOptions,
  type RepositoryErrorMessages,
} from './repository'

// --- Domain model ----------------------------------------------------------
export type { Account, AccountWithBalance } from './domain/account'
export {
  normalizeAccount,
  parseAccountsStorage,
  serializeAccountsStorage,
} from './domain/account'
export type { Category, CategoryType } from './domain/category'
export {
  normalizeCategory,
  parseCategoriesStorage,
  serializeCategoriesStorage,
} from './domain/category'
export type {
  Transaction,
  CashflowTransaction,
  TransferTransaction,
  AdjustmentTransaction,
  TransactionType,
} from './domain/transaction'
export {
  isTransaction,
  isTransferTransaction,
  isAdjustmentTransaction,
  isTransactionLinkedToAccount,
  isTransactionLinkedToCategory,
  hasValidTransactionReferences,
  normalizeTransaction,
  parseTransactionsStorage,
  serializeTransactionsStorage,
  type AccountRef,
  type CategoryRef,
} from './domain/transaction'
export type { Debtor } from './domain/debtor'
export type {
  Household,
  HouseholdMember,
  HouseholdRole,
  HouseholdInvitation,
  HouseholdInvitationStatus,
  HouseholdInvitationPreview,
  HouseholdCode,
} from './domain/household'
export {
  normalizeHousehold,
  normalizeHouseholdMember,
  normalizeHouseholdInvitation,
  normalizeHouseholdInvitationPreview,
  normalizeHouseholdCode,
} from './domain/household'
export { authorLabel, type AuthorLabelOptions } from './domain/author-label'
export { emailLocalPart, householdDisplayName, memberLabel } from './domain/household-label'
export type {
  DebtOperation,
  DebtDirection,
  DebtOperationKind,
} from './domain/debt-operation'
export type {
  PlannedPayment,
  PlannedPaymentType,
  PlannedPaymentRegularity,
  PlannedPaymentConfirmMode,
  PlannedPaymentReminder,
} from './domain/planned_payment'

// --- Per-entity repository contracts (the DI seam) -------------------------
export {
  type AccountRepository,
  type CreateAccountPayload,
  type UpdateAccountPayload,
} from './repositories/account'
export {
  type CategoryRepository,
  type CreateCategoryPayload,
  type UpdateCategoryPayload,
} from './repositories/category'
export {
  type TransactionRepository,
  type TransactionQuery,
  type TransactionPage,
  type CreateTransactionPayload,
  type UpdateTransactionPayload,
  type LocalStorageTransactionRepository,
} from './repositories/transaction'
export {
  type DebtorRepository,
  type CreateDebtorPayload,
  type UpdateDebtorPayload,
} from './repositories/debtor'
export {
  type DebtOperationRepository,
  type DebtOperationQuery,
  type CreateDebtOperationPayload,
  type UpdateDebtOperationPayload,
} from './repositories/debt-operation'
export {
  type PlannedPaymentRepository,
  type PlannedPaymentQuery,
  type CreatePlannedPaymentPayload,
  type UpdatePlannedPaymentPayload,
} from './repositories/planned-payment'

// --- Household endpoint client ----------------------------------------------
export {
  fetchHousehold,
  updateHousehold,
  updateDisplayName,
  createHouseholdInvitation,
  listHouseholdInvitations,
  revokeHouseholdInvitation,
  previewHouseholdInvitation,
  acceptHouseholdInvitation,
  generateHouseholdCode,
  revokeHouseholdCode,
  joinHouseholdByCode,
  leaveHousehold,
  removeHouseholdMember,
  dissolveHousehold,
} from './http/household'

// --- Sync endpoint client (offline-first push/pull) -------------------------
export {
  pushSyncOperations,
  pullSyncChanges,
  type SyncEntityKind,
  type AccountSyncData,
  type CategorySyncData,
  type CategoryDeleteData,
  type TransactionSyncData,
  type DebtorSyncData,
  type DebtOperationSyncData,
  type PlannedPaymentSyncData,
  type SyncOperationData,
  type SyncPushOperation,
  type SyncPushResultItem,
  type SyncServerState,
  type SyncChangeItem,
  type SyncPullPage,
} from './http/sync'

// --- Shared generic helpers (also used by app-local repositories) ----------
export { generateId } from './lib/generate-id'
export {
  isRecord,
  asString,
  asNonEmptyString,
  asNumber,
  asInteger,
  asPositiveNumber,
  asPositiveInteger,
  asDateTimeString,
} from './lib/normalize'
export { isIsoDateTime, type IsoDateTime, type CalendarDay } from './lib/datetime'
