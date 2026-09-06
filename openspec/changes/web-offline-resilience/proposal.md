# Proposal: web-offline-resilience

## Why

On mobile networks that operate carrier whitelists (foreign IPs hang instead
of refusing), every request to the VPS blackholes for minutes. Two user-facing
failures follow:

1. The login/register pages never render: the router guard awaits the session
   restore, whose fetch has no timeout, so the wait lasts until the browser's
   TCP stack gives up.
2. A network-failed session restore is terminal: `ensureRestored()` caches its
   promise forever, so a user who was signed in, enables airplane mode (or
   crosses into a blackholed network), opens the app, then regains
   connectivity stays in guest mode until a manual reload - sync never
   resumes.

The companion root cause - the render-blocking Google Fonts `@import`
white-screening the shell itself - was already fixed on main (commit
`00f52b8`); this change covers the remaining API-level degradation.

## What Changes

- Bounded request timeouts in the shared API client factory
  (`@expense-tracker/api`): a default for all calls, overridable per client
  instance. The web app adopts: 5s for session/auth calls, 30s for the sync
  transport (large first-sync pages on slow links), 10s for everything else.
  The sync worker inherits via its existing shared client.
- Session restore stops treating "network failed" as terminal:
  - a 401 still lands in the final anonymous (guest) state, as today;
  - a timeout/network failure lands in a recoverable *offline* state with an
    "offline mode" indicator (when local data has an owner binding),
    distinct from the guest indicator;
  - the restore is retried automatically on `online` and on
    `visibilitychange` -> visible while in the offline state; a successful
    retry authenticates and the sync engine resumes through the existing
    auth watch.
- Permanent e2e coverage for the *hanging-network* (blackhole) scenario in
  the PWA suite - today only instant-failure (`setOffline`) is covered,
  which is why the font bug and the login hang shipped.

## Capabilities

### Modified

- `web-local-data`: anonymous-first requirement gains the offline-vs-guest
  distinction and the bounded-restore timeout; new requirement for request
  timeouts at the repository seam.
- `web-pwa`: offline shell requirement gains the hanging-network scenario
  (connectivity present but unusable).

## Impact

- Affected code: `packages/api` (client factory), `apps/web` session store +
  shell indicator + i18n strings, PWA e2e suite. The mobile app consumes the
  same client factory and inherits the default timeout (10s) - acceptable
  and desirable; no mobile-specific behavior changes.
- Risks: a too-aggressive timeout aborting legitimate slow requests - the
  sync transport keeps 30s, and every timeout is retried by the existing
  backoff/policy machinery, so degradation is graceful.
- No OpenAPI/spec-first surface changes; no persistence or schema changes.
