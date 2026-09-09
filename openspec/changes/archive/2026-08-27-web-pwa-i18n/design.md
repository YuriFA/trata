# Design: web-pwa-i18n

## Context

The web app has vue-i18n wired over `@trata/i18n` (en.json +
ru.json, `DEFAULT_LOCALE = 'en'`, a locale watcher already exists at
`src/app/setup-i18n-locale-watcher.ts`), and a boilerplate manifest
("MyWebSite") with icons but no service worker. Product decisions: web is
the public product, served to family phones as an installed PWA; RU is the
default language with EN available at launch. The app's offline data story
is already local-first (web-local-first-core), so the SW's only job is the
app shell — API responses must never be served from HTTP cache.

## Goals / Non-Goals

**Goals:**

- Installable PWA with offline cold start (shell + code + wasm precached).
- Update flow that never reloads without consent.
- RU default + complete EN + persistent user switch.
- Close the `DEFAULT_LOCALE` assumption item.

**Non-Goals:**

- Periodic Background Sync / push notifications ( revisit after launch).
- Mobile app i18n (mobile stays personal RU with its TODO(i18n) markers).
- Locale-aware number/currency formats beyond what money/dates already do.

## Decisions

### D1. `vite-plugin-pwa` (generateSW) over a hand-rolled service worker

Workbox `generateSW` emits the precache manifest from the Vite build
(hashed assets included automatically) with `globPatterns` extended to cover
`**/*.wasm` and the worker chunk; `navigateFallback` to `index.html` for
the SPA shell; `navigateFallbackDenylist` (or runtimeCaching absent +
denylist) keeps `/api/**` pass-through — satisfying the no-cached-API
requirement by construction (no runtime caching configured at all).
Rejected: hand-rolled SW (recurring cache-invalidation bugs for zero
benefit); `injectManifest` custom SW (no custom fetch logic needed).

### D2. Update flow: prompt, never auto-reload

`registerType: 'prompt'` with `registerSW` `onNeedRefresh` → toast
«Доступно обновление» with a reload action (vue-sonner, already in deps).
While the user declines, the old version keeps running; the new one
activates on their reload or the next cold start. Unsaved state is never
destroyed without consent.

### D3. Manifest reality pass

Replace the boilerplate: product name + short name, `display: standalone`,
`theme_color`/`background_color` from the shared design tokens (values
synced by review — the tokens package is css; no build step added),
`start_url: "/"`, existing icons including maskable; `lang: "ru"`.

### D4. Locale default flips in the package, switch lives in the app

`DEFAULT_LOCALE: 'en' → 'ru'` in `packages/i18n/src/locale.ts` (closes the
assumptions item; RU default per product decision — no browser-language
detection). The user's explicit choice is stored (localStorage, app-local
concern) and rehydrated by the existing locale watcher; the switcher
(RU/EN) lands in settings and applies immediately via the existing i18n
instance. EN completeness is enforced by the existing `i18n:lint`
(`ESLINT_I18N_STRICT=1`) gate plus a key-parity unit test on the message
catalogs.

### D5. Precache size discipline

The wasm binary (~845 KB raw) and the worker chunk are precached — offline
cold start requires them. Accept the one-time ~0.5 MB gzip cost; `dist`
size stays under review; unused sqlite3 worker1/proxy assets are excluded
from the precache glob (spike finding: they are never fetched).

## Risks / Trade-offs

- [New dev dependency (vite-plugin-pwa + workbox)] → the standard tool for
  this job; hand-rolling is the riskier alternative.
- [Stale SW bricks deploys if precache validation breaks] → Workbox
  revision hashes + the update prompt; e2e covers cold start offline.
- [i18n flip surprises EN-speaking early users] → no public users yet;
  switcher ships in the same change.
- [iOS PWA quirks (storage eviction, install flow)] → `persist()` already
  requested (change 1); install UX degrades gracefully to a home-screen
  shortcut — acceptable for the family audience.

## Migration Plan

Additive web change; deploy once — first load after deploy registers the
SW; subsequent visits are offline-capable. Rollback = revert (SW falls back
to network when no new worker registers).

## Open Questions

(none — Periodic Background Sync and push are explicitly deferred.)

## Deviations during implementation

- **Separate PWA e2e suite** (`e2e/pwa/pwa.spec.ts` + `playwright.pwa.config.ts`,
  `pnpm test:e2e:pwa` which builds and previews): a service worker only
  exists in production builds, so the default dev-server suite ignores
  `e2e/pwa/**`.
- **Locale pinning in tests**: existing e2e/unit tests assert English copy
  and pin EN via localStorage/vitest setup; the PWA suite asserts the RU
  default. In `sync-backend.spec.ts` the pin sits inside each test body —
  a `beforeEach` raced the body-level `test.skip()` teardown on Firefox.
- **Lint gate deviation**: the tasks named a root `pnpm lint` that does not
  exist; the gate ran as `pnpm -C apps/web lint`.
- **`packages/i18n` gained test infrastructure** (vitest + `test` script)
  for the new key-parity test — the package previously had no tests.
- **Locale-watcher composition moved out of `main.ts`** into
  `setup-i18n-locale-watcher.ts` (behavior-preserving, now unit-tested).
- A non-standard `notes.md` (manual install checklist for Chromium + iOS
  Safari) accompanies the archived change.
