import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { useAppUpdateStore } from '@/shared/store/use-app-update-store'

/** Display state of the update section (combines the check and the signal). */
export type AppUpdateStatus =
  | 'hidden' // no SW registration (local development)
  | 'idle' // registration not probed yet
  | 'checking'
  | 'up-to-date'
  | 'failed'
  | 'update-available'

/**
 * View-model of the about-app card (change `web-app-info`): the web build
 * version, the best-effort API version line, and the update status derived
 * from the app-update store (the app-layer `onNeedRefresh` signal has
 * priority over any check status: a waiting worker is always the truth).
 */
export function useAppInfo(): {
  apiVersion: Ref<string | null>
  status: ComputedRef<AppUpdateStatus>
  checkForUpdates: () => Promise<void>
  applyUpdate: () => Promise<void>
} {
  const update = useAppUpdateStore()
  const apiVersion = ref<string | null>(null)

  const status = computed<AppUpdateStatus>(() => {
    if (update.needRefresh) return 'update-available'
    if (update.swAvailable === false) return 'hidden'
    return update.checkStatus
  })

  // Silent mount check (web-pwa delta): the shown status reflects an actual
  // recent check; without a registration (dev) it resolves to `hidden`.
  onMounted(() => {
    void fetchApiVersion()
    void update.checkForUpdates()
  })

  /**
   * Best-effort health fetch (capability `app-version`): fire-and-forget and
   * network-tolerant - an unreachable API just leaves the line absent.
   * Plain `fetch` like the boot console line: health is an operational
   * endpoint, not a domain resource (no session/base-URL semantics).
   */
  async function fetchApiVersion(): Promise<void> {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const health = (await res.json()) as { version?: string }
        if (health.version) apiVersion.value = health.version
      }
    } catch {
      // API unreachable: the line stays absent, no error state.
    }
  }

  return {
    apiVersion,
    status,
    checkForUpdates: update.checkForUpdates,
    applyUpdate: update.applyUpdate,
  }
}
