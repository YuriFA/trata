import { useAuthStore } from '@/entities/session'

/**
 * Wires the recoverable offline restore (web-offline-resilience design D3):
 * while the last restore failed by network (`restoreOutcome === 'offline'`),
 * coming back online or foregrounding the app retries it. A success runs the
 * normal ownership gate and the existing auth watch resumes the sync engine -
 * no timers, no manual refresh UI.
 */
export function setupOfflineRestoreRetry(
  auth: ReturnType<typeof useAuthStore>,
): () => void {
  const retry = () => {
    void auth.retryRestoreIfOffline()
  }

  window.addEventListener('online', retry)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') retry()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    window.removeEventListener('online', retry)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
