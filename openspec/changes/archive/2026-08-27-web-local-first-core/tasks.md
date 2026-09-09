# Tasks: web-local-first-core

## 1. Worker: driver and storage (port from spike branch)

- [x] 1.1 Add `@trata/local-data`, `drizzle-orm`, `@sqlite.org/sqlite-wasm`, `comlink` to `apps/web` dependencies
- [x] 1.2 Port `shared/lib/local-db/sqlite-wasm-database.ts` from branch `spike/web-sqlite-wasm` (adapter + react-free migrator + `openLocalDatabase`), drop spike-only debug helpers
- [x] 1.3 Create `shared/lib/local-db/local-db-worker.ts`: Web Locks `ifAvailable` guard (`expense-tracker-local-db`) held for the worker lifetime; on loss report `db-busy`; on success open + migrate the database, construct account/category/transaction repositories from `@trata/local-data`, build the sync engine, `expose` the API via Comlink, then post the ready signal
- [x] 1.4 Create `shared/lib/local-db/local-db.ts` (main thread): spawn the worker with `new Worker(new URL(...), { type: 'module' })`, resolve a typed `LocalDbApi` (Comlink `wrap` + ready-handshake queueing calls made before ready), expose boot-state events (`booting`/`ready`/`db-busy`), singleton accessor
- [x] 1.5 Call `navigator.storage.persist()` from the main thread at boot; surface `storage.estimate()` in settings later (not in this change)

## 2. Repository wiring

- [x] 2.1 Rewrite `app/repositories.ts`: `provideRepositories(app)` provides exactly one `local` variant — Comlink `Remote` repositories cast to the shared `Repository` interfaces; keep DI keys from `@trata/api`
- [x] 2.2 Add worker-side RPC surface for owner/meta and wipe: `getOwnerUserId`, `setOwnerUserId`, `wipeLocalData`, `isDbBusy` reporting (wrapping the package's sync-meta helpers)
- [x] 2.3 Update `app/repositories.test.ts` for the new wiring (handshake + provide assertions against a fake `LocalDbApi`)
- [x] 2.4 Boot shell: splash composable/component for `booting`, "уже открыто в другой вкладке" banner with reload for `db-busy`, mounted above the router outlet

## 3. Anonymous-first auth

- [x] 3.1 Rework `entities/session/model/use-auth-store.ts` to the mobile status machine (`restoring` → `anonymous` ⇄ `authenticated`): network-tolerant restore (401 OR fetch failure ⇒ anonymous), keep `clearSession` wired to `setUnauthorizedHandler`
- [x] 3.2 Implement the ownership gate (design D5): unowned/same-owner bind + authenticate; different owner ⇒ reka-ui AlertDialog with destructive "удалить данные" (`wipeLocalData` via RPC + full cache invalidation) and "отмена" (server-side logout, stay anonymous); apply on login, register, and restored sessions
- [x] 3.3 Flip the router to public-by-default: remove the auth guard and `redirectIfAuthed` relocations except on login/register themselves; add the guest indicator (local-mode chip) and signed-in account entry in the app layout
- [x] 3.4 Unit tests: restore paths (ok/401/network-fail), gate paths (unowned, same owner, different owner delete/cancel), logout-keeps-data (mock RPC)

## 4. Sync controller, badge, conflicts

- [x] 4.1 Create `shared/lib/sync/sync-composable.ts`: engine state via `subscribe` over RPC; `runNow(force)`; trigger wiring — `visibilitychange`, window `online`, debounced (2.5 s) run after colada mutations, auth-gated (run + `resume` on `authenticated`, never in anonymous)
- [x] 4.2 Wire `onDataChanged` from the worker to full colada cache invalidation on the main thread
- [x] 4.3 Port `widgets/sync-status` from mobile: badge with pending/running/paused states, manual run action, hidden in anonymous mode
- [x] 4.4 Port `features/sync-conflicts` (conflict center) onto reka-ui: list unresolved conflicts, keep-local / take-server resolution flows via RPC, mounted globally in the app layout
- [x] 4.5 Unit tests for badge states and conflict-center resolution flows (mock RPC state)

## 5. Cut the legacy variants

- [x] 5.1 Delete `entities/{account,category,transaction}/api` HTTP and localStorage repository implementations and their tests; keep the barrel interfaces/DI exports the app consumes
- [x] 5.2 Remove `VITE_REPO_VARIANT` handling, docs references, and any mock-localStorage fixtures superseded by in-memory mocks
- [x] 5.3 Run `pnpm knip` and remove newly-unused files/exports/dependencies

## 6. e2e and gates

- [x] 6.1 Split playwright suites: backendless (local CRUD, reload persistence, offline via `context.setOffline`, multi-tab `db-busy` banner) and backend-gated via env (initial sync union, push/pull, 401 pause/resume) — mirror mobile's `SYNC_INTEGRATION_API` skip pattern
- [x] 6.2 Update existing e2e flows that assumed HTTP repositories/redirects-to-login
- [x] 6.3 Full gates: `pnpm -C apps/web type-check test:unit test:e2e`, `pnpm arch:check` (web FSD rules cover the new slices), `pnpm lint`, `pnpm knip`; fix fallout
- [x] 6.4 Update `apps/web/AGENTS.md` and `docs/architecture/invariants.md`/`overview.md` evidence paths for the new data layer; note the single-tab contract
- [x] 6.5 `openspec validate web-local-first-core --strict` passes
