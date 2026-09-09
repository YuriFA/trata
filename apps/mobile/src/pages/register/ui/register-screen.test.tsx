// Register screen behavior under React Hook Form: per-field validation
// (short password, mismatched confirm), server errors at the root slot with
// values preserved, and pending state blocking duplicates. `useAuth` and the
// router are mocked at the boundary.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AlreadyExistsError } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { RegisterScreen } from './register-screen'

// The mock object is created inside the factory: the jest.mock call is hoisted
// above this module's body, so an outer `const` would still be uninitialized
// when the component's import of expo-router runs the factory.
jest.mock('expo-router', () => {
  const mockRouter = { back: jest.fn(), navigate: jest.fn() }
  let mockParams: { redirect?: string } = {}
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    __setParams: (params: { redirect?: string }) => void (mockParams = params),
  }
})

jest.mock('@/entities/session', () => {
  const registerMock = jest.fn()
  return { useAuth: () => ({ register: registerMock }), registerMock }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router, __setParams } = require('expo-router') as {
  router: { back: jest.Mock; navigate: jest.Mock }
  __setParams: (params: { redirect?: string }) => void
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerMock } = require('@/entities/session') as {
  registerMock: ReturnType<typeof jest.fn>
}

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

function renderRegister() {
  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <ThemeProvider>
        <RegisterScreen />
      </ThemeProvider>
    </SafeAreaProvider>,
  )
}

function fillValid(password = 'longenough') {
  fireEvent.changeText(screen.getByTestId('register-email-input'), 'user@example.com')
  fireEvent.changeText(screen.getByTestId('register-password-input'), password)
  fireEvent.changeText(screen.getByTestId('register-confirm-input'), password)
}

describe('RegisterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the shared header shell and pops to login on back', () => {
    renderRegister()

    expect(screen.getByTestId('screen-header-large-title')).toHaveTextContent('Регистрация')
    fireEvent.press(screen.getByTestId('screen-header-back'))

    // login→register is a push, so the default back() is a real pop to login
    // (a pop, not a replace, keeps the transition animating backwards).
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('blocks a mismatched confirm with the confirm-field error', async () => {
    renderRegister()

    fireEvent.changeText(screen.getByTestId('register-email-input'), 'user@example.com')
    fireEvent.changeText(screen.getByTestId('register-password-input'), 'longenough')
    fireEvent.changeText(screen.getByTestId('register-confirm-input'), 'different1')
    fireEvent.press(screen.getByTestId('register-submit-button'))

    expect(await screen.findByTestId('register-confirm-error')).toHaveTextContent(
      'Пароли не совпадают',
    )
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('blocks a short password with the minimum-length message', async () => {
    renderRegister()

    fireEvent.changeText(screen.getByTestId('register-email-input'), 'user@example.com')
    fireEvent.changeText(screen.getByTestId('register-password-input'), 'short')
    fireEvent.changeText(screen.getByTestId('register-confirm-input'), 'short')
    fireEvent.press(screen.getByTestId('register-submit-button'))

    expect(await screen.findByTestId('register-password-error')).toHaveTextContent(
      'Пароль должен содержать минимум 8 символов',
    )
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('submits the trimmed email with the password on valid input', async () => {
    registerMock.mockResolvedValue({ ok: true })
    renderRegister()

    fireEvent.changeText(screen.getByTestId('register-email-input'), '  user@example.com  ')
    fireEvent.changeText(screen.getByTestId('register-password-input'), 'longenough')
    fireEvent.changeText(screen.getByTestId('register-confirm-input'), 'longenough')
    fireEvent.press(screen.getByTestId('register-submit-button'))

    await waitFor(() => expect(registerMock).toHaveBeenCalledWith('user@example.com', 'longenough'))
    // Success must leave the auth flow entirely (login sits beneath in the
    // stack), not just pop one screen.
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('/settings'))
  })

  it('navigates to the carried redirect instead of settings after success', async () => {
    registerMock.mockResolvedValue({ ok: true })
    __setParams({ redirect: '/invite/abc123' })
    renderRegister()

    fillValid()
    fireEvent.press(screen.getByTestId('register-submit-button'))

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('/invite/abc123'))
  })

  it('surfaces a repository error at the root slot and keeps the values', async () => {
    registerMock.mockRejectedValue(
      new AlreadyExistsError('User already exists', { apiCode: 'USER_ALREADY_EXISTS' }),
    )
    renderRegister()

    fillValid()
    fireEvent.press(screen.getByTestId('register-submit-button'))

    await waitFor(() =>
      expect(screen.getByTestId('register-error-text')).toHaveTextContent('Уже существует'),
    )
    expect(screen.getByTestId('register-email-input').props.value).toBe('user@example.com')
    expect(screen.getByTestId('register-password-input').props.value).toBe('longenough')
  })

  it('blocks a double submit while the registration is pending', async () => {
    let resolveRegister: (result: { ok: boolean }) => void = () => {}
    registerMock.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => void (resolveRegister = resolve)),
    )
    renderRegister()

    fillValid()
    fireEvent.press(screen.getByTestId('register-submit-button'))

    await waitFor(() =>
      expect(screen.getByTestId('register-submit-button').props.accessibilityState.disabled).toBe(
        true,
      ),
    )
    fireEvent.press(screen.getByTestId('register-submit-button'))
    expect(registerMock).toHaveBeenCalledTimes(1)

    resolveRegister({ ok: true })
  })
})
