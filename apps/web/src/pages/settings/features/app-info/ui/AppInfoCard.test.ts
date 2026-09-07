import { describe, it, expect, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { getActivePinia } from 'pinia'
import AppInfoCard from '../ui/AppInfoCard.vue'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
import { useAppUpdateStore } from '@/shared/store/use-app-update-store'

// The card composes the real app-update store over the platform seams
// (serviceWorker, fetch); each test installs the doubles it needs. jsdom
// ships neither API. Unit copy is EN (suite convention). The helper would
// create a fresh pinia - pass the active one so the store the test drives
// is the store the component reads.
function mountCard() {
  return mountWithProviders(AppInfoCard, { pinia: getActivePinia()! })
}

function stubServiceWorker(sw: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
}

function stubRegistration(options: { update?: Promise<void> }) {
  return {
    update: vi.fn<() => Promise<void>>(() => options.update ?? Promise.resolve()),
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
  }
}

afterEach(() => {
  delete (navigator as Partial<Navigator> as { serviceWorker?: unknown }).serviceWorker
  vi.unstubAllGlobals()
})

describe('AppInfoCard', () => {
  it('always shows the web build version', () => {
    const wrapper = mountCard()

    expect(wrapper.get('[data-testid="settings-app-version"]').text()).toBe('Version: dev')
  })

  it('shows the API version as a muted line when the health endpoint answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ version: 'sha-abc1234' })))),
    )
    stubServiceWorker({ getRegistration: () => Promise.resolve(undefined) })

    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.get('[data-testid="settings-api-version"]').text()).toBe('API: sha-abc1234')
  })

  it('keeps the API line absent (no error state) when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    stubServiceWorker({ getRegistration: () => Promise.resolve(undefined) })

    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-api-version"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Version: dev')
  })

  it('renders without update UI when there is no service worker (dev)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )

    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-update-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-check-updates"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="settings-apply-update"]').exists()).toBe(false)
  })

  it('shows the pending update with the accept action wired to the injected reload', async () => {
    const store = useAppUpdateStore()
    const reload = vi.fn<() => Promise<void>>(() => Promise.resolve())
    store.setReloadToUpdate(reload)
    store.needRefresh = true

    const wrapper = mountCard()

    expect(wrapper.get('[data-testid="settings-update-status"]').text()).toBe('Update available')
    const accept = wrapper.get('[data-testid="settings-apply-update"]')
    expect(accept.text()).toBe('Update')

    await accept.trigger('click')
    expect(reload).toHaveBeenCalledWith(true)
  })

  it('shows up to date after a check that finds nothing', async () => {
    stubServiceWorker({
      getRegistration: () => Promise.resolve(stubRegistration({})),
    })

    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.get('[data-testid="settings-update-status"]').text()).toBe('Up to date')
    expect(wrapper.get('[data-testid="settings-check-updates"]').text()).toBe('Check for updates')
  })

  it('shows a failed check with a retry label, never as up to date', async () => {
    stubServiceWorker({
      getRegistration: () =>
        Promise.resolve(stubRegistration({ update: Promise.reject(new TypeError('offline')) })),
    })

    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.get('[data-testid="settings-update-status"]').text()).toBe(
      'Could not check for updates',
    )
    expect(wrapper.get('[data-testid="settings-check-updates"]').text()).toBe('Retry')
  })

  it('re-runs the check from the ghost button', async () => {
    const registration = stubRegistration({})
    stubServiceWorker({ getRegistration: () => Promise.resolve(registration) })

    const wrapper = mountCard()
    await flushPromises()
    expect(registration.update).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="settings-check-updates"]').trigger('click')
    await flushPromises()

    expect(registration.update).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="settings-update-status"]').text()).toBe('Up to date')
  })
})
