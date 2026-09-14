import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { RepositoryError, UnauthorizedError } from '@trata/api'
import type { Household, HouseholdInvitationPreview } from '@trata/api'
import type { User } from '@/entities/session'
import type { LocalDbApi } from '@/shared/lib/local-db'
import InvitePage from './InvitePage.vue'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

// The household control-plane API is mocked: the page is a pure consumer of
// the preview/accept calls.
vi.mock('@/entities/household', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/household')>()),
  householdApi: {
    previewInvitation: vi.fn<(token: string) => Promise<HouseholdInvitationPreview>>(),
    acceptInvitation: vi.fn<(token: string) => Promise<Household>>(),
  },
}))

// Auth store mocked down to what the page reads: status (preview gating) and
// the signed-in user (mismatch card, clean-choice owner rebind).
const authState: {
  status: 'restoring' | 'anonymous' | 'authenticated'
  user: User | null
  ensureRestored: () => Promise<void>
} = {
  status: 'anonymous',
  user: null,
  ensureRestored: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}
vi.mock('@/entities/session', () => ({
  useAuthStore: () => authState,
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

// The local-db bridge is mocked for the join store's apply step.
const householdRpc = {
  rebase: vi.fn<(householdId: string) => Promise<void>>().mockResolvedValue(undefined),
  getLastHousehold: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
  setLastHousehold: vi.fn<(householdId: string) => Promise<void>>().mockResolvedValue(undefined),
}
const metaRpc = {
  getOwnerUserId: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
  setOwnerUserId: vi.fn<(userId: string) => Promise<void>>().mockResolvedValue(undefined),
  wipeLocalData: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}
const localDbApi = {
  household: householdRpc,
  meta: metaRpc,
  sync: { run: vi.fn<(force?: boolean) => Promise<unknown>>().mockResolvedValue(undefined) },
} as unknown as LocalDbApi
vi.mock('@/shared/lib/local-db', () => ({
  getLocalDbApi: () => Promise.resolve(localDbApi),
}))

const invalidateQueries = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
vi.mock('@pinia/colada', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pinia/colada')>()),
  useQueryCache: () => ({ invalidateQueries }),
}))

// Import after the mocks are registered.
const { householdApi } = await import('@/entities/household')

const preview: HouseholdInvitationPreview = {
  householdName: null,
  membersCount: 2,
  inviterEmail: 'wife@example.com',
  inviterDisplayName: null,
  expiresAt: '2026-01-01T00:00:00Z',
}

const joinedHousehold: Household = {
  id: 'h9',
  createdAt: '2026-01-01T00:00:00Z',
  name: 'Семья',
  currency: 'RUB',
  members: [
    {
      userId: 'u1',
      email: 'wife@example.com',
      displayName: null,
      role: 'owner',
      joinedAt: '2026-01-01T00:00:00Z',
    },
  ],
}

const user: User = {
  id: 'u2',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

function apiError(apiCode: string): RepositoryError {
  return new RepositoryError('backend says no', 'unknown', { apiCode })
}

async function mountPage(
  token = 'tok-1',
): Promise<{ wrapper: ReturnType<typeof mountWithProviders>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/invite/:token', component: InvitePage },
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/login', name: 'login', component: { template: '<div/>' } },
      { path: '/register', name: 'register', component: { template: '<div/>' } },
    ],
  })
  await router.push(`/invite/${token}`)
  await router.isReady()
  const wrapper = mountWithProviders(InvitePage, { router })
  await flushPromises()
  return { wrapper, router }
}

describe('InvitePage', () => {
  beforeEach(() => {
    authState.status = 'anonymous'
    authState.user = null
    vi.mocked(householdApi.previewInvitation).mockReset()
    vi.mocked(householdApi.acceptInvitation).mockReset()
    householdRpc.rebase.mockClear()
    householdRpc.setLastHousehold.mockClear()
    metaRpc.setOwnerUserId.mockClear()
    metaRpc.wipeLocalData.mockClear()
  })

  it('renders the accept screen from a successful preview (name fallback + members)', async () => {
    authState.status = 'authenticated'
    authState.user = user
    vi.mocked(householdApi.previewInvitation).mockResolvedValue(preview)

    const { wrapper } = await mountPage('tok-1')

    expect(wrapper.find('[data-testid="invite-page-preview"]').exists()).toBe(true)
    // householdName is null: the inviter email prefix is the fallback label.
    expect(wrapper.find('[data-testid="invite-household-name"]').text()).toBe('wife')
    expect(wrapper.text()).toContain('wife@example.com')
    expect(wrapper.find('[data-testid="invite-choice-carry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="invite-choice-clean"]').exists()).toBe(true)
  })

  it('renders the login/register CTA with the redirect query for an anonymous visitor', async () => {
    vi.mocked(householdApi.previewInvitation).mockRejectedValue(
      new UnauthorizedError('missing session cookie'),
    )

    const { wrapper } = await mountPage('tok-1')

    const cta = wrapper.find('[data-testid="invite-page-anonymous"]')
    expect(cta.exists()).toBe(true)
    // The CTA buttons render as anchors (Button as-child over RouterLink).
    const login = wrapper.find('[data-testid="invite-page-login-link"]')
    expect(login.attributes('href')).toBe('/login?redirect=/invite/tok-1')
    const register = wrapper.find('[data-testid="invite-page-register-link"]')
    expect(register.attributes('href')).toBe('/register?redirect=/invite/tok-1')
    expect(wrapper.find('[data-testid="invite-page-preview"]').exists()).toBe(false)
  })

  it('renders the mismatch card for a wrong-account 403', async () => {
    authState.status = 'authenticated'
    authState.user = user
    vi.mocked(householdApi.previewInvitation).mockRejectedValue(
      apiError('HOUSEHOLD_INVITATION_EMAIL_MISMATCH'),
    )

    const { wrapper } = await mountPage()

    expect(wrapper.find('[data-testid="invite-page-mismatch"]').exists()).toBe(true)
    // The card names the signed-in account.
    expect(wrapper.text()).toContain('user@example.com')
    expect(wrapper.find('[data-testid="invite-page-preview"]').exists()).toBe(false)
  })

  it.each([
    ['HOUSEHOLD_INVITATION_EXPIRED', 'This invitation has expired'],
    ['HOUSEHOLD_INVITATION_REVOKED', 'This invitation was revoked by the owner'],
    ['HOUSEHOLD_INVITATION_NOT_FOUND', 'This invitation does not exist'],
    ['HOUSEHOLD_INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted'],
  ] as const)('renders the dead card for %s', async (apiCode, message) => {
    authState.status = 'authenticated'
    authState.user = user
    vi.mocked(householdApi.previewInvitation).mockRejectedValue(apiError(apiCode))

    const { wrapper } = await mountPage()

    const dead = wrapper.find('[data-testid="invite-page-dead"]')
    expect(dead.exists()).toBe(true)
    expect(dead.text()).toContain(message)
    expect(dead.find('a').attributes('href')).toBe('/')
  })

  it('accepts with the carry choice by default and navigates home', async () => {
    authState.status = 'authenticated'
    authState.user = user
    vi.mocked(householdApi.previewInvitation).mockResolvedValue(preview)
    vi.mocked(householdApi.acceptInvitation).mockResolvedValue(joinedHousehold)

    const { wrapper, router } = await mountPage('tok-1')

    await wrapper.find('[data-testid="invite-accept-button"]').trigger('click')
    await flushPromises()

    expect(householdApi.acceptInvitation).toHaveBeenCalledWith('tok-1')
    expect(householdRpc.rebase).toHaveBeenCalledWith('h9')
    expect(metaRpc.wipeLocalData).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('accepts with the clean choice when picked and wipes local data', async () => {
    authState.status = 'authenticated'
    authState.user = user
    vi.mocked(householdApi.previewInvitation).mockResolvedValue(preview)
    vi.mocked(householdApi.acceptInvitation).mockResolvedValue(joinedHousehold)

    const { wrapper, router } = await mountPage('tok-1')

    // Pick the clean option through its radio input (jsdom does not forward
    // label activation to nested controls deterministically).
    await wrapper.find('[data-testid="invite-choice-clean"] input[type="radio"]').setValue(true)
    await wrapper.find('[data-testid="invite-accept-button"]').trigger('click')
    await flushPromises()

    expect(metaRpc.wipeLocalData).toHaveBeenCalledTimes(1)
    expect(metaRpc.setOwnerUserId).toHaveBeenCalledWith('u2')
    expect(householdRpc.setLastHousehold).toHaveBeenCalledWith('h9')
    expect(householdRpc.rebase).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('keeps the form up with a mapped message when the accept fails', async () => {
    authState.status = 'authenticated'
    authState.user = user
    vi.mocked(householdApi.previewInvitation).mockResolvedValue(preview)
    vi.mocked(householdApi.acceptInvitation).mockRejectedValue(
      apiError('HOUSEHOLD_INVITATION_EXPIRED'),
    )

    const { wrapper, router } = await mountPage('tok-1')

    await wrapper.find('[data-testid="invite-accept-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="invite-page-preview"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('This invitation has expired')
    expect(router.currentRoute.value.path).toBe('/invite/tok-1')
  })
})
