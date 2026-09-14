// The household management mutation set (household-ux 1.1): every action
// wraps its API method and invalidates the household query cache on settle,
// so the section refetches the server's answer. The API module is mocked at
// its boundary; the query + mutations run for real over the test client.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Household, HouseholdInvitation } from '@trata/api'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { useHousehold } from './use-household'
import { useHouseholdActions } from './use-household-actions'

jest.mock('../api/household-api', () => ({
  householdApi: {
    getHousehold: jest.fn(),
    rename: jest.fn(),
    updateDisplayName: jest.fn(),
    invite: jest.fn(),
    revokeInvitation: jest.fn(),
    generateCode: jest.fn(),
    revokeCode: jest.fn(),
    removeMember: jest.fn(),
    dissolve: jest.fn(),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { householdApi } = require('../api/household-api') as {
  householdApi: Record<string, ReturnType<typeof jest.fn>>
}

function household(name: string | null): Household {
  return {
    id: 'hh-1',
    currency: 'RUB',
    createdAt: '2026-08-01T00:00:00.000Z',
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

type MutationLike = { mutateAsync: (vars: unknown) => Promise<unknown> }
let run: (action: string, vars?: unknown) => Promise<unknown>

function Harness() {
  const query = useHousehold()
  const actions = useHouseholdActions()
  const mutations = actions as unknown as Record<string, MutationLike>
  run = (action, vars) => mutations[action].mutateAsync(vars)
  return <Text testID="harness-name">{query.data ? (query.data.name ?? '∅') : '…'}</Text>
}

beforeEach(() => {
  jest.clearAllMocks()
  householdApi.getHousehold.mockResolvedValue(household('Before'))
  householdApi.rename.mockResolvedValue(household('After'))
  householdApi.updateDisplayName.mockResolvedValue('Жена')
  householdApi.invite.mockResolvedValue(invitation)
  householdApi.revokeInvitation.mockResolvedValue(undefined)
  householdApi.generateCode.mockResolvedValue({
    code: 'AB23CD45',
    createdAt: '2026-08-27T00:00:00.000Z',
  })
  householdApi.revokeCode.mockResolvedValue(undefined)
  householdApi.removeMember.mockResolvedValue(undefined)
  householdApi.dissolve.mockResolvedValue(undefined)
})

describe('useHouseholdActions', () => {
  const cases: Array<[action: string, vars: string | undefined]> = [
    ['rename', 'После правки'],
    ['updateDisplayName', 'Жена'],
    ['invite', 'wife@example.com'],
    ['revokeInvitation', 'inv-1'],
    ['generateCode', undefined],
    ['revokeCode', undefined],
    ['removeMember', 'u2'],
    ['dissolve', undefined],
  ]

  it.each(cases)(
    '%s wraps the API method and invalidates the household query',
    async (action, vars) => {
      render(
        <QueryClientProvider client={createQueryClient()}>
          <Harness />
        </QueryClientProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('harness-name')).toHaveTextContent('Before'))

      await run(action, vars)

      const apiMethod = householdApi[action]
      expect(apiMethod).toHaveBeenCalledTimes(1)
      // Zero-arg actions (generateCode/revokeCode/dissolve) forward no args.
      expect(apiMethod.mock.calls[0]).toEqual(vars === undefined ? [] : [vars])
      // Invalidation refetched the household query against the (mocked) server.
      await waitFor(() => expect(householdApi.getHousehold).toHaveBeenCalledTimes(2))
    },
  )

  it('still invalidates when the action rejects', async () => {
    householdApi.rename.mockRejectedValue(new Error('boom'))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness />
      </QueryClientProvider>,
    )
    await screen.findByTestId('harness-name')
    await waitFor(() => expect(screen.getByTestId('harness-name')).toHaveTextContent('Before'))

    await expect(run('rename', 'X')).rejects.toThrow('boom')
    await waitFor(() => expect(householdApi.getHousehold).toHaveBeenCalledTimes(2))
  })
})
