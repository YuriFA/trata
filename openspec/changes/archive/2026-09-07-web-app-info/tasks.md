# Tasks: web-app-info

## 1. Update-state store (layer bridge)

- [x] 1.1 Create `apps/web/src/shared/store/use-app-update-store.ts` with pinia: `needRefresh` flag, `applyUpdate` action (closure injected by the app layer), `checkForUpdates` action (resolve registration via `navigator.serviceWorker.getRegistration()`, call `update()`, derive up-to-date / check-failed status; no registration → update UI hidden)
- [x] 1.2 Unit-test the store: injected-closure apply, check success without update, check rejection, no-registration (dev) degradation

## 2. App-layer wiring

- [x] 2.1 Extend `apps/web/src/app/register-service-worker.ts`: on `onNeedRefresh`, set the store's `needRefresh` and inject the `updateServiceWorker` closure; toast behavior unchanged
- [x] 2.2 Unit-test the wiring (mock `virtual:pwa-register`): needRefresh signal sets the store and still fires the toast

## 3. Settings card feature

- [x] 3.1 Create `apps/web/src/pages/settings/features/app-info/` (ui + model + index): `AppInfoCard` rendered in a `SettingsCard` at the bottom of the settings page, outside the authenticated template
- [x] 3.2 Card model: expose `APP_VERSION`, fetch `/api/health` on mount (plain `fetch`, fire-and-forget, network-tolerant) for the muted API version line; fire the silent mount update check in production
- [x] 3.3 Card UI states: version line always; API version as muted secondary line when reachable; update status (update-available with primary "Update" button reusing `applyUpdate`; up-to-date; check-failed with retry; hidden when no registration); ghost check/re-check button per design D4
- [x] 3.4 Add i18n keys (`ru` + `en`, product default RU) in `packages/i18n/src/locales/`; keep `pnpm i18n:lint` green
- [x] 3.5 Component-test `AppInfoCard`: all states (mocked store + mocked health fetch), anonymous render, dev degradation

## 4. E2E (PWA suite)

- [x] 4.1 In `apps/web/e2e/pwa/`: settings card shows the version; opening settings reflects a check outcome (up-to-date path)
- [x] 4.2 Update-available path: serve a byte-modified `sw.js` (route interception) to force a waiting worker; assert the settings card shows the update status and the accept action reloads into the new worker

## 5. Verification

- [x] 5.1 Full web green set: `pnpm type-check`, `pnpm lint`, `pnpm i18n:lint`, `pnpm test:unit`, `pnpm exec steiger src`, `pnpm lint:design`, workspace `pnpm knip`
- [x] 5.2 E2E green: `pnpm test:e2e` (default suite) and `pnpm test:e2e:pwa`
