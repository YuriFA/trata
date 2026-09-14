// The «Пространство» settings group (household-ux 2.1-2.3/2.6): display name
// with the owner email prefix fallback, the member list (label/email, role,
// joined date), role-aware action visibility (owner manages, member leaves),
// the owner sheets (invite validation → API, code panel create/rotate/revoke,
// rename incl. the null reset), remove-member and dissolution confirms (with
// the local record counts), and the leave flow — clean start only: the shared
// data choice is NEVER offered (design D5), `performHouseholdJoin` gets
// 'clean'. The household entity, the join feature and the router are mocked
// at their boundaries.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { RepositoryError, type Household, type HouseholdInvitation } from '@trata/api'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { HouseholdSection } from './household-section'

const OWNER_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const SIBLING_ID = '33333333-3333-4333-8333-333333333333'

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: 'hh-current',
    currency: 'RUB',
    createdAt: '2026-08-01T00:00:00.000Z',
    name: 'Семья',
    members: [
      {
        userId: OWNER_ID,
        email: 'owner@example.com',
        displayName: null,
        role: 'owner',
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        userId: USER_ID,
        email: 'wife@example.com',
        displayName: null,
        role: 'member',
        joinedAt: '2026-08-02T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

const invitation = (overrides: Partial<HouseholdInvitation> = {}): HouseholdInvitation => ({
  id: 'inv-1',
  email: 'friend@example.com',
  status: 'pending',
  createdAt: '2026-08-20T00:00:00.000Z',
  expiresAt: '2026-08-27T00:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  ...overrides,
})

let mockAuthStatus: 'authenticated' | 'anonymous' = 'authenticated'
let mockAuthUser: { id: string; email: string } | null = { id: USER_ID, email: 'wife@example.com' }
let mockHousehold: Household | null = household()
let mockInvitations: HouseholdInvitation[] = []

const mockChooseHouseholdData: ReturnType<typeof jest.fn> = jest.fn()
const mockPerformHouseholdJoin: ReturnType<typeof jest.fn> = jest.fn()

// The api module is mocked directly (not just the barrel export) so BOTH the
// barrel import and the real useHouseholdActions hook (which imports the api
// module itself) hit the same jest fns.
jest.mock('@/entities/household/api/household-api', () => ({
  householdApi: {
    joinByCode: jest.fn(),
    leave: jest.fn(),
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

jest.mock('@/entities/household', () => ({
  ...(jest.requireActual('@/entities/household') as Record<string, unknown>),
  useHousehold: () => ({ data: mockHousehold }),
  useHouseholdInvitations: () => ({ data: mockInvitations, isLoading: false }),
}))

jest.mock('@/entities/session', () => ({
  useAuth: () => ({ status: mockAuthStatus, user: mockAuthUser }),
}))

jest.mock('@/features/household-join', () => ({
  useHouseholdJoin: () => ({
    chooseHouseholdData: mockChooseHouseholdData,
    performHouseholdJoin: mockPerformHouseholdJoin,
  }),
}))

jest.mock('@/entities/transaction/api/repository', () => ({
  useTransactionRepository: () => ({
    // Dissolve-count fixture: only the length matters, not the shape.
    query: jest.fn(async () => [{ id: 't1' }, { id: 't2' }] as never[]),
  }),
}))

jest.mock('@/entities/debt/api/repository', () => ({
  useDebtOperationRepository: () => ({
    getAll: jest.fn(async () => [{ id: 'o1' }] as never[]),
  }),
}))

jest.mock('@/entities/planned-payment/api/repository', () => ({
  usePlannedPaymentRepository: () => ({
    query: jest.fn(async () => [] as never[]),
  }),
}))

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { householdApi } = require('@/entities/household/api/household-api') as {
  householdApi: Record<string, ReturnType<typeof jest.fn>>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router } = require('expo-router') as {
  router: { navigate: ReturnType<typeof jest.fn> }
}

let alertButtons: { text: string; onPress?: () => void; style?: string }[]

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthStatus = 'authenticated'
  mockAuthUser = { id: USER_ID, email: 'wife@example.com' }
  mockHousehold = household()
  mockInvitations = []
  alertButtons = []
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    alertButtons = (buttons ?? []) as typeof alertButtons
    return
  })
  householdApi.joinByCode.mockResolvedValue(household({ id: 'hh-joined' }))
  householdApi.leave.mockResolvedValue(household({ id: 'hh-personal', members: [] }))
  householdApi.getHousehold.mockResolvedValue(household({ id: 'hh-personal', members: [] }))
  householdApi.rename.mockResolvedValue(household({ name: 'После' }))
  householdApi.updateDisplayName.mockResolvedValue('Жена')
  householdApi.invite.mockResolvedValue(invitation())
  householdApi.revokeInvitation.mockResolvedValue(undefined)
  householdApi.generateCode.mockResolvedValue({
    code: 'AB23CD45',
    createdAt: '2026-08-27T00:00:00.000Z',
  })
  householdApi.revokeCode.mockResolvedValue(undefined)
  householdApi.removeMember.mockResolvedValue(undefined)
  householdApi.dissolve.mockResolvedValue(undefined)
  mockChooseHouseholdData.mockResolvedValue(undefined)
  mockPerformHouseholdJoin.mockResolvedValue(undefined)
})

function renderSection() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BottomSheetProvider>
        <HouseholdSection />
      </BottomSheetProvider>
    </QueryClientProvider>,
  )
}

async function pressAlertButton(text: string) {
  const button = await waitFor(() => {
    const found = alertButtons.find((candidate) => candidate.text === text)
    if (!found) throw new Error(`alert button "${text}" missing`)
    return found
  })
  await act(async () => {
    button.onPress?.()
  })
}

describe('HouseholdSection', () => {
  it('shows the household display name and the members count', () => {
    renderSection()

    expect(screen.getByTestId('settings-household-section')).toBeTruthy()
    expect(screen.getByTestId('settings-household-name')).toHaveTextContent('Семья')
    expect(screen.getByTestId('settings-household-members')).toHaveTextContent('Участников: 2')
  })

  it('falls back to the owner email prefix when the household has no name', () => {
    mockHousehold = household({ name: null })
    renderSection()

    expect(screen.getByTestId('settings-household-name')).toHaveTextContent('owner')
  })

  it('renders nothing while anonymous', () => {
    mockAuthStatus = 'anonymous'
    renderSection()

    expect(screen.queryByTestId('settings-household-section')).toBeNull()
  })

  it('lists members with label, email, role, and the own-row marker', () => {
    mockHousehold = household({
      members: [
        household().members[0],
        household().members[1],
        {
          userId: SIBLING_ID,
          email: 'kid@example.com',
          displayName: 'Ребёнок',
          role: 'member',
          joinedAt: '2026-08-03T00:00:00.000Z',
        },
      ],
    })
    renderSection()

    const own = screen.getByTestId(`settings-household-member-${USER_ID}`)
    expect(own).toHaveTextContent(/wife@example\.com/)
    expect(own).toHaveTextContent(/\(вы\)/)

    const sibling = screen.getByTestId(`settings-household-member-${SIBLING_ID}`)
    expect(sibling).toHaveTextContent(/Ребёнок/)
    expect(sibling).toHaveTextContent(/kid@example\.com/)
    expect(sibling).toHaveTextContent(/Участник/)

    expect(screen.getByTestId(`settings-household-member-${OWNER_ID}`)).toHaveTextContent(
      /Владелец/,
    )
  })

  it('hides owner-only actions from a member and offers leave', () => {
    renderSection()

    expect(screen.queryByTestId('settings-household-owner-actions')).toBeNull()
    expect(screen.queryByTestId('settings-household-invite-button')).toBeNull()
    expect(screen.queryByTestId('settings-household-dissolve-button')).toBeNull()
    expect(screen.getByTestId('settings-leave-household-button')).toBeTruthy()
    expect(screen.getByTestId('settings-join-by-code-button')).toBeTruthy()
  })

  it('shows owner actions and hides leave while other members remain', () => {
    mockAuthUser = { id: OWNER_ID, email: 'owner@example.com' }
    renderSection()

    expect(screen.getByTestId('settings-household-owner-actions')).toBeTruthy()
    expect(screen.getByTestId('settings-household-invite-button')).toBeTruthy()
    expect(screen.getByTestId('settings-household-invitations-button')).toBeTruthy()
    expect(screen.getByTestId('settings-household-code-button')).toBeTruthy()
    expect(screen.getByTestId('settings-household-rename-button')).toBeTruthy()
    expect(screen.getByTestId('settings-household-dissolve-button')).toBeTruthy()
    // Owner-with-members cannot leave (the backend rejects it).
    expect(screen.queryByTestId('settings-leave-household-button')).toBeNull()
  })

  it('offers the owner leave when alone', () => {
    mockAuthUser = { id: OWNER_ID, email: 'owner@example.com' }
    mockHousehold = household({ members: [household().members[0]] })
    renderSection()

    expect(screen.getByTestId('settings-leave-household-button')).toBeTruthy()
  })

  it('removes a member through the destructive confirm', async () => {
    mockAuthUser = { id: OWNER_ID, email: 'owner@example.com' }
    renderSection()

    fireEvent.press(screen.getByTestId(`settings-household-remove-${USER_ID}`))
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1))
    expect(Alert.alert).toHaveBeenCalledWith(
      'Удалить участника?',
      'wife@example.com потеряет доступ к общим данным домохозяйства.',
      expect.anything(),
    )

    await pressAlertButton('Удалить')
    await waitFor(() => expect(householdApi.removeMember).toHaveBeenCalledWith(USER_ID))
  })

  it('dissolves through the confirm with the local record counts', async () => {
    mockAuthUser = { id: OWNER_ID, email: 'owner@example.com' }
    renderSection()

    fireEvent.press(screen.getByTestId('settings-household-dissolve-button'))
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1))
    expect(Alert.alert).toHaveBeenCalledWith(
      'Распустить домохозяйство?',
      expect.stringContaining('2 транзакции, 1 долговая операция, 0 планов'),
      expect.anything(),
    )

    await pressAlertButton('Распустить')
    await waitFor(() => expect(householdApi.dissolve).toHaveBeenCalledTimes(1))
    // The dissolving owner lands in the fresh personal household - clean start.
    await waitFor(() =>
      expect(mockPerformHouseholdJoin).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hh-personal' }),
        'clean',
      ),
    )
    expect(router.navigate).toHaveBeenCalledWith('/')
  })

  describe('owner sheets', () => {
    beforeEach(() => {
      mockAuthUser = { id: OWNER_ID, email: 'owner@example.com' }
    })

    it('validates the invite email before any API call', async () => {
      renderSection()
      fireEvent.press(screen.getByTestId('settings-household-invite-button'))

      const input = await screen.findByTestId('settings-household-invite-input')
      fireEvent.changeText(input, 'not-an-email')
      fireEvent.press(screen.getByTestId('settings-household-invite-submit'))

      expect(await screen.findByTestId('settings-household-invite-error')).toHaveTextContent(
        'Введите корректный email',
      )
      expect(householdApi.invite).not.toHaveBeenCalled()
    })

    it('invites by email and closes the sheet', async () => {
      renderSection()
      fireEvent.press(screen.getByTestId('settings-household-invite-button'))

      fireEvent.changeText(
        await screen.findByTestId('settings-household-invite-input'),
        'friend@example.com',
      )
      fireEvent.press(screen.getByTestId('settings-household-invite-submit'))

      await waitFor(() => expect(householdApi.invite).toHaveBeenCalledWith('friend@example.com'))
      await waitFor(() =>
        expect(screen.queryByTestId('settings-household-invite-sheet')).toBeNull(),
      )
    })

    it('lists pending invitations with resend and revoke', async () => {
      mockInvitations = [invitation()]
      renderSection()
      fireEvent.press(screen.getByTestId('settings-household-invitations-button'))

      expect(await screen.findByTestId('settings-household-invitation-inv-1')).toHaveTextContent(
        /friend@example\.com/,
      )
      expect(screen.getByTestId('settings-household-invitation-inv-1-status')).toHaveTextContent(
        'Ожидает',
      )

      // Resend re-invites the same email (refresh, not duplicate).
      fireEvent.press(screen.getByTestId('settings-household-invitation-inv-1-resend'))
      await waitFor(() => expect(householdApi.invite).toHaveBeenCalledWith('friend@example.com'))

      fireEvent.press(screen.getByTestId('settings-household-invitation-inv-1-revoke'))
      await waitFor(() => expect(householdApi.revokeInvitation).toHaveBeenCalledWith('inv-1'))
    })

    it('creates, rotates (with confirm), and revokes the home code', async () => {
      renderSection()
      fireEvent.press(screen.getByTestId('settings-household-code-button'))

      expect(await screen.findByTestId('settings-household-code-none')).toBeTruthy()
      fireEvent.press(screen.getByTestId('settings-household-code-generate'))

      expect(await screen.findByTestId('settings-household-code-value')).toHaveTextContent(
        'AB23CD45',
      )

      fireEvent.press(screen.getByTestId('settings-household-code-rotate'))
      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          'Обновить код?',
          expect.anything(),
          expect.anything(),
        ),
      )
      householdApi.generateCode.mockResolvedValue({
        code: 'ZZ99YY77',
        createdAt: '2026-08-27T00:00:00.000Z',
      })
      await pressAlertButton('Обновить')
      await waitFor(() => expect(householdApi.generateCode).toHaveBeenCalledTimes(2))

      fireEvent.press(screen.getByTestId('settings-household-code-revoke'))
      await waitFor(() => expect(householdApi.revokeCode).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.getByTestId('settings-household-code-none')).toBeTruthy())
    })

    it('renames and clears the household name (null reset)', async () => {
      renderSection()
      fireEvent.press(screen.getByTestId('settings-household-rename-button'))

      const input = await screen.findByTestId('settings-household-rename-input')
      expect(input).toHaveProp('value', 'Семья')

      // Clearing the field resets the name (PATCH name: null); the sheet
      // closes on success, so the second rename reopens it.
      fireEvent.changeText(input, '')
      fireEvent.press(screen.getByTestId('settings-household-rename-submit'))
      await waitFor(() => expect(householdApi.rename).toHaveBeenCalledWith(null))
      await waitFor(() =>
        expect(screen.queryByTestId('settings-household-rename-input')).toBeNull(),
      )

      fireEvent.press(screen.getByTestId('settings-household-rename-button'))
      fireEvent.changeText(await screen.findByTestId('settings-household-rename-input'), ' Новое ')
      fireEvent.press(screen.getByTestId('settings-household-rename-submit'))
      await waitFor(() => expect(householdApi.rename).toHaveBeenCalledWith('Новое'))
    })
  })

  it('validates the code shape in the join-by-code sheet before any API call', async () => {
    renderSection()
    fireEvent.press(screen.getByTestId('settings-join-by-code-button'))

    expect(await screen.findByTestId('settings-join-code-input')).toBeTruthy()

    // Ambiguous glyphs and a short code both fail the alphabet rule.
    fireEvent.changeText(screen.getByTestId('settings-join-code-input'), '0O1Iabcd')
    fireEvent.press(screen.getByTestId('settings-join-code-submit'))

    expect(await screen.findByTestId('settings-join-code-error')).toHaveTextContent(
      'Код — 8 символов (без 0, O, 1 и I)',
    )
    expect(householdApi.joinByCode).not.toHaveBeenCalled()
  })

  it('joins by code, applies the shared choice dialog and navigates home', async () => {
    renderSection()
    fireEvent.press(screen.getByTestId('settings-join-by-code-button'))
    await screen.findByTestId('settings-join-code-input')

    fireEvent.changeText(screen.getByTestId('settings-join-code-input'), 'AB23CD45')
    fireEvent.press(screen.getByTestId('settings-join-code-submit'))

    await waitFor(() =>
      expect(mockChooseHouseholdData).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hh-joined' }),
      ),
    )
    expect(router.navigate).toHaveBeenCalledWith('/')
    // The sheet is gone after the flow completes.
    await waitFor(() => expect(screen.queryByTestId('settings-join-code-sheet')).toBeNull())
  })

  it('maps an invalid code to the root error in the sheet', async () => {
    householdApi.joinByCode.mockRejectedValue(
      new RepositoryError('bad code', 'invalid-payload', { apiCode: 'HOUSEHOLD_CODE_INVALID' }),
    )
    renderSection()
    fireEvent.press(screen.getByTestId('settings-join-by-code-button'))
    await screen.findByTestId('settings-join-code-input')

    fireEvent.changeText(screen.getByTestId('settings-join-code-input'), 'AB23CD45')
    fireEvent.press(screen.getByTestId('settings-join-code-submit'))

    expect(await screen.findByTestId('settings-join-code-form-error')).toHaveTextContent(
      'Неверный код домохозяйства',
    )
    expect(mockChooseHouseholdData).not.toHaveBeenCalled()
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('leaves with a clean start only - the carry/clean choice is never offered', async () => {
    renderSection()

    fireEvent.press(screen.getByTestId('settings-leave-household-button'))
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1))
    expect(alertButtons.map((button) => button.text)).toEqual(['Отмена', 'Выйти'])
    expect(Alert.alert).toHaveBeenCalledWith(
      'Покинуть домохозяйство?',
      'Ваши записи останутся в домохозяйстве и будут доступны оставшимся участникам. Это устройство начнёт с чистого листа.',
      expect.anything(),
    )

    await pressAlertButton('Выйти')

    await waitFor(() => expect(householdApi.leave).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mockPerformHouseholdJoin).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hh-personal' }),
        'clean',
      ),
    )
    expect(mockChooseHouseholdData).not.toHaveBeenCalled()
    expect(router.navigate).toHaveBeenCalledWith('/')
  })

  it('maps the owner-with-members rejection to its RU wording', async () => {
    householdApi.leave.mockRejectedValue(
      new RepositoryError('owner', 'conflict', { apiCode: 'HOUSEHOLD_OWNER_WITH_MEMBERS' }),
    )
    renderSection()

    fireEvent.press(screen.getByTestId('settings-leave-household-button'))
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1))
    await pressAlertButton('Выйти')

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(2))
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Не удалось выйти',
      'Владелец не может покинуть домохозяйство с участниками',
    )
    expect(mockPerformHouseholdJoin).not.toHaveBeenCalled()
  })
})
