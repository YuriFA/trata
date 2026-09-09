// Behavioral tests for the background-fetch task wiring: the registered
// executor runs a real engine cycle over the test database (node:sqlite) and
// maps the outcome to the platform's BackgroundFetchResult; an anonymous
// device never touches the network; registration is idempotent and a failed
// run reports Failed instead of rejecting.

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { SyncPullPage, SyncPushOperation, SyncPushResultItem } from '@trata/api'
import { createLocalCategoryRepository } from '@/entities/category'
import { createTestDatabase } from '@trata/local-data/testing'
import { setOwnerUserId, syncOutbox } from '@trata/local-data'
import type { LocalDatabase } from '@/shared/lib/db/database'
import { BACKGROUND_SYNC_TASK, registerBackgroundSync } from './background-sync'

// The transport seam lives in @trata/api (pushSyncOperations /
// pullSyncChanges); redirect it to a per-test holder so the module under test
// builds a real engine whose HTTP leg is fake.
const mockTransport = {
  push: async (_operations: SyncPushOperation[]): Promise<SyncPushResultItem[]> => [],
  pull: async (_cursor: number): Promise<SyncPullPage> => ({ changes: [], nextCursor: null }),
}

jest.mock('@trata/api', () => ({
  ...(jest.requireActual('@trata/api') as object),
  pushSyncOperations: (client: unknown, operations: SyncPushOperation[]) =>
    mockTransport.push(operations),
  pullSyncChanges: (client: unknown, cursor: number) => mockTransport.pull(cursor),
}))

// The real opener calls native expo-sqlite; tests hand it the node:sqlite
// database instead (or a rejection to exercise the Failed mapping).
const mockDbHolder: { db: LocalDatabase | null; openError: Error | null } = {
  db: null,
  openError: null,
}

jest.mock('@/shared/lib/db/database', () => ({
  openLocalDatabase: () =>
    mockDbHolder.openError
      ? Promise.reject(mockDbHolder.openError)
      : Promise.resolve(mockDbHolder.db),
}))

const mockRegisterTaskAsync = jest.fn((..._args: unknown[]) => Promise.resolve())

jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NoData: 1, NewData: 2, Failed: 3 },
  registerTaskAsync: (...args: unknown[]) => mockRegisterTaskAsync(...args),
}))

const mockDefineTask = jest.fn((..._args: unknown[]) => undefined)

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => mockDefineTask(...args),
  isTaskDefined: () => false,
}))

const CATEGORY = { name: 'Такси', type: 'expense' as const, icon: 'car', color: '#7c5cff' }

const RESULT = { NoData: 1, NewData: 2, Failed: 3 } as const

// Register once for the whole suite: the executor reads the per-test database
// and transport holders on every invocation, so each test just swaps them.
registerBackgroundSync()
const executor = mockDefineTask.mock.calls[0]?.[1] as () => Promise<number>

describe('background sync', () => {
  let db: LocalDatabase

  beforeEach(async () => {
    db = await createTestDatabase()
    mockDbHolder.db = db
    mockDbHolder.openError = null
  })

  it('registers the task exactly once across repeated calls', () => {
    registerBackgroundSync()
    registerBackgroundSync()

    expect(mockDefineTask).toHaveBeenCalledTimes(1)
    expect(mockDefineTask.mock.calls[0]?.[0]).toBe(BACKGROUND_SYNC_TASK)
    expect(mockRegisterTaskAsync).toHaveBeenCalledTimes(1)
    expect(mockRegisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK, {
      minimumInterval: 900,
      stopOnTerminate: false,
    })
  })

  it('reports NoData and skips the network on an anonymous device', async () => {
    mockTransport.push = async () => {
      throw new Error('must not be called')
    }

    await expect(executor()).resolves.toBe(RESULT.NoData)
  })

  it('runs a full cycle and reports NewData when work was pending', async () => {
    setOwnerUserId(db, 'user-1')
    await createLocalCategoryRepository(db).create(CATEGORY)

    mockTransport.push = async (operations) =>
      operations.map((op) => ({ opId: op.opId, status: 'applied' as const, version: 1 }))
    mockTransport.pull = async () => ({ changes: [], nextCursor: null })

    await expect(executor()).resolves.toBe(RESULT.NewData)
    // The pending create was confirmed: the outbox is drained.
    expect(db.select().from(syncOutbox).all()).toHaveLength(0)
  })

  it('reports NoData when authenticated but already in sync', async () => {
    setOwnerUserId(db, 'user-1')
    mockTransport.push = async () => []
    mockTransport.pull = async () => ({ changes: [], nextCursor: null })

    await expect(executor()).resolves.toBe(RESULT.NoData)
  })

  it('maps a thrown run to Failed without rejecting', async () => {
    mockDbHolder.openError = new Error('database failed to open')

    await expect(executor()).resolves.toBe(RESULT.Failed)
  })
})
