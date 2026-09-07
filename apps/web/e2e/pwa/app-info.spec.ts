import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// About-app card specs (change `web-app-info`, capabilities `app-version` +
// `web-pwa`): the settings page shows the build version and the honest
// update status, and the update-available path (waiting worker -> accept ->
// reload into the new worker) works end to end. Runs against the production
// build via playwright.pwa.config.ts like the rest of e2e/pwa. Product
// default locale is RU, so the flow asserts Russian copy.

async function waitForActiveServiceWorker(page: Page) {
  await page.waitForFunction(() =>
    navigator.serviceWorker.ready.then((registration) => registration.active !== null),
  )
}

test('settings shows the build version and lands up-to-date after the mount check', async ({
  page,
}) => {
  await page.goto('/settings')
  await waitForActiveServiceWorker(page)

  // Reload so the page is controlled by the worker (the update handshake
  // needs a controller); the card's silent mount check then resolves.
  await page.reload()

  await expect(page.getByTestId('settings-app-version')).toContainText('Версия:')
  await expect(page.getByTestId('settings-update-status')).toHaveText('Актуальная версия')
})

test('a deployed update surfaces in the card and reloads into the new worker on accept', async ({
  page,
}) => {
  await page.goto('/settings')
  await waitForActiveServiceWorker(page)
  await page.reload()
  await expect(page.getByTestId('settings-update-status')).toHaveText('Актуальная версия')

  // "Deploy" a new build: byte-modify the served worker script on disk (a
  // trailing comment is inert for the identical precache manifest, but the
  // bytes differ, so the browser treats it as a new version). Restored in
  // afterEach so sibling workers see the pristine build.
  const swPath = resolve('dist/sw.js')
  const original = readFileSync(swPath, 'utf8')
  writeFileSync(swPath, `${original}\n// web-app-info e2e: v2`)

  try {
    await page.getByTestId('settings-check-updates').click()
    await expect(page.getByTestId('settings-update-status')).toHaveText('Доступно обновление')

    await page.getByTestId('settings-apply-update').click()

    // The accept reloads through SKIP_WAITING into the new worker; the card
    // then checks again and finds nothing newer.
    await expect(page.getByTestId('settings-update-status')).toHaveText('Актуальная версия')
  } finally {
    writeFileSync(swPath, original)
  }
})
