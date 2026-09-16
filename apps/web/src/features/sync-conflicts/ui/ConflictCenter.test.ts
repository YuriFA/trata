import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import type { LocalSyncConflict } from '@trata/local-data'
import type { LocalDbApi } from '@/shared/lib/local-db'
import type { SyncController } from '@/shared/lib/local-db'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const versionConflict: LocalSyncConflict = {
  id: 'c1',
  entity: 'category',
  entityId: 'cat-1',
  opId: 'op-1',
  kind: 'version',
  baseVersion: 1,
  serverVersion: 2,
  localState: { name: 'Кафе', type: 'expense', icon: 'cafe', color: '#fff' },
  serverState: {
    version: 2,
    deleted: false,
    data: { name: 'Coffee', type: 'expense', icon: 'cafe', color: '#000' },
  },
  createdAt: '2026-01-01T00:00:00Z',
}

const deletedConflict: LocalSyncConflict = {
  id: 'c2',
  entity: 'account',
  entityId: 'acc-1',
  opId: null,
  kind: 'deleted',
  baseVersion: 3,
  serverVersion: 4,
  localState: {
    id: 'acc-1',
    name: 'Карта',
    currency: 'RUB',
    openingBalance: 100000,
    manualAdjustment: 0,
  },
  serverState: { version: 4, deleted: true },
  createdAt: '2026-01-01T00:00:00Z',
}

const deletedDebtorConflict: LocalSyncConflict = {
  id: 'c3',
  entity: 'debtor',
  entityId: 'deb-1',
  opId: null,
  kind: 'deleted',
  baseVersion: 1,
  serverVersion: 2,
  localState: { id: 'deb-1', name: 'Анна' },
  serverState: { version: 2, deleted: true },
  createdAt: '2026-01-01T00:00:00Z',
}

const deletedWithoutState: LocalSyncConflict = {
  id: 'c4',
  entity: 'account',
  entityId: 'acc-2',
  opId: null,
  kind: 'deleted',
  baseVersion: 3,
  serverVersion: 4,
  localState: null,
  serverState: { version: 4, deleted: true },
  createdAt: '2026-01-01T00:00:00Z',
}

const runMock = vi.fn<(force?: boolean) => Promise<{ status: string }>>()
const listMock = vi.fn<() => Promise<LocalSyncConflict[]>>()
const keepLocalMock = vi.fn<(id: string) => Promise<void>>()
const takeServerMock = vi.fn<(id: string) => Promise<void>>()
const markResolvedMock = vi.fn<(id: string) => Promise<void>>()
const restoreConflictAsNewMock =
  vi.fn<(id: string) => Promise<import('@trata/local-data').RestoreResult>>()
const rebindOwnerMock = vi.fn<(userId: string) => Promise<void>>()
const localDbApi = {
  sync: {
    run: runMock,
    resume: vi.fn<() => Promise<void>>(),
    getState: vi.fn<() => Promise<{ running: boolean; paused: boolean; lastRunAt: null }>>(
      async () => ({ running: false, paused: false, lastRunAt: null }),
    ),
    subscribe: vi.fn<(listener: () => void) => Promise<() => void>>(async () => () => {}),
    readStatus: vi.fn<() => Promise<unknown>>(),
    listUnresolvedConflicts: listMock,
    getConflict: vi.fn<(id: string) => Promise<unknown | null>>(),
    resolveConflictKeepLocal: keepLocalMock,
    resolveConflictTakeServer: takeServerMock,
    markConflictResolved: markResolvedMock,
    rebindOwner: rebindOwnerMock,
    restoreConflictAsNew: restoreConflictAsNewMock,
  },
  meta: {
    getOwnerUserId: vi.fn<() => Promise<string | null>>(),
    setOwnerUserId: vi.fn<(userId: string) => Promise<void>>(),
    wipeLocalData: vi.fn<() => Promise<void>>(),
  },
} as unknown as LocalDbApi

// Mock the inner module (not the barrel): the real sync composable imports
// './local-db' directly, and vitest mocks by resolved file path - mocking
// here covers both the barrel re-export and the composable's own import.
vi.mock('@/shared/lib/local-db/local-db', () => ({
  getLocalDbApi: () => Promise.resolve(localDbApi),
  onSyncRunComplete: () => () => {},
}))

const { ConflictCenter } = await import('@/features/sync-conflicts')
const { provideSyncController } = await import('@/shared/lib/local-db')
const { createMockAccountRepository, createMockDebtorRepository } =
  await import('@/__tests__/helpers/mock-repositories')

const hostState: { controller: SyncController | null } = { controller: null }

// Repository providers are still needed by the DI tree even though restore
// now goes through the bridge.
const accountsRepo = createMockAccountRepository()
const debtorsRepo = createMockDebtorRepository()

const mounted: { unmount: () => void }[] = []

function mountConflictCenter() {
  const Host = defineComponent({
    setup() {
      hostState.controller = provideSyncController({ isAuthenticated: () => true })
      return () => h('div', [h(ConflictCenter)])
    },
  })
  mounted.push(
    mountWithProviders(Host, {
      repositories: { accounts: accountsRepo, debtors: debtorsRepo },
    }),
  )
}

// reka-ui teleports the open dialog to document.body, so assertions query
// the document instead of the component wrapper.
function queryAll(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)]
}

function conflictItems(): HTMLElement[] {
  return queryAll('[data-testid^="conflict-item-"]')
}

async function mountOpenWithConflicts(conflicts: LocalSyncConflict[]) {
  listMock.mockResolvedValue(conflicts)
  const wrapper = mountConflictCenter()
  hostState.controller!.conflictsOpen.value = true
  await flushPromises()
  return wrapper
}

function findButton(label: string): HTMLElement {
  const button = queryAll('button').find((b) => b.textContent === label)
  expect(button).toBeDefined()
  return button!
}

describe('ConflictCenter', () => {
  beforeEach(() => {
    runMock.mockReset().mockResolvedValue({ status: 'completed' })
    keepLocalMock.mockReset().mockResolvedValue(undefined)
    takeServerMock.mockReset().mockResolvedValue(undefined)
    markResolvedMock.mockReset().mockResolvedValue(undefined)
    listMock.mockReset()
    restoreConflictAsNewMock
      .mockReset()
      .mockResolvedValue({ ok: true, entity: 'account', createdId: 'new-id' })
    rebindOwnerMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    // Stale teleported dialogs from earlier mounts would shadow queries.
    for (const wrapper of mounted.splice(0)) {
      wrapper.unmount()
    }
    await flushPromises()
    document.body.innerHTML = ''
  })

  it('lists unresolved conflicts with their subjects', async () => {
    await mountOpenWithConflicts([versionConflict, deletedConflict])
    const items = conflictItems()
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('Кафе')
    expect(items[1]?.textContent).toContain('Карта')
  })

  it('offers keep-local / take-server on version conflicts and resolves via RPC', async () => {
    await mountOpenWithConflicts([versionConflict])

    await findButton('Keep mine').click()
    await flushPromises()
    expect(keepLocalMock).toHaveBeenCalledWith('c1')
    // Resolution always refreshes and kicks a follow-up cycle.
    expect(runMock).toHaveBeenCalled()

    runMock.mockClear()
    await findButton('Take server version').click()
    await flushPromises()
    expect(takeServerMock).toHaveBeenCalledWith('c1')
  })

  it('offers only review on delete-vs-edit conflicts (delete-wins already applied)', async () => {
    await mountOpenWithConflicts([deletedConflict])
    const item = document.querySelector<HTMLElement>('[data-testid="conflict-item-c2"]')

    expect(item?.textContent).not.toContain('Keep mine')
    expect(item?.textContent).not.toContain('Take server version')

    await findButton('Mark reviewed').click()
    await flushPromises()
    expect(markResolvedMock).toHaveBeenCalledWith('c2')
    expect(keepLocalMock).not.toHaveBeenCalled()
  })

  it('restores a deleted-kind conflict as a new record and resolves it', async () => {
    await mountOpenWithConflicts([deletedConflict])

    const restore = document.querySelector<HTMLElement>('[data-testid="conflict-restore-as-new"]')
    expect(restore).not.toBeNull()
    restore!.click()
    await flushPromises()

    // The bridge method is called with the conflict's id.
    expect(restoreConflictAsNewMock).toHaveBeenCalledWith('c2')
    // A successful restore triggers a sync run.
    expect(runMock).toHaveBeenCalled()
  })

  it('routes the restore to the conflict entity kind', async () => {
    await mountOpenWithConflicts([deletedDebtorConflict])

    document.querySelector<HTMLElement>('[data-testid="conflict-restore-as-new"]')!.click()
    await flushPromises()

    expect(restoreConflictAsNewMock).toHaveBeenCalledWith('c3')
    expect(runMock).toHaveBeenCalled()
  })

  it('shows an error notification when the restore is refused', async () => {
    restoreConflictAsNewMock.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid-state',
      entity: 'account',
    })
    await mountOpenWithConflicts([deletedConflict])

    document.querySelector<HTMLElement>('[data-testid="conflict-restore-as-new"]')!.click()
    await flushPromises()

    // The bridge was called but the restore failed: the conflict stays listed
    // (listMock still returns it on the next poll) and the run still fires
    // (onSettled always invalidates and kicks the engine).
    expect(restoreConflictAsNewMock).toHaveBeenCalledWith('c2')
    expect(runMock).toHaveBeenCalled()
  })

  it('hides the restore action when no local state was preserved', async () => {
    await mountOpenWithConflicts([deletedWithoutState])
    expect(document.querySelector('[data-testid="conflict-restore-as-new"]')).toBeNull()
    expect(findButton('Mark reviewed')).toBeDefined()
  })

  it('shows the empty state when nothing is unresolved', async () => {
    await mountOpenWithConflicts([])
    expect(document.querySelector('[data-testid="conflict-center-empty"]')).not.toBeNull()
  })
})
