# Tasks: mobile-offline-first

## 1. Phase 1 — Mobile local data foundation

- [x] 1.1 Add mobile dependencies: `@trata/api` (workspace), `expo-sqlite`, `drizzle-orm`, `drizzle-kit`, `@tanstack/react-query`, `@react-native-community/netinfo` (`npx expo install` for native-bundled ones)
- [x] 1.2 Spike: verify interactive transactions in `drizzle-orm/expo-sqlite`; if unsupported, adopt expo-sqlite `withTransactionAsync` wrapper for all multi-statement writes (decision recorded in design D10)
- [x] 1.3 Create `apps/mobile/src/shared/lib/db/`: Drizzle schema (`accounts`, `categories`, `transactions` with `version`/`server_version`/`deleted_at`, indexes; money INTEGER minor units; ISO UTC TEXT dates) + `sync_outbox` (opId PK, base_version, sent_at, attempts, last_error), `sync_conflicts`, `sync_meta`; drizzle-kit migrations applied at app start
- [x] 1.4 Implement `entities/category/api/local-repository.ts`: CRUD per the shared interface; empty start (no seeds); unique-name check throwing the shared already-exists code; every mutation writes entity + outbox op in one transaction (`version += 1`, `server_version` untouched, baseVersion = `server_version` at creation; client-supplied version CAS starts when phase-2 types add `version`)
- [x] 1.5 Implement `entities/account/api/local-repository.ts`: CRUD + computed balance query (opening + manual + Σ impacts) + in-use deletion guard; same outbox/version rules
- [x] 1.6 Implement `entities/transaction/api/local-repository.ts`: create/update/delete + `query()` filters (type, account, category, inclusive date range, `occurred_at DESC, id DESC`) + `listPage` offset cursor; reference validation (account/category exist, type match, distinct transfer accounts); version-conflict check on update throwing the shared version-conflict code; same outbox/version rules
- [x] 1.7 Unit-test the three repositories: domain rules and error codes, atomicity of mutation+outbox (kill-mid-write scenario), version transitions per design D5 (mutation +1; confirmation sets `server_version`, `version := server_version` only when the last pending op confirms — including the coalesced-group realignment case: 3 edits at local 8 confirmed as one op at server 6 must end CLEAN at 6), outbox rules (baseVersion fixed at creation; op per mutation)
- [x] 1.8 Add `RepositoriesProvider` (Context + inject-or-throw hooks for the three repositories) and `QueryClientProvider` wired in root `src/app/_layout.tsx`
- [x] 1.9 Add TanStack Query hooks in `entities/*/model/`: queries keyed `['accounts']`/`['categories']`/`['transactions']`; mutations with cache invalidation (transaction mutations also invalidate `['accounts']`); mock-repository test helpers + hook tests
- [x] 1.10 Add `shared/lib/data/repository-errors-ru.ts`: `RepositoryErrorCode` → RU message map consumed via `getRepositoryErrorMessage`

## 2. Phase 1 — Product features on local data

- [x] 2.1 Rebind dashboard to repositories: selectors typed with domain types (`amount`, balances via money math incl. `manualAdjustment`), delete `model/mock-data.ts`, wire SummaryCard (3 modes), AllExpensesCard, CategorySection, ExpensesSheet; empty states for no categories / no transactions
- [x] 2.2 Create `entities/category/config/category-appearance.ts` (predefined Ionicons `IconName` list + predefined hex backgrounds from brand tokens; inline `style={{ backgroundColor }}` rendering) with a carve-out for the palette file in `design-tokens-guard.test.ts`
- [x] 2.3 Wire `NewCategorySheet` to `useCreateCategory`: name, type toggle, icon picker, color picker; validation and RU error surfacing
- [x] 2.4 Build accounts screen: list with balances, create form (name, currency USD/EUR/RUB, opening balance in major units → minor via money helpers), delete with in-use guard messaging
- [x] 2.5 Build the three speed-dial transaction flows (expense, income, transfer) with API-mirroring guards (category type match, distinct transfer accounts, amount ≥ 1 minor unit) and a minimal month list on the transactions tab
- [x] 2.6 Phase-1 acceptance: `pnpm type-check`, `lint`, jest, `pnpm knip` green; Maestro flows (add category, add account, add expense via speed dial, month/mode switching) pass in Expo Go
  - Accepted exception (user decision, 2026-08-16): static checks + 4/8 flows green; the data-creating flows 05–08 stay `TODO(sheet-e2e)` known-failing — stabilizing sheet-input typing needs @gorhom keyboard-handling work (keyboardBehavior has no `'none'` in v5), deferred as a separate task.

## 3. Phase 2 — Contract and backend sync support

- [x] 3.1 Update `docs/api/openapi.yaml` first: optional client `id` on the three create requests; `version` on Category/Account schemas and update requests; tombstone-aware listings; `POST /api/sync/push` + `GET /api/sync/pull` with per-item results and `SYNC_VERSION_CONFLICT`/`SYNC_ALREADY_EXISTS` codes; pass redocly lint
- [x] 3.2 Backend migrations: `change_log` (monotonic seq under advisory lock), `applied_operations`, `deleted_at` soft deletes + `version` on categories/accounts; audit every sqlc list/summary query for `deleted_at IS NULL`
- [x] 3.3 Backend service layer: every mutation writes entity + `change_log` (+ `applied_operations` for sync pushes) in one DB transaction; idempotent create semantics per spec (absent→create / same opId→replay / other opId→`SYNC_ALREADY_EXISTS`)
- [x] 3.4 Backend `/api/sync/push` and `/api/sync/pull` handlers: per-item CAS results with `serverState` on conflict; cursor pull in seq order with pagination; Go unit/integration tests covering replay, conflict, partial batch, tombstones
- [x] 3.5 Make registration seeding opt-in (default off, web signup keeps it on until its own product decision)
- [x] 3.6 Regenerate and extend `packages/api`: `pnpm gen:api`; sync client functions/types; extend `mapApiError` (`SYNC_VERSION_CONFLICT` → `VersionConflictError`, `SYNC_ALREADY_EXISTS` → `AlreadyExistsError`); verify `CreateTransactionPayload` accepts client id; package type-check green
- [x] 3.7 Verify web is unaffected: existing web e2e/test suites green against the updated backend (additive contract)

## 4. Phase 3 — SyncEngine on mobile

- [x] 4.1 Engine core in `shared/lib/sync/`: cycle `push → resolve conflicts → pull`; batch push of coalesced groups (full state, first op's base/opId, `sent_at` freeze for retries); remove exactly the confirmed opIds; apply confirmation transitions per design D5 (`server_version := response.version` per confirmed op; `version := server_version` when no pending ops remain — the coalesced realignment); chain continuation after an in-flight ancestor confirms; pull applies upserts to CLEAN records only, advances the stored cursor
  - Pull phase skips a run whose push phase failed on transport (lost-response case): the server replays frozen opIds on the next run first, so our own applied changes never echo back as pull-newer-on-dirty conflicts.
- [x] 4.2 Persistent conflicts: write `sync_conflicts` from push 409s and pull-newer-on-dirty; resolution UI (edit×edit dialog: keep mine → re-push on current server version / take theirs → apply serverState and drop ops); delete×edit notification with default delete-wins and restore-as-new-record
- [x] 4.3 Initial sync + ownership: `sync_meta.owner_user_id` check at login (same/empty → push-all + pull from cursor 0; different owner → block and offer clear-or-cancel); logout keeps local data
  - `entities/session` built (session-api, AuthProvider with ownership gate + 401 hook); login/register screens and the Settings auth section wired; no forced auth gate — the app stays fully usable anonymously per the sync-protocol spec.
- [x] 4.4 Triggers and resilience: NetInfo reconnect, app start/foreground, post-mutation debounce, manual refresh; 401 mid-run pauses and resumes after re-login without queue loss; retry backoff via outbox `attempts`
- [x] 4.5 Sync status UI: badge for pending outbox count and unresolved conflicts
- [x] 4.6 Integration tests against the real backend with backend-stopped offline scenarios: offline create/edit/delete → reconnect → convergence; duplicate push; delete×edit; restart with open conflicts; Maestro sync flows pass in Expo Go
  - Jest integration suite (`shared/lib/sync/backend-integration.test.ts`) runs only with `SYNC_INTEGRATION_API` set (skipped by default); it exposed and fixed two phase-2 backend bugs: `toAPICategory` never mapped `version` (REST responses reported 0), and `session.secure` env-default clobbered the yaml's `secure: false` (Secure cookies are never sent over plain-HTTP local dev — broke RN sync auth). Maestro flow `09-sync-signin` (backend + provisioned user) green; the known-failing sheet flows 05–08 are unchanged (`TODO(sheet-e2e)`).
  - Phase-2 type debt cleared to reach a green `type-check`: local account/category repositories + mocks now carry the `version` CAS exactly like transactions (per the phase-2 contract), with fixtures updated.

## 5. Phase 4 — Optional hardening (not blocking)

- [x] 5.1 Opportunistic background sync via dev build + BGTaskScheduler/expo-background-fetch (dev build + repoint `.maestro/_launch.yaml` per AGENTS.md)
  - Accepted exception (user decision, 2026-08-16): implementation verified (jest suite for the task wiring; registration succeeds on the rebuilt dev build — 0 failures in Metro logs; Maestro repointed to the dev build, flows 01–04 green). Flow 09-sync-signin stays red: Maestro `inputText` into the iOS secure field is unstable on the dev build (wrong/empty password → 401, while the same credentials succeed via curl). Deferred as a separate e2e-stability task; flows 05–08 remain known-failing `TODO(sheet-e2e)`.
- [x] 5.2 Tombstone retention job on the backend (default 90 days; decide per design Open Questions)
- [x] 5.3 Sync metrics/logging dashboard feed and conflict-rate monitoring
