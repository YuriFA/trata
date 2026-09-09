// Household rebase tests (household-join design D4/D7 + spec scenarios):
// tombstone drop, wholesale outbox replacement (no stale ops), idempotency,
// the union end-to-end (rebase -> push-as-creates -> pull merge, no
// duplicates by id), the last_household marker/mismatch helper, and local
// authorship stamping (creates stamp the device owner; pull-apply stores the
// server-delivered author).

import { beforeEach, describe, expect, it } from 'vitest'
import type {
  SyncPushOperation,
  SyncPullPage,
  SyncPushResultItem,
  SyncOperationData,
} from '@trata/api'
import { createLocalAccountRepository } from '../repositories/account'
import { createTestDatabase } from '../testing/test-database'
import type { LocalDatabase } from '../types'
import { accounts, syncOutbox, type SyncEntity } from '../schema'
import { eq } from 'drizzle-orm'
import { enqueueOperation } from '../outbox'
import { createSyncEngine, type SyncTransport } from './sync-engine'
import {
  getLastHousehold,
  getPullCursor,
  setPullCursor,
  householdNeedsRebase,
  setLastHousehold,
  setOwnerUserId,
  wipeLocalData,
} from './sync-meta'
import { rebaseLocalDataForHousehold } from './rebase'

/** Minimal idempotent-create server: enough for the union assertions. */
class UnionServer implements SyncTransport {
  records = new Map<string, { version: number; data: Record<string, unknown> }>()
  applied = new Map<string, number>()
  pullLog: SyncPullPage['changes'] = []

  async push(operations: SyncPushOperation[]): Promise<SyncPushResultItem[]> {
    return operations.map((op) => {
      const replay = this.applied.get(op.opId)
      if (replay !== undefined) return { opId: op.opId, status: 'applied', version: replay }
      if (!op.data) return { opId: op.opId, status: 'applied', version: 0 }
      const existing = this.records.get(op.id)
      // Mirror the real server's idempotent-create rule: a base-0 create
      // for an id that already exists (different opId) conflicts.
      if (op.baseVersion === 0 && existing) {
        return {
          opId: op.opId,
          status: 'conflict',
          code: 'SYNC_ALREADY_EXISTS',
          serverState: { version: existing.version, deleted: false, data: existing.data as never },
        }
      }
      const version = existing ? existing.version + 1 : 1
      this.records.set(op.id, { version, data: op.data as Record<string, unknown> })
      this.applied.set(op.opId, version)
      return { opId: op.opId, status: 'applied', version }
    })
  }

  /** Server-side create by another member (pre-existing household data). */
  seedFromServer(entity: SyncEntity, id: string, data: Record<string, unknown>, userId: string) {
    const version = 1
    this.records.set(id, { version, data })
    this.pullLog.push({
      seq: this.pullLog.length + 1,
      entity,
      id,
      action: 'upsert',
      version,
      userId,
      data: data as SyncOperationData,
    })
  }

  async pull(cursor: number): Promise<SyncPullPage> {
    const changes = this.pullLog.filter((c) => c.seq > cursor)
    const last = changes.length > 0 ? changes[changes.length - 1].seq : null
    return { changes, nextCursor: last }
  }
}

let db: LocalDatabase

beforeEach(async () => {
  db = await createTestDatabase()
})

describe('rebaseLocalDataForHousehold', () => {
  it('drops tombstones, zeroes versions, replaces the outbox, resets the cursor, and stores the marker', async () => {
    const accountsRepo = createLocalAccountRepository(db)
    const kept = await accountsRepo.create({ name: 'Kept', currency: 'USD', openingBalance: 100 })
    const doomed = await accountsRepo.create({ name: 'Doomed', currency: 'USD', openingBalance: 0 })
    await accountsRepo.remove(doomed.id)

    // Simulate a previously synchronized state: server versions > 0, a
    // cursor deep in the stream, and a frozen in-flight op.
    db.update(accounts).set({ serverVersion: 3 }).run()
    db.insert(syncOutbox)
      .values({
        opId: 'frozen-op',
        entity: 'account',
        entityId: kept.id,
        op: 'upsert',
        payloadJson: '{"stale":true}',
        baseVersion: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        sentAt: '2026-01-01T00:00:01.000Z',
        attempts: 2,
        lastError: null,
      })
      .run()
    setPullCursor(db, 42)

    rebaseLocalDataForHousehold(db, 'household-b')

    const rows = db.select().from(accounts).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(kept.id)
    expect(rows[0].serverVersion).toBe(0)

    const ops = db.select().from(syncOutbox).all()
    expect(ops).toHaveLength(1)
    expect(ops[0].entityId).toBe(kept.id)
    expect(ops[0].op).toBe('upsert')
    expect(ops[0].baseVersion).toBe(0)
    expect(ops[0].opId).not.toBe('frozen-op')

    expect(getPullCursor(db)).toBe(0)
    expect(getLastHousehold(db)).toBe('household-b')
  })

  it('is idempotent: running it twice yields the same state', async () => {
    const accountsRepo = createLocalAccountRepository(db)
    await accountsRepo.create({ name: 'A', currency: 'USD', openingBalance: 1 })

    rebaseLocalDataForHousehold(db, 'household-b')
    const afterFirst = db.select().from(syncOutbox).all().map((o) => o.entityId).sort()
    rebaseLocalDataForHousehold(db, 'household-b')
    const afterSecond = db.select().from(syncOutbox).all().map((o) => o.entityId).sort()

    expect(afterSecond).toEqual(afterFirst)
    expect(afterSecond).toHaveLength(1)
    expect(db.select().from(accounts).all().every((r) => r.serverVersion === 0)).toBe(true)
    expect(getPullCursor(db)).toBe(0)
  })

  it('carries records into the new household through the union without duplicates by id', async () => {
    const accountsRepo = createLocalAccountRepository(db)
    const mine = await accountsRepo.create({ name: 'Mine', currency: 'USD', openingBalance: 500 })
    // Previously synced: server knows these records in the OLD household.
    db.update(accounts).set({ serverVersion: 2 }).run()

    const server = new UnionServer()
    // The new household already holds a sibling's record.
    server.seedFromServer(
      'account',
      'sibling-account-1',
      { name: 'Theirs', currency: 'EUR', openingBalance: 250 },
      'author-user-1',
    )

    rebaseLocalDataForHousehold(db, 'household-b')
    const engine = createSyncEngine({ db, transport: server })
    await engine.run()

    // The household ends up with BOTH records, same ids, no duplicates.
    expect([...server.records.keys()].sort()).toEqual([mine.id, 'sibling-account-1'].sort())
    expect(server.records.get(mine.id)?.version).toBe(1)
    expect(server.records.get(mine.id)?.data).toMatchObject({ name: 'Mine' })

    // The device holds both records too, clean (version == serverVersion).
    const rows = db.select().from(accounts).all()
    expect(rows.map((r) => r.id).sort()).toEqual([mine.id, 'sibling-account-1'].sort())
    for (const row of rows) {
      expect(row.serverVersion).toBeGreaterThan(0)
      expect(row.version).toBe(row.serverVersion)
    }
    expect(getPullCursor(db)).toBe(server.pullLog.length)

    // The rebase marker survived the sync.
    expect(getLastHousehold(db)).toBe('household-b')
  })
})

describe('idempotent-create convergence', () => {
  it('a rebased base-0 create met with SYNC_ALREADY_EXISTS adopts the server record', async () => {
    const accountsRepo = createLocalAccountRepository(db)
    const mine = await accountsRepo.create({ name: 'Mine', currency: 'USD', openingBalance: 500 })

    // Another device of the union already pushed this id into the household.
    const server = new UnionServer()
    server.records.set(mine.id, {
      version: 3,
      data: { name: 'Theirs', currency: 'EUR', openingBalance: 900 },
    })
    server.applied.set('their-op', 3)

    rebaseLocalDataForHousehold(db, 'household-b')
    const engine = createSyncEngine({ db, transport: server })
    const outcome = await engine.run()

    expect(outcome.conflicts).toBe(0)
    const row = db.select().from(accounts).all().find((r) => r.id === mine.id)
    expect(row).toMatchObject({ name: 'Theirs', currency: 'EUR', openingBalance: 900 })
    expect(row?.version).toBe(3)
    expect(row?.serverVersion).toBe(3)
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })
})

describe('last_household marker', () => {
  it('detects mismatches only when a marker exists', () => {
    expect(householdNeedsRebase(db, 'h1')).toBe(false) // never tracked

    setLastHousehold(db, 'h1')
    expect(householdNeedsRebase(db, 'h1')).toBe(false)
    expect(householdNeedsRebase(db, 'h2')).toBe(true)
  })

  it('is cleared by wipeLocalData (the start-clean choice re-tracks on first sync)', async () => {
    setLastHousehold(db, 'h1')
    wipeLocalData(db)
    expect(getLastHousehold(db)).toBeNull()
    expect(householdNeedsRebase(db, 'h2')).toBe(false)
  })
})

describe('local authorship', () => {
  it('stamps local creates with the device owner when known (null when anonymous)', async () => {
    const accountsRepo = createLocalAccountRepository(db)
    const anonymous = await accountsRepo.create({ name: 'Anon', currency: 'USD', openingBalance: 0 })
    expect(
      db.select().from(accounts).where(eq(accounts.id, anonymous.id)).get()?.userId,
    ).toBeNull()

    setOwnerUserId(db, 'user-1')
    const owned = await accountsRepo.create({ name: 'Owned', currency: 'USD', openingBalance: 0 })
    expect(
      db.select().from(accounts).where(eq(accounts.id, owned.id)).get()?.userId,
    ).toBe('user-1')
  })

  it('stores the server-delivered author on pull applies', async () => {
    const server = new UnionServer()
    server.seedFromServer(
      'account',
      'sibling-account-2',
      { name: 'Theirs', currency: 'USD', openingBalance: 10 },
      'author-user-2',
    )
    const engine = createSyncEngine({ db, transport: server })
    await engine.run()

    const row = db.select().from(accounts).where(eq(accounts.id, 'sibling-account-2')).get()
    expect(row?.userId).toBe('author-user-2')
  })
})
