# Architecture Overview — observed baseline

Baseline captured 2026-08-20 on branch `chore/expo-sdk-57` (HEAD `c0b18bf`).
This document describes the architecture **as observed in the code**, with
file-level evidence. It replaces the earlier overview, which predated
mobile's offline-first data layer and the sync protocol (it claimed mobile
had no backend integration and that tokens shipped as RN styles — neither is
true today).

Reading conventions:

- Unmarked statements are **observed** facts.
- **[INTENT-DIVERGENT]** — code differs from documented intent (ADRs,
  invariants, openspec, AGENTS.md working rules); the divergence itself is
  an observed fact, restated in the summary at the end.
- **[INTENDED]** — documented intent that the code confirms.
- **[UNKNOWN]** — a rule or rationale that cannot be established from code,
  tests, OpenSpec, or existing documentation. It is not assumed.

Architectural decisions live in `docs/adr/` and
`docs/architecture/invariants.md`; capability specs in `openspec/specs/`
(accounts, categories, transactions, sync-protocol, mobile-forms,
mobile-local-data); agent working rules in the `AGENTS.md` files (root +
per area); undecided items in `docs/assumptions.md`; known problems in
`docs/technical-debt.md`.

## System map

```
docs/api/openapi.yaml ── single HTTP contract source (OpenAPI 3.0.3, 18 paths)
   ├─→ backend       oapi-codegen    → internal/api/api.gen.go   (make gen; CI drift gate)
   └─→ packages/api  openapi-typescript → src/schema.ts          (pnpm gen:api; CI gate: ts-gen-check)

packages:  money (leaf) ←── api ←── web       web uses   api, money, i18n, tokens, dates, local-data
           dates (leaf) ←────────── mobile    mobile uses api, dates, money, tokens, local-data (NOT i18n)
           i18n  (leaf) ←── web
           tokens (leaf) ←── web + mobile

web    ── local-first (SQLite-WASM worker + sync engine, anonymous mode) ──→ backend
mobile ── SQLite source of truth; sync engine push/pull over HTTP ──→ backend (offline-first)
```

One Go backend serves two clients of the same product: **both are
local-first** under the client local data boundary (decided 2026-08-20,
invariant #16) — local repositories over on-device storage are the source of
truth for domain data, with direct API access limited to control-plane
operations; the sync engine reconciles with the backend (web: SQLite-WASM in
a worker, anonymous mode included; mobile: on-device SQLite). Both consume
the same generated contract types and the same error-mapping layer from
`@trata/api`.

CI reality (`.github/workflows/ci.yml`, 6 jobs): redocly spec lint +
PR-only `oasdiff breaking`; backend codegen drift gate (`make gen-check`);
TS contract drift gate (`ts-gen-check`, added 2026-08-20: regenerate +
`git diff --exit-code` on `schema.ts`); architecture rules gate
(`arch-check`, added 2026-08-20: dependency-cruiser — package
leaf/direction + platform bans, mobile FSD layer direction +
cross-slice + api-client seam, date-fns facade ban; backend layering is
enforced inside the lint job via depguard); Go lint + `go test -race`;
backend Docker smoke build. Still local-only: type-check, web/mobile
tests, knip, and web Steiger (documented as debt in
`docs/technical-debt.md`).
`deploy.yml` is manual-dispatch backend image build to GHCR.

## Backend (`backend/`)

Go 1.26 module `github.com/yurifa/trata/backend`: Gin + pgx/v5 +
sqlc + golang-migrate. Single binary `cmd/expense-tracker-api/main.go`
with manual constructor injection (main.go:117-137) and graceful shutdown;
migrations are embedded and auto-applied at boot
(`internal/repository/postgres/db.go:74-107`).

### Layers and dependency direction

```
transport/http (gin)  →  service  →  repository (interfaces)  ←  repository/postgres (sqlc impl)
        \_______________________________↑ middleware exception (decided, allowlisted)
                 domain (pure types + sentinel errors) — shared by all layers
```

- `internal/transport/http/` — handlers implement the generated
  `api.StrictServerInterface` (every handler signature uses generated
  request/response objects); `convert.go` maps domain ↔ generated types.
- `internal/service/` — business rules; imports only `auth`, `domain`,
  `repository` (interfaces). No gin/sqlc types reach this layer.
- `internal/repository/interfaces.go` — 10 interfaces expressed purely in
  `domain` types; implemented by one concrete `*postgres.Repository` with
  compile-time assertions, and by in-memory `service/fakes` for tests.
- sqlc-generated code (`internal/repository/db/`) is imported **only** by
  `internal/repository/postgres/`; every row is mapped to `domain.*`.
- Middleware exception (decided 2026-08-20): cross-cutting infrastructure
  middleware that needs no service business logic may depend directly on
  repository interfaces. Allowed set is explicit: `SessionRepository` +
  `UserRepository` (auth middleware, `middleware/auth.go:23-28`, incl.
  sliding-expiry handling) and `IdempotencyRepository` (idempotency
  middleware, `middleware/idempotency.go:48`); wired in `NewEngine`
  (`server.go:30-32`). Any new middleware → repository dependency requires
  a separate architectural decision (invariant #17 in `invariants.md`).
  Accepted consequence: the
  sliding-expiry policy stays in transport middleware without dedicated
  unit tests (covered only indirectly via e2e).
- Repository/service boundary (decided 2026-08-20): repository must not
  decide business policy; it may implement persistence/integrity mechanics
  and classify persistence-level outcomes. Placement heuristic: a rule
  expressible and testable without a database does not belong in the
  repository. Under this rule, CAS `WHERE version = X` and `classify*Write`
  (`postgres/transactions.go:143-152`) are compliant persistence semantics;
  `RegisterUser`'s default-category seeding (`postgres/users.go:47-70`) and
  `VerifyEmailCode`'s attempt accounting
  (`postgres/email_verification.go:114-126`, constant in
  `domain.MaxVerificationAttempts`) are **registered deviations** — business
  policy inside repository transactions, migration deferred by decision (no
  UoW seam introduced for now; revisit as new tasks exercise the boundary).
  Rule recorded in invariant #18 in `invariants.md`.

### Data flow (representative: `POST /api/transactions`)

1. Middleware chain built in `NewEngine` (`transport/http/server.go:26-89`):
   CORS → RequestID → Recovery → slog logger → OpenAPI-spec request
   validation (from the embedded spec) → path-aware auth → rate limit
   (login/verify-email only) → path-aware idempotency (this route only).
2. Auth middleware resolves the `session_id` cookie to a session (SQL
   enforces `expires_at > now()`), loads the user, resolves the user's
   (single, v1) household membership, applies sliding expiry (extend when
   <25% TTL remains), sets user/householdID/session in the gin context.
3. Idempotency middleware requires an `Idempotency-Key` header, hashes the
   body, and replays stored responses for repeated keys (per-user scope).
4. Handler (`transport/http/transactions.go`) takes the householdID
   (scoping) and user (authorship) from context (never the body), maps to
   `domain.CreateTransactionParams`, calls `TransactionService.Create`.
5. Service validates references and business rules (household ownership of
   account/category, cashflow-vs-transfer rules — `service/transaction.go`).
6. Repository wraps the write in `withinLockedTx`
   (`postgres/tx.go`): begin → per-household advisory lock
   (`pg_advisory_xact_lock`) → entity write + `change_log` append in one
   transaction → commit. The lock makes `change_log.seq` order equal commit
   order within a household (rationale documented in
   `migrations/000002_sync.up.sql`, re-keyed to households by
   `000005_household.up.sql`).
7. Errors flow back to `writeDomainError` (see below); success is converted
   to generated response types.

Login (`POST /api/auth/login`): handler → `AuthService.Login`
(`service/auth.go:102-121`) → bcrypt verify with anti-enumeration (wrong
email and wrong password both yield `ErrInvalidCredentials`) → fresh
256-bit session token persisted → `Set-Cookie` built by
`transport/http/cookie/cookie.go` (HttpOnly, Path=/, SameSite/Secure from
config).

### Persistence

- sqlc config reads the **schema from the migration files**; generated code
  is committed under `internal/repository/db/`. Migrations are sequential
  up/down pairs, embedded, auto-applied at startup (`Makefile migrate-*`).
- Money: `BIGINT` int64 minor units everywhere (`transactions.amount`,
  `accounts.opening_balance`, `accounts.manual_adjustment`); balances
  computed in SQL via the tombstone-filtered `account_contributions` view.
- Optimistic concurrency: `version` is an optimistic-concurrency token for
  mutable user-owned entities only (transactions/accounts/categories; no
  other entity carries one); CAS in the SQL
  `WHERE ... AND version = @version` + `version = version + 1`; zero-row
  outcomes classified as NotFound vs `Err*VersionConflict` → HTTP 409
  `*_VERSION_CONFLICT` on REST endpoints — sync push instead reports
  conflicts per-item inside HTTP 200 (`SYNC_VERSION_CONFLICT`), a separate
  batch-protocol semantic (clarified 2026-08-20).
- Deletes are tombstones (`deleted_at`), never hard `DELETE` — except the
  retention job which GCs tombstones older than the retention window
  (default 90 days; the only `DELETE`s on synced tables live in
  `queries/retention.sql`). The `change_log` is never pruned: pulls serve
  tombstones from the log alone, so a device offline through the whole
  window still converges (`jobs/retention/retention.go:1-8`).
- Timestamps `TIMESTAMPTZ ... DEFAULT now()`; Go code uses
  `time.Now().UTC()`. IDs are UUIDs (`gen_random_uuid()`), and
  client-supplied IDs are accepted for offline-first creates
  (`postgres/tx.go:58-63`).
- Enums are CHECK constraints, not Postgres ENUM types.

### Authentication and ownership

Stateful sessions in Postgres (`sessions` table; id = 256-bit `crypto/rand`
hex token, stored as the cookie value). No JWT anywhere. Sliding expiry;
expired sessions purged by `jobs/cleanup/` (6h default interval).
Public route set is exactly: register, login, logout, password-reset
request+confirm; everything else under `/api/` requires a session
(`server.go:100-108`). Password reset tokens are stored SHA-256-hashed,
single-use, and atomically revoke all sessions.

Ownership (household model, ADR-0002): every shared-resource query filters
`household_id` (verified across
`queries/{accounts,categories,transactions,debtors,debt_operations,planned_payments,sync}.sql`);
the householdID originates only from the auth middleware's membership
resolution, and `user_id` on entity rows is an authorship stamp set
server-side. Cross-household access returns not-found; IDOR behavior is
asserted by two-household isolation tests. Every user owns exactly one
personal household (v1); `households`/`household_members` live in
`migrations/000005_household.up.sql`.
Sanctioned unscoped exceptions (clarified 2026-08-20; invariant #5
unchanged): `users` lookups by unique
identity — login + auth middleware, the PK is the identity
(`queries/users.sql:3-5`); capability-keyed auth rows — `sessions` by
token, `password_reset_tokens` by token hash, where possessing the secret
is the authorization (`queries/sessions.sql`,
`postgres/password_reset.go:60-83`); and time-based cleanup jobs over
expired rows.

CSRF (decided 2026-08-20, `docs/adr/0001-auth-csrf-threat-model.md`): one
stateful cookie session for both clients; the primary CSRF control is a
server-side Origin check on state-changing browser requests — **implemented
2026-08-30** (`middleware/origin.go`, mounted pre-CORS in `server.go`,
403 `ORIGIN_REJECTED`; e2e `hardening_test.go`); SameSite=Lax + JSON-only
+ CORS allowlist remain defense-in-depth; native clients carry no extra
CSRF protection. Transport policy: production HTTPS-only with `Secure`
cookies; dev allows plain HTTP on localhost. Rate limiting is an in-memory
per-IP limiter on login/verify-email **and registration**
(attempt-counting, `middleware/ratelimit.go`, 429
`REGISTER_RATE_LIMITED` + `Retry-After`) — process-local, not distributed.

### Error handling

Response shape is `ErrorResponse{code, message}` (`httperr/httperr.go`).
Domain errors are defined once as sentinels (`domain/errors.go`) and mapped
to status+code in **one place** — `writeDomainError`
(`transport/http/errormap.go:29-53`), wired as the oapi-codegen
`HandlerErrorFunc`. Middleware (auth 401s, validation 400s, idempotency,
rate-limit 429) writes responses directly but shares the same shape via
`httperr.Write`. Request-shape validation comes from the embedded spec at
the engine level (400 `VALIDATION_FAILED`); validation responses use the
plain `ErrorResponse` shape with no field-level details (the former
`ValidationErrorResponse`/`FieldError` models were removed — finding A4).

### Testing

Pyramid: unit tests for crypto primitives and services (against in-memory
`service/fakes`), transport tests with httptest + fakes, job-loop tests;
integration tests against a real `postgres:17` testcontainers container
(repository suites incl. IDOR and optimistic-concurrency, e2e auth + sync
flows); `go test -race ./...` runs in CI. The observable UTC rule is
`time.Now().UTC()` + `time.Equal`/RFC3339 comparisons in tests.
Coverage gaps (observed): idempotency and rate-limit middleware, `config`,
`logger`, and no category-specific repository suite.

## Shared packages (`packages/`)

Platform-agnostic TypeScript resolved to source `.ts` via `exports` (no
build step). The "only fetch-family APIs, no DOM/Vue/RN" rule is **observed
to hold**: grep of `packages/*/src` finds no `window.`/`document.`/
`navigator.`/`react-native`/`localStorage` usage; `createApiClient` touches
only `globalThis.fetch` and injected `fetch`.

- **`api`** (deps: `@trata/money` — the only cross-package import
  in the tree) — the contract layer: generated `schema.ts` (1971 lines,
  committed, regenerated via `pnpm gen:api`); `createApiClient({baseUrl,
  fetch})` wrapping openapi-fetch with `credentials: 'include'` default;
  `mapApiError` keyed on the response `code` (not HTTP status) producing
  `RepositoryError` subclasses, plus module-level
  `setUnauthorizedHandler`; the `Repository<T,C,U>` interface and per-entity
  extensions (`TransactionRepository` adds `query()`/`listPage()`); HTTP
  repository implementations; sync transport functions
  (`pushSyncOperations`/`pullSyncChanges`, per-item conflicts returned as
  data). Hand-written domain types narrow `CurrencyCode` via money. No
  in-package tests — covered from app test suites.
- **`money`** (leaf) — dinero.js integer money over int64 minor units;
  `formatMoney` is deliberately Intl-free (Hermes-safe, hand-rolled en/ru
  shapes); balance calculator generic over a minimal account shape.
- **`dates`** (leaf, dep date-fns 4.4.0) — ru/en locale-shaped labels,
  month cursor, `monthToUtcDayRange`, Monday-first grids, day keys,
  `nowIso`/`isoDaysAgo`. Consumed only by mobile today; decided end-state
  (2026-08-20): both apps use this package as the canonical date layer —
  web's app-local adapter is temporary, extend the package API when web
  needs more. Product default locale is RU (implemented 2026-08-27 in
  `DEFAULT_LOCALE`, change `web-pwa-i18n`).
- **`i18n`** (leaf) — EN/RU bundles in key parity (unit-tested in
  `src/locales.test.ts`), `MessageSchema` (EN is source of truth),
  `mapCategory(s)` with an injected `Translator`, 24 seed-category
  slug→key mappings, `DEFAULT_LOCALE = 'ru'` (flipped en→ru 2026-08-27,
  change `web-pwa-i18n`). **Consumed only by web**; mobile does not install
  it (see Mobile section).
- **`tokens`** (leaf, css-only) — two copies kept in sync **by machine**:
  `src/index.css` (web) and `src/mobile.css` (mobile, Uniwind); the mobile
  palette is canonical (decided 2026-08-20). Synced 2026-08-20 (light
  background/border, radius 2/4px literals, popover and aliceblue present
  on both sides) and guarded by the mobile `design-tokens-sync.test.ts`
  (fails on any drift between the copies, per theme).

tsconfig note: strict standalone configs in every TS package, all with
`noUncheckedIndexedAccess` (i18n gained it 2026-08-20, type-checks clean).
`tokens` has no tsconfig by design — it is css-only and exempt from the
rule (decided 2026-08-20); its palette is guarded by the
mobile `design-tokens-guard` and `design-tokens-sync` tests.

## Web (`apps/web/`)

Vue 3 + Vite, Feature-Sliced Design: `app/ pages/ widgets/ features/
entities/ shared/` (`widgets/sync-status` is the first widgets slice). Layer
rules are enforced by Steiger (`steiger.config.ts`, run via `pnpm exec
steiger`) — local only, not CI. Local-first since the `web-local-first-core`
rework: the app is fully usable anonymously on local data, and account login
binds it through the ownership gate + initial sync (capability spec
`openspec/specs/web-local-data`). Screen inventory and navigation contract
(screen set parity with mobile, web-native presentation) are specified by the
`web-screens` capability: dashboard, transactions, analytics (overview +
`/analytics/:direction` detail), debts, plans, accounts, settings — all
reachable through the persistent `AppNav`. Transaction creation (any type)
happens in dialogs, not on dedicated pages.

- **State**: server state via `@pinia/colada` (`gcTime 300s`, `staleTime
  30s`, retry ×2); auth/session state in a Pinia store
  (`entities/session/model/use-auth-store.ts` — the session itself is an
  HttpOnly cookie, so the store holds only the fetched user); UI/settings
  state in a Pinia settings store persisted to localStorage via
  `@vueuse/core`. Forms use vee-validate + zod.
- **Local data / repositories**: the whole `@trata/local-data`
  stack (SQLite-WASM + OPFS sahpool driver, drizzle schema, repositories,
  sync engine) runs in a dedicated Web Worker
  (`shared/lib/local-db/local-db-worker.ts`); the main thread talks to it
  over a Comlink RPC bridge with a ready handshake
  (`local-db.ts`, contract in `local-db-api.ts`). `app/repositories.ts`
  provides Comlink remotes as the single `Repository` variant behind the
  DI Symbol keys — forwarding proxies queue calls made before the worker
  signals ready, and rehydrate worker-side `RepositoryError`s from their
  surviving `name` (Comlink's throw transfer keeps message/name only).
  The RPC surface carries all six repository segments (accounts,
  categories, transactions, debtors, debt operations, planned payments —
  the last including the client-only `confirmPlannedPayment` composite);
  entity slices `entities/{debtor,debt-operation,planned-payment}` are
  thin barrels over them, and `entities/analytics` holds the pure
  selectors (period totals, per-category distribution) ported from
  mobile.
  Household join (change `household-join`): the RPC surface carries a
  `household` segment (`rebase`/`getLastHousehold`/`setLastHousehold` over
  the package's `rebaseLocalDataForHousehold`); the sync gate in
  `sync-composable.ts` runs `ensureCurrentHousehold` before the engine run —
  a `last_household` mismatch (a stale second device) surfaces the global
  carry/clean choice dialog (`features/household-join`), and the rebase
  resets versions/cursor/outbox so the initial-sync union applies unchanged.
  Household UX (change `household-ux`): settings carries the household
  management block + profile display-name editor (page-local features over
  `entities/household`'s `useHouseholdActions` mutations); shared-record
  rows resolve `authorId` (surfaced through the local repositories since
  that change) via `features/household-author`'s `useAuthorLabel` marker
  selector; leave and dissolve apply only the clean-start path
  (`applyHouseholdChoice(household, 'clean')`).
  Single-tab contract: the worker takes a Web Locks `ifAvailable` guard
  (`expense-tracker-local-db`) held for its lifetime; a second tab renders
  the "already open in another tab" state with a reload action and never
  opens the database. `navigator.storage.persist()` is requested at boot.
  Session APIs (and the worker's sync transport) call the apiClient
  directly — the documented, deliberate control-plane exception.
- **Auth**: anonymous-first. The Pinia store
  (`entities/session/model/use-auth-store.ts`) runs the mobile status
  machine (`restoring → anonymous ⇄ authenticated`) with a
  network-tolerant restore (401 or unreachable backend ⇒ anonymous shell);
  login/register/restored sessions pass the ownership gate over
  `sync_meta.owner_user_id` (unowned/same owner binds; a different owner
  must choose wipe-data vs cancel — reka-ui AlertDialog
  `entities/session/ui/OwnershipGateDialog.vue`); logout keeps all local
  data. The router is public-by-default (only login/register bounce
  authenticated users); the 401 handler clears the session in place
  (`main.ts`). Same-origin `/api` via the Vite dev proxy.
- **Sync**: engine in the worker; main-thread controller
  (`shared/lib/local-db/sync-composable.ts`, provided in AppShell with the
  auth getter injected) publishes engine state over the RPC `subscribe`,
  wires `visibilitychange`/`online`/post-mutation-debounce (2.5 s)
  triggers, auth-gates every run, and maps `onRunComplete` to scoped colada
  invalidation: the `['sync']` status cache after every completed cycle,
  the local-data entity roots only when the cycle wrote local rows
  (`wroteLocalData`) — no-op cycles leave every entity cache untouched.
  `widgets/sync-status` renders the badge (hidden in
  anonymous mode); `features/sync-conflicts` is the global conflict
  center (keep-local/take-server for version conflicts via RPC;
  deleted-kind conflicts offer dismiss plus restore-as-new — re-creating
  the preserved `localState` as a fresh record).
- **Dates**: `@trata/dates` is a dependency since the analytics
  screens (web-screens-parity): their period cursors, day keys, and labels
  go through the package directly. The older app-local facade over
  `@internationalized/date` (`shared/lib/date/`, branded `CalendarDay`)
  still backs the transactions date filter and transfers — the sanctioned
  **temporary** adapter; the decided end-state (2026-08-20) remains full
  migration onto `@trata/dates`.
- **Money**: `shared/lib/money/*` are pure re-export barrels over
  `@trata/money`. Per the refined money rule (decided
  2026-08-20), `AmountField.vue` (reka-ui NumberField) keeps float major
  units in form state — a platform-appropriate representation — converted
  exactly once at the mapper seam (`toMinorUnits(data.amount)`, five
  verified sites); storage/transport/sync/calculation stay integer.
  Mobile's stricter digit-string convention remains valid, not mandatory.
- **i18n**: vue-i18n over `@trata/i18n` bundles; RU is the
  default locale (`web-locales` capability), a RU/EN switcher lives in
  settings; `app/setup-i18n-locale-watcher.ts` applies the persisted choice
  immediately and invalidates the categories query cache (category names
  are localized); strict i18n lint (`lint:i18n`) plus a package-level
  EN/RU key-parity test.
- **PWA** (`web-pwa` capability): `vite-plugin-pwa` generateSW in
  `vite.config.ts` — app-shell-only precache (js/css/html/wasm/worker
  assets; unused emscripten side files excluded), `navigateFallback` with
  an `/api` denylist, NO runtime caching (API responses never come from
  cache), prompted updates (`app/register-service-worker.ts` →
  «Доступно обновление» toast, never auto-reload). Manifest is
  hand-maintained at `public/site.webmanifest`. PWA e2e (`e2e/pwa/`,
  `playwright.pwa.config.ts`, `pnpm test:e2e:pwa`) runs against the
  production build; the dev-server suite ignores `pwa/**`.
- **Errors**: package-level mapping produces `RepositoryError` subclasses;
  UI surfaces them via toasts (`vue-sonner`), inline form field errors, and
  retry-capable `ErrorState` blocks; a handful of screens special-case
  classes (Unauthorized/RateLimited on login, AlreadyExists on register).
- **Testing**: 85 vitest files (2026-09-01 count) — repositories (via `globalThis.fetch`
  spies), DI wiring, stores/composables, and extensive component/page tests
  with a mount-with-providers helper; Playwright e2e covers backendless
  local flows (CRUD, reload persistence, offline, single-tab lock, and the
  web-screens-parity screens: analytics render, debts create→history→edit,
  plan create→confirm→transaction, quick income), the production-build PWA
  suite (offline cold start, no cached API), and an env-gated sync suite.
  Steiger runs via `pnpm exec steiger`.

## Mobile (`apps/mobile/`)

React Native + Expo (dev build) with FSD adapted to Expo Router: `src/app/`
is routes-only (thin re-export files), plus `pages/ features/ widgets/
entities/ shared/`.

- **Layers** (decided 2026-08-20; invariant #15): canonical model is six
  layers `app → pages → widgets → features → entities → shared`; `widgets/`
  (`bottom-tab-bar`, `sync-status`) is documented. Hard rule, no
  exceptions: dependencies point only downward — `shared` must not import
  from any higher layer; cross-slice imports within a layer are
  forbidden; barrels required. All A11 deviations fixed 2026-08-20: the
  sync provider composes in `src/app/_layout.tsx` (context/hook in
  `shared/lib/sync/sync-context.tsx`); the cashflow sheets delegate
  new-transaction actions to page-level composition; entity slices export
  barrels. Enforced by dependency-cruiser `fsd-*` rules in CI
  (`arch-check`) with zero exclusions.
- **Offline-first data architecture**: `src/app/_layout.tsx` mounts local
  repositories backed by expo-sqlite via Drizzle for account/category/
  transaction; the schema, outbox, engine, and local repositories live in the
  shared `@trata/local-data` package
  (`packages/local-data/src/repositories/*`); every create/update/remove
  writes the entity row plus an
  outbox op in one `db.transaction`. The app's `shared/lib/db/database.ts`
  only supplies the expo driver + migrations call.
  Local repositories mirror backend semantics exactly — version-CAS →
  `VersionConflictError`, referential `ACCOUNT_IN_USE`/`CATEGORY_IN_USE`,
  documented in-code as deliberate mirroring. TanStack Query is explicitly
  "a UI cache over the local repositories — NOT the offline store"
  (`shared/lib/query/query-client.ts`; `staleTime 15s`, RN AppState-mapped
  focus manager). Mock repositories used by tests live in
  `shared/lib/testing/` (`mock-{account,category,transaction}-repository.ts`,
  moved out of production segments — finding A13).
- **Sync** (engine in `packages/local-data/src/sync/`, app wiring in
  `shared/lib/sync/`): engine cycle = push → resolve conflicts →
  pull, over the package's sync transport (`createApiTransport(apiClient)`
  → `pushSyncOperations`/`pullSyncChanges`). Per-record op coalescing;
  frozen `sentAt`; retry backoff with attempt counting; 401 pauses the
  engine and resumes after re-login. Triggers: app foreground (AppState),
  network reconnect (NetInfo), post-mutation debounce (2.5s, subscribed to
  the TanStack mutation cache), manual run from the sync badge, and
  advisory `expo-background-fetch` (dev build only). Conflicts are
  persisted in a `sync_conflicts` table and surfaced in
  `features/sync-conflicts/ui/conflict-center.tsx` (edit-vs-edit presented;
  delete-vs-edit resolves delete-wins). After engine writes, the entire
  query cache is invalidated. Household join (change `household-join`):
  `features/household-join` owns the shared carry/clean choice
  (`rebaseLocalDataForHousehold` vs wipe+pull) used by invitation accept
  (`app/invite/[token]`), join-by-code, leave, and the startup/foreground
  `last_household` mismatch guard; a base-0 push answered
  `SYNC_ALREADY_EXISTS` adopts the server record (union convergence).
  Household UX (change `household-ux`): the settings «Пространство» group
  and profile editor build on `entities/household`
  (`useHouseholdActions` mutations); cashflow rows/sheets, the edit sheet,
  debtor history, and plan rows render authorship markers via
  `entities/household`'s `authorLabel`; leave and dissolve apply only the
  clean-start path (`performHouseholdJoin(household, 'clean')`).
- **Auth**: React context (`entities/session/model/use-auth.tsx`) with
  restoring/authenticated/anonymous statuses; **no router guard** — the app
  is deliberately usable anonymously on local data: decided behavior,
  specified in `openspec/specs/sync-protocol` ("Initial sync and account
  ownership": the app SHALL be fully usable anonymously before login; the
  sync pause behavior makes it coherent). A device-ownership gate on `sync_meta.owner_user_id` binds
  local data to the first syncing account and offers a wipe when a
  different account tries to sync; logout keeps local data. The 401
  handler switches to anonymous without redirect.
- **i18n**: none. `@trata/i18n` is not installed; UI strings are
  hardcoded Russian with `TODO(i18n)` markers; repository error text comes
  from a static RU map (`repository-errors-ru.ts`) that self-describes as
  a twin of the shared bundle's wording [INTENT-DIVERGENT vs the decided
  i18n direction (`docs/assumptions.md`, decided-directions list)].
- **Money**: amounts stay strings through forms;
  `parseMajorUnitsToMinor` is the single sanctioned ×100 conversion
  (`shared/lib/money/parse.ts`); formatting via `@trata/money`'s
  Intl-free `formatMoney`. Serialized conflict values parse through a
  `Number.isSafeInteger`-guarded `toMinorUnits` helper
  (`conflict-center.tsx`, fixed 2026-08-20 — finding B4).
- **Dates**: uses `@trata/dates` throughout (21 non-test import
  sites); never imports date-fns directly.
- **Testing**: 37 jest files — local repositories against **real SQLite**
  (`node:sqlite` test helper, forbidden from app code), hooks with mock
  repositories, sync engine/background-sync with a fake transport, an
  opt-in backend-integration suite (`SYNC_INTEGRATION_API`), screens/
  features, and a design-tokens guard test. 13 Maestro flows under
  `.maestro/flows/`. Gaps: goals (no screen yet), reset-password/
  verify-email/settings screens.

## Cross-cutting flows

- **Error path end-to-end**: Go sentinel error → `writeDomainError`
  (status + `ErrorResponse{code,message}`) → package `mapApiError` keyed on
  `code` → `RepositoryError` subclass (+`apiCode`, `retryAfter`) → app
  message map (web: vue-i18n keys per code; mobile: static RU map) → UI
  (toast / inline field / `ErrorState` / form root error). No UI in either
  app switches on specific `apiCode`s; they consume the coarse classes.
- **Web read path**: page → `useQuery(SYNC_QUERY_KEY_ROOTS.<entity>)` →
  injected local repository (`@trata/local-data` over SQLite-WASM) →
  Pinia Colada cache; URL-driven filters. The server is reached only through
  the sync engine, not per-read.
- **Mobile write path**: form → local repository (row + outbox op in one
  SQLite tx) → TanStack cache invalidation → debounced sync trigger →
  engine push (server CAS verdicts per item) → conflict rows or pull of
  remote changes → full cache invalidation.

## Testing boundaries

| Area | Unit | Integration | E2E | In CI |
|---|---|---|---|---|
| backend | auth crypto, services (fakes), transport (httptest+fakes), jobs | repository + e2e suites on testcontainers Postgres 17 (IDOR, OCC, auth flows, sync) | — (e2e suite is a Go integration pkg) | yes (`go test -race`, lint, drift gate) |
| packages | none in-package | covered from app suites only | — | no |
| web | 85 vitest files (repos, DI, stores, components, filters) | — | Playwright auth flow | no (local only) |
| mobile | 37 jest files (repos on real SQLite, sync engine, screens) | opt-in backend-integration suite | 11 Maestro flows | no (local only) |
| spec | — | — | — | yes (redocly lint, oasdiff breaking on PRs) |

## Observed vs documented intent (summary)

| # | Intent (source) | Observed |
|---|---|---|
| 1 | ~~`backend/AGENTS.md`: strict transport → service → repository~~ resolved 2026-08-20 | Rule amended with an explicit, allowlisted middleware exception — now consistent |
| 2 | ~~"repository — no business rules"~~ refined 2026-08-20: policy vs persistence-mechanics boundary | `classify*Write`/CAS compliant; `RegisterUser` seeding + `VerifyEmailCode` attempts are registered deviations (migration deferred, no UoW) |
| 3 | ~~tokens "kept in sync by hand"~~ resolved 2026-08-20: mobile copy canonical, machine-guarded | Copies synced (light background/border, radius 2/4px literals, popover + aliceblue on both sides); enforced by the mobile `design-tokens-sync` test |
| 4 | ~~"each package has tsconfig + type-check"~~ refined 2026-08-20: TS packages only; tokens (css-only) exempt | i18n flag added (type-checks clean); rule scoped |
| 5 | ~~`time.Local = time.UTC` in tests~~ resolved 2026-08-20: mechanism claim removed from root `AGENTS.md` | UTC achieved via `time.Now().UTC()` + `time.Equal` — rule text now matches reality |
| 6 | ~~Mobile 5-layer model~~ resolved 2026-08-20: 6-layer model + hard downward-only rule | All A11 violations fixed the same day; depcruise `fsd-*` rules run with zero exclusions |
| 7 | ~~Mobile header claims `@trata/i18n`~~ resolved 2026-08-20 | Header states `{api,dates,money,tokens}` (i18n wiring pending); RU-hardcoded status self-acknowledged in the same file |
| 8 | ~~"packages consumed by every app" framing~~ resolved 2026-08-20 | Root `AGENTS.md` states actual consumption (web: api/money/i18n/tokens; mobile: api/dates/money/tokens); dates end-state and RU default recorded as decided direction |

Items where a rule or rationale could not be established from any source are
marked **[UNKNOWN]** inline. They are not treated as either invariants or
violations.
