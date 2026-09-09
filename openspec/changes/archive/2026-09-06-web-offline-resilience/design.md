# Design: web-offline-resilience

## Context

The session-restore flow (`useAuthStore.ensureRestored`) and the sync engine
share `createApiClient` (`packages/api`). Nothing in that factory bounds a
request today; every fetch relies on the browser TCP stack (minutes under a
blackhole). The restore promise is cached forever, and its catch-all maps
both "401 not signed in" and "network failed" to the same terminal anonymous
state (design D5 of the web-local-data change).

## Goals / Non-Goals

Goals:

- Bound every API request without touching call sites.
- Make a network-failed restore recoverable while keeping 401 terminal.
- Keep the degradation invisible on healthy networks (zero extra roundtrips).

Non-Goals:

- A global "network health" probe/ping gate (rejected in design review: same
  information as the request's own timeout, one extra roundtrip on the happy
  path).
- Changing the sync run policy, backoff curve, or conflict handling.
- Any UI beyond the existing mode indicator changing copy/state.

## Decisions

### D1. Timeout lives in the client factory, per instance

`createApiClient(options)` gains `timeoutMs?: number` (default 10s). Every
request composes `AbortSignal.timeout(timeoutMs)` with any caller-supplied
signal. The web app creates its tuned instances through the existing
`shared/api/client.ts` seam: the main client keeps the default; session calls
pass a 5s timeout at the call site via the existing request-options signal
field; the sync worker builds its client with 30s.

Rationale: one mechanism, tree-shaken into both the main thread and the
local-db worker; no call-site sprawl; per-call override stays available for
future long transfers.

Aborted requests surface as the existing network `RepositoryError` kind
(transport failure) - the sync engine's backoff and the restore's catch path
already handle it; no new error taxonomy.

### D2. Two anonymous states, one status machine extension

`AuthStatus` gains nothing; instead the store exposes a companion flag:

- `restoreOutcome: 'unknown' | 'signed-out' | 'offline'`
  - `'signed-out'`: the server answered 401 (or logout) - terminal for the
    run.
  - `'offline'`: restore failed by timeout/network - recoverable.
  - `'unknown'`: restore still pending.

`ensureRestored()` keeps its once-per-run contract for the *settled* cases;
D3 adds the recovery path. This avoids a fourth status leaking into every
consumer of `auth.status` while still letting the shell indicator and the
retry logic branch.

### D3. Recovery: retry triggers, not polling

While `restoreOutcome === 'offline'`, the store (wired once from the app
layer, same pattern as the sync controller injection) re-runs the restore on
`window online` and on `visibilitychange -> visible`. A retry that succeeds
runs the normal `passOwnershipGate` path; the sync engine picks up through
the existing `isAuthenticated` watch. No timers, no manual refresh UI.

### D4. Indicator copy distinguishes offline from guest

The shell indicator (existing `guest-mode-indicator` surface) renders:

- offline + local owner exists: "offline mode, will sign back in when the
  network returns" (RU/EN strings added to `@trata/i18n`);
- `signed-out`: today's guest copy unchanged.

The owner binding (`db.meta.getOwnerUserId()`) is the existing, free signal
for "someone was signed in on this device".

## Risks / Trade-offs

- 5s restore timeout on a merely-slow network misfires into offline mode:
  benign - the app is fully usable, the retry path heals it, and the deep
  links to `/login` still work (the guard awaits the same bounded promise).
- `AbortSignal.timeout` support: Safari 16+ / Chrome 103+; the PWA baseline
  already requires newer APIs (OPFS sync handles). No fallback shim.
- Mobile app inherits the 10s default: strictly better than today's unbounded
  hangs; per-platform tuning can come later if measurements demand it.

## Migration Plan

Purely additive client behavior + additive store state; no persistence, no
API contract change. Ships as one change; the e2e blackhole suite lands with
it to pin the behavior.

## Open Questions

None - the design was settled in a grilling session (2026-09-06) with the
user, including the timeout tiers (5/10/30s), the retry triggers, and the
indicator distinction.
