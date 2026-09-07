import { describe, it, expect, afterEach, vi } from 'vitest'
import { useAppUpdateStore } from './use-app-update-store'

// The store talks to the SW platform API directly (design D2); jsdom has no
// `serviceWorker`, so each test installs the probe double it needs.
type Fn = (...args: unknown[]) => void

function registrationDouble(options: { update?: Promise<void>; fireUpdateFound?: boolean }) {
  const listeners = new Map<string, Fn[]>()
  return {
    update: vi.fn<() => Promise<void>>(() => {
      if (options.fireUpdateFound) {
        for (const listener of listeners.get('updatefound') ?? []) listener()
      }
      return options.update ?? Promise.resolve()
    }),
    addEventListener: vi.fn<(type: string, listener: Fn) => void>((type: string, listener: Fn) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    }),
    removeEventListener: vi.fn<() => void>(),
  }
}

function stubServiceWorker(sw: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
}

afterEach(() => {
  // configurable: true lets the double be dropped between tests.
  delete (navigator as Partial<Navigator> as { serviceWorker?: unknown }).serviceWorker
})

describe('useAppUpdateStore', () => {
  it('reports no SW and keeps the idle status when the API is missing (dev)', async () => {
    const store = useAppUpdateStore()

    await store.checkForUpdates()

    expect(store.swAvailable).toBe(false)
    expect(store.checkStatus).toBe('idle')
  })

  it('reports no SW when no registration exists', async () => {
    stubServiceWorker({ getRegistration: () => Promise.resolve(undefined) })
    const store = useAppUpdateStore()
    store.checkStatus = 'up-to-date'

    await store.checkForUpdates()

    expect(store.swAvailable).toBe(false)
    expect(store.checkStatus).toBe('idle')
  })

  it('marks a check up-to-date when update() resolves with no new worker', async () => {
    const registration = registrationDouble({})
    stubServiceWorker({ getRegistration: () => Promise.resolve(registration) })
    const store = useAppUpdateStore()

    await store.checkForUpdates()

    expect(store.swAvailable).toBe(true)
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(store.checkStatus).toBe('up-to-date')
  })

  it('marks a failed check when update() rejects (offline)', async () => {
    const registration = registrationDouble({ update: Promise.reject(new TypeError('offline')) })
    stubServiceWorker({ getRegistration: () => Promise.resolve(registration) })
    const store = useAppUpdateStore()

    await store.checkForUpdates()

    expect(store.checkStatus).toBe('failed')
  })

  it('keeps the check pending when a new worker starts installing', async () => {
    // updatefound fired: the found worker is still installing, so the check
    // must not claim up-to-date - `needRefresh` (onNeedRefresh) takes over
    // once the worker finishes installing.
    const registration = registrationDouble({ fireUpdateFound: true })
    stubServiceWorker({ getRegistration: () => Promise.resolve(registration) })
    const store = useAppUpdateStore()

    await store.checkForUpdates()

    expect(store.checkStatus).toBe('checking')
    expect(store.needRefresh).toBe(false)

    // The app layer's onNeedRefresh signal flips the authoritative flag.
    store.needRefresh = true
    expect(store.needRefresh).toBe(true)
  })

  it('applies the update through the closure injected by the app layer', async () => {
    const store = useAppUpdateStore()
    const reload = vi.fn<() => Promise<void>>(() => Promise.resolve())
    store.setReloadToUpdate(reload)

    await store.applyUpdate()

    expect(reload).toHaveBeenCalledWith(true)
  })

  it('is a no-op to apply without an injected closure', async () => {
    const store = useAppUpdateStore()
    await expect(store.applyUpdate()).resolves.toBeUndefined()
  })
})
