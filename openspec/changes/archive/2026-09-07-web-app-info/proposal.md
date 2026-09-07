# Proposal: web-app-info

## Why

The web app's build version is visible only in a browser console line
logged at boot, and a pending PWA update only as a transient toast. A
user cannot answer "which version am I on?" or "is there an update?"
without devtools, and a missed toast leaves a waiting update invisible
until the next cold start. The settings page is the natural permanent
surface for both.

## What Changes

- New "About app" card at the bottom of the settings page (available to
  anonymous users - SW updates apply to everyone):
  - Shows the web build version (`sha-<short>`; `dev` for local builds).
  - Shows the API build version as a muted secondary line when
    `/api/health` is reachable; unreachable API hides the line without
    an error state (same network-tolerance as the boot console line).
  - Shows an honest update status in production builds:
    - a pending update (waiting service worker, the same signal that
      fires the toast) with an "Update" action reusing the existing
      prompted-reload flow (`updateSW(true)`);
    - "Up to date" only after an explicit check that found nothing;
    - a check-failure state (offline) that is NOT presented as
      up-to-date, with a retry action;
  - In dev builds (no service worker): the version line only, no update
    UI.
- Explicit "Check for updates" action in the card: calls
  `registration.update()`, reusing the browser's update lifecycle and
  the existing `onNeedRefresh` path - no parallel update-detection
  logic. The check also fires silently when the card mounts, so the
  shown status reflects an actual recent check.
- Out of scope: background periodic update checks (deferred as a
  separate decision), mobile (OTA updates are a different mechanism).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `app-version`: new requirement - the web settings page displays the
  web build version and the API build version (muted, best-effort) in
  the UI, not only in the boot console line.
- `web-pwa`: the "Prompted updates" requirement grows a second,
  persistent surface (settings card) plus an explicit user-triggered
  update check; acceptance (reload) still goes through the same
  prompted flow.

## Impact

- `apps/web/src/pages/settings/` - new card feature (ui + model).
- `apps/web/src/shared/store/` - new update-state store bridging the
  app-layer SW registration into the page (theme-watcher precedent).
- `apps/web/src/app/register-service-worker.ts` - writes update state
  into the store; toast behavior unchanged.
- `packages/i18n/src/locales/{ru,en}.json` - new settings keys.
- No backend changes; no OpenAPI changes.
