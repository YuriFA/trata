# Design: extract-local-data-package

## Context

The mobile app owns the entire local-first stack today:

- `apps/mobile/src/shared/lib/db/` — `schema.ts` (6 entity tables with
  `version`/`serverVersion`/`deletedAt` tombstones + `syncOutbox`,
  `syncConflicts`, `syncMeta`), `outbox.ts` (enqueue/coalesce/confirmations),
  `migrations.generated.ts`, `database.ts` (the **only** driver touchpoint:
  expo-sqlite JSI + expo migrator), `database-context.tsx` (React),
  `testing/test-database.ts` (node:sqlite factory for tests).
- `apps/mobile/src/shared/lib/sync/` — `sync-engine.ts` (711 lines;
  transport is injected), `conflicts.ts`, `sync-data.ts`, `sync-meta.ts`,
  `offline-gate.ts`, `sync-status.ts`, plus the app-coupled `transport.ts`,
  `background-sync.ts` (expo), `sync-context.tsx` (React),
  `backend-integration.test.ts` (real Go backend, env-gated).
- Local repositories for all six entities in
  `apps/mobile/src/entities/*/api/local-repository.ts` (+ tests) — CRUD over
  drizzle with outbox enrollment.

All of these are platform-neutral at runtime: they work against the drizzle
query surface and `@trata/api` types. Two Expo leaks exist:
`database.ts` (driver) and `shared/lib/generate-id.ts` (expo-crypto
`randomUUID`, because Hermes lacks WebCrypto). The expo database **type** is
threaded type-only into every module via `import type { LocalDatabase }`.

Constraints that shape the design: `packages/*` must stay platform-agnostic
(fetch-family only; no DOM/Vue/RN), each TS package carries its own
`tsconfig.json` + `type-check`, the only cross-package edge today is
`api → money`, and `pnpm arch:check` (root `package.json` +
`.dependency-cruiser.packages.cjs`) enforces package rules. Stage 4 rebuilds
the web app offline-first on this layer over a browser SQLite (WASM/OPFS
spike pending) — the package must not presume expo. See `proposal.md` for
motivation.

## Goals / Non-Goals

**Goals:**

- The package is the single implementation of the local-data semantics;
  mobile behavior is unchanged — moved, not rewritten (tests pass without
  semantic edits).
- Exactly two new platform seams: a generic drizzle database type and an
  injectable id factory (the transport seam already exists in the engine).
- Guardrails extended so platform purity regressions in `packages/*` are
  machine-caught (`pkg-no-expo`), not review-caught.

**Non-Goals:**

- Deciding the web driver (SQLite-WASM/OPFS vs alternatives) — stage 4 spike.
- Household — decided in `docs/adr/0002-household-shared-budget.md`,
  implemented in stage 5.
- Migrating mobile's remaining jest-expo tests to vitest; CI changes.
- Any change to the engine's public behavior, the sync protocol, OpenAPI,
  `apps/web`, `backend/`, or `packages/api`.

## Decisions

### D1. Package boundary and name: `@trata/local-data`

Moves into `packages/local-data`:

| Moves | Stays in `apps/mobile` |
|---|---|
| `db/{schema,outbox,migrations.generated}.ts` | `db/database.ts` (expo driver + migrator call) |
| `sync/{sync-engine,conflicts,sync-data,sync-meta,offline-gate,sync-status}.ts` | `sync/transport.ts` (app `apiClient` binding) |
| local repositories ×6 entities (+ their tests) | `sync/background-sync.ts` (expo task) |
| `testing/test-database.ts` (node:sqlite factory) | `sync/sync-context.tsx`, `db/database-context.tsx` (React) |
| engine/outbox/sync-status tests | `sync/backend-integration.test.ts` (real backend, env-gated) |
| drizzle pipeline: `drizzle.config.ts`, `db:generate` script, `inline-migrations.mjs`, `drizzle/` journal | `shared/lib/generate-id.ts` (app-side override wiring) |

Rejected: **engine-only minimal package** — the six local repositories are
equally neutral and equally needed by web (stage 4); leaving them in mobile
forces a rewrite of ~6 × CRUD + outbox enrollment. Rejected name
**`@trata/sync`** — the package contains the schema and
repositories, not just sync; `local-data` matches the "local data boundary"
language of invariant #16.

### D2. Database type seam: generic drizzle type, no expo types in the package

The package declares its own database types over the generic base:

```ts
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
export type LocalDatabase = BaseSQLiteDatabase<'sync', RunResult, typeof schema>
export type LocalTransaction = /* derived from LocalDatabase['transaction'] */
```

App drivers satisfy the type structurally (`ExpoSQLiteDatabase<typeof schema>`
is a synchronous-result subtype); every moved module swaps its
`import type` from `@/shared/lib/db/database` to the package. Rejected:
keeping the type in the app and parameterizing the package over it — inverts
the dependency; the package would compile against app types.

### D3. Id factory: default WebCrypto, bootstrap override on mobile

The package's id generation defaults to `globalThis.crypto.randomUUID()`
(browsers, Node ≥ 19) and exposes `configureIdFactory(fn)` — called once from
mobile bootstrap with expo-crypto's `randomUUID` (Hermes has no WebCrypto).
Rejected: threading a factory parameter through every signature — touches
nearly all call sites for one platform's limitation. Rejected: injecting only
into engine options — repositories, outbox, and conflicts also mint ids.
Trade-off: module-level configuration is hidden state; mitigated by the
documented bootstrap contract (mobile calls it before any db work) and a test
asserting the default.

### D4. Tests move with the code and run on vitest

`sync-engine.test.ts` (1122 lines), `outbox.test.ts`, `sync-status.test.ts`,
and the repository tests move into the package and run on **vitest** — they
are node-only (real SQLite via `node:sqlite`, in-file fake transport, no RN
modules), so jest-expo would be pure overhead. This is the first package with
tests (today `packages/*` has zero), setting the precedent for the package's
own `type-check` + `test` scripts. The factory `testing/test-database.ts`
switches from the `drizzle-orm/expo-sqlite/driver` subpath to
**`drizzle-orm/node-sqlite`** — with the generic type (D2) there is no reason
to keep the expo-shaped subpath in package tests. Rejected: leaving tests in
mobile — they would import package internals from outside and keep a
node-only suite inside jest-expo.

### D5. Migrations pipeline relocates; journal moves verbatim

`drizzle.config.ts` (schema path → `./src/schema.ts`), the `db:generate`
script, `scripts/inline-migrations.mjs`, and the `drizzle/` journal (3
entries) move to the package. The journal is copied as-is — the lineage stays
continuous, so already-migrated mobile databases keep working (a re-generated
schema diff must produce zero new migrations; that is a verification gate).
Both apps consume the exported `migrations` through their own migrators
(expo migrator in mobile; the web migrator arrives with stage 4). Rejected:
per-app drizzle configs pointing across package boundaries — path hacks and a
second source of truth for the schema.

### D6. Guardrails

- `root package.json` → `arch:check`: add `packages/local-data/src` to the
  depcruise target list (today: api/dates/money/i18n).
- `.dependency-cruiser.packages.cjs`: new **`pkg-no-expo`** rule banning
  `expo-*` and `react-native-*` imports from `^packages/[^/]+/src/` — the
  existing `pkg-no-platform-frameworks` list (react, vue, react-native, …)
  does not catch `expo-crypto`, `expo-sqlite`, etc., which is exactly the
  leak this extraction must prevent.
- Dependency edges: `local-data → {api, dates}` (allowed by existing rules;
  `local-data` is not a leaf); `api ⇀ local-data` is already banned by
  `api-only-money`.
- `.dependency-cruiser.mobile.cjs`: the `api-client-seam` rule's exception
  `pathNot: ^src/shared/lib/sync/` references paths that move — update or
  drop the exception so the rule keeps banning direct `shared/api` imports
  outside session/sync seams.
- `knip.json`: knip resolves the package via its `exports`; add a
  `packages/local-data` key only if knip flags false positives (pattern
  precedent: `packages/api` `ignoreIssues` for `schema.ts`).

### D7. Mobile consumption: direct package imports, no per-entity shims

Mobile entities and features import repositories and engine APIs from
`@trata/local-data` directly (same pattern as `@trata/api`
today — FSD allows workspace-package imports at the entities/shared layers);
the per-entity `api/local-repository.ts` files are deleted, not shimmed.
Mobile jest `moduleNameMapper` gains `^@trata/local-data$` →
`packages/local-data/src/index.ts` (mirrors the api mapping). Rejected:
keeping thin re-export shims per entity — one more indirection layer with no
consumer benefit; callers already cross package boundaries for types.

## Risks / Trade-offs

- [Expo driver instance not assignable to the generic `LocalDatabase` type]
  → compile-time failure in `apps/mobile` type-check; fix is a localized
  type adjustment in the package (worst case: minimal structural wrapper in
  `database.ts`). No runtime risk.
- [Behavior drift sneaks in during the move] → move-only discipline: no
  renames beyond imports, moved tests edited for import paths only; the
  drizzle journal must produce zero new migrations (D5 gate); full gates run
  at the end (mobile jest, package vitest, type-check everywhere,
  `arch:check`, `knip`).
- [Module-level `configureIdFactory` misused (called late or twice)] →
  documented bootstrap contract; mobile calls it in app entry before any db
  open; a package test asserts the WebCrypto default works without
  configuration.
- [knip flags exports only web will consume] → mirror the `packages/api`
  `ignoreIssues` pattern with a comment; revisit at stage 4 when web starts
  consuming them.
- [Package tests need Node ≥ 22 for `node:sqlite`] → same requirement the
  mobile suite already has today; no new constraint, but the package
  `engines` field states it explicitly.
- [`pkg-no-expo` misses drizzle's expo-shaped subpaths] → by design:
  `drizzle-orm/*` subpaths are drizzle code, not expo runtime; D4 removes the
  last expo-shaped import from package tests anyway.

## Migration Plan

One change, landable as a single review sequence (tasks mirror this):

1. Scaffold `packages/local-data` (package.json/tsconfig/exports, vitest,
   knip entry if needed).
2. Move db layer + pipeline (D5), then sync modules with the type seam (D2),
   then repositories (D1), then tests + factory (D4).
3. Wire seams in mobile: bootstrap `configureIdFactory`, jest mapping,
   import updates, delete moved files (D7).
4. Update guardrails (D6) and docs (root `AGENTS.md` packages map and
   dependency direction, `apps/mobile/AGENTS.md`,
   `docs/architecture/overview.md`, invariants evidence paths).
5. Full gates: `pnpm -r type-check`, package vitest, mobile jest (incl.
   e2e-relevant suites), `pnpm arch:check`, `pnpm knip`, drizzle journal
   zero-diff check.

Rollback: revert the merge commit — no data or runtime migration is involved
(the on-device journal is unchanged by construction).
