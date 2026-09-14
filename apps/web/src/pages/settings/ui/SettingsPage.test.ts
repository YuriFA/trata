import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Household, HouseholdCode, HouseholdMember } from '@trata/api'
import type { User } from '@/entities/session'
import SettingsPage from './SettingsPage.vue'
import { CurrencySelect } from '@/shared/ui/currency-select'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import { useSettingsStore } from '@/shared/store/use-settings-store'

// The session entity is mocked down to what the page reads: the auth state
// gating the auth-only cards and the sessions listing.
const authState: {
  status: 'restoring' | 'anonymous' | 'authenticated'
  user: User | null
  isAuthenticated: boolean
} = {
  status: 'anonymous',
  user: null,
  isAuthenticated: false,
}
vi.mock('@/entities/session', () => ({
  useAuthStore: () => authState,
  sessionApi: {
    listSessions: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    deleteAllSessions: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}))

// The household read + the panel/editor actions are mocked at the package
// seam (`use-household.ts` and the dialogs import the HTTP helpers through
// the package, not the entity barrel - and deep entity paths would sidestep
// the public API); the label fallback stays real so the display-name
// derivation is exercised.
vi.mock('@trata/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trata/api')>()),
  fetchHousehold: vi.fn<() => Promise<Household>>(),
  updateDisplayName: vi.fn<(displayName: string) => Promise<string>>(),
  generateHouseholdCode: vi.fn<() => Promise<HouseholdCode>>(),
  listHouseholdInvitations: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
}))

const { fetchHousehold, generateHouseholdCode } = await import('@trata/api')

const user: User = {
  id: 'u2',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const OWNER_MEMBER = householdMember('u1', 'wife@example.com', 'owner')
const MY_MEMBER = householdMember('u2', 'user@example.com', 'member')

function householdMember(userId: string, email: string, role: 'owner' | 'member'): HouseholdMember {
  return {
    userId,
    email,
    displayName: null,
    role,
    joinedAt: '2024-01-01T00:00:00Z',
  }
}

const household: Household = {
  id: 'h1',
  createdAt: '2024-01-01T00:00:00Z',
  name: null,
  currency: 'RUB',
  members: [OWNER_MEMBER, MY_MEMBER],
}

/** Swaps the signed-in user into the given role (u2 = the test user). */
function householdWithRole(role: 'owner' | 'member'): Household {
  const members = household.members.map((member) =>
    member.userId === 'u2' ? { ...member, role } : { ...member, role: 'member' as const },
  )
  return { ...household, members }
}

function mountPage(): ReturnType<typeof mountWithProviders> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: SettingsPage },
      { path: '/reset-password', name: 'reset-password', component: { template: '<div/>' } },
      { path: '/verify-email', name: 'verify-email', component: { template: '<div/>' } },
      { path: '/', name: 'home', component: { template: '<div/>' } },
      {
        path: '/settings/categories',
        name: 'settings-categories',
        component: { template: '<div/>' },
      },
      {
        path: '/settings/data',
        name: 'settings-data',
        component: { template: '<div/>' },
      },
    ],
  })
  // repositories: {} injects the default mock repositories - the dissolve
  // dialog counts records through them.
  return mountWithProviders(SettingsPage, { router, repositories: {} })
}

function authenticateAs(role: 'owner' | 'member', hh: Household = householdWithRole(role)) {
  authState.status = 'authenticated'
  authState.user = user
  authState.isAuthenticated = true
  vi.mocked(fetchHousehold).mockResolvedValue(hh)
}

describe('SettingsPage', () => {
  beforeEach(() => {
    authState.status = 'anonymous'
    authState.user = null
    authState.isAuthenticated = false
    vi.mocked(fetchHousehold).mockReset()
    vi.mocked(generateHouseholdCode).mockReset()
  })

  it('renders page title', () => {
    const wrapper = mountPage()
    const heading = wrapper.find('h1')
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBeTruthy()
  })

  it('seeds the display-currency selector with the resolution chain default', () => {
    const wrapper = mountPage()

    // No explicit setting and no household on an anonymous device: the chain
    // resolves to the catalog default and seeds the selector.
    const select = wrapper.findComponent(CurrencySelect)
    expect(select.exists()).toBe(true)
    expect(select.props('modelValue')).toBe('RUB')
  })

  it('commits a display-currency choice to the settings store and localStorage', async () => {
    const wrapper = mountPage()

    wrapper.findComponent(CurrencySelect).vm.$emit('update:modelValue', 'EUR')
    await flushPromises()

    const settings = useSettingsStore()
    expect(settings.displayCurrency).toBe('EUR')
    expect(JSON.parse(localStorage.getItem('BudgetTracker:display-currency')!)).toEqual({
      version: 1,
      currency: 'EUR',
    })
  })

  it('suggests the locale-derived base currency once for the owner', async () => {
    localStorage.removeItem('BudgetTracker:base-currency-suggestion')
    authenticateAs('owner')

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    // The en-US test locale maps to USD, so an RUB household gets one offer.
    const suggestion = wrapper.find('[data-testid="settings-base-currency-suggestion"]')
    expect(suggestion.exists()).toBe(true)
    expect(suggestion.text()).toContain('USD')

    await wrapper.find('[data-testid="settings-base-currency-suggest-dismiss"]').trigger('click')

    // Once per device: the flag survives a remount.
    expect(localStorage.getItem('BudgetTracker:base-currency-suggestion')).toBe('USD')
    const remount = mountPage()
    await flushPromises()
    await flushPromises()
    expect(remount.find('[data-testid="settings-base-currency-suggestion"]').exists()).toBe(false)
  })

  it('hides the base-currency editor and suggestion from a member', async () => {
    localStorage.removeItem('BudgetTracker:base-currency-suggestion')
    authenticateAs('member')

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-base-currency-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-base-currency-suggestion"]').exists()).toBe(false)
  })

  it('shows the household card with the owner-prefix fallback label and members count', async () => {
    authenticateAs('member')

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    const card = wrapper.find('[data-testid="settings-household-card"]')
    expect(card.exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-household-name"]').text()).toContain('wife')
    expect(wrapper.find('[data-testid="settings-household-name"]').text()).toContain('2 members')
    expect(wrapper.find('[data-testid="household-join-code-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-leave-button"]').exists()).toBe(true)
  })

  it('shows the household display name when the household has one', async () => {
    authenticateAs('member', { ...householdWithRole('member'), name: 'Семья' })

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-household-name"]').text()).toContain('Семья')
  })

  it('hides the household card for anonymous visitors', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-household-card"]').exists()).toBe(false)
    expect(fetchHousehold).not.toHaveBeenCalled()
  })

  it('lists members with label, email, role, and the own-row marker', async () => {
    authenticateAs('member', {
      ...householdWithRole('member'),
      members: [{ ...OWNER_MEMBER, displayName: 'Жена' }, MY_MEMBER],
    })

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    const own = wrapper.find('[data-testid="settings-household-member-u2"]')
    expect(own.exists()).toBe(true)
    expect(own.text()).toContain('user@example.com')
    expect(own.text()).toContain('(you)')

    const owner = wrapper.find('[data-testid="settings-household-member-u1"]')
    expect(owner.text()).toContain('Жена')
    expect(owner.text()).toContain('wife@example.com')
    expect(owner.text()).toContain('Owner')
    expect(owner.text()).toContain('Joined')
  })

  it('hides owner-only actions from a member and offers leave', async () => {
    authenticateAs('member')

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-household-owner-actions"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="household-invite-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="household-dissolve-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-household-remove-u1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="household-leave-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-join-code-button"]').exists()).toBe(true)
  })

  it('shows owner actions, member removal, and hides leave while members remain', async () => {
    authenticateAs('owner')

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-household-owner-actions"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-invite-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-invitations-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-code-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-rename-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="household-dissolve-button"]').exists()).toBe(true)
    // The (non-owner) member row carries the remove affordance; the owner's
    // own row does not.
    expect(wrapper.find('[data-testid="settings-household-remove-u1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-household-remove-u2"]').exists()).toBe(false)
    // The backend rejects an owner leaving while members remain.
    expect(wrapper.find('[data-testid="household-leave-button"]').exists()).toBe(false)
  })

  it('offers the owner leave when alone', async () => {
    authenticateAs('owner', {
      ...householdWithRole('owner'),
      members: [MY_MEMBER],
    })

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="household-leave-button"]').exists()).toBe(true)
  })

  it('renders the display-name editor with the email fallback preview', async () => {
    authenticateAs('member')

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    const card = wrapper.find('[data-testid="settings-profile-card"]')
    expect(card.exists()).toBe(true)
    expect(wrapper.find('[data-testid="settings-profile-email"]').text()).toContain(
      'user@example.com',
    )
    expect(wrapper.find('[data-testid="settings-profile-preview"]').text()).toContain(
      'user@example.com',
    )
  })

  it('shows the member-view preview when a display name is set', async () => {
    authenticateAs('member', {
      ...householdWithRole('member'),
      members: [OWNER_MEMBER, { ...MY_MEMBER, displayName: 'Юрий' }],
    })

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-profile-preview"]').text()).toContain('Юрий')
  })

  it('creates and shows the home code from the panel', async () => {
    authenticateAs('owner')
    vi.mocked(generateHouseholdCode).mockResolvedValue({
      code: 'AB23CD45',
      createdAt: '2024-01-01T00:00:00Z',
    })

    const wrapper = mountPage()
    await flushPromises()
    await flushPromises()

    await wrapper.find('[data-testid="household-code-button"]').trigger('click')
    await flushPromises()

    expect(document.querySelector('[data-testid="household-code-none"]')).not.toBeNull()
    const generate = document.querySelector<HTMLButtonElement>(
      '[data-testid="household-code-generate"]',
    )
    expect(generate).not.toBeNull()
    generate?.click()
    await flushPromises()
    await flushPromises()

    expect(document.querySelector('[data-testid="household-code-value"]')?.textContent).toContain(
      'AB23CD45',
    )
  })
})
