# Design: mobile-offline-first

## Context

The mobile app is a UI shell (Expo Router + FSD) whose dashboard runs on
throwaway mock data; `entities/` and the data layer are empty. The shared
`@trata/api` package already defines the repository contracts
(`Repository<T,C,U>`, `CategoryRepository`, `AccountRepository`,
`TransactionRepository` with `query`/`listPage`), HTTP implementations,
code-keyed error mapping, and domain normalizers — the web app consumes
them online with a dev-only localStorage variant that emulates backend
rules. The backend is online CRUD (Go + sqlc + Postgres) generated from
`docs/api/openapi.yaml`; it has no change feed, no tombstones, and no
client-generated ids on create. A hard constraint from
`apps/mobile/AGENTS.md`: the e2e target is Expo Go on iOS, so only
native modules bundled with Expo Go are allowed (`expo-sqlite` and
`@react-native-community/netinfo` qualify; mmkv/op-sqlite do not).
Shared packages must stay platform-agnostic (fetch-family only).

## Goals / Non-Goals

**Goals:**

- True offline-first mobile: local DB is the source of truth; the UI
  never waits on the network; reliable eventual sync with the REST
  backend through the unchanged repository abstraction.
- Sync-ready by construction from phase 1: outbox, sync metadata, and
  conflict storage exist before any sync code runs.
- Additive API evolution; web app untouched.

**Non-Goals:**

- Offline support or sync for the web app.
- Continuous background synchronization (platform-prohibited; only
  opportunistic foreground sync).
- Real-time/multi-device live push (websocket) — pull is client-driven.
- Merging same-named categories created on different devices (v1 leaves
  them as duplicates; see Open Questions).

## Decisions

### D1. Local store: expo-sqlite + Drizzle ORM

`expo-sqlite` (JSI, bundled with Expo Go) + `drizzle-orm/expo-sqlite`
with `drizzle-kit` migrations (generate → migrator bundled via Metro).
Relational queries with indexes, transactions, typed schema over the
domain types.

Alternatives rejected: **AsyncStorage KV blobs** (web localStorage
pattern) — no transactions or queryable structure, whole-blob rewrites,
Android 6 MB cap; fine for a dev-only variant, wrong for a source of
truth. **MMKV / op-sqlite / WatermelonDB** — native modules outside
Expo Go, force a dev build and break the Maestro/Expo Go rule.
**RxDB** — its React Native SQLite storage is RxDB Premium (from
$99/month) and drags in a parallel query/collections world beside the
repository layer.

### D2. Repository integration: unchanged contracts, local implementation

`apps/mobile` implements the existing interfaces in
`src/entities/*/api/local-repository.ts`; DI via a
`RepositoriesProvider` (React Context + inject-or-throw hooks, the
mobile analog of web's provide/inject). Verified fit: CRUD maps to SQL;
`query({type, accountId, categoryId, fromDate, toDate})` maps to indexed
WHERE + `occurred_at DESC`; `listPage` uses an opaque offset cursor (the
web localStorage repo already does this); `update(id, {version,…})`
gives the CAS token; local FK guards reuse the
`LocalStorageTransactionRepository` extension
(`hasTransactionsForAccount/Category`). Two type-level notes: client id in
`CreateTransactionPayload` (Account/Category already allow it) extends with
the phase-2 contract change, and `UpdateAccountPayload`/`UpdateCategoryPayload`
gain the required `version` via that same phase-2 regeneration — transactions
already have it — so client-supplied CAS for accounts and categories starts in
phase 2; until then their phase-1 local updates apply unconditionally with
`version += 1`. Nothing sync-specific enters the repository interfaces; the
sync engine lives below and beside them, invisible to features.

### D3. TanStack Query is the single reactivity layer (no live queries)

All writers to the local DB run in-process (local repositories and the
sync engine) and invalidate query keys themselves after writing
(`['accounts']`, `['categories']`, `['transactions']`). Drizzle's
`useLiveQuery` would add a second reactive system with no external
writer to justify it. TanStack Query's persisted cache is explicitly NOT
the offline store — it is a UI cache over the repositories.

### D4. Sync: custom engine over the evolved REST API

Rejected managed sync stacks: **PowerSync** (needs op-sqlite → outside
Expo Go; requires the PowerSync service + sync rules — a backend
architecture change that displaces our REST contract), **ElectricSQL**
(GA but read-path replication; writes still go through our API, plus a
separate service next to Postgres), **RxDB replication** (see D1). A
custom engine over the backend we own is the only option compatible with
Expo Go, the repository abstraction, the existing REST backend, and
explicit control of conflict semantics for financial data.

### D5. Version and dirty model (see specs for normative behavior)

Two columns per entity table:

- `version` — the local logical revision; the CAS token the repository
  interface exposes.
- `server_version` — the last server-confirmed revision; `0` means never
  published. It is the base revision captured by new outbox operations.

State rule: `CLEAN ⟺ version == server_version`;
`DIRTY ⟺ version > server_version`. Transitions:

- Local mutation → `version += 1`; `server_version` unchanged.
- Operation confirmed → `server_version := response.version`. If other
  pending operations remain, `version` is untouched (the record stays
  DIRTY). When the last pending operation is confirmed,
  `version := server_version` (the record becomes CLEAN).

The final assignment is load-bearing, not cosmetic: a coalesced group of
N local mutations applies as ONE server operation — one server revision
increment — so after its confirmation the counters can be apart (local
8, server 6) with an empty queue and nothing left to push. Only the
`version := server_version` assignment closes the invariant; without it
a coalesced record stays artificially DIRTY forever. In the purely
sequential case (one operation per mutation, e.g. the in-flight B
scenario) the counters converge naturally and the assignment is a no-op.
Implementations must not "optimize" it away.

In phase 1 (no server yet) the local repository emulates the server —
assigning and checking `version` exactly like the web localStorage
variant does — while `server_version` stays 0 so the first real push
goes out as a create. Repository-level CAS conflicts
(`VersionConflictError`) and sync-level conflicts (below) never mix.

### D6. Outbox mechanics

Every mutation writes the entity row and its operation in one
transaction. `sync_outbox(id PK, entity, entity_id, op, payload_json,
base_version, created_at, sent_at NULL, attempts, last_error)`:
`baseVersion` is fixed at creation (= `server_version`, never the local
`version`); `sent_at` freezes an operation so retries reuse the same
opId and payload (persistent idempotency). Confirmation removes exactly
the confirmed opId — never "all ops of the entity": an operation created
while an earlier one is in flight stays pending (spec scenario "Edit
during in-flight push"); after such an ancestor confirms, the follower
is pushed as a continuation of the same client chain against the updated
`server_version`. Before a push, unsent operations of one record
coalesce into a single operation: full current state, base of the first
operation in the group, the group's first opId. Unborn records
(created+deleted with `server_version = 0`) vanish without any
operation; mutating a tombstone is rejected (`NotFoundError`).

### D7. Protocol and server invariants

- `POST /api/sync/push {operations:[{opId, entity, action, baseVersion,
  data?, id?}]}` → per-item `{opId, status: applied|conflict|error,
  version?, code?, serverState?}`. Update applies iff server
  `version == baseVersion`. Create (`baseVersion = 0`): absent → create;
  exists + same opId → replay stored result; exists + other opId →
  `SYNC_ALREADY_EXISTS`, never a silent overwrite.
- `GET /api/sync/pull?cursor=&limit=` → `{changes:[{seq, entity, id,
  action: upsert|tombstone, data?, version}], nextCursor}`.
- Postgres: `change_log(seq, entity, entity_id, action)` row written in
  the same DB transaction as each mutation, with seq assigned
  monotonically under an advisory lock so seq order equals commit
  visibility (no cursor gaps); `applied_operations(op_id PK, user_id,
  entity, entity_id, result_json, applied_at)` in the same transaction
  as the mutation provides persistent opId idempotency; soft deletes
  (`deleted_at` + version bump) with listings filtered.
- Auth stays the session cookie; a 401 mid-run pauses the engine (queue
  untouched), resumes after re-login. RN cookie persistence across
  restarts must be verified; if unreliable, persist the cookie
  explicitly.
- Engine cycle: push → resolve conflicts → pull; triggers: start/
  foreground, NetInfo reconnect, post-mutation debounce, manual refresh;
  retries with backoff.

### D8. Conflicts are persistent records

`sync_conflicts(id, entity, entity_id, op_id, kind, base_version,
server_version, local_state_json, server_state_json, created_at,
resolved_at)` — created from push 409s and from pull-newer-on-dirty;
never memory-only. Resolution flows per spec: user dialog for edit×edit;
delete×edit defaults to delete-wins with notification and
restore-as-new-record; nothing silently discarded.

### D9. Initial sync and ownership

`sync_meta` holds `owner_user_id`, `pull_cursor`, `device_id`. First
login (unowned or same owner): push all local records as creates, pull
from cursor 0, merge = union by id. Different owner: block the push,
offer clear-or-cancel. Logout keeps data (offline mode). Known v1 gap:
identically-named categories created independently on web and mobile
merge as duplicates; auto-merge by `(name, type)` is a deferred option.

### D10. Local schema

`accounts`, `categories`, `transactions` mirror the domain plus
`version`, `server_version`, `deleted_at`; money is INTEGER minor units;
dates are ISO-8601 UTC TEXT; ids are client UUID v4. Indexes on
`transactions(occurred_at)`, `(account_id)`, `(category_id)`,
`(type, occurred_at)`. Balances are computed by query (opening +
manual + Σ impacts), mirroring `@trata/money`. Drizzle
interactive transactions on the expo-sqlite driver must be verified at
the start of phase 1; fallback: wrap statements in expo-sqlite's
`withTransactionAsync`.

### D11. API evolution (spec-first)

`docs/api/openapi.yaml` first → redocly lint → backend `make gen` →
`pnpm gen:api`: optional client `id` on all three create requests;
`version` on Category and Account; tombstones; `/api/sync/*`; new codes
`SYNC_VERSION_CONFLICT` (maps to the existing `VersionConflictError`)
and `SYNC_ALREADY_EXISTS` (`AlreadyExistsError`) added to `mapApiError`.
Category seeding becomes opt-in (product decision; web signup keeps
seeding enabled until its own product decision).

## Risks / Trade-offs

- [Custom sync = self-owned correctness] → scenario tests: duplicate
  push, edit×edit, delete×edit, in-flight op B, offline-create, partial
  batch, 401 mid-run, restart with open conflicts, reference cascade.
- [Soft deletes change every sqlc listing] → audit all list/summary
  queries for `deleted_at IS NULL`; Go tests.
- [seq/commit ordering drift under write concurrency] → advisory-lock
  log writes; short transactions; document the invariant in the
  backend's AGENTS.md.
- [Drizzle expo-sqlite transaction support uncertain] → verify first in
  phase 1; `withTransactionAsync` fallback.
- [RN session-cookie persistence unverified] → verify before phase 3;
  explicit cookie storage if needed.
- [Tombstone growth] → retention policy in phase 2 (default 90 days);
  conflicts and outbox rows pruned after resolution/confirmation.
- [Anonymous data has no account until first login] → accepted; owner
  check prevents cross-account leakage.

## Migration Plan

Phases ship independently; each is deployable and rollback-safe:

1. **Phase 1 (mobile only)** — no backend/API change; app works locally.
   Rollback = revert the mobile app.
2. **Phase 2 (contract + backend)** — additive OpenAPI changes and
   Postgres migrations (`change_log`, `applied_operations`, `deleted_at`,
   `version`). Existing clients see no difference; seeding default flips
   only for new registrations behind an explicit flag. Rollback =
   redeploy previous image; migrations are additive columns/tables.
3. **Phase 3 (sync engine on mobile)** — client-side only; can ship
   behind a feature flag per build.
4. **Phase 4 (optional)** — opportunistic background sync via dev build,
   tombstone retention, sync metrics.

## Open Questions

- Tombstone retention window (default suggestion 90 days) — decide in
  phase 2; does not affect client behavior.
  - Decided (phase 4): 90 days (`retention.tombstone_window`, env
    `RETENTION_TOMBSTONE_WINDOW`), swept hourly. The change_log is never
    pruned — pulls serve tombstones from the log alone, so devices offline
    through the whole window still converge; hard-deleted rows only make
    their older upsert entries pull as nil-data (skipped by the client).
- RN cookie persistence behavior per platform — verify in phase 3; both
  outcomes have a plan (rely on native store vs persist explicitly).
- Auto-merge policy for identically-named categories across devices —
  v1 keeps duplicates; revisit after real usage feedback.
