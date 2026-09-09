// The typed RPC contract between the main thread and the local-db worker
// (design D1): repositories are exposed as plain async-method objects over
// Comlink; the sync engine's subscribe/state surface and the sync-meta owner
// helpers ride the same bridge. Type-only module - imported by both sides.

import type {
  AccountRepository,
  CategoryRepository,
  DebtorRepository,
  DebtOperationRepository,
  TransactionRepository,
} from '@trata/api'
import type {
  LocalPlannedPaymentRepository,
  LocalSyncConflict,
  RestoreResult,
  SyncEngineState,
  SyncRunOutcome,
  SyncStatusSnapshot,
} from '@trata/local-data'

/** Worker -> main boot signals (plain strings: Comlink ignores id-less messages). */
export const LOCAL_DB_READY_SIGNAL = 'expense-tracker:local-db-ready'
export const LOCAL_DB_BUSY_SIGNAL = 'expense-tracker:local-db-busy'

/**
 * The sync engine completed a cycle. Object payload (still id-less, so
 * Comlink's wrap endpoint ignores it): `wroteLocalData` tells whether the
 * cycle wrote local rows - providers invalidate entity caches only then,
 * while the sync-status cache refreshes after every cycle.
 */
export const LOCAL_DB_RUN_COMPLETE_SIGNAL = 'expense-tracker:local-db-run-complete'

export interface LocalDbRunCompleteMessage {
  type: typeof LOCAL_DB_RUN_COMPLETE_SIGNAL
  wroteLocalData: boolean
}

/** The Web Locks name guarding single-tab database exclusivity (design D3). */
export const LOCAL_DB_LOCK_NAME = 'expense-tracker-local-db'

interface LocalDbSyncApi {
  run(force?: boolean): Promise<SyncRunOutcome>
  /** Clears a 401 pause; the next trigger re-runs the cycle. */
  resume(): Promise<void>
  getState(): Promise<SyncEngineState>
  /**
   * Engine state listener over the bridge (callback crossed via Comlink
   * `proxy()`); the resolved function unsubscribes.
   */
  subscribe(listener: () => void): Promise<() => void>
  readStatus(): Promise<SyncStatusSnapshot>
  listUnresolvedConflicts(): Promise<LocalSyncConflict[]>
  getConflict(conflictId: string): Promise<LocalSyncConflict | null>
  resolveConflictKeepLocal(conflictId: string): Promise<void>
  resolveConflictTakeServer(conflictId: string): Promise<void>
  markConflictResolved(conflictId: string): Promise<void>
  /** Wipes ALL local data and rebinds the database to a new owner atomically. */
  rebindOwner(userId: string): Promise<void>
  /** Restores a delete-vs-edit conflict as a new record; returns a result type. */
  restoreConflictAsNew(conflictId: string): Promise<RestoreResult>
}

interface LocalDbMetaApi {
  /** The user this local database belongs to; null = anonymous/unowned. */
  getOwnerUserId(): Promise<string | null>
  setOwnerUserId(userId: string): Promise<void>
  /** Clears ALL local data (the ownership gate's destructive choice). */
  wipeLocalData(): Promise<void>
}

// Household-change bookkeeping (household-join design D4/D7): the rebase the
// carry-data choice runs before the engine operates as the new household, and
// the last-household marker a stale second device compares on startup.
interface LocalDbHouseholdApi {
  rebase(householdId: string): Promise<void>
  /** The household this database last synced against; null = untracked. */
  getLastHousehold(): Promise<string | null>
  setLastHousehold(householdId: string): Promise<void>
}

export interface LocalDbApi {
  accounts: AccountRepository
  categories: CategoryRepository
  transactions: TransactionRepository
  debtors: DebtorRepository
  debtOperations: DebtOperationRepository
  plannedPayments: LocalPlannedPaymentRepository
  sync: LocalDbSyncApi
  meta: LocalDbMetaApi
  household: LocalDbHouseholdApi
}
