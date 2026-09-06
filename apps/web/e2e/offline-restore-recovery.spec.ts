import { test, expect } from '@playwright/test'

// Airplane-mode recovery (web-offline-resilience design D3): a network-failed
// session restore is recoverable - the `online` event retries it in place, so
// a signed-in user who starts the app offline gets their session back when
// connectivity returns, without a manual reload. Backendless: /api/auth/me is
// route-mocked, everything else hits the dev proxy (which 500s harmlessly -
// the sync engine treats it as a transport failure).

// The mocked authenticated user for /api/auth/me.
const ME = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'e2e+offline-restore@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// Root-anchored /api matcher: a plain `**/api/**` glob would also swallow
// the dev server's workspace-module URLs
// (`/node_modules/@expense-tracker/api/src/...`) and hang the module graph.
const API_URL = /^[a-z]+:\/\/[^/]+\/api\//

test('a network-failed restore recovers when connectivity returns', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))

  // 'up' serves the session, 'down' fails instantly (airplane mode).
  // Everything else under /api is blackholed: a real local backend (docker
  // compose on :8080) would 401 the household/sync probes - and every 401
  // clears the session through the unauthorized interceptor. A hanging
  // request parks the household gate (sync skips) without any 401s.
  let backend: 'up' | 'down' = 'up'
  await page.route(API_URL, (route) => {
    if (!route.request().url().includes('/api/auth/me')) {
      return new Promise<void>(() => {})
    }
    if (backend === 'up') return route.fulfill({ json: ME })
    return route.abort('connectionreset')
  })

  // Online: the restore authenticates and binds the local owner.
  await page.goto('/')
  await expect(page.getByText(ME.email).first()).toBeVisible()

  // Offline cold start (instant failure, like airplane mode): the app lands
  // in the recoverable offline state - NOT terminal guest mode - because the
  // local database has an owner binding.
  backend = 'down'
  await page.reload()
  await expect(page.getByTestId('offline-mode-indicator')).toBeVisible()
  await expect(page.getByText(ME.email)).toHaveCount(0)

  // Connectivity returns: the online event retries the restore in place -
  // authenticated state (and with it the sync engine) comes back without a
  // reload.
  backend = 'up'
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText(ME.email).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('offline-mode-indicator')).toHaveCount(0)
})
