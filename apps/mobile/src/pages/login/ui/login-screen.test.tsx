// Login screen behavior under React Hook Form: submit-driven per-field
// validation, server errors at the root slot with values preserved, the
// cancelled ownership-takeover path staying on screen, and pending state
// blocking duplicates. `useAuth` and the router are mocked at the boundary.

import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { UnauthorizedError } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { LoginScreen } from './login-screen'

// The mock object is created inside the factory: the jest.mock call is hoisted
// above this module's body, so an outer `const` would still be uninitialized
// when the component's import of expo-router runs the factory.
jest.mock('expo-router', () => {
  const mockRouter = { back: jest.fn(), push: jest.fn(), navigate: jest.fn() }
  let mockParams: { redirect?: string } = {}
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    __setParams: (params: { redirect?: string }) => void (mockParams = params),
  }
})

jest.mock('@/entities/session', () => {
  const loginMock = jest.fn()
  return { useAuth: () => ({ login: loginMock }), loginMock }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router, __setParams } = require('expo-router') as {
  router: { back: jest.Mock; push: jest.Mock; navigate: jest.Mock }
  __setParams: (params: { redirect?: string }) => void
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loginMock } = require('@/entities/session') as {
  loginMock: ReturnType<typeof jest.fn>
}

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

function renderLogin() {
  render(
    <SafeAreaProvider
      initialMetrics={{ insets: ZERO_INSETS, frame: { x: 0, y: 0, width: 375, height: 812 } }}
    >
      <ThemeProvider>
        <LoginScreen />
      </ThemeProvider>
    </SafeAreaProvider>,
  )
}

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the shared header shell with the back affordance', () => {
    renderLogin()

    expect(screen.getByTestId('screen-header-large-title')).toHaveTextContent('Вход')
    expect(screen.getByTestId('screen-header-back')).toBeTruthy()
  })

  it('pushes to register so the register header back can pop to login', () => {
    renderLogin()

    fireEvent.press(screen.getByTestId('login-to-register-button'))

    expect(router.push).toHaveBeenCalledWith('/register')
  })

  it('blocks an empty submit with both field errors and no login call', async () => {
    renderLogin()

    fireEvent.press(screen.getByTestId('login-submit-button'))

    expect(await screen.findByTestId('login-email-error')).toHaveTextContent('Введите email')
    expect(await screen.findByTestId('login-password-error')).toHaveTextContent('Введите пароль')
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('submits the trimmed email with the password on valid input', async () => {
    loginMock.mockResolvedValue({ ok: true })
    renderLogin()

    fireEvent.changeText(screen.getByTestId('login-email-input'), '  user@example.com  ')
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'secret')
    fireEvent.press(screen.getByTestId('login-submit-button'))

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('user@example.com', 'secret'))
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1))
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('navigates to the carried redirect instead of back after success', async () => {
    loginMock.mockResolvedValue({ ok: true })
    __setParams({ redirect: '/invite/abc123' })
    renderLogin()

    fireEvent.changeText(screen.getByTestId('login-email-input'), 'user@example.com')
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'secret')
    fireEvent.press(screen.getByTestId('login-submit-button'))

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('/invite/abc123'))
    expect(router.back).not.toHaveBeenCalled()
  })

  it('carries the redirect through to the register screen', () => {
    __setParams({ redirect: '/invite/abc123' })
    renderLogin()

    fireEvent.press(screen.getByTestId('login-to-register-button'))

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/register',
      params: { redirect: '/invite/abc123' },
    })
  })

  it('surfaces a repository error at the root slot and keeps the values', async () => {
    loginMock.mockRejectedValue(new UnauthorizedError('invalid credentials'))
    renderLogin()

    fireEvent.changeText(screen.getByTestId('login-email-input'), 'user@example.com')
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'secret')
    fireEvent.press(screen.getByTestId('login-submit-button'))

    await waitFor(() =>
      expect(screen.getByTestId('login-error-text')).toHaveTextContent('Необходимо войти'),
    )
    expect(screen.getByTestId('login-email-input').props.value).toBe('user@example.com')
    expect(screen.getByTestId('login-password-input').props.value).toBe('secret')
  })

  it('stays mounted when the ownership takeover is cancelled', async () => {
    loginMock.mockResolvedValue({ ok: false, blockedByOwner: true })
    renderLogin()

    fireEvent.changeText(screen.getByTestId('login-email-input'), 'user@example.com')
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'secret')
    fireEvent.press(screen.getByTestId('login-submit-button'))

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
    expect(router.back).not.toHaveBeenCalled()
    expect(screen.queryByTestId('login-error-text')).toBeNull()
  })

  it('blocks a double submit while the login is pending', async () => {
    let resolveLogin: (result: { ok: boolean }) => void = () => {}
    loginMock.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => void (resolveLogin = resolve)),
    )
    renderLogin()

    fireEvent.changeText(screen.getByTestId('login-email-input'), 'user@example.com')
    fireEvent.changeText(screen.getByTestId('login-password-input'), 'secret')
    fireEvent.press(screen.getByTestId('login-submit-button'))

    await waitFor(() =>
      expect(screen.getByTestId('login-submit-button').props.accessibilityState.disabled).toBe(
        true,
      ),
    )
    fireEvent.press(screen.getByTestId('login-submit-button'))
    expect(loginMock).toHaveBeenCalledTimes(1)

    resolveLogin({ ok: true })
  })
})
