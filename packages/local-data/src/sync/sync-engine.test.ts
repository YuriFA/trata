// Engine cycle tests against an in-memory fake server that mirrors the
// backend's push semantics (opId idempotency/replay, CAS updates, delete
// idempotence, already-exists/ deleted/ version conflicts) and its cursor
// pull. Covers the spec scenarios: coalesced push + D5 realignment, chain
// continuation after an in-flight ancestor, duplicate delivery, partial
// batches, 401 pause/resume, CLEAN-only pull applies, pull-newer-on-dirty,
// delete-wins with restore-as-new, restart with open conflicts, backoff.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UnauthorizedError,
  type SyncPushOperation,
  type SyncPullPage,
  type SyncPushResultItem,
} from '@trata/api'
import { createLocalAccountRepository } from '../repositories/account'
import { createLocalCategoryRepository } from '../repositories/category'
import { createLocalTransactionRepository } from '../repositories/transaction'
import { createLocalDebtOperationRepository, createLocalDebtorRepository } from '../repositories/debt'
import { balancesByDebtor } from '../balances'
import { createLocalPlannedPaymentRepository } from '../repositories/planned-payment'
import { createTestDatabase } from '../testing/test-database'
import type { LocalDatabase } from '../types'
import {
  categories,
  debtOperations,
  debtors,
  plannedPayments,
  syncOutbox,
  transactions,
  type SyncEntity,
} from '../schema'
import { eq } from 'drizzle-orm'
import {
  listUnresolvedConflicts,
  markConflictResolved,
  resolveConflictKeepLocal,
  resolveConflictTakeServer,
} from './conflicts'
import {
  backoffDelayMs,
  createSyncEngine,
  type SyncEngine,
  type SyncTransport,
} from './sync-engine'
import { getPullCursor } from './sync-meta'
import { readSyncStatus } from './sync-status'

// --- Fake server -------------------------------------------------------------

interface ServerRecord {
  version: number
  deleted: boolean
  data: Record<string, unknown>
}

class FakeServer implements SyncTransport {
  records = new Map<string, ServerRecord>()
  appliedOps = new Map<string, number>()
  log: {
    seq: number
    entity: SyncEntity
    id: string
    action: 'upsert' | 'tombstone'
    version: number
    data?: Record<string, unknown>
  }[] = []
  pushCalls: SyncPushOperation[][] = []
  /** Apply the batch, then fail the response (lost-response simulation). */
  nextPushError: Error | null = null
  /** Reject the request before applying (auth/network failure simulation). */
  nextPushReject: Error | null = null
  /** Record keys whose next upsert returns a per-item error result. */
  failNextUpsertFor = new Set<string>()
  /** Per-item error results with a custom code (e.g. reference validation). */
  nextErrorResults = new Map<string, { code: string; message: string }>()

  private key(entity: string, id: string) {
    return `${entity}:${id}`
  }

  append(
    entity: SyncEntity,
    id: string,
    action: 'upsert' | 'tombstone',
    version: number,
    data?: Record<string, unknown>,
  ) {
    const seq = this.log.length + 1
    this.log.push({ seq, entity, id, action, version, ...(data ? { data } : {}) })
  }

  async push(operations: SyncPushOperation[]): Promise<SyncPushResultItem[]> {
    this.pushCalls.push(operations)
    if (this.nextPushReject) {
      const error = this.nextPushReject
      this.nextPushReject = null
      throw error
    }
    // Apply first, then optionally fail: simulates "applied server-side but
    // the response was lost".
    const results = operations.map((op) => this.apply(op))
    if (this.nextPushError) {
      const error = this.nextPushError
      this.nextPushError = null
      throw error
    }
    return results
  }

  apply(op: SyncPushOperation): SyncPushResultItem {
    const replayed = this.appliedOps.get(op.opId)
    if (replayed !== undefined) {
      return { opId: op.opId, status: 'applied', version: replayed }
    }

    const k = this.key(op.entity, op.id)

    if (op.action === 'delete') {
      const rec = this.records.get(k)
      if (!rec) return { opId: op.opId, status: 'applied', version: 0 }
      if (rec.deleted) return { opId: op.opId, status: 'applied', version: rec.version }
      rec.deleted = true
      rec.version += 1
      this.append(op.entity, op.id, 'tombstone', rec.version)
      this.appliedOps.set(op.opId, rec.version)
      return { opId: op.opId, status: 'applied', version: rec.version }
    }

    const data = (op.data ?? {}) as Record<string, unknown>

    if (op.baseVersion === 0) {
      const existing = this.records.get(k)
      if (existing) {
        return {
          opId: op.opId,
          status: 'conflict',
          code: 'SYNC_ALREADY_EXISTS',
          message: 'record already exists',
          serverState: {
            version: existing.version,
            deleted: existing.deleted,
            ...(existing.deleted ? {} : { data: existing.data as never }),
          },
        }
      }
      if (this.failNextUpsertFor.has(k)) {
        this.failNextUpsertFor.delete(k)
        return {
          opId: op.opId,
          status: 'error',
          code: 'CATEGORY_ALREADY_EXISTS',
          message: 'name taken',
        }
      }
      const customError = this.nextErrorResults.get(k)
      if (customError) {
        this.nextErrorResults.delete(k)
        return { opId: op.opId, status: 'error', ...customError }
      }
      this.records.set(k, { version: 1, deleted: false, data })
      this.append(op.entity, op.id, 'upsert', 1, data)
      this.appliedOps.set(op.opId, 1)
      return { opId: op.opId, status: 'applied', version: 1 }
    }

    const rec = this.records.get(k)
    if (!rec) {
      return {
        opId: op.opId,
        status: 'conflict',
        code: 'SYNC_VERSION_CONFLICT',
        message: 'not found on server',
        serverState: { version: 0, deleted: false },
      }
    }
    if (rec.deleted) {
      return {
        opId: op.opId,
        status: 'conflict',
        code: 'SYNC_DELETED_CONFLICT',
        message: 'deleted on server',
        serverState: { version: rec.version, deleted: true },
      }
    }
    if (rec.version !== op.baseVersion) {
      return {
        opId: op.opId,
        status: 'conflict',
        code: 'SYNC_VERSION_CONFLICT',
        message: 'version conflict',
        serverState: { version: rec.version, deleted: false, data: rec.data as never },
      }
    }
    rec.version += 1
    rec.data = data
    this.append(op.entity, op.id, 'upsert', rec.version, data)
    this.appliedOps.set(op.opId, rec.version)
    return { opId: op.opId, status: 'applied', version: rec.version }
  }

  async pull(cursor: number): Promise<SyncPullPage> {
    return {
      changes: this.log.filter((c) => c.seq > cursor) as SyncPullPage['changes'],
      nextCursor: null,
    }
  }

  /** Server-side mutation by "another device". */
  mutate(entity: SyncEntity, id: string, patch: Record<string, unknown>) {
    const k = this.key(entity, id)
    const rec = this.records.get(k)
    if (!rec) throw new Error('mutate: unknown record')
    rec.data = { ...rec.data, ...patch }
    rec.version += 1
    this.append(entity, id, 'upsert', rec.version, rec.data)
  }

  deleteRecord(entity: SyncEntity, id: string) {
    const k = this.key(entity, id)
    const rec = this.records.get(k)
    if (!rec) throw new Error('deleteRecord: unknown record')
    rec.deleted = true
    rec.version += 1
    this.append(entity, id, 'tombstone', rec.version)
  }
}

// --- Harness -------------------------------------------------------------------

let db: LocalDatabase
let server: FakeServer
let clockMs: number
let engine: SyncEngine
let categoryRepo: ReturnType<typeof createLocalCategoryRepository>
let accountRepo: ReturnType<typeof createLocalAccountRepository>
let transactionRepo: ReturnType<typeof createLocalTransactionRepository>

/** `wroteLocalData` of every completed cycle, in order. */
let completions: boolean[]

function makeEngine(transport: SyncTransport = server) {
  return createSyncEngine({
    db,
    transport,
    now: () => new Date(clockMs),
    onRunComplete: ({ wroteLocalData }) => completions.push(wroteLocalData),
  })
}

function categoryRow(id: string) {
  return db.select().from(categories).where(eq(categories.id, id)).get()
}

function outboxRows() {
  return db.select().from(syncOutbox).all()
}

beforeEach(async () => {
  db = await createTestDatabase()
  server = new FakeServer()
  clockMs = Date.parse('2026-08-16T12:00:00.000Z')
  completions = []
  engine = makeEngine()
  categoryRepo = createLocalCategoryRepository(db)
  accountRepo = createLocalAccountRepository(db)
  transactionRepo = createLocalTransactionRepository(db)
})

const CATEGORY = { name: 'Такси', type: 'expense' as const, icon: 'car', color: '#7c5cff' }

// --- Push: coalescing + D5 ------------------------------------------------------

describe('sync engine: push phase', () => {
  it('coalesces three offline edits into one operation and realigns CLEAN (D5)', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await categoryRepo.update(category.id, { name: 'Такси 2', version: category.version })
    await categoryRepo.update(category.id, { name: 'Такси 3', version: 2 })
    // 3 mutations -> local version 3, serverVersion 0.
    expect(categoryRow(category.id)).toMatchObject({ version: 3, serverVersion: 0 })
    expect(outboxRows()).toHaveLength(3)

    const outcome = await engine.run({ force: true })

    expect(outcome.pushed).toBe(1)
    expect(server.pushCalls).toHaveLength(1)
    expect(server.pushCalls[0]).toHaveLength(1) // coalesced to ONE operation
    expect(server.records.get(`category:${category.id}`)?.data).toMatchObject({ name: 'Такси 3' })

    // Coalesced realignment: one server op (v1) closes the invariant.
    expect(categoryRow(category.id)).toMatchObject({ version: 1, serverVersion: 1 })
    expect(outboxRows()).toHaveLength(0)
    expect(getPullCursor(db)).toBeGreaterThan(0)
  })

  it('pushes unborn create+delete as nothing', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await categoryRepo.remove(category.id)
    expect(outboxRows()).toHaveLength(0)

    await engine.run({ force: true })
    expect(server.pushCalls).toHaveLength(0)
    expect(server.records.size).toBe(0)
  })

  it('delete during an in-flight create ends tombstoned on the server (no lost delete)', async () => {
    // The create is in flight when the user deletes. The server may already
    // hold the record, so the delete must survive as a queued tombstone and
    // land after the create - the unborn shortcut must not wipe it.
    const gate: { release: (() => void) | null } = { release: null }
    let firstPush = true
    const gatedTransport: SyncTransport = {
      push: (operations) =>
        new Promise((resolve) => {
          server.pushCalls.push(operations)
          const results = operations.map((op) => server.apply(op))
          if (firstPush) {
            firstPush = false
            gate.release = () => resolve(results)
          } else {
            resolve(results)
          }
        }),
      pull: (cursor) => server.pull(cursor),
    }

    const category = await categoryRepo.create(CATEGORY)
    const createOpId = outboxRows()[0].opId
    const runPromise = makeEngine(gatedTransport).run({ force: true })
    await new Promise((resolve) => setImmediate(resolve))

    await categoryRepo.remove(category.id) // delete BEFORE the create confirms
    gate.release?.()
    await runPromise

    // Push 1: the frozen create (same opId). Push 2: the delete re-based onto
    // the confirmed version. The server ends tombstoned, the record CLEAN.
    expect(server.pushCalls).toHaveLength(2)
    expect(server.pushCalls[0][0]).toMatchObject({ opId: createOpId, action: 'upsert' })
    expect(server.pushCalls[1][0]).toMatchObject({ action: 'delete', id: category.id })
    expect(server.pushCalls[1][0].baseVersion).toBe(1)
    expect(server.records.get(`category:${category.id}`)?.deleted).toBe(true)
    expect(categoryRow(category.id)?.deletedAt).not.toBeNull()
    expect(categoryRow(category.id)).toMatchObject({ version: 2, serverVersion: 2 })
    expect(outboxRows()).toHaveLength(0)
  })

  it('continues the chain after an in-flight ancestor confirms (follower re-bases)', async () => {
    // A gated transport lets the test mutate locally while the first push is
    // in flight - the spec's "edit during in-flight push" scenario. Follower
    // pushes resolve immediately (the engine continues the chain in-run).
    const gate: { release: (() => void) | null } = { release: null }
    let firstPush = true
    const gatedTransport: SyncTransport = {
      push: (operations) =>
        new Promise((resolve) => {
          server.pushCalls.push(operations)
          const results = operations.map((op) => server.apply(op))
          if (firstPush) {
            firstPush = false
            gate.release = () => resolve(results)
          } else {
            resolve(results)
          }
        }),
      pull: (cursor) => server.pull(cursor),
    }
    const gatedEngine = makeEngine(gatedTransport)

    const category = await categoryRepo.create(CATEGORY) // operation A
    const runPromise = gatedEngine.run({ force: true })
    await new Promise((resolve) => setImmediate(resolve))
    expect(gate.release).not.toBeNull()

    const afterA = await categoryRepo.update(category.id, {
      name: 'Такси 2',
      version: category.version,
    }) // operation B, created while A is in flight
    expect(afterA.version).toBe(2)
    const followerOpId = db.select().from(syncOutbox).all().at(-1)?.opId

    gate.release?.()
    await runPromise

    // A confirmed (server v1); B pushed as a continuation against v1 and
    // applied (server v2) - record CLEAN at 2, queue empty.
    expect(server.pushCalls).toHaveLength(2)
    const followerCall = server.pushCalls[1][0]
    expect(followerCall.opId).toBe(followerOpId)
    expect(followerCall.baseVersion).toBe(1)
    expect(categoryRow(category.id)).toMatchObject({ version: 2, serverVersion: 2 })
    expect(outboxRows()).toHaveLength(0)
  })

  it('replays stored results on duplicate delivery after a lost response', async () => {
    const category = await categoryRepo.create(CATEGORY)

    // The server applies the push but the response is lost (network drop).
    server.nextPushError = new Error('network dropped after apply')
    await engine.run({ force: true })
    expect(server.appliedOps.size).toBe(1)
    expect(categoryRow(category.id)?.serverVersion).toBe(0) // unconfirmed locally
    expect(outboxRows()).toHaveLength(1)

    // Retry delivers the SAME opId: the server replays, no duplicate record.
    const outcome = await engine.run({ force: true })
    expect(outcome.pushed).toBe(1)
    expect(server.records.size).toBe(1)
    expect(server.appliedOps.size).toBe(1)
    expect(categoryRow(category.id)).toMatchObject({ version: 1, serverVersion: 1 })
    expect(outboxRows()).toHaveLength(0)
  })

  it('keeps error-result operations queued with the machine code (partial batch)', async () => {
    const ok = await categoryRepo.create(CATEGORY)
    const failing = await categoryRepo.create({ ...CATEGORY, name: 'Доставка' })
    server.failNextUpsertFor.add(`category:${failing.id}`)

    const outcome = await engine.run()

    expect(outcome.pushed).toBe(1)
    expect(categoryRow(ok.id)).toMatchObject({ version: 1, serverVersion: 1 })
    const kept = outboxRows()
    expect(kept).toHaveLength(1)
    expect(kept[0].entityId).toBe(failing.id)
    expect(kept[0].lastError).toContain('CATEGORY_ALREADY_EXISTS')
    expect(kept[0].attempts).toBe(1)
  })

  it('backs off failed operations and re-sends after the window (force bypasses)', async () => {
    const failing = await categoryRepo.create(CATEGORY)
    server.failNextUpsertFor.add(`category:${failing.id}`)
    await engine.run({ force: true })
    expect(outboxRows()[0].attempts).toBe(1)

    // Immediate non-forced run: the op is inside its backoff window.
    await engine.run()
    expect(server.pushCalls).toHaveLength(1)

    // After the window (5s base backoff) it goes out again.
    clockMs += backoffDelayMs(1) + 1
    await engine.run()
    expect(server.pushCalls).toHaveLength(2)
  })

  it('pauses on 401 mid-run and resumes after re-login without queue loss', async () => {
    const category = await categoryRepo.create(CATEGORY)
    server.nextPushReject = new UnauthorizedError('session expired')

    const outcome = await engine.run({ force: true })
    expect(outcome.status).toBe('paused')
    expect(engine.getState().paused).toBe(true)
    expect(outboxRows()).toHaveLength(1) // queue untouched

    // Triggers are no-ops while paused: no further push left the device and
    // nothing was applied.
    await engine.run({ force: true })
    expect(server.pushCalls).toHaveLength(1)
    expect(server.appliedOps.size).toBe(0)

    engine.resume()
    const resumed = await engine.run({ force: true })
    expect(resumed.status).toBe('completed')
    expect(categoryRow(category.id)).toMatchObject({ version: 1, serverVersion: 1 })
  })
})

// --- Pull ------------------------------------------------------------------------

describe('sync engine: pull phase', () => {
  it('applies a remote category cascade: per-record tombstones land like plain deletes', async () => {
    // Another device cascaded a category delete: the pull feed carries one
    // tombstone per tombstoned record (category + its transactions).
    const account = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
    const category = await categoryRepo.create(CATEGORY)
    const transaction = await transactionRepo.create({
      type: 'expense',
      amount: 250,
      description: '',
      occurredAt: '2026-08-10T12:00:00.000Z',
      accountId: account.id,
      categoryId: category.id,
    })
    await engine.run({ force: true })

    server.deleteRecord('category', category.id)
    server.deleteRecord('transaction', transaction.id)
    const outcome = await engine.run({ force: true })

    expect(outcome.pulled).toBe(2)
    expect(categoryRow(category.id)?.deletedAt).not.toBeNull()
    const txRow = db.select().from(transactions).where(eq(transactions.id, transaction.id)).get()
    expect(txRow?.deletedAt).not.toBeNull()
    expect(await categoryRepo.getById(category.id)).toBeNull()
  })

  it('pushes a cascade delete as one flagged wire operation', async () => {
    const account = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
    const category = await categoryRepo.create(CATEGORY)
    await transactionRepo.create({
      type: 'expense',
      amount: 250,
      description: '',
      occurredAt: '2026-08-10T12:00:00.000Z',
      accountId: account.id,
      categoryId: category.id,
    })
    await engine.run({ force: true }) // everything confirmed on the server

    await categoryRepo.remove(category.id, { cascade: true })
    await engine.run({ force: true })

    // One delete operation, carrying the cascade flag in its wire data.
    const deleteCalls = server.pushCalls.flat().filter((op) => op.action === 'delete')
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].data).toEqual({ cascade: true })
    expect(server.records.get(`category:${category.id}`)?.deleted).toBe(true)
    expect(outboxRows()).toHaveLength(0)
    // The transaction row converges via the server's cascade tombstone on
    // pull (the fake echoes it in the feed like the real server).
    const txRow = db.select().from(transactions).all().find((row) => row.categoryId === category.id)
    expect(txRow?.deletedAt).not.toBeNull()
  })

  it('applies pulled changes to CLEAN records and advances the cursor once', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    const cursorAfterPush = getPullCursor(db)

    server.mutate('category', category.id, { name: 'Такси (переименован на сервере)' })
    const outcome = await engine.run({ force: true })

    expect(outcome.pulled).toBe(1)
    const row = categoryRow(category.id)
    expect(row).toMatchObject({ version: 2, serverVersion: 2, deletedAt: null })
    const pulled = await categoryRepo.getById(category.id)
    expect(pulled?.name).toBe('Такси (переименован на сервере)')

    // Caught up: a further run pulls nothing new and keeps the cursor.
    const again = await engine.run({ force: true })
    expect(again.pulled).toBe(0)
    expect(getPullCursor(db)).toBeGreaterThan(cursorAfterPush)
  })

  it('never overwrites a DIRTY record: pull-newer-on-dirty creates a persistent conflict', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })

    await categoryRepo.update(category.id, { name: 'Локальное имя', version: 1 })
    server.mutate('category', category.id, { name: 'Серверное имя' })

    await engine.run({ force: true })

    // The push conflicted first (base 1 vs server 2) - same persistent record.
    const conflicts = listUnresolvedConflicts(db)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      entity: 'category',
      entityId: category.id,
      kind: 'version',
    })
    expect((conflicts[0].localState as { name?: string }).name).toBe('Локальное имя')
    expect((conflicts[0].serverState?.data as { name?: string } | undefined)?.name).toBe(
      'Серверное имя',
    )

    // Local state untouched, op retained.
    expect(await categoryRepo.getById(category.id)).toMatchObject({ name: 'Локальное имя' })
    expect(outboxRows()).toHaveLength(1)
  })

  it('take-theirs applies the server state, drops pending operations, goes CLEAN', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    await categoryRepo.update(category.id, { name: 'Локальное имя', version: 1 })
    server.mutate('category', category.id, { name: 'Серверное имя' })
    await engine.run({ force: true })

    const [conflict] = listUnresolvedConflicts(db)
    resolveConflictTakeServer(db, conflict.id)

    expect(await categoryRepo.getById(category.id)).toMatchObject({ name: 'Серверное имя' })
    expect(categoryRow(category.id)).toMatchObject({ version: 2, serverVersion: 2 })
    expect(outboxRows()).toHaveLength(0)
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('keep-mine rebases onto the server version and re-pushes to CLEAN', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    await categoryRepo.update(category.id, { name: 'Локальное имя', version: 1 })
    server.mutate('category', category.id, { name: 'Серверное имя' })
    await engine.run({ force: true })

    const [conflict] = listUnresolvedConflicts(db)
    resolveConflictKeepLocal(db, conflict.id)

    expect(await categoryRepo.getById(category.id)).toMatchObject({ name: 'Локальное имя' })
    expect(outboxRows()).toHaveLength(1)
    expect(outboxRows()[0].baseVersion).toBe(2)

    const outcome = await engine.run({ force: true })
    expect(outcome.pushed).toBe(1)
    expect(categoryRow(category.id)).toMatchObject({ version: 3, serverVersion: 3 })
    expect(server.records.get(`category:${category.id}`)?.data).toMatchObject({
      name: 'Локальное имя',
    })
  })

  it('delete-vs-edit on push applies delete-wins and preserves the edit for restore', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    await categoryRepo.update(category.id, { name: 'Локальная правка', version: 1 })
    server.deleteRecord('category', category.id)

    await engine.run({ force: true })

    // Tombstone applied locally by default; ops dropped; conflict kept.
    expect(categoryRow(category.id)?.deletedAt).not.toBeNull()
    expect(outboxRows()).toHaveLength(0)
    const [conflict] = listUnresolvedConflicts(db)
    expect(conflict.kind).toBe('deleted')
    expect((conflict.localState as { name: string }).name).toBe('Локальная правка')

    // Restore-as-new: the preserved edit comes back under a new id.
    const restored = await categoryRepo.create({
      name: (conflict.localState as { name: string }).name,
      type: 'expense',
      icon: 'car',
      color: '#7c5cff',
    })
    markConflictResolved(db, conflict.id)
    await engine.run({ force: true })
    expect(restored.id).not.toBe(category.id)
    expect(await categoryRepo.getById(restored.id)).toMatchObject({ name: 'Локальная правка' })
    expect(server.records.get(`category:${restored.id}`)).toBeDefined()
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('a pulled tombstone on a DIRTY record applies delete-wins too', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    await categoryRepo.update(category.id, { name: 'Локальная правка', version: 1 })
    server.deleteRecord('category', category.id)

    // Push that goes nowhere (e.g. the edit op keeps erroring), pull delivers
    // the tombstone while the record is dirty.
    const pullOnlyTransport: SyncTransport = {
      push: async () => [],
      pull: (cursor) => server.pull(cursor),
    }
    await makeEngine(pullOnlyTransport).run({ force: true })

    expect(categoryRow(category.id)?.deletedAt).not.toBeNull()
    expect(outboxRows()).toHaveLength(0)
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(listUnresolvedConflicts(db)[0].kind).toBe('deleted')
  })

  it('local delete vs remote edit: delete-wins re-pushes the tombstone, edit stays restorable', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true }) // confirmed on the server (v1)
    await categoryRepo.remove(category.id) // local delete pending (base 1)
    server.mutate('category', category.id, { name: 'Серверная правка' }) // remote edit (v2)

    // Pull delivers the edit while the local delete is stuck (backoff).
    const pullOnlyTransport: SyncTransport = {
      push: async () => [],
      pull: (cursor) => server.pull(cursor),
    }
    await makeEngine(pullOnlyTransport).run({ force: true })

    // Delete-wins in this direction too: the tombstone is re-based onto the
    // remote edit with ONE delete operation against v2 (it must reach the
    // server, not just apply locally), and the lost remote edit is preserved.
    expect(categoryRow(category.id)?.deletedAt).not.toBeNull()
    expect(categoryRow(category.id)).toMatchObject({ version: 3, serverVersion: 2 })
    const ops = outboxRows()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'delete', entityId: category.id, baseVersion: 2 })
    const [conflict] = listUnresolvedConflicts(db)
    expect(conflict.kind).toBe('deleted')
    expect((conflict.localState as { name?: string }).name).toBe('Серверная правка')

    // The informational conflict does not block the re-push: the server ends
    // tombstoned and the record CLEAN.
    await engine.run({ force: true })
    expect(server.records.get(`category:${category.id}`)?.deleted).toBe(true)
    expect(categoryRow(category.id)).toMatchObject({ version: 3, serverVersion: 3 })
    expect(outboxRows()).toHaveLength(0)

    // Restore-as-new recovers the lost remote edit under a fresh id.
    const restored = await categoryRepo.create({
      name: (conflict.localState as { name: string }).name,
      type: 'expense',
      icon: 'car',
      color: '#7c5cff',
    })
    markConflictResolved(db, conflict.id)
    await engine.run({ force: true })
    expect(restored.id).not.toBe(category.id)
    expect(await categoryRepo.getById(restored.id)).toMatchObject({ name: 'Серверная правка' })
    expect(server.records.get(`category:${restored.id}`)?.data).toMatchObject({
      name: 'Серверная правка',
    })
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('delete-vs-delete converges silently without notifying the user', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    await categoryRepo.remove(category.id) // local delete pending
    server.deleteRecord('category', category.id) // the other device deleted it too

    const pullOnlyTransport: SyncTransport = {
      push: async () => [],
      pull: (cursor) => server.pull(cursor),
    }
    await makeEngine(pullOnlyTransport).run({ force: true })

    // Idempotent delete: CLEAN at the server's tombstone version, no pending
    // operation, and no conflict record - nobody is notified.
    expect(categoryRow(category.id)).toMatchObject({
      deletedAt: expect.any(String),
      version: 2,
      serverVersion: 2,
    })
    expect(outboxRows()).toHaveLength(0)
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })

  it('a pulled tombstone on a CLEAN record just applies', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    server.deleteRecord('category', category.id)

    await engine.run({ force: true })

    expect(categoryRow(category.id)?.deletedAt).not.toBeNull()
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
  })
})

// --- Cycle + status -------------------------------------------------------------

describe('sync engine: cycle and restart', () => {
  it('pushes before pulling and merges initial sync by id (union)', async () => {
    // Local-only record.
    const localCategory = await categoryRepo.create(CATEGORY)
    // Server-only record (created by "the web app").
    const serverCategoryId = '11111111-1111-4111-8111-111111111111'
    server.records.set(`category:${serverCategoryId}`, {
      version: 1,
      deleted: false,
      data: { name: 'Продукты', type: 'expense', icon: 'cart', color: '#16a34a' },
    })
    server.append('category', serverCategoryId, 'upsert', 1, {
      name: 'Продукты',
      type: 'expense',
      icon: 'cart',
      color: '#16a34a',
    })

    const outcome = await engine.run({ force: true })

    expect(outcome.pushed).toBeGreaterThanOrEqual(1)
    const names = new Set((await categoryRepo.getAll()).map((c) => c.name))
    expect(names).toEqual(new Set(['Такси', 'Продукты']))
    expect(categoryRow(localCategory.id)?.serverVersion).toBe(1)
    expect(readSyncStatus(db).unresolvedConflicts).toBe(0)
  })

  it('survives a restart with open conflicts (new engine, same state)', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })
    await categoryRepo.update(category.id, { name: 'Локальное имя', version: 1 })
    server.mutate('category', category.id, { name: 'Серверное имя' })
    await engine.run({ force: true })
    expect(listUnresolvedConflicts(db)).toHaveLength(1)

    // "Restart": a fresh engine instance over the same database.
    const pushCallsBefore = server.pushCalls.length
    const restarted = makeEngine()
    await restarted.run({ force: true })

    expect(listUnresolvedConflicts(db)).toHaveLength(1)
    expect(await categoryRepo.getById(category.id)).toMatchObject({ name: 'Локальное имя' })
    // The conflicted record's op is blocked while unresolved: nothing re-pushed.
    expect(server.pushCalls).toHaveLength(pushCallsBefore)
  })

  it('converges offline create/edit/delete flows to the same server state', async () => {
    const account = await accountRepo.create({
      name: 'Карта',
      currency: 'RUB',
      openingBalance: 100_000,
    })
    const category = await categoryRepo.create(CATEGORY)
    const kept = await transactionRepo.create({
      type: 'expense',
      amount: 1_500,
      description: '',
      occurredAt: '2026-08-10T10:00:00.000Z',
      accountId: account.id,
      categoryId: category.id,
    })
    const doomed = await transactionRepo.create({
      type: 'expense',
      amount: 2_500,
      description: '',
      occurredAt: '2026-08-11T10:00:00.000Z',
      accountId: account.id,
      categoryId: category.id,
    })
    await transactionRepo.update(kept.id, { amount: 1_800, version: kept.version })
    await transactionRepo.remove(doomed.id)
    await accountRepo.update(account.id, { name: 'Карта+', version: account.version })

    await engine.run({ force: true })

    expect(outboxRows()).toHaveLength(0)
    const accountRecord = server.records.get(`account:${account.id}`)
    expect(accountRecord?.data).toMatchObject({ name: 'Карта+' })
    expect(server.records.get(`transaction:${kept.id}`)?.data).toMatchObject({ amount: 1_800 })
    // Unborn create+delete (never synced): no trace on the server at all.
    expect(server.records.has(`transaction:${doomed.id}`)).toBe(false)
    // Every pushed record ended CLEAN.
    expect(db.select().from(categories).where(eq(categories.id, category.id)).get()).toMatchObject({
      version: 1,
      serverVersion: 1,
    })

    // A second device (fresh database) converges by pulling from cursor 0:
    // the same final transaction list, same amount.
    const secondDb = await createTestDatabase()
    const secondEngine = createSyncEngine({
      db: secondDb,
      transport: server,
      now: () => new Date(clockMs),
      onRunComplete: () => undefined,
    })
    await secondEngine.run({ force: true })
    const secondRepo = createLocalTransactionRepository(secondDb)
    const pulled = await secondRepo.query({})
    expect(pulled.map((t) => t.id)).toEqual([kept.id])
    expect(pulled[0]?.amount).toBe(1_800)

    // A delete AFTER the record is server-known pushes a real tombstone, and
    // the second device learns of it via pull.
    await transactionRepo.remove(kept.id)
    await engine.run({ force: true })
    expect(server.records.get(`transaction:${kept.id}`)?.deleted).toBe(true)
    await secondEngine.run({ force: true })
    expect(await secondRepo.query({})).toEqual([])
  })
})

// --- Run completion signal --------------------------------------------------------

describe('sync engine: run completion signal', () => {
  it('signals wroteLocalData=false for a no-op run (empty queue, caught-up cursor)', async () => {
    await engine.run({ force: true })
    completions.length = 0

    await engine.run({ force: true })

    expect(completions).toEqual([false])
  })

  it('signals true when push confirmations or pulled changes wrote local rows', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true }) // push confirmation (pull echo skips)
    expect(completions).toEqual([true])

    completions.length = 0
    server.mutate('category', category.id, { name: 'Такси 2' })
    await engine.run({ force: true }) // pulled change applied
    expect(completions).toEqual([true])
  })

  it('signals false when the transport fails or the run pauses on 401', async () => {
    await categoryRepo.create(CATEGORY)

    server.nextPushError = new Error('offline')
    await engine.run({ force: true })
    expect(completions.at(-1)).toBe(false)

    server.nextPushReject = new UnauthorizedError('session expired')
    await engine.run({ force: true })
    expect(completions.at(-1)).toBe(false)
    expect(engine.getState().paused).toBe(true)
  })

  it('signals true when a conflict write lands', async () => {
    const category = await categoryRepo.create(CATEGORY)
    await engine.run({ force: true })

    // Local unconfirmed edit vs a remote edit of the same record.
    await categoryRepo.update(category.id, { name: 'Локально', version: 1 })
    server.mutate('category', category.id, { name: 'Сервер' })
    await engine.run({ force: true })

    expect(completions.at(-1)).toBe(true)
    expect(listUnresolvedConflicts(db)).toHaveLength(1)
  })
})

describe('backoffDelayMs', () => {
  it('grows exponentially and caps at 15 minutes', () => {
    expect(backoffDelayMs(1)).toBe(5_000)
    expect(backoffDelayMs(2)).toBe(10_000)
    expect(backoffDelayMs(3)).toBe(20_000)
    expect(backoffDelayMs(20)).toBe(15 * 60_000)
  })
})

// --- Debts (debtor + debt_operation as first-class synced entities) -------------

describe('sync engine: debts', () => {
  let debtorRepo: ReturnType<typeof createLocalDebtorRepository>
  let operationRepo: ReturnType<typeof createLocalDebtOperationRepository>

  beforeEach(() => {
    debtorRepo = createLocalDebtorRepository(db)
    operationRepo = createLocalDebtOperationRepository(db)
  })

  async function seedDebt() {
    const debtor = await debtorRepo.create({ name: 'Анна' })
    const debt = await operationRepo.create({
      debtorId: debtor.id,
      direction: 'receivable',
      kind: 'debt',
      amount: 500_000,
      occurredAt: '2026-08-20T10:00:00.000Z',
    })
    return { debtor, debt }
  }

  it('round-trips a debtor and its operations; a second device derives the same balance', async () => {
    const { debtor, debt } = await seedDebt()
    await operationRepo.create({
      debtorId: debtor.id,
      direction: 'receivable',
      kind: 'repayment',
      amount: 150_000,
      occurredAt: '2026-08-21T10:00:00.000Z',
    })

    const outcome = await engine.run({ force: true })

    expect(outcome.pushed).toBe(3) // debtor create + debt + repayment
    expect(outboxRows()).toHaveLength(0)
    expect(server.records.get(`debtor:${debtor.id}`)?.data).toMatchObject({ name: 'Анна' })
    expect(server.records.get(`debt_operation:${debt.id}`)?.data).toMatchObject({
      amount: 500_000,
      direction: 'receivable',
    })
    // Both local rows ended CLEAN under their client-generated ids.
    expect(db.select().from(debtors).where(eq(debtors.id, debtor.id)).get()).toMatchObject({
      version: 1,
      serverVersion: 1,
    })

    // A second device (fresh database) converges by pulling from cursor 0 and
    // derives the same balance from the pulled records.
    const secondDb = await createTestDatabase()
    const secondEngine = createSyncEngine({
      db: secondDb,
      transport: server,
      now: () => new Date(clockMs),
      onRunComplete: () => undefined,
    })
    await secondEngine.run({ force: true })
    const secondOperations = await createLocalDebtOperationRepository(secondDb).getAll()
    expect(balancesByDebtor(secondOperations).get(debtor.id)).toEqual({
      receivable: 350_000,
      payable: 0,
    })
  })

  it('skips an unknown entity kind in a pull and still advances the cursor (D5)', async () => {
    // A server newer than this build emits a foreign entity kind.
    server.log.push({
      seq: 1,
      entity: 'budget' as unknown as SyncEntity,
      id: 'foreign-1',
      action: 'upsert',
      version: 1,
      data: { name: 'Бюджет' },
    })
    const debtorId = '22222222-2222-4222-8222-222222222222'
    server.records.set(`debtor:${debtorId}`, {
      version: 1,
      deleted: false,
      data: { name: 'Сергей', currency: 'RUB' },
    })
    server.log.push({
      seq: 2,
      entity: 'debtor',
      id: debtorId,
      action: 'upsert',
      version: 1,
      data: { name: 'Сергей', currency: 'RUB' },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const outcome = await engine.run({ force: true })
      expect(outcome.pulled).toBe(2)
    } finally {
      warnSpy.mockRestore()
    }

    // The foreign change is skipped (no crash, no row), the known one applies,
    // and the cursor advanced past BOTH - sync never stalls on this build.
    expect(db.select().from(debtors).where(eq(debtors.id, debtorId)).get()).toMatchObject({
      name: 'Сергей',
    })
    expect(getPullCursor(db)).toBe(2)
  })

  it('a pre-plans build skips pulled planned payments and advances the cursor (D8)', async () => {
    // Simulate an older app build: the engine knows every kind except
    // planned_payment. A newer server delivers a plan change plus a known one.
    const oldBuildEngine = createSyncEngine({
      db,
      transport: server,
      now: () => new Date(clockMs),
      onRunComplete: () => undefined,
      knownEntities: new Set(['account', 'category', 'transaction', 'debtor', 'debt_operation']),
    })
    const planId = '33333333-3333-4333-8333-333333333333'
    server.log.push({
      seq: 1,
      entity: 'planned_payment',
      id: planId,
      action: 'upsert',
      version: 1,
      data: {
        type: 'expense',
        amount: 59_900,
        name: 'Netflix',
        accountId: '44444444-4444-4444-8444-444444444444',
        categoryId: '55555555-5555-4555-8555-555555555555',
        nextDue: '2026-09-05',
        anchorDate: '2026-09-05',
        regularity: 'monthly',
        confirmMode: 'manual',
        reminder: 'off',
        note: '',
      },
    })
    const debtorId = '22222222-2222-4222-8222-222222222222'
    server.records.set(`debtor:${debtorId}`, {
      version: 1,
      deleted: false,
      data: { name: 'Сергей', currency: 'RUB' },
    })
    server.log.push({
      seq: 2,
      entity: 'debtor',
      id: debtorId,
      action: 'upsert',
      version: 1,
      data: { name: 'Сергей', currency: 'RUB' },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const outcome = await oldBuildEngine.run({ force: true })
      expect(outcome.pulled).toBe(2)
    } finally {
      warnSpy.mockRestore()
    }

    // The plan is skipped without a crash or a row; the debtor applies; the
    // cursor advanced past both - the old build keeps syncing.
    expect(db.select().from(plannedPayments).all()).toHaveLength(0)
    expect(db.select().from(debtors).where(eq(debtors.id, debtorId)).get()).toMatchObject({
      name: 'Сергей',
    })
    expect(getPullCursor(db)).toBe(2)
  })

  it('keeps an operation queued with lastError when its debtor was deleted on the server (D8)', async () => {
    const { debtor } = await seedDebt()
    await engine.run({ force: true })

    // Another device deletes the debtor server-side; this device, still
    // unaware, records one more operation offline.
    server.deleteRecord('debtor', debtor.id)
    const pending = await operationRepo.create({
      debtorId: debtor.id,
      direction: 'receivable',
      kind: 'repayment',
      amount: 50_000,
      occurredAt: '2026-08-22T10:00:00.000Z',
    })
    // The server's reference validation rejects the pushed operation.
    server.nextErrorResults.set(`debt_operation:${pending.id}`, {
      code: 'DEBT_OPERATION_DEBTOR_NOT_FOUND',
      message: 'debtor not found',
    })
    const pushCallsBefore = server.pushCalls.length

    await engine.run({ force: true })

    // The op is NOT confirmed: it stays queued with the machine error visible
    // and never becomes a sync conflict (user resolves it by editing/deleting).
    const ops = outboxRows()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entityId: pending.id, op: 'upsert', attempts: 1 })
    expect(ops[0].lastError).toContain('DEBT_OPERATION_DEBTOR_NOT_FOUND')
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
    expect(server.pushCalls.length).toBeGreaterThan(pushCallsBefore)

    // Pulling the debtor tombstone independently tombstones the local debtor
    // and leaves the queued operation's own record untouched.
    const debtorRow = db.select().from(debtors).where(eq(debtors.id, debtor.id)).get()
    expect(debtorRow?.deletedAt).not.toBeNull()
    const operationRow = db
      .select()
      .from(debtOperations)
      .where(eq(debtOperations.id, pending.id))
      .get()
    expect(operationRow?.deletedAt).toBeNull()
  })
})

// --- Planned payments (first-class synced entity, design D6/D8) -----------------

describe('sync engine: planned payments', () => {
  let planRepo: ReturnType<typeof createLocalPlannedPaymentRepository>

  beforeEach(() => {
    planRepo = createLocalPlannedPaymentRepository(db)
  })

  async function seedPlanRefs() {
    const account = await accountRepo.create({ name: 'Карта', currency: 'RUB', openingBalance: 0 })
    const category = await categoryRepo.create(CATEGORY)
    return { accountId: account.id, categoryId: category.id }
  }

  it('round-trips a plan; a second device converges with the same next-due and anchor', async () => {
    const refs = await seedPlanRefs()
    const plan = await planRepo.create({
      type: 'expense',
      amount: 599_00,
      name: 'Netflix',
      accountId: refs.accountId,
      categoryId: refs.categoryId,
      nextDue: '2026-09-05',
      regularity: 'monthly',
      confirmMode: 'manual',
      reminder: 'day_before',
      note: '',
    })

    const outcome = await engine.run({ force: true })
    expect(outcome.pushed).toBe(3) // account + category + plan
    expect(outboxRows()).toHaveLength(0)
    expect(server.records.get(`planned_payment:${plan.id}`)?.data).toMatchObject({
      type: 'expense',
      amount: 599_00,
      nextDue: '2026-09-05',
      anchorDate: '2026-09-05',
      regularity: 'monthly',
    })
    expect(
      db.select().from(plannedPayments).where(eq(plannedPayments.id, plan.id)).get(),
    ).toMatchObject({ version: 1, serverVersion: 1 })

    // A second device (fresh database) converges by pulling from cursor 0.
    const secondDb = await createTestDatabase()
    const secondEngine = createSyncEngine({
      db: secondDb,
      transport: server,
      now: () => new Date(clockMs),
      onRunComplete: () => undefined,
    })
    await secondEngine.run({ force: true })
    const secondPlan = await createLocalPlannedPaymentRepository(secondDb).getById(plan.id)
    expect(secondPlan).toMatchObject({
      nextDue: '2026-09-05',
      anchorDate: '2026-09-05',
      amount: 599_00,
      version: 1,
    })
  })

  it('keeps a pushed plan queued with lastError when its category was deleted on the server (D8)', async () => {
    const refs = await seedPlanRefs()
    await engine.run({ force: true })

    // Another device deletes the category server-side; this device, still
    // unaware, records a plan referencing it offline.
    server.deleteRecord('category', refs.categoryId)
    const pending = await planRepo.create({
      type: 'expense',
      amount: 1_200_00,
      name: '',
      accountId: refs.accountId,
      categoryId: refs.categoryId,
      nextDue: '2026-10-01',
      regularity: 'monthly',
      confirmMode: 'manual',
      reminder: 'off',
      note: '',
    })
    server.nextErrorResults.set(`planned_payment:${pending.id}`, {
      code: 'PLANNED_PAYMENT_CATEGORY_NOT_FOUND',
      message: 'category not found',
    })

    await engine.run({ force: true })

    // The plan is NOT applied: it stays queued with the machine error visible
    // and never becomes a sync conflict - the user edits or deletes it locally.
    const ops = outboxRows()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entityId: pending.id, op: 'upsert', attempts: 1 })
    expect(ops[0].lastError).toContain('PLANNED_PAYMENT_CATEGORY_NOT_FOUND')
    expect(listUnresolvedConflicts(db)).toHaveLength(0)
    expect(server.records.has(`planned_payment:${pending.id}`)).toBe(false)
  })
})
