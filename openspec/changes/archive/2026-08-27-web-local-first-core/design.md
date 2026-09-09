# Design: web-local-first-core

## Context

Stage 3 extracted the mobile offline-first layer into
`@trata/local-data` (drizzle schema, repositories with mirrored
backend semantics, outbox, sync engine, conflicts). The driver spike
(`docs/spikes/web-sqlite-wasm-driver.md`, branch `spike/web-sqlite-wasm`)
proved the package runs unchanged in the browser: official
`@sqlite.org/sqlite-wasm` + a ~90-line adapter over the drizzle expo-driver
`prepareSync` seam, OPFS sahpool persistence, react-free migrator — inside a
dedicated worker, green in dev and production build. The web app today is
online-first: `app/repositories.ts` provides `http` | `localStorage`
repository variants behind DI keys, the router guards every route behind
`fetchMe`, and colada queries call repository methods directly.

The mobile app is the reference composition (`src/app/_layout.tsx`,
`entities/session/model/use-auth.tsx`): DB open → repository providers →
query client → auth provider with the ownership gate (design D9 of
add-mobile-local-data) → sync engine with opportunistic triggers → global
conflict center. This change ports that composition to the web; only the
transport to the data differs (postMessage RPC instead of in-process).

## Goals / Non-Goals

**Goals:**

- Web parity with the mobile composition root, using the spike's driver code
  as-is where possible.
- A typed RPC contract such that colada queries call repository methods
  exactly as before (async interfaces unchanged from `@trata/api`).
- Anonymous-first shell with the ownership gate, network-tolerant restore,
  and logout-keeps-data — mirroring `use-auth.tsx` semantics 1:1.
- Removal of the HTTP/localStorage entity repository variants in the same
  change (decided: cut immediately, no fallback period).

**Non-Goals:**

- New screens or navigation reshaping (change 2: screens parity).
- PWA shell/service worker, install, RU/EN i18n (change 3).
- Debts / planned payments on the web — no web screens exist yet; their
  repositories enter with their screens in change 2.
- Multi-tab ownership handoff (BroadcastChannel protocol) — banner only.
- Backend or OpenAPI changes.

## Decisions

### D1. Dedicated worker owns the database; Comlink is the bridge

The whole `local-data` stack (driver, repositories, engine) lives in one
dedicated worker; OPFS sync access handles exist only in worker scope (spike
finding). Main thread talks to it over **Comlink** (`expose`/`wrap`):

- repositories are plain objects with async methods — exposed directly;
  `Remote<typeof api>` becomes the typed contract, no hand-written command
  layer;
- engine `subscribe` works through Comlink `proxy()` callbacks;
- ~1.1 KB dependency, de-facto standard, structured-clone semantics (Date
  objects survive — relevant for entity fields).

Rejected: a hand-rolled ~60-line request/response bridge (more explicit and
loggable, but sustained by hand for no functional gain); explicit command
union types (boilerplate × every repository method).

**Ready handshake:** messages posted before the worker registers its
listener are lost — the bridge resolves only after the worker posts a ready
signal; calls made before that queue behind the handshake promise.

### D2. Worker placement and boot states in FSD

`shared/lib/local-db/` (app-side wiring, mirroring mobile's
`shared/lib/db`): `sqlite-wasm-database.ts` (adapter + migrator + open, from
the spike), `local-db-worker.ts` (worker entry: Web Locks guard → open →
expose API), `local-db.ts` (main-thread singleton: `getLocalDbApi()` caching
the `Remote` after handshake). Boot state machine on the main thread:
`booting` → `ready` | `db-busy` (splash / already-open banner). The worker
chunk loads lazily via `new Worker(new URL(...), { type: 'module' })` — it
never enters the critical path of users who only view static shell.

### D3. Web Locks guard with `ifAvailable`, banner on loss

Inside the worker: `navigator.locks.request('expense-tracker-local-db', {
ifAvailable: true }, ...)` — held for the worker's lifetime. Unavailable ⇒
worker reports `db-busy` instead of opening (the sahpool `createSyncAccessHandle`
failure would otherwise surface as an opaque driver error). The main thread
renders "уже открыто в другой вкладке" with a reload action. Lock loss (holder
tab closed) is observed via the lock promise resolving after release — the
banner's retry re-runs boot.

Rejected: BroadcastChannel ownership handoff (smoother UX, but a protocol
with real edge cases — deferred until asked for by usage).

### D4. Repository wiring: single `local` variant

`provideRepositories(app)` creates exactly one variant — Comlink `Remote`
repository objects cast to the shared `Repository` interfaces from
`@trata/api`. DI keys stay. `VITE_REPO_VARIANT`, the HTTP and
localStorage implementations under `entities/*/api/`, and their cross-wiring
tests are deleted. Session APIs (`login`/`logout`/`me`, password flows) and
the sync transport keep using the API client directly — the api-client-seam
rule shrinks to exactly the mobile shape.

Testing seam: unit tests keep using in-memory mock repositories (existing
pattern); integration tests of the local stack run against
`@trata/local-data/testing` in vitest (node), not in-browser.

### D5. Auth store rework mirrors `use-auth.tsx`

`entities/session/model/use-auth-store.ts` gains the mobile statuses
(`restoring` → `anonymous` ⇄ `authenticated`):

- boot: `getCurrentUser()`; `UnauthorizedError` OR network/backend failure ⇒
  `anonymous` (no error screen);
- ownership gate on login AND on restored sessions: unowned/same owner ⇒
  bind (`getOwnerUserId`/`setOwnerUserId` over RPC) + `authenticated`;
  different owner ⇒ reka-ui AlertDialog «Локальные данные другого
  пользователя» with destructive "удалить" (`wipeLocalData` + full colada
  invalidation) and cancel (server logout, stay anonymous);
- 401 interceptor (`setUnauthorizedHandler`) already exists in the shared
  package — wire it to the store's `clearSession`;
- logout keeps data; outbox waits for the next authentication.

Router flips public-by-default: drop the auth guard entirely; login/register
pages remain for the guest entry point; `redirectIfAuthed` semantics stay.

### D6. Sync controller and triggers (web mapping)

The engine lives in the worker; the main thread gets a thin controller
(RPC + a Vue composable publishing `SyncEngineState` via `subscribe`).
Trigger mapping from mobile:

| mobile | web |
| --- | --- |
| AppState foreground | `visibilitychange` → visible |
| NetInfo reconnect | window `online` |
| post-mutation debounce 2.5 s | colada mutation-cache `onSuccess` → debounced `run()` |
| manual force run | sync badge action |
| expo-background-fetch | none (dev-build-only on mobile; web needs nothing) |

`onDataChanged` → full cache invalidation (colada equivalent of
`invalidateQueries()`); 401 → engine pauses itself, `resume()` after login.

### D7. Conflict center and sync badge (web)

`features/sync-conflicts` + `widgets/sync-status` ports of the mobile
screens onto reka-ui dialogs; mounted globally in the app layout. State
sources: engine `subscribe` + unresolved-conflict queries over RPC
(`listUnresolvedConflicts`, resolve handlers from the package). Guest mode
hides the badge (nothing to sync) and shows the anonymous indicator instead.

### D8. Playwright e2e split

- **Backendless suite**: local CRUD, persistence across reload, multi-tab
  banner, ownership gate (gate needs no server for the "different owner"
  path — two logins do; gate covered in the backend suite), offline flows
  via `context.setOffline(true)` (no offline-gate port needed — that device
  exists for Maestro only).
- **Backend suite** (env-gated like mobile's `SYNC_INTEGRATION_API`):
  initial sync union, push/pull cycles, 401 pause/resume.

## Risks / Trade-offs

- [Comlink `Remote` typing of generic repository interfaces erodes] → keep
  the cast surface at one place (`provideRepositories`), typed by the shared
  `Repository` interfaces; unit tests exercise mocks, e2e exercises the real
  bridge.
- [Structured-clone drops functions/classes in payloads] → repository results
  are plain JSON + Date; the spike verified Date survives; forbid class
  instances at the seam by review (no new types cross the bridge).
- [Worker adds async to app boot] → splash boot state; screens mount after
  `ready` (~tens of ms per spike; wasm fetch is the only network-size cost,
  and it is lazy).
- [Cutting HTTP repositories removes a rollback path] → git revert is the
  rollback; the spike proved the stack, and package tests cover domain
  semantics.
- [Single-tab exclusivity surprises users] → spec'd banner (D3); revisit
  handoff only if it hurts in practice.
- [localStorage users lose dev-offline toy] → superseded by the real
  local-first core; no production users exist (personal project).

## Migration Plan

Single deploy (web app only, no backend coordination): land the change,
delete the spike's dev-only route if it was merged (it lives on the spike
branch — nothing to clean on main). Rollback = revert the commit.

## Open Questions

- Exact colada invalidation API shape (mutation-cache subscription vs query
  cache walk) — resolvable during implementation without changing this
  design.

## Deviations during implementation

- **Inline category creation added beyond the task list**
  (`features/transaction/add/ui/NewCategoryDialog.vue`). The deleted
  localStorage repository used to bundle default categories, and the web
  never had category CRUD UI — without this dialog an anonymous user could
  not create transactions at all, contradicting this change's own spec.
  Local seeding was rejected: the backend seeds categories opt-in on
  registration, so seeded locals would push as duplicates after the initial
  sync. The dialog mirrors mobile's new-category-sheet and creates ordinary
  syncable records.
- **`sync-composable` landed in `shared/lib/local-db/`** (task 4.1 named
  `shared/lib/sync/`): a second `shared/lib` group would cross steiger's
  grouping threshold, and the sync controller belongs to the same subsystem
  as the bridge.
- **Comlink seam realities encoded in code**: awaiting a path-extended
  proxy triggers a wire GET, so forwarding proxies only await the root
  remote; Comlink's throw transfer preserves only message/name, so
  worker-side `RepositoryError` subclasses are rehydrated from `name`
  (`shared/lib/local-db/rehydrate-repository-error.ts`) — `code` survives,
  `apiCode`/`retryAfter` do not cross (nothing on web consumes them from
  repositories).
- **Playwright WebKit excluded** (config comment): the bundled WebKit build
  exposes no OPFS at all; real Safari ≥ 17 ships it — the manual
  verification flagged by the spike remains open.
- **Deleted-kind conflicts ship without restore-as-new**: review/dismiss
  only; `localState` is preserved so no data is lost. `sync-protocol`
  requires the restore option — scheduled as task 7.1 of
  web-screens-parity (design D7 there).
