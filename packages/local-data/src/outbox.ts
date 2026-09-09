// Outbox mechanics (design D6) and version/dirty-state transitions (D5).
//
// Every local mutation writes the entity row and one outbox operation in the
// same SQLite transaction. The sync engine (phase 3) pushes those operations
// and applies confirmations through `applyPushConfirmations`; nothing here
// talks to the network. The phase-1 local repository already writes the
// outbox so the later engine plugs in without schema or repository changes.

import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { nowIso } from '@trata/dates'
import type { LocalTransaction } from './types'
import {
  accounts,
  categories,
  debtOperations,
  debtors,
  plannedPayments,
  syncOutbox,
  transactions,
  type SyncEntity,
  type SyncOperationKind,
  type SyncOutboxRow,
} from './schema'
import { generateId } from './id-factory'

export interface EnqueueOperationInput {
  entity: SyncEntity
  entityId: string
  op: SyncOperationKind
  /** Full record payload (domain shape); `null` for delete operations. */
  payload: unknown
  /** Must be the record's `serverVersion` at creation, never its `version`. */
  baseVersion: number
}

/**
 * Appends a pending sync operation. Callers must invoke this INSIDE the same
 * `db.transaction` that writes the entity row, so a mutation is never
 * committed without its operation (spec: "Mutation and queue write are
 * atomic").
 */
export function enqueueOperation(tx: LocalTransaction, input: EnqueueOperationInput): string {
  const opId = generateId()
  tx.insert(syncOutbox)
    .values({
      opId,
      entity: input.entity,
      entityId: input.entityId,
      op: input.op,
      payloadJson: JSON.stringify(input.payload),
      baseVersion: input.baseVersion,
      createdAt: nowIso(),
      sentAt: null,
      attempts: 0,
      lastError: null,
    })
    .run()
  return opId
}

/** Removes every pending operation of one record (used when an unborn record
 * - created and deleted with `serverVersion = 0` - vanishes). */
export function removeOperationsFor(
  tx: LocalTransaction,
  entity: SyncEntity,
  entityId: string,
): void {
  tx.delete(syncOutbox)
    .where(and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, entityId)))
    .run()
}

export function pendingOperations(tx: LocalTransaction): SyncOutboxRow[] {
  return tx.select().from(syncOutbox).orderBy(asc(syncOutbox.createdAt), asc(syncOutbox.opId)).all()
}

/**
 * True when at least one operation of the record has already been sent (in
 * flight or awaiting retry). The server may hold the record even though the
 * local `serverVersion` is still 0 (create applied with a lost response), so
 * a delete must go through the tombstone flow instead of the unborn wipe.
 */
export function hasSentOperations(
  tx: LocalTransaction,
  entity: SyncEntity,
  entityId: string,
): boolean {
  const sent = tx
    .select({ opId: syncOutbox.opId })
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.entity, entity),
        eq(syncOutbox.entityId, entityId),
        isNotNull(syncOutbox.sentAt),
      ),
    )
    .get()
  return sent !== undefined
}

/** A push confirmation: the server applied `opId` and returned `version`. */
export interface PushConfirmation {
  opId: string
  version: number
}

function updateEntityRevisions(
  tx: LocalTransaction,
  entity: SyncEntity,
  entityId: string,
  patch: { serverVersion?: number; version?: number },
): void {
  switch (entity) {
    case 'account':
      tx.update(accounts).set(patch).where(eq(accounts.id, entityId)).run()
      break
    case 'category':
      tx.update(categories).set(patch).where(eq(categories.id, entityId)).run()
      break
    case 'transaction':
      tx.update(transactions).set(patch).where(eq(transactions.id, entityId)).run()
      break
    case 'debtor':
      tx.update(debtors).set(patch).where(eq(debtors.id, entityId)).run()
      break
    case 'debt_operation':
      tx.update(debtOperations).set(patch).where(eq(debtOperations.id, entityId)).run()
      break
    case 'planned_payment':
      tx.update(plannedPayments).set(patch).where(eq(plannedPayments.id, entityId)).run()
      break
  }
}

/**
 * Applies server confirmations (design D5):
 *
 * - removes EXACTLY the confirmed opIds (never "all ops of the entity" - an
 *   operation created while an earlier one was in flight stays pending);
 * - sets `serverVersion := response.version` per confirmed operation;
 * - when the record's last pending operation is confirmed, additionally sets
 *   `version := serverVersion`. This final assignment is load-bearing: a
 *   coalesced group of N local mutations applies as ONE server operation, so
 *   after its confirmation the counters can be apart (local 8, server 6) with
 *   an empty queue. Only this assignment closes the CLEAN invariant, and the
 *   sequential case converges naturally, making it a no-op there.
 */
export function applyPushConfirmations(
  tx: LocalTransaction,
  confirmations: readonly PushConfirmation[],
): void {
  for (const confirmation of confirmations) {
    const op = tx.select().from(syncOutbox).where(eq(syncOutbox.opId, confirmation.opId)).get()
    if (!op) continue

    tx.delete(syncOutbox).where(eq(syncOutbox.opId, confirmation.opId)).run()
    updateEntityRevisions(tx, op.entity, op.entityId, { serverVersion: confirmation.version })

    const remaining = tx
      .select({ opId: syncOutbox.opId })
      .from(syncOutbox)
      .where(and(eq(syncOutbox.entity, op.entity), eq(syncOutbox.entityId, op.entityId)))
      .all()

    if (remaining.length === 0) {
      updateEntityRevisions(tx, op.entity, op.entityId, { version: confirmation.version })
    }
  }
}

/**
 * Coalesces each record's not-yet-sent operations into a single operation
 * carrying the full current record state, the base revision of the FIRST
 * operation in the group, and that first operation's opId (design D6).
 * Sent (in-flight) operations never merge - they are already bound to a
 * request. Runs immediately before a push.
 *
 * `readRecord` supplies the current domain payload of a record (or `null`
 * when the record no longer exists); it is injected so this module stays
 * free of entity mapping logic. If a record is tombstoned or gone the
 * surviving operation becomes (or stays) a `delete`.
 */
export function coalesceUnsentOperations(
  tx: LocalTransaction,
  readRecord: (
    entity: SyncEntity,
    entityId: string,
  ) => { deleted: boolean; payload: unknown } | null,
): void {
  const unsent = tx
    .select()
    .from(syncOutbox)
    .where(isNull(syncOutbox.sentAt))
    .orderBy(asc(syncOutbox.createdAt), asc(syncOutbox.opId))
    .all()

  const groups = new Map<string, SyncOutboxRow[]>()
  for (const op of unsent) {
    const key = `${op.entity}:${op.entityId}`
    const group = groups.get(key)
    if (group) group.push(op)
    else groups.set(key, [op])
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const [first, ...rest] = group
    // Unreachable (length >= 2); satisfies stricter app tsconfigs
    // (noUncheckedIndexedAccess) where destructuring cannot prove it.
    if (!first) continue
    const record = readRecord(first.entity, first.entityId)

    if (!record) {
      // Record vanished entirely (unborn create+delete); drop the whole group.
      tx.delete(syncOutbox)
        .where(
          inArray(
            syncOutbox.opId,
            group.map((op) => op.opId),
          ),
        )
        .run()
      continue
    }

    if (record.deleted) {
      tx.update(syncOutbox)
        .set({ op: 'delete', payloadJson: 'null' })
        .where(eq(syncOutbox.opId, first.opId))
        .run()
    } else {
      tx.update(syncOutbox)
        .set({ op: 'upsert', payloadJson: JSON.stringify(record.payload) })
        .where(eq(syncOutbox.opId, first.opId))
        .run()
    }

    tx.delete(syncOutbox)
      .where(
        inArray(
          syncOutbox.opId,
          rest.map((op) => op.opId),
        ),
      )
      .run()
  }
}
