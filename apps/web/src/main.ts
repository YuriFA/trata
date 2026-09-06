import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { PiniaColadaRetry } from '@pinia/colada-plugin-retry'

import App from './App.vue'
import i18n from './shared/i18n'
import router from './app/router'
import { provideRepositories } from './app/repositories'
import { setupThemeWatcher } from './app/setup-theme-watcher'
import { setUnauthorizedHandler } from './shared/api'
import { APP_VERSION } from './shared/config/app-version'
import { useAuthStore } from './entities/session'
import './style.css'
import { setupI18nLocaleWatcher } from './app/setup-i18n-locale-watcher'
import { setupPushReminders } from './app/setup-push-reminders'
import { setupOfflineRestoreRetry } from './app/setup-offline-restore-retry'
import { registerServiceWorker } from './app/register-service-worker'

const app = createApp(App)
const pinia = createPinia()

app.use(i18n)
app.use(pinia)
app.use(PiniaColada, {
  queryOptions: {
    gcTime: 300_000, // 5 minutes, the default
    staleTime: 30_000, // SWR: don't refetch on remount within 30s
  },
  plugins: [
    PiniaColadaRetry({
      retry: 2,
      delay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
    }),
  ],
})
app.use(router)
provideRepositories(app)

// Session restore runs once at startup and is network-tolerant (design D5):
// a 401 or an unreachable backend both land in the anonymous shell - the app
// keeps working on local data. A network-failed restore stays recoverable:
// online/visibility retries re-run it (web-offline-resilience design D3).
const auth = useAuthStore(pinia)
void auth.ensureRestored()
setupOfflineRestoreRetry(auth)

// Apply the persisted theme before the first paint and keep it in sync.
setupThemeWatcher()

// 401 interceptor: when an authenticated request loses its session mid-flight,
// drop local auth state - the app continues anonymously on local data (no
// relocation: every route is public) and the sync engine pauses itself until
// the next successful login. Unauthenticated calls (login/register/me before
// sign-in) handle UnauthorizedError themselves and the auth store is empty
// then, so this is a no-op for them.
setUnauthorizedHandler(() => {
  const auth = useAuthStore(pinia)
  if (auth.isAuthenticated) {
    auth.clearSession()
  }
})

setupI18nLocaleWatcher()
setupPushReminders()
app.mount('#app')

// Boot version line (spec: `app-version`): one console.info identifying the
// running build, so "is the site on the right version?" is answered without
// server access and front/back drift after partial rollbacks is visible.
// The API part is fire-and-forget and bypasses the API client (no session or
// base-URL semantics; the relative URL hits the same origin through the
// gateway): an offline start logs the web-only line and never blocks boot.
async function logBuildVersions(): Promise<void> {
  const parts = [`web ${APP_VERSION}`]
  try {
    const res = await fetch('/api/health')
    if (res.ok) {
      const health = (await res.json()) as { version?: string }
      if (health.version) parts.push(`api ${health.version}`)
    }
  } catch {
    // API unreachable: keep the web-only line.
  }
  console.info(`[expense-tracker] ${parts.join(' · ')}`)
}
void logBuildVersions()

// The app-shell service worker exists only in production builds; in dev its
// /sw.js would 404 (vite-plugin-pwa emits nothing without devOptions).
if (import.meta.env.PROD) registerServiceWorker()
