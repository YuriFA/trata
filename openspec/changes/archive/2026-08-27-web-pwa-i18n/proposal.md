# Proposal: web-pwa-i18n

## Why

The web app is the product's future public face served to family phones as a
PWA (App Store costs made mobile stay personal). Today it has only a leftover
boilerplate manifest ("MyWebSite") and no service worker — it cannot install
or load offline — and while vue-i18n wiring exists with RU/EN message files,
the default locale is still `en` with incomplete EN coverage, while the
product decision is RU default + EN at launch.

## What Changes

- **PWA**: real manifest (product name, token theme colors, standalone
  display, existing icons), service worker with app-shell precache including
  the SQLite WASM binary and worker chunk, explicit no-cache policy for API
  calls, and a prompted update flow ("доступно обновление" → reload).
- **i18n launch readiness**: `DEFAULT_LOCALE` flips en→ru in
  `@trata/i18n` (closing the tracked assumption), EN coverage
  completed for all screens (including change 2's), locale switcher in
  settings with persisted choice.
- Assumptions doc updated (DEFAULT_LOCALE item closed; PWA direction
  recorded).

## Capabilities

### New Capabilities

- `web-pwa`: installability, offline app shell, and update behavior of the
  web app as a PWA.
- `web-locales`: locale behavior of the web app — RU default, EN
  availability, user switching with persistence.

### Modified Capabilities

(none)

## Impact

- `apps/web`: vite PWA plugin config (or hand-rolled SW — decided in
  design), manifest replacement, update-toast wiring, settings locale
  switcher, dependency additions.
- `packages/i18n`: `DEFAULT_LOCALE` en→ru; any missing EN keys.
- Docs: `docs/assumptions.md` (close DEFAULT_LOCALE item), `apps/web/AGENTS.md`.
- Tests: unit tests for locale switching/persistence; e2e offline-load and
  update-prompt flows; i18n lint (`ESLINT_I18N_STRICT`) stays green.
