import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { Household } from '@trata/api'
import type { LocalDbApi } from '@/shared/lib/local-db'
import { UnauthorizedError } from '@/shared/lib/data'

// The household control-plane API is mocked: the store under test only needs
// getHousehold() for the startup gate.
vi.mock('@/entities/household', () => ({
  householdApi: {
    getHousehold: vi.fn<() => Promise<Household>>(),
  },
}))

// The auth store is mocked down to what the join flow reads (the owner id for
// the start-clean rebind).
vi.mock('@/entities/session', () => ({
  useAuthStore: () => ({ user: authUser }),
}))

vi.mock('@/shared/services/notification', () => ({
  notification: {
    mutationError: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    warning: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
  },
}))

// Mock the worker RPC surface: the join flow touches the household rebase,
// the meta wipe/owner binding, and the engine run.
const householdMock = {
  rebase: vi.fn<(householdId: string) => Promise<void>>(),
  getLastHousehold: vi.fn<() => Promise<string | null>>(),
  setLastHousehold: vi.fn<(householdId: string) => Promise<void>>(),
}
const metaMock = {
  getOwnerUserId: vi.fn<() => Promise<string | null>>(),
  setOwnerUserId: vi.fn<(userId: string) => Promise<void>>(),
  wipeLocalData: vi.fn<() => Promise<void>>(),
}
const syncMock = {
  run: vi.fn<(force?: boolean) => Promise<unknown>>().mockResolvedValue(undefined),
}
const localDbApi = {
  household: householdMock,
  meta: metaMock,
  sync: syncMock,
} as unknown as LocalDbApi

vi.mock('@/shared/lib/local-db', () => ({
  getLocalDbApi: () => Promise.resolve(localDbApi),
}))

const invalidateQueries = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
vi.mock('@pinia/colada', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pinia/colada')>()),
  useQueryCache: () => ({ invalidateQueries }),
}))

// Mutated by the auth-store mock; reset per test. Declared before the lazy
// imports below so the mocked factory closure always sees it initialized.
let authUser: { id: string } | null = { id: 'u1' }

// Import after the mocks are registered.
const { householdApi } = await import('@/entities/household')
const { useHouseholdJoinStore } = await import('./use-household-join')

const household: Household = {
  id: 'h2',
  createdAt: '2024-01-01T00:00:00Z',
  name: 'Семья',
  members: [
    {
      userId: 'u1',
      email: 'user@example.com',
      displayName: null,
      role: 'owner',
      joinedAt: '2024-01-01T00:00:00Z',
    },
  ],
}

describe('useHouseholdJoinStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    authUser = { id: 'u1' }
    householdMock.rebase.mockReset().mockResolvedValue(undefined)
    householdMock.getLastHousehold.mockReset().mockResolvedValue(null)
    householdMock.setLastHousehold.mockReset().mockResolvedValue(undefined)
    metaMock.setOwnerUserId.mockReset().mockResolvedValue(undefined)
    metaMock.wipeLocalData.mockReset().mockResolvedValue(undefined)
    syncMock.run.mockClear()
    invalidateQueries.mockClear().mockResolvedValue(undefined)
    vi.mocked(householdApi.getHousehold).mockReset()
  })

  describe('applyHouseholdChoice', () => {
    it('carry rebases for the new household, invalidates caches, and runs sync', async () => {
      const join = useHouseholdJoinStore()

      await join.applyHouseholdChoice(household, 'carry')

      expect(householdMock.rebase).toHaveBeenCalledWith(household.id)
      expect(metaMock.wipeLocalData).not.toHaveBeenCalled()
      expect(invalidateQueries).toHaveBeenCalledTimes(1)
      expect(syncMock.run).toHaveBeenCalledTimes(1)
    })

    it('clean wipes, rebinds the owner, stamps the marker, invalidates, and runs', async () => {
      const join = useHouseholdJoinStore()

      await join.applyHouseholdChoice(household, 'clean')

      expect(metaMock.wipeLocalData).toHaveBeenCalledTimes(1)
      expect(metaMock.setOwnerUserId).toHaveBeenCalledWith('u1')
      expect(householdMock.setLastHousehold).toHaveBeenCalledWith(household.id)
      expect(householdMock.rebase).not.toHaveBeenCalled()
      expect(invalidateQueries).toHaveBeenCalledTimes(1)
      expect(syncMock.run).toHaveBeenCalledTimes(1)
    })

    it('clean without a known user skips the owner rebind', async () => {
      authUser = null
      const join = useHouseholdJoinStore()

      await join.applyHouseholdChoice(household, 'clean')

      expect(metaMock.setOwnerUserId).not.toHaveBeenCalled()
      expect(householdMock.setLastHousehold).toHaveBeenCalledWith(household.id)
    })
  })

  describe('chooseHouseholdData (the shared choice dialog)', () => {
    it('parks a pending choice and applies the confirmed pick', async () => {
      const join = useHouseholdJoinStore()

      let settled = false
      const choice = join.chooseHouseholdData(household).then(() => {
        settled = true
      })
      expect(join.pending).not.toBeNull()
      expect(syncMock.run).not.toHaveBeenCalled()

      await join.confirmChoice('carry')
      await choice

      expect(settled).toBe(true)
      expect(join.pending).toBeNull()
      expect(householdMock.rebase).toHaveBeenCalledWith(household.id)
    })
  })

  describe('ensureCurrentHousehold (the startup gate, design D7)', () => {
    it('stamps the marker on a fresh (null) device and runs no dialog', async () => {
      vi.mocked(householdApi.getHousehold).mockResolvedValue(household)
      householdMock.getLastHousehold.mockResolvedValue(null)
      const join = useHouseholdJoinStore()

      await join.ensureCurrentHousehold()

      expect(householdMock.setLastHousehold).toHaveBeenCalledWith(household.id)
      expect(join.pending).toBeNull()
    })

    it('stamps the marker when the device already tracks the household', async () => {
      vi.mocked(householdApi.getHousehold).mockResolvedValue(household)
      householdMock.getLastHousehold.mockResolvedValue(household.id)
      const join = useHouseholdJoinStore()

      await join.ensureCurrentHousehold()

      expect(householdMock.setLastHousehold).toHaveBeenCalledWith(household.id)
      expect(join.pending).toBeNull()
    })

    it('holds on a stale marker until the choice is applied', async () => {
      vi.mocked(householdApi.getHousehold).mockResolvedValue(household)
      householdMock.getLastHousehold.mockResolvedValue('h-old')
      const join = useHouseholdJoinStore()

      const gate = join.ensureCurrentHousehold()
      await flushPromises()
      expect(join.pending).not.toBeNull()
      expect(householdMock.rebase).not.toHaveBeenCalled()

      await join.confirmChoice('clean')
      await gate

      expect(join.pending).toBeNull()
      expect(metaMock.wipeLocalData).toHaveBeenCalledTimes(1)
      expect(syncMock.run).toHaveBeenCalled()
    })

    it('rejects when the household cannot be fetched (offline) - the run-policy then skips the run', async () => {
      vi.mocked(householdApi.getHousehold).mockRejectedValue(new UnauthorizedError('no session'))
      const join = useHouseholdJoinStore()

      await expect(join.ensureCurrentHousehold()).rejects.toThrow(UnauthorizedError)
      expect(join.pending).toBeNull()
      expect(householdMock.setLastHousehold).not.toHaveBeenCalled()
    })
  })
})
