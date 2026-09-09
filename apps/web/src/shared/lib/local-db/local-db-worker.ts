// The local-db worker entry (design D1-D3): the whole local-data stack
// (SQLite-WASM driver, repositories, sync engine) lives in this dedicated
// worker because OPFS sync access handles exist only in worker scope. Boot
// sequence: take the Web Locks guard `ifAvailable` (single-tab exclusivity),
// open + migrate the database, compose the repositories and the sync engine,
// expose the RPC surface via Comlink, and only then post the ready signal -
// anything the main thread posts earlier would be lost (it queues behind the
// handshake in local-db.ts instead).

import * as Comlink from 'comlink'
import { proxy } from 'comlink'
import { syncApiClient } from '@/shared/api'
import {
  createApiTransport,
  createLocalAccountRepository,
  createLocalCategoryRepository,
  createLocalDebtorRepository,
  createLocalDebtOperationRepository,
  createLocalPlannedPaymentRepository,
  createLocalTransactionRepository,
  createSyncEngine,
  getConflictById,
  getLastHousehold,
  getOwnerUserId,
  listUnresolvedConflicts,
  markConflictResolved,
  rebaseLocalDataForHousehold,
  rebindOwner,
  resolveConflictKeepLocal,
  resolveConflictTakeServer,
  restoreConflictAsNew,
  readSyncStatus,
  setLastHousehold,
  setOwnerUserId,
  wipeLocalData,
} from '@trata/local-data'
import { openLocalDatabase } from './sqlite-wasm-database'
import {
  LOCAL_DB_BUSY_SIGNAL,
  LOCAL_DB_LOCK_NAME,
  LOCAL_DB_READY_SIGNAL,
  LOCAL_DB_RUN_COMPLETE_SIGNAL,
  type LocalDbApi,
  type LocalDbRunCompleteMessage,
} from './local-db-api'

// DedicatedWorkerGlobalScope without pulling the WebWorker lib into the app
// compilation (DOM lib types `navigator.locks`; `postMessage` is cast here).
const ctx = self as unknown as {
  postMessage(message: string | LocalDbRunCompleteMessage): void
}

async function boot(): Promise<void> {
  // Single-tab exclusivity (design D3): grab the lock without waiting and
  // hold it for the worker's whole lifetime. A second tab gets `db-busy`
  // instead of an opaque sahpool `createSyncAccessHandle` failure; the first
  // tab keeps working untouched.
  await navigator.locks.request(LOCAL_DB_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      ctx.postMessage(LOCAL_DB_BUSY_SIGNAL)
      return
    }

    const store = await openLocalDatabase()

    const engine = createSyncEngine({
      db: store.db,
      transport: createApiTransport(syncApiClient),
      // A cycle completed (design D6): the flag tells whether local rows were
      // written. A plain id-less message - Comlink ignores it on the wrap
      // endpoint.
      onRunComplete: ({ wroteLocalData }) =>
        ctx.postMessage({
          type: LOCAL_DB_RUN_COMPLETE_SIGNAL,
          wroteLocalData,
        } satisfies LocalDbRunCompleteMessage),
    })

    const api: LocalDbApi = {
      accounts: createLocalAccountRepository(store.db),
      categories: createLocalCategoryRepository(store.db),
      transactions: createLocalTransactionRepository(store.db),
      debtors: createLocalDebtorRepository(store.db),
      debtOperations: createLocalDebtOperationRepository(store.db),
      plannedPayments: createLocalPlannedPaymentRepository(store.db),
      sync: {
        run: (force?: boolean) => engine.run(force === true ? { force: true } : undefined),
        resume: async () => engine.resume(),
        getState: async () => engine.getState(),
        // The listener arrives as a Comlink proxy; the returned unsubscribe
        // function must be marked so it survives the structured clone.
        subscribe: async (listener: () => void) => proxy(engine.subscribe(listener)),
        readStatus: async () => readSyncStatus(store.db),
        listUnresolvedConflicts: async () => listUnresolvedConflicts(store.db),
        getConflict: async (conflictId: string) => getConflictById(store.db, conflictId),
        resolveConflictKeepLocal: async (conflictId: string) => {
          resolveConflictKeepLocal(store.db, conflictId)
        },
        resolveConflictTakeServer: async (conflictId: string) => {
          resolveConflictTakeServer(store.db, conflictId)
        },
        markConflictResolved: async (conflictId: string) => {
          markConflictResolved(store.db, conflictId)
        },
        rebindOwner: async (userId: string) => {
          rebindOwner(store.db, userId)
        },
        restoreConflictAsNew: async (conflictId: string) => {
          return restoreConflictAsNew(store.db, conflictId)
        },
      },
      meta: {
        getOwnerUserId: async () => getOwnerUserId(store.db),
        setOwnerUserId: async (userId: string) => setOwnerUserId(store.db, userId),
        wipeLocalData: async () => wipeLocalData(store.db),
      },
      household: {
        rebase: async (householdId: string) => rebaseLocalDataForHousehold(store.db, householdId),
        getLastHousehold: async () => getLastHousehold(store.db),
        setLastHousehold: async (householdId: string) => setLastHousehold(store.db, householdId),
      },
    }

    Comlink.expose(api)
    ctx.postMessage(LOCAL_DB_READY_SIGNAL)

    // Hold the lock until the tab (and this worker with it) goes away: this
    // promise never settles, so the lock grant never ends.
    await new Promise<never>(() => {})
  })
}

void boot()
