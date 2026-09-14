// Session-boundary rate refresh (multi-currency design D5, the
// exchange-rates refresh policy): on app start, regained connectivity, and
// foregrounding. Mirrors the offline-restore retry wiring - listeners, no
// timers - and the refresh itself is non-fatal and shared (concurrent
// triggers collapse into one in-flight request).

import { refreshRates } from '@/shared/lib/money'

export function setupRatesRefresh(): () => void {
  const refresh = () => {
    void refreshRates()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') refresh()
  }

  void refreshRates()
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    window.removeEventListener('online', refresh)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
