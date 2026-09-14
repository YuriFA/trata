import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises } from '@vue/test-utils'
import type { Household, HouseholdInvitation } from '@trata/api'
import { useHousehold } from './use-household'
import { useHouseholdActions } from './use-household-actions'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

vi.mock('../api/household-api', () => ({
  householdApi: {
    getHousehold: vi.fn<() => Promise<unknown>>(),
    rename: vi.fn<(name: string | null) => Promise<unknown>>(),
    updateDisplayName: vi.fn<(displayName: string) => Promise<unknown>>(),
    invite: vi.fn<(email: string) => Promise<unknown>>(),
    revokeInvitation: vi.fn<(invitationId: string) => Promise<void>>(),
    generateCode: vi.fn<() => Promise<unknown>>(),
    revokeCode: vi.fn<() => Promise<void>>(),
    removeMember: vi.fn<(userId: string) => Promise<void>>(),
    dissolve: vi.fn<() => Promise<void>>(),
  },
}))

// The mocked module is also re-imported by the composables under test.
const { householdApi } = await import('../api/household-api')
type MockFn = ReturnType<typeof vi.fn<() => unknown>>
const householdApiMocks = householdApi as unknown as {
  getHousehold: MockFn
  rename: MockFn
  updateDisplayName: MockFn
  invite: MockFn
  revokeInvitation: MockFn
  generateCode: MockFn
  revokeCode: MockFn
  removeMember: MockFn
  dissolve: MockFn
}

function household(name: string | null): Household {
  return {
    id: 'hh-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    currency: 'RUB',
    name,
    members: [
      {
        userId: 'u1',
        email: 'owner@example.com',
        displayName: null,
        role: 'owner',
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  }
}

const invitation: HouseholdInvitation = {
  id: 'inv-1',
  email: 'wife@example.com',
  status: 'pending',
  createdAt: '2026-08-27T00:00:00.000Z',
  expiresAt: '2026-09-03T00:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
}

function mountHarness<T>(composable: () => T): { result: T } {
  let result!: T
  const TestComponent = defineComponent({
    setup() {
      result = composable()
      return () => h('div')
    },
  })
  mountWithProviders(TestComponent)
  return { result }
}

beforeEach(() => {
  vi.clearAllMocks()
  householdApiMocks.getHousehold.mockResolvedValue(household('Before'))
  householdApiMocks.rename.mockResolvedValue(household('After'))
  householdApiMocks.updateDisplayName.mockResolvedValue('Жена')
  householdApiMocks.invite.mockResolvedValue(invitation)
  householdApiMocks.revokeInvitation.mockResolvedValue(undefined)
  householdApiMocks.generateCode.mockResolvedValue({
    code: 'AB23CD45',
    createdAt: '2026-08-27T00:00:00.000Z',
  })
  householdApiMocks.revokeCode.mockResolvedValue(undefined)
  householdApiMocks.removeMember.mockResolvedValue(undefined)
  householdApiMocks.dissolve.mockResolvedValue(undefined)
})

describe('useHouseholdActions', () => {
  it.each([
    ['rename', 'После правки'],
    ['updateDisplayName', 'Жена'],
    ['invite', 'wife@example.com'],
    ['revokeInvitation', 'inv-1'],
    ['generateCode', undefined],
    ['revokeCode', undefined],
    ['removeMember', 'u2'],
    ['dissolve', undefined],
  ] as const)(
    '%s wraps the API method and invalidates the household query',
    async (action, vars) => {
      const { result } = mountHarness(() => {
        const query = useHousehold()
        const actions = useHouseholdActions()
        return { query, actions }
      })

      await flushPromises()
      expect(result.query.data.value?.name).toBe('Before')

      const mutation = result.actions[action]
      await mutation.mutateAsync(vars as never)

      const apiMethod = householdApiMocks[action]
      expect(apiMethod).toHaveBeenCalledTimes(1)
      // Zero-arg actions (generateCode/revokeCode/dissolve) forward no args.
      expect(apiMethod.mock.calls[0]).toEqual(vars === undefined ? [] : [vars])

      // Invalidation refetched the household query against the (mocked) server.
      await flushPromises()
      expect(householdApiMocks.getHousehold).toHaveBeenCalledTimes(2)
    },
  )

  it('still invalidates when the action rejects', async () => {
    householdApiMocks.rename.mockRejectedValue(new Error('boom'))
    const { result } = mountHarness(() => {
      const query = useHousehold()
      const actions = useHouseholdActions()
      return { query, actions }
    })
    await flushPromises()
    expect(householdApiMocks.getHousehold).toHaveBeenCalledTimes(1)

    await expect(result.actions.rename.mutateAsync('X')).rejects.toThrow('boom')
    await flushPromises()

    // onSettled invalidation refetched the household query despite the error.
    expect(householdApiMocks.getHousehold).toHaveBeenCalledTimes(2)
  })
})
