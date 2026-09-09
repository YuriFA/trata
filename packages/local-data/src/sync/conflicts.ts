// Persistent conflict records (design D8): created from push 409s and from
// pull-newer-on-dirty, never memory-only, surviving restarts. Delete-vs-edit
// conflicts are auto-resolved delete-wins at creation time (tombstone applies,
// the lost edit is preserved for restore-as-new); edit-vs-edit conflicts wait
// for the user, and their two resolutions (keep mine = re-push on the current
// server version; take theirs = apply server state and drop pending ops) are
// implemented here as plain db operations so both the engine and the UI use
// the exact same transitions.

import { and, desc, eq, isNull } from 'drizzle-orm'
import { nowIso } from '@trata/dates'
import type { SyncOperationData } from '@trata/api'
import type { LocalDatabase, LocalTransaction } from '../types'
import { enqueueOperation } from '../outbox'
import {
  accounts,
  categories,
  debtOperations,
  debtors,
  plannedPayments,
  syncConflicts,
  syncOutbox,
  transactions,
  type AccountRow,
  type CategoryRow,
  type DebtOperationRow,
  type DebtorRow,
  type PlannedPaymentRow,
  type SyncConflictRow,
  type SyncEntity,
  type TransactionRow,
} from '../schema'
import { generateId } from '../id-factory'
import { readEntityRow, rowToPayload, syncDataToRowPatch } from './sync-data'
import { catalogConflictSubject } from './sync-entity-catalog.generated'

type SyncConflictKind = 'version' | 'deleted'

/** The server side of a conflict (mirrors the wire `SyncServerState`). */
interface ConflictServerState {
  version: number
  deleted: boolean
  data?: SyncOperationData
}

export interface LocalSyncConflict {
  id: string
  entity: SyncEntity
  entityId: string
  opId: string | null
  kind: SyncConflictKind
  baseVersion: number
  serverVersion: number
  /** Domain payload of the local state at conflict time. */
  localState: unknown
  serverState: ConflictServerState | null
  createdAt: string
}

export interface RecordConflictInput {
  entity: SyncEntity
  entityId: string
  opId: string | null
  kind: SyncConflictKind
  baseVersion: number
  serverVersion: number
  localState: unknown
  serverState: ConflictServerState | null
}

function parseKind(value: string): SyncConflictKind {
  return value === 'deleted' ? 'deleted' : 'version'
}

function toConflict(row: SyncConflictRow): LocalSyncConflict {
  let serverState: ConflictServerState | null = null
  if (row.serverStateJson !== 'null') {
    try {
      serverState = JSON.parse(row.serverStateJson) as ConflictServerState
    } catch {
      serverState = null
    }
  }
  let localState: unknown = null
  try {
    localState = JSON.parse(row.localStateJson)
  } catch {
    localState = null
  }
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    opId: row.opId,
    kind: parseKind(row.kind),
    baseVersion: row.baseVersion,
    serverVersion: row.serverVersion,
    localState,
    serverState,
    createdAt: row.createdAt,
  }
}

export function findUnresolvedConflict(
  db: LocalDatabase | LocalTransaction,
  entity: SyncEntity,
  entityId: string,
): LocalSyncConflict | null {
  const row = db
    .select()
    .from(syncConflicts)
    .where(
      and(
        eq(syncConflicts.entity, entity),
        eq(syncConflicts.entityId, entityId),
        isNull(syncConflicts.resolvedAt),
      ),
    )
    .get()
  return row ? toConflict(row) : null
}

/**
 * Records (or refreshes) the unresolved conflict of a record. An existing
 * unresolved conflict for the same record is updated in place - the newest
 * server state wins, the local state snapshot is refreshed - so repeated
 * push/pull cycles never pile up duplicates.
 */
export function recordConflict(
  tx: LocalTransaction,
  input: RecordConflictInput,
): LocalSyncConflict {
  const existing = findUnresolvedConflict(tx, input.entity, input.entityId)
  const values = {
    opId: input.opId,
    kind: input.kind,
    baseVersion: input.baseVersion,
    serverVersion: input.serverVersion,
    localStateJson: JSON.stringify(input.localState ?? null),
    serverStateJson: JSON.stringify(input.serverState ?? null),
  }

  if (existing) {
    tx.update(syncConflicts).set(values).where(eq(syncConflicts.id, existing.id)).run()
    return {
      ...existing,
      ...values,
      localState: input.localState ?? null,
      serverState: input.serverState,
    } as LocalSyncConflict
  }

  const id = generateId()
  const createdAt = nowIso()
  tx.insert(syncConflicts)
    .values({
      id,
      entity: input.entity,
      entityId: input.entityId,
      resolvedAt: null,
      createdAt,
      ...values,
    })
    .run()
  return {
    id,
    createdAt,
    entity: input.entity,
    entityId: input.entityId,
    opId: input.opId,
    kind: input.kind,
    baseVersion: input.baseVersion,
    serverVersion: input.serverVersion,
    localState: input.localState ?? null,
    serverState: input.serverState,
  }
}

export function listUnresolvedConflicts(db: LocalDatabase): LocalSyncConflict[] {
  return db
    .select()
    .from(syncConflicts)
    .where(isNull(syncConflicts.resolvedAt))
    .orderBy(desc(syncConflicts.createdAt))
    .all()
    .map(toConflict)
}

export function getConflictById(db: LocalDatabase, id: string): LocalSyncConflict | null {
  const row = db.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get()
  return row ? toConflict(row) : null
}

/**
 * Human label of the conflicting record (name / description): prefer the
 * local state, fall back to the server state. Returns an empty string when
 * neither carries a name or description.
 */
export function conflictSubject(conflict: LocalSyncConflict): string {
  const state = conflict.localState as Record<string, unknown> | null
  const source =
    state ?? (conflict.serverState?.data as Record<string, unknown> | undefined) ?? undefined
  const name = typeof source?.name === 'string' ? source.name : ''
  const description = typeof source?.description === 'string' ? source.description : ''

  return catalogConflictSubject(conflict.entity, source) || name || description
}

export function markConflictResolved(db: LocalDatabase, id: string): void {
  db.update(syncConflicts).set({ resolvedAt: nowIso() }).where(eq(syncConflicts.id, id)).run()
}

function updateEntityRow(
  tx: LocalTransaction,
  entity: SyncEntity,
  entityId: string,
  patch:
    | Partial<AccountRow>
    | Partial<CategoryRow>
    | Partial<TransactionRow>
    | Partial<DebtorRow>
    | Partial<DebtOperationRow>
    | Partial<PlannedPaymentRow>,
): void {
  switch (entity) {
    case 'account':
      tx.update(accounts)
        .set(patch as Partial<AccountRow>)
        .where(eq(accounts.id, entityId))
        .run()
      break
    case 'category':
      tx.update(categories)
        .set(patch as Partial<CategoryRow>)
        .where(eq(categories.id, entityId))
        .run()
      break
    case 'transaction':
      tx.update(transactions)
        .set(patch as Partial<TransactionRow>)
        .where(eq(transactions.id, entityId))
        .run()
      break
    case 'debtor':
      tx.update(debtors)
        .set(patch as Partial<DebtorRow>)
        .where(eq(debtors.id, entityId))
        .run()
      break
    case 'debt_operation':
      tx.update(debtOperations)
        .set(patch as Partial<DebtOperationRow>)
        .where(eq(debtOperations.id, entityId))
        .run()
      break
    case 'planned_payment':
      tx.update(plannedPayments)
        .set(patch as Partial<PlannedPaymentRow>)
        .where(eq(plannedPayments.id, entityId))
        .run()
      break
  }
}

/** Drops every pending operation of one record (resolution bookkeeping). */
export function dropOperationsFor(
  tx: LocalTransaction,
  entity: SyncEntity,
  entityId: string,
): void {
  tx.delete(syncOutbox)
    .where(and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, entityId)))
    .run()
}

/** First pending operation id of a record (conflicts reference it per spec). */
export function firstPendingOpId(
  tx: LocalTransaction,
  entity: SyncEntity,
  entityId: string,
): string | null {
  const op = tx
    .select({ opId: syncOutbox.opId })
    .from(syncOutbox)
    .where(and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, entityId)))
    .orderBy(syncOutbox.createdAt, syncOutbox.opId)
    .get()
  return op?.opId ?? null
}

/**
 * Applies the delete-wins default of a delete-vs-edit conflict: the tombstone
 * applies locally (CLEAN at the server's tombstone version), all pending
 * operations of the record are dropped, and the conflict record keeps the lost
 * edit for restore-as-new. Used from BOTH directions (push deleted-conflict
 * and pulled tombstone-on-dirty).
 */
export function applyDeleteWins(
  tx: LocalTransaction,
  input: {
    entity: SyncEntity
    entityId: string
    opId: string | null
    baseVersion: number
    serverVersion: number
  },
): void {
  const row = readEntityRow(tx, input.entity, input.entityId)
  const localState = row ? rowToPayload(input.entity, row) : null

  if (row) {
    updateEntityRow(tx, input.entity, input.entityId, {
      deletedAt: nowIso(),
      version: input.serverVersion,
      serverVersion: input.serverVersion,
    })
  }
  dropOperationsFor(tx, input.entity, input.entityId)
  recordConflict(tx, {
    ...input,
    kind: 'deleted',
    localState,
    serverState: { version: input.serverVersion, deleted: true },
  })
}

/**
 * The mirrored delete-vs-edit direction: the record was deleted locally (a
 * pending delete operation) and edited on the server. Delete-wins still
 * applies by default, but here the tombstone must REACH the server: the local
 * row is re-based onto the remote edit's version and ONE fresh delete
 * operation is enqueued against it. The lost REMOTE edit is preserved as the
 * conflict's local state (what `restoreAsNew` recovers); the notification is
 * informational - it never blocks the re-push.
 */
export function applyLocalDeleteWins(
  tx: LocalTransaction,
  input: {
    entity: SyncEntity
    entityId: string
    opId: string | null
    baseVersion: number
    serverVersion: number
    /** The lost remote edit's payload (restore-as-new source). */
    lostEdit: unknown
    serverState: ConflictServerState
  },
): void {
  const row = readEntityRow(tx, input.entity, input.entityId)
  updateEntityRow(tx, input.entity, input.entityId, {
    serverVersion: input.serverVersion,
    version: Math.max(row?.version ?? 0, input.serverVersion + 1),
  })
  dropOperationsFor(tx, input.entity, input.entityId)
  enqueueOperation(tx, {
    entity: input.entity,
    entityId: input.entityId,
    op: 'delete',
    payload: null,
    baseVersion: input.serverVersion,
  })
  recordConflict(tx, {
    entity: input.entity,
    entityId: input.entityId,
    opId: input.opId,
    kind: 'deleted',
    baseVersion: input.baseVersion,
    serverVersion: input.serverVersion,
    localState: input.lostEdit,
    serverState: input.serverState,
  })
}

/**
 * "Take theirs": applies the stored server state locally, drops every pending
 * operation of the record, and the record becomes CLEAN. A server state of
 * version 0 (the server no longer knows the record) resolves by removing the
 * local row entirely.
 */
export function resolveConflictTakeServer(db: LocalDatabase, conflictId: string): void {
  db.transaction((tx) => {
    const row = tx.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId)).get()
    if (!row || row.resolvedAt) return
    const conflict = toConflict(row)

    const entityRow = readEntityRow(tx, conflict.entity, conflict.entityId)
    if (conflict.serverState && conflict.serverState.version > 0) {
      if (conflict.serverState.deleted || !conflict.serverState.data) {
        if (entityRow) {
          updateEntityRow(tx, conflict.entity, conflict.entityId, {
            deletedAt: nowIso(),
            version: conflict.serverState.version,
            serverVersion: conflict.serverState.version,
          })
        }
      } else {
        const patch = syncDataToRowPatch(conflict.entity, conflict.serverState.data)
        if (patch) {
          updateEntityRow(tx, conflict.entity, conflict.entityId, {
            ...patch,
            deletedAt: null,
            version: conflict.serverState.version,
            serverVersion: conflict.serverState.version,
          })
        } else if (entityRow) {
          // Unparseable server payload: fall back to the version bookkeeping
          // alone so the record at least stops conflicting.
          updateEntityRow(tx, conflict.entity, conflict.entityId, {
            version: conflict.serverState.version,
            serverVersion: conflict.serverState.version,
          })
        }
      }
    } else if (entityRow) {
      // Server reports the record as never-seen (v0): remove it locally.
      switch (conflict.entity) {
        case 'account':
          tx.delete(accounts).where(eq(accounts.id, conflict.entityId)).run()
          break
        case 'category':
          tx.delete(categories).where(eq(categories.id, conflict.entityId)).run()
          break
        case 'transaction':
          tx.delete(transactions).where(eq(transactions.id, conflict.entityId)).run()
          break
        case 'debtor':
          tx.delete(debtors).where(eq(debtors.id, conflict.entityId)).run()
          break
        case 'debt_operation':
          tx.delete(debtOperations).where(eq(debtOperations.id, conflict.entityId)).run()
          break
        case 'planned_payment':
          tx.delete(plannedPayments).where(eq(plannedPayments.id, conflict.entityId)).run()
          break
      }
    }

    dropOperationsFor(tx, conflict.entity, conflict.entityId)
    tx.update(syncConflicts)
      .set({ resolvedAt: nowIso() })
      .where(eq(syncConflicts.id, conflictId))
      .run()
  })
}

/**
 * "Keep mine": rebases the local change onto the server's current version and
 * re-enqueues it as one fresh operation (full current state, base = the
 * server version from the conflict). The record stays DIRTY and the next run
 * re-pushes it; once applied it becomes CLEAN. Pending operations captured
 * before the conflict are replaced by the fresh one.
 */
export function resolveConflictKeepLocal(db: LocalDatabase, conflictId: string): void {
  db.transaction((tx) => {
    const row = tx.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId)).get()
    if (!row || row.resolvedAt) return
    const conflict = toConflict(row)

    const entityRow = readEntityRow(tx, conflict.entity, conflict.entityId)
    dropOperationsFor(tx, conflict.entity, conflict.entityId)

    if (entityRow) {
      const deleted = entityRow.deletedAt !== null
      const currentVersion = Math.max(entityRow.version, conflict.serverVersion + 1)
      updateEntityRow(tx, conflict.entity, conflict.entityId, {
        serverVersion: conflict.serverVersion,
        version: currentVersion,
      })
      enqueueOperation(tx, {
        entity: conflict.entity,
        entityId: conflict.entityId,
        op: deleted ? 'delete' : 'upsert',
        payload: deleted ? null : rowToPayload(conflict.entity, entityRow),
        baseVersion: conflict.serverVersion,
      })
    }

    tx.update(syncConflicts)
      .set({ resolvedAt: nowIso() })
      .where(eq(syncConflicts.id, conflictId))
      .run()
  })
}
