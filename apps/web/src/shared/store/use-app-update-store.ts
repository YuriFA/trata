import { defineStore } from 'pinia'
import { ref } from 'vue'

/** Outcome of the last explicit update check (`idle` = none ran yet). */
export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'failed'

/**
 * Layer bridge for the app-update signal (change `web-app-info`, design D1):
 * the app layer (`register-service-worker.ts`) owns the SW registration and
 * writes the waiting-worker signal + the reload closure here; the settings
 * page reads it. Same app-writes/pages-read direction as the theme watcher.
 *
 * `checkForUpdates` reuses the browser's own update lifecycle: it calls
 * `registration.update()` and lets a found worker flow into the app layer's
 * `onNeedRefresh` - there is no parallel detection logic. When the check
 * finds a new worker, the status stays `checking` until that worker
 * finishes installing and `needRefresh` flips; only a check that resolved
 * without any new worker reports `up-to-date`, so the status never claims
 * freshness it did not verify.
 */
export const useAppUpdateStore = defineStore('app-update', () => {
  /** True once a waiting worker exists (set from `onNeedRefresh`). */
  const needRefresh = ref(false)
  const checkStatus = ref<UpdateCheckStatus>('idle')
  /** Runtime probe result: is there a SW registration at all (null = unknown). */
  const swAvailable = ref<boolean | null>(null)

  // The app layer injects registerSW's updateServiceWorker closure (the
  // reload + SKIP_WAITING handshake); non-reactive on purpose.
  let reloadToUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null

  function setReloadToUpdate(fn: (reloadPage?: boolean) => Promise<void>): void {
    reloadToUpdate = fn
  }

  /** Accepts the waiting update: same reload flow as the toast's action. */
  async function applyUpdate(): Promise<void> {
    await reloadToUpdate?.(true)
  }

  async function checkForUpdates(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      swAvailable.value = false
      return
    }
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      swAvailable.value = false
      checkStatus.value = 'idle'
      return
    }
    swAvailable.value = true
    checkStatus.value = 'checking'

    // updatefound is the browser's "the update check saw new bytes" signal:
    // if it never fires while update() resolves, nothing new is deployed.
    let foundUpdate = false
    const onUpdateFound = () => {
      foundUpdate = true
    }
    registration.addEventListener('updatefound', onUpdateFound)
    try {
      await registration.update()
    } catch {
      checkStatus.value = 'failed'
      return
    } finally {
      registration.removeEventListener('updatefound', onUpdateFound)
    }
    if (!foundUpdate) checkStatus.value = 'up-to-date'
  }

  return { needRefresh, checkStatus, swAvailable, setReloadToUpdate, applyUpdate, checkForUpdates }
})
