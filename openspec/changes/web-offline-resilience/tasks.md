# Tasks: web-offline-resilience

## 1. packages/api - timeout in the client factory

- [ ] 1.1 Add `timeoutMs` option to `createApiClient` (default 10 000) in
  `packages/api`; compose `AbortSignal.timeout` with any caller signal on
  every request; surface aborts through the existing network
  `RepositoryError` path
- [ ] 1.2 Unit tests: default timeout aborts a hanging fetch; per-instance
  override; caller signal still respected; non-2xx mapping unchanged

## 2. Web - timeout tiers

- [ ] 2.1 `shared/api/client.ts`: keep the default (10s) for the main client
- [ ] 2.2 Session API calls (`getCurrentUser` path used by restore, login,
  register): 5s timeout via the request-options signal
- [ ] 2.3 Local-db worker client (`shared/lib/local-db/local-db-worker.ts`):
  build with 30s for the sync transport

## 3. Web - recoverable offline restore

- [ ] 3.1 `useAuthStore`: add `restoreOutcome` (`unknown`/`signed-out`/
  `offline`); set `signed-out` only on 401 (and logout), `offline` on
  timeout/network error; keep `ensureRestored` once-per-run for settled
  outcomes
- [ ] 3.2 Retry path: expose `retryRestoreIfOffline()`; wire `window online`
  + `visibilitychange -> visible` listeners once from the app layer; a
  successful retry goes through `passOwnershipGate` and the existing auth
  watch resumes sync
- [ ] 3.3 Shell indicator: while `restoreOutcome === 'offline'` and the
  local db has an owner binding, render offline-mode copy instead of guest
  copy; add RU/EN strings to `@expense-tracker/i18n` (strict `i18n:lint` +
  key parity)
- [ ] 3.4 Unit tests: 401 -> `signed-out` (terminal, no retry); network
  error -> `offline` (retry authenticates; ownership gate runs; sync watch
  fires); indicator copy selection

## 4. E2E - hanging-network (blackhole) suite

- [ ] 4.1 PWA suite: cold start with hung `/api/**` (never-fulfilling route
  handler, NOT `setOffline`): `/` renders the dashboard from local data;
  `/login` renders within the 5s bound
- [ ] 4.2 PWA suite: cold start with ALL non-SW requests hung: shell paints
  (regression pin for the render-blocking-font class of bugs)
- [ ] 4.3 Dev-server suite: airplane-mode recovery - authenticated start
  offline (instant API failure), `online` event, restore retries and the
  signed-in state returns without reload
