import { test, expect, type Page } from '@playwright/test'

// Hanging-network (blackhole) specs (web-offline-resilience): carrier-
// whitelisted mobile networks blackhole foreign IPs - requests neither fail
// nor respond for the browser's full TCP timeout. `context.setOffline`
// (instant failure, used by pwa.spec.ts) never exercises this: a hanging
// request is the case that caught both shipped bugs (the render-blocking
// Google Fonts @import and the unbounded session-restore fetch). Product
// default locale is RU (capability `web-locales`), so these assert RU copy.

/** Blackhole a URL pattern: the handler never settles, so the request hangs. */
const neverSettle = () => new Promise<void>(() => {})

/** Root-anchored /api matcher (see offline-restore-recovery.spec.ts). */
const API_URL = /^[a-z]+:\/\/[^/]+\/api\//

async function waitForActiveServiceWorker(page: Page) {
  await page.waitForFunction(() =>
    navigator.serviceWorker.ready.then((registration) => registration.active !== null),
  )
}

test('dashboard renders from local data while the API blackholes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('guest-mode-indicator')).toBeVisible()
  await waitForActiveServiceWorker(page)

  // Blackhole every /api request - including the session restore.
  await page.route(API_URL, neverSettle)
  await page.reload()

  // The shell paints from the precache and the dashboard renders from local
  // data; the restore degrades into the (recoverable) offline state.
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible({ timeout: 10_000 })
})

test('login renders within the restore-timeout bound while the API blackholes', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('guest-mode-indicator')).toBeVisible()
  await waitForActiveServiceWorker(page)

  await page.route(API_URL, neverSettle)
  await page.goto('/login')

  // The router guard awaits the bounded restore (5s auth timeout): the page
  // must render within that bound instead of hanging until the browser's
  // TCP timeout.
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible({ timeout: 9_000 })
})

test('shell paints with ALL network requests blackholed (regression pin)', async ({ page }) => {
  // Seed local data so the offline render has content.
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Создать' }).first().click()
  await page.getByLabel('Название').fill('Чёрная дыра')
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await expect(page.getByText('Счёт добавлен')).toBeVisible()
  await waitForActiveServiceWorker(page)

  // Blackhole EVERYTHING except the SW script itself (its update check is
  // non-blocking anyway): the precache must serve the whole shell with no
  // hung render-blocking request - the class of bug the Google Fonts
  // @import shipped with.
  await page.route('**/*', (route) => {
    if (route.request().url().endsWith('/sw.js')) {
      void route.fallback()
      return
    }
    void neverSettle()
  })
  await page.reload()

  // The precached shell paints and operates on local data with every
  // network request hung: the accounts screen (current route) and then a
  // client-side navigation to the dashboard both render.
  await expect(page.getByRole('heading', { name: 'Счета' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Чёрная дыра')).toBeVisible({ timeout: 10_000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible({ timeout: 10_000 })
})
