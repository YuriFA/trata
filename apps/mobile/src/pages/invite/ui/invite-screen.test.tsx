// Invitation accept screen states (household-join design D6): the preview
// render (with the inviter-prefix name fallback), the 401 round-trip to
// login carrying the redirect, the wrong-account card, dead-invite mapped
// errors with the way home, and the accept wiring applying the screen
// choice directly (carry → rebase path, clean → wipe path) with no second
// dialog. The household API, the join feature and the router are mocked at
// their boundaries; the query runs through a real query client.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  NotFoundError,
  RepositoryError,
  UnauthorizedError,
  type Household,
  type HouseholdInvitationPreview,
} from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { InviteScreen } from './invite-screen'

const TOKEN = 'invite-token-1'
const USER = { id: 'u-1', email: 'wife@example.com' }

const PREVIEW: HouseholdInvitationPreview = {
  householdName: 'Семья',
  membersCount: 3,
  inviterEmail: 'owner@example.com',
  inviterDisplayName: null,
  expiresAt: '2026-09-01T00:00:00.000Z',
}

const JOINED_HOUSEHOLD: Household = {
  id: 'hh-target',
  createdAt: '2026-08-01T00:00:00.000Z',
  name: 'Семья',
  members: [],
}

const mockPerformJoin: ReturnType<typeof jest.fn> = jest.fn()

jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  householdApi: {
    previewInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
  },
}))

jest.mock('@/entities/session', () => ({
  useAuth: () => ({
    status: mockAuthStatus,
    user: mockAuthStatus === 'authenticated' ? USER : null,
  }),
}))

jest.mock('@/features/household-join', () => ({
  useHouseholdJoin: () => ({ performHouseholdJoin: mockPerformJoin }),
}))

jest.mock('expo-router', () => {
  const mockRouter = { push: jest.fn(), navigate: jest.fn(), back: jest.fn() }
  return { router: mockRouter, useRouter: () => mockRouter }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { householdApi } = require('@/entities/household') as {
  householdApi: {
    previewInvitation: ReturnType<typeof jest.fn>
    acceptInvitation: ReturnType<typeof jest.fn>
  }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router } = require('expo-router') as {
  router: { push: ReturnType<typeof jest.fn>; navigate: ReturnType<typeof jest.fn> }
}

let mockAuthStatus: 'restoring' | 'anonymous' | 'authenticated' = 'authenticated'

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthStatus = 'authenticated'
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  householdApi.previewInvitation.mockResolvedValue(PREVIEW)
  householdApi.acceptInvitation.mockResolvedValue(JOINED_HOUSEHOLD)
  mockPerformJoin.mockResolvedValue(undefined)
})

function renderInvite() {
  return render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 812 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <InviteScreen token={TOKEN} />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  )
}

function emailMismatchError(): RepositoryError {
  // The backend's 403 falls through to the coarse `unknown` code carrying
  // the machine apiCode (mapApiError).
  return new RepositoryError('forbidden', 'unknown', {
    apiCode: 'HOUSEHOLD_INVITATION_EMAIL_MISMATCH',
  })
}

describe('InviteScreen', () => {
  it('renders the preview: household name, members count, inviter, carry preselected', async () => {
    renderInvite()

    expect(await screen.findByTestId('invite-household-name')).toHaveTextContent('Семья')
    expect(screen.getByTestId('invite-members-count')).toHaveTextContent('Участников: 3')
    expect(screen.getByTestId('invite-inviter')).toHaveTextContent(
      'Вас пригласил: owner@example.com',
    )
    expect(householdApi.previewInvitation).toHaveBeenCalledWith(TOKEN)
    expect(screen.getByTestId('invite-choice-carry').props.accessibilityState.selected).toBe(true)
    expect(screen.getByTestId('invite-choice-clean').props.accessibilityState.selected).toBe(false)
  })

  it('falls back to the inviter email prefix when the household has no name', async () => {
    householdApi.previewInvitation.mockResolvedValue({ ...PREVIEW, householdName: null })
    renderInvite()

    expect(await screen.findByTestId('invite-household-name')).toHaveTextContent('owner')
  })

  it('redirects to login with the invite return path on 401, without an error card', async () => {
    householdApi.previewInvitation.mockRejectedValue(new UnauthorizedError('no session'))
    renderInvite()

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/login',
        params: { redirect: `/invite/${TOKEN}` },
      }),
    )
    expect(screen.queryByTestId('invite-screen-error')).toBeNull()
  })

  it('shows the wrong-account card naming the signed-in email', async () => {
    householdApi.previewInvitation.mockRejectedValue(emailMismatchError())
    renderInvite()

    expect(await screen.findByTestId('invite-screen-email-mismatch')).toBeTruthy()
    expect(screen.getByText('Приглашение отправлено на другой адрес')).toBeTruthy()
    expect(screen.getByText('Вы вошли как wife@example.com.')).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('shows the mapped dead-invitation text and returns home on «Понятно»', async () => {
    householdApi.previewInvitation.mockRejectedValue(
      new NotFoundError('gone', { apiCode: 'HOUSEHOLD_INVITATION_NOT_FOUND' }),
    )
    renderInvite()

    expect(await screen.findByTestId('invite-screen-error-text')).toHaveTextContent(
      'Приглашение не найдено',
    )
    fireEvent.press(screen.getByTestId('invite-screen-ok'))
    expect(router.navigate).toHaveBeenCalledWith('/')
  })

  it('accepts with the carry choice: accept API → shared join feature → home, no second dialog', async () => {
    renderInvite()
    await screen.findByTestId('invite-accept-button')

    fireEvent.press(screen.getByTestId('invite-accept-button'))

    await waitFor(() => expect(householdApi.acceptInvitation).toHaveBeenCalledWith(TOKEN))
    await waitFor(() => expect(mockPerformJoin).toHaveBeenCalledWith(JOINED_HOUSEHOLD, 'carry'))
    expect(router.navigate).toHaveBeenCalledWith('/')
    // The choice was made on the screen - no second dialog.
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  it('accepts with the clean choice when the clean row is selected', async () => {
    renderInvite()
    await screen.findByTestId('invite-accept-button')

    fireEvent.press(screen.getByTestId('invite-choice-clean'))
    expect(screen.getByTestId('invite-choice-clean').props.accessibilityState.selected).toBe(true)
    fireEvent.press(screen.getByTestId('invite-accept-button'))

    await waitFor(() => expect(mockPerformJoin).toHaveBeenCalledWith(JOINED_HOUSEHOLD, 'clean'))
    expect(router.navigate).toHaveBeenCalledWith('/')
  })

  it('surfaces the mapped accept error on the card', async () => {
    householdApi.acceptInvitation.mockRejectedValue(
      new RepositoryError('conflict', 'conflict', { apiCode: 'HOUSEHOLD_INVITATION_EXPIRED' }),
    )
    renderInvite()
    await screen.findByTestId('invite-accept-button')

    await act(async () => {
      fireEvent.press(screen.getByTestId('invite-accept-button'))
    })

    expect(await screen.findByTestId('invite-accept-error')).toHaveTextContent(
      'Срок действия приглашения истёк',
    )
    expect(mockPerformJoin).not.toHaveBeenCalled()
    expect(router.navigate).not.toHaveBeenCalled()
  })
})
