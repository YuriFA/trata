import { describe, it, expect } from 'vitest'
import AppSidebarNav from './AppSidebarNav.vue'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import { useAuthStore } from '@/entities/session'

describe('AppSidebarNav', () => {
  it('renders navigation links from i18n', () => {
    const wrapper = mountWithProviders(AppSidebarNav, { props: { footer: false } })
    const links = wrapper.findAll('a')
    expect(links.length).toBeGreaterThanOrEqual(7)
  })

  it('renders RouterLink components with hrefs', () => {
    const wrapper = mountWithProviders(AppSidebarNav, { props: { footer: false } })
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/')
    expect(hrefs).toContain('/transactions')
    expect(hrefs).toContain('/analytics')
    expect(hrefs).toContain('/debts')
    expect(hrefs).toContain('/plans')
    expect(hrefs).toContain('/accounts')
    expect(hrefs).toContain('/settings')
  })

  it('switches the mode indicator copy for the offline restore state', async () => {
    const wrapper = mountWithProviders(AppSidebarNav, { props: { footer: false } })
    const auth = useAuthStore()

    // Guest device (default state): the ordinary local-mode indicator.
    expect(wrapper.find('[data-testid="guest-mode-indicator"]').text()).toContain('Local mode')

    // Network-failed restore on an owned device: the offline indicator takes
    // over (web-offline-resilience design D4).
    auth.$patch({ status: 'anonymous' })
    auth.hasLocalOwner = true
    auth.restoreOutcome = 'offline'
    await wrapper.vm.$nextTick()

    const offline = wrapper.find('[data-testid="offline-mode-indicator"]')
    expect(offline.exists()).toBe(true)
    expect(offline.text()).toContain('Offline mode')
    expect(wrapper.find('[data-testid="guest-mode-indicator"]').exists()).toBe(false)
  })
})
