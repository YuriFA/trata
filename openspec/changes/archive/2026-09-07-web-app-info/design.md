# Design: web-app-info

## Context

The settings page (FSD `pages/settings`) already renders sections via
the shared `SettingsCard` and page-local features under
`pages/settings/features/*`. The SW registration lives in the app
layer (`app/register-service-worker.ts`): `registerSW`'s
`onNeedRefresh` fires a toast and holds the `updateServiceWorker(true)`
closure. `APP_VERSION` comes from `shared/config/app-version.ts`
(build-injected `__APP_VERSION__`). The boot console line already
fetches `/api/health` fire-and-forget and discards the result.

FSD layering constrains the wiring: `pages` cannot import `app`, so
the update signal must cross layers through a shared store - the same
bridge pattern `setup-theme-watcher` already uses (app writes, pages
read).

## Goals / Non-Goals

**Goals:**

- One source of update truth feeding both the existing toast and the
  new settings card.
- Honest statuses: "up to date" only after a check; offline failure is
  never presented as up-to-date.
- Zero behavior change for the existing toast and prompted-reload
  flow.

**Non-Goals:**

- Background periodic update checks (deferred; separate decision if
  long-lived installed sessions turn out to miss updates).
- Front/back version-drift warnings in the UI (the muted API line is
  display-only; drift diagnosis stays in the console line).
- Any mobile surface (Expo OTA is a different mechanism).

## Decisions

### D1: Shared pinia store as the layer bridge

New `shared/store/use-app-update-store` holding the update state
(`needRefresh` flag, `applyUpdate` action) and a `checkForUpdates`
action. The app layer (`register-service-worker.ts`) populates
`needRefresh` from `onNeedRefresh` and injects the
`updateServiceWorker` closure; the settings card reads and calls it.

Alternatives considered:

- Reading `navigator.serviceWorker` directly from the page and
  reimplementing update detection (`updatefound`/`waiting` handling) -
  duplicates vite-plugin-pwa's logic and forks the prompt path.
- `useRegisterSW` from `virtual:pwa-register/vue` in the card - it
  registers a second SW hook; registration already happens once in
  `main.ts`, and mixing the two would double-register.

### D2: The check reuses `registration.update()` and `onNeedRefresh`

`checkForUpdates` resolves the registration via
`navigator.serviceWorker.getRegistration()` and calls `update()`. A
found update flows through the browser's normal lifecycle into the
existing `onNeedRefresh` (no parallel detection). Status derivation:
update-available = the `needRefresh` signal; up-to-date =
`update()` resolved with no new signal; failed = `update()` rejected.
No registration (dev) hides the update UI entirely.

Trade-off: "up to date" technically means "this check found nothing" -
the spec keeps exactly that meaning, which is the honest one.

### D3: API version fetched by the card, not stored from boot

The card model fetches `/api/health` on mount with plain `fetch`,
fire-and-forget and network-tolerant - same style as the boot line
(`main.ts`), which stays as-is for operators. Reusing the boot result
would couple page state to a boot-time fetch that may be stale by the
time settings open.

The fetch bypasses the API client deliberately: `/api/health` is an
operational endpoint, not a domain resource (no session/base-URL
semantics), matching the boot line's precedent.

### D4: Silent mount check + one ghost action button

The card fires `checkForUpdates` on mount (production only). UI has
one ghost button whose label shifts by state: retry after failure,
re-check after up-to-date; a primary "Update" button appears only in
the update-available state (same action as the toast's accept). This
mirrors the sessions card's existing retry-button pattern.

### D5: Card placement and access

Bottom of the settings page, outside the authenticated template
(SW updates apply to anonymous users too). Rendered as a
`SettingsCard` with `content-class` row layout consistent with the
locale/appearance cards.

## Risks / Trade-offs

- [Mount check fires a network request per settings visit] → it is
  one conditional `sw.js` fetch, non-blocking; acceptable.
- [`update()` semantics vary subtly across browsers (e.g. no-op when
  called too soon after a previous check)] → worst case the status
  reads up-to-date from a fresh check that was throttled; next visit
  or manual re-check recovers. No correctness risk: the waiting-worker
  signal is the authoritative one.
- [Two prompt surfaces could double-fire toasts] → they share one
  signal; the toast stays in the app layer exactly as today, the card
  only renders state.

## Open Questions

- Exact copy/wording of the new i18n keys (RU default, EN) - safe to
  settle during implementation.
