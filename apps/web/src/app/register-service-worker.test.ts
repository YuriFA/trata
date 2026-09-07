import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerSW } from 'virtual:pwa-register'
import { toast } from 'vue-sonner'
import { registerServiceWorker } from './register-service-worker'
import { useAppUpdateStore } from '@/shared/store/use-app-update-store'

// The module under test bridges the plugin's registerSW onto the app-update
// store; the plugin module and the toast are mocked at their seams.
vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn<() => (reloadPage?: boolean) => Promise<void>>(),
}))
vi.mock('vue-sonner', () => ({
  toast: { info: vi.fn<(message: string, options?: object) => void>() },
}))

// Narrowed to the options the wiring reads; cast through the mock's typing.
type RegisterOptions = Parameters<typeof registerSW>[0]
let options: RegisterOptions
const updateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve())

beforeEach(() => {
  vi.mocked(registerSW).mockImplementation((swOptions) => {
    options = swOptions as RegisterOptions
    return updateServiceWorker
  })
  vi.mocked(toast.info).mockClear()
  updateServiceWorker.mockClear()
})

describe('registerServiceWorker', () => {
  it('injects the reload closure into the store (same flow as the toast action)', async () => {
    registerServiceWorker()
    const update = useAppUpdateStore()

    await update.applyUpdate()

    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('mirrors the waiting-worker signal into the store and still fires the toast', () => {
    registerServiceWorker()
    const update = useAppUpdateStore()

    options!.onNeedRefresh!()

    expect(update.needRefresh).toBe(true)
    expect(toast.info).toHaveBeenCalledWith(
      'Update available',
      expect.objectContaining({ duration: Infinity }),
    )
  })

  it('keeps onOfflineReady silent', () => {
    registerServiceWorker()

    expect(() => options!.onOfflineReady!()).not.toThrow()
    expect(toast.info).not.toHaveBeenCalled()
  })
})
