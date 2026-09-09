import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import type { SyncEngineState, SyncStatusSnapshot } from '@trata/local-data'
import type { LocalDbApi } from '@/shared/lib/local-db'
import type { SyncController } from '@/shared/lib/local-db'
import type { User } from '@/entities/session'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

// The worker RPC surface, mocked: the engine state listener is captured so
// tests can push state changes exactly like the worker would.
const status: SyncStatusSnapshot = {
  pendingOperations: 0,
  unresolvedConflicts: 0,
  lastSyncedAt: null,
  failingOperations: 0,
  lastError: null,
}
let engineState: SyncEngineState = { running: false, paused: false, lastRunAt: null }
let stateListener: (() => void) | null = null

const runMock = vi.fn<(force?: boolean) => Promise<{ status: string }>>()
const localDbApi = {
  sync: {
    run: runMock,
    resume: vi.fn<() => Promise<void>>(),
    getState: vi.fn<() => Promise<typeof engineState>>(async () => engineState),
    subscribe: vi.fn<(listener: () => void) => Promise<() => void>>(async (listener) => {
      stateListener = listener
      return () => {}
    }),
    readStatus: vi.fn<() => Promise<typeof status>>(async () => status),
    listUnresolvedConflicts: vi.fn<() => Promise<unknown[]>>(),
    getConflict: vi.fn<(id: string) => Promise<unknown | null>>(),
    resolveConflictKeepLocal: vi.fn<(id: string) => Promise<void>>(),
    resolveConflictTakeServer: vi.fn<(id: string) => Promise<void>>(),
    markConflictResolved: vi.fn<(id: string) => Promise<void>>(),
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

const { SyncStatusBadge } = await import('@/widgets/sync-status')
const { provideSyncController } = await import('@/shared/lib/local-db')
const { useAuthStore } = await import('@/entities/session')

const user: User = {
  id: 'u1',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const hostState: { controller: SyncController | null } = { controller: null }

/** Mounts the badge with the sync controller provided, as AppShell does. */
function mountBadge(compact = false) {
  const Host = defineComponent({
    setup() {
      hostState.controller = provideSyncController({ isAuthenticated: () => true })
      return () => h('div', [h(SyncStatusBadge, { compact })])
    },
  })
  return mountWithProviders(Host)
}

async function mountAuthenticated(compact = false) {
  const wrapper = mountBadge(compact)
  const auth = useAuthStore()
  auth.user = user
  auth.status = 'authenticated'
  await flushPromises()
  return wrapper
}

function pushEngineState(next: SyncEngineState) {
  engineState = next
  stateListener?.()
}

describe('SyncStatusBadge', () => {
  beforeEach(() => {
    status.pendingOperations = 0
    status.unresolvedConflicts = 0
    status.failingOperations = 0
    status.lastError = null
    engineState = { running: false, paused: false, lastRunAt: null }
    runMock.mockReset().mockResolvedValue({ status: 'completed' })
    stateListener = null
  })

  it('is hidden while anonymous (nothing to sync)', async () => {
    const wrapper = mountBadge()
    await flushPromises()
    expect(wrapper.find('[data-testid="sync-status-badge"]').exists()).toBe(false)
  })

  it('shows the synced state when idle with an empty outbox', async () => {
    const wrapper = await mountAuthenticated()
    expect(wrapper.find('[data-testid="sync-status-synced"]').text()).toBe('Synced')
  })

  it('shows the pending state with the outbox count', async () => {
    status.pendingOperations = 3
    const wrapper = await mountAuthenticated()
    expect(wrapper.find('[data-testid="sync-status-pending"]').text()).toContain('3')
  })

  it('shows the running state while a cycle is in flight', async () => {
    const wrapper = await mountAuthenticated()
    pushEngineState({ running: true, paused: false, lastRunAt: null })
    await flushPromises()
    expect(wrapper.find('[data-testid="sync-status-running"]').exists()).toBe(true)
  })

  it('shows the paused state after a 401', async () => {
    const wrapper = await mountAuthenticated()
    pushEngineState({ running: false, paused: true, lastRunAt: null })
    await flushPromises()
    expect(wrapper.find('[data-testid="sync-status-paused"]').exists()).toBe(true)
  })

  it('shows the conflicts state and opens the conflict center on click', async () => {
    status.unresolvedConflicts = 2
    const wrapper = await mountAuthenticated()
    expect(wrapper.find('[data-testid="sync-status-conflicts"]').text()).toContain('2')

    await wrapper.find('[data-testid="sync-status-badge"]').trigger('click')
    expect(hostState.controller?.conflictsOpen.value).toBe(true)
  })

  it('shows the failing state with the rejected count and last error tooltip', async () => {
    status.pendingOperations = 5
    status.failingOperations = 4
    status.lastError = 'INVALID_REFS: invalid references'
    const wrapper = await mountAuthenticated()

    const label = wrapper.find('[data-testid="sync-status-failing"]')
    expect(label.text()).toContain('4')
    expect(wrapper.find('[data-testid="sync-status-pending"]').exists()).toBe(false)
    // The raw stored error is one hover away - no devtools needed.
    expect(wrapper.find('[data-testid="sync-status-badge"]').attributes('title')).toBe(
      'INVALID_REFS: invalid references',
    )
  })

  it('keeps the failing state over paused and pending', async () => {
    status.pendingOperations = 5
    status.failingOperations = 1
    status.lastError = 'CATEGORY_IN_USE: category has transactions'
    pushEngineState({ running: false, paused: true, lastRunAt: null })
    const wrapper = await mountAuthenticated()

    expect(wrapper.find('[data-testid="sync-status-failing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sync-status-paused"]').exists()).toBe(false)
  })

  it('forces a manual run on click when no conflicts exist', async () => {
    const wrapper = await mountAuthenticated()
    await wrapper.find('[data-testid="sync-status-badge"]').trigger('click')
    await flushPromises()
    expect(runMock).toHaveBeenCalledWith(true)
  })

  // Compact (<1024px top bar) variant: icon-only, state in an sr-only span,
  // pending count as a visible corner badge.
  it('compact variant drops the label but keeps the state testid', async () => {
    const wrapper = await mountAuthenticated(true)

    const badge = wrapper.find('[data-testid="sync-status-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('size-7')
    expect(badge.find('[data-testid="sync-status-synced"]').exists()).toBe(true)
    // No visible full-pill label - the state span is screen-reader only.
    expect(wrapper.find('[data-testid="sync-status-synced"]').classes()).toContain('sr-only')
  })

  it('compact pending state shows the outbox count as a corner badge', async () => {
    status.pendingOperations = 3
    const wrapper = await mountAuthenticated(true)

    expect(wrapper.find('[data-testid="sync-status-pending"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sync-status-badge"]').text()).toContain('3')
  })

  it('compact failing state shows the rejected count as a corner badge', async () => {
    status.pendingOperations = 7
    status.failingOperations = 2
    status.lastError = 'INVALID_REFS: invalid references'
    const wrapper = await mountAuthenticated(true)

    expect(wrapper.find('[data-testid="sync-status-failing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sync-status-badge"]').text()).toContain('2')
  })
})
