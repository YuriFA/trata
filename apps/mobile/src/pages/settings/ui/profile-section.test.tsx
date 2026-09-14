// The «Профиль» settings group (household-ux 2.5): the account email, the
// member-view display name (email fallback), the preview line, and the
// display-name sheet - validation, live preview, and the update mutation.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Household } from '@trata/api'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { ProfileSection } from './profile-section'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function household(displayName: string | null): Household {
  return {
    id: 'hh-1',
    currency: 'RUB',
    createdAt: '2026-08-01T00:00:00.000Z',
    name: null,
    members: [
      {
        userId: USER_ID,
        email: 'me@example.com',
        displayName,
        role: 'owner',
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  }
}

let mockAuthStatus: 'authenticated' | 'anonymous' = 'authenticated'
let mockHousehold: Household | null = household(null)

jest.mock('@/entities/household/api/household-api', () => ({
  householdApi: {
    updateDisplayName: jest.fn(),
  },
}))

jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: mockHousehold }),
}))

jest.mock('@/entities/session', () => ({
  useAuth: () => ({
    status: mockAuthStatus,
    user: mockAuthStatus === 'authenticated' ? { id: USER_ID, email: 'me@example.com' } : null,
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { householdApi } = require('@/entities/household/api/household-api') as {
  householdApi: { updateDisplayName: ReturnType<typeof jest.fn> }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthStatus = 'authenticated'
  mockHousehold = household(null)
  householdApi.updateDisplayName.mockResolvedValue('Жена')
})

function renderSection() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BottomSheetProvider>
        <ProfileSection />
      </BottomSheetProvider>
    </QueryClientProvider>,
  )
}

describe('ProfileSection', () => {
  it('renders nothing while anonymous', () => {
    mockAuthStatus = 'anonymous'
    renderSection()

    expect(screen.queryByTestId('settings-profile-section')).toBeNull()
  })

  it('shows the email fallback preview when no display name is set', () => {
    renderSection()

    expect(screen.getByTestId('settings-profile-email')).toHaveTextContent('me@example.com')
    expect(screen.getByTestId('settings-profile-display-name')).toHaveTextContent('me@example.com')
    expect(screen.getByTestId('settings-profile-preview')).toHaveTextContent(
      'Без имени участники видят ваш email: me@example.com',
    )
  })

  it('shows the member-view preview when a display name is set', () => {
    mockHousehold = household('Юрий')
    renderSection()

    expect(screen.getByTestId('settings-profile-display-name')).toHaveTextContent('Юрий')
    expect(screen.getByTestId('settings-profile-preview')).toHaveTextContent(
      'Участники видят вас как: Юрий',
    )
  })

  it('edits the name with a live preview and saves through the API', async () => {
    renderSection()

    fireEvent.press(screen.getByTestId('settings-profile-edit-name'))
    const input = await screen.findByTestId('settings-display-name-input')

    // The live preview mirrors the typed value, with the email fallback when
    // cleared (the API cannot reset the name, so empty is invalid).
    fireEvent.changeText(input, 'Жена')
    expect(screen.getByTestId('settings-display-name-preview')).toHaveTextContent(
      'Участники видят вас как: Жена',
    )
    fireEvent.changeText(input, '')
    expect(screen.getByTestId('settings-display-name-preview')).toHaveTextContent(
      'Без имени участники видят ваш email: me@example.com',
    )

    fireEvent.changeText(input, ' ')
    fireEvent.press(screen.getByTestId('settings-display-name-submit'))
    expect(await screen.findByTestId('settings-display-name-error')).toHaveTextContent(
      'Введите имя',
    )
    expect(householdApi.updateDisplayName).not.toHaveBeenCalled()

    fireEvent.changeText(input, 'Жена')
    fireEvent.press(screen.getByTestId('settings-display-name-submit'))
    await waitFor(() => expect(householdApi.updateDisplayName).toHaveBeenCalledWith('Жена'))
    await waitFor(() => expect(screen.queryByTestId('settings-display-name-sheet')).toBeNull())
  })
})
