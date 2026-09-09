# Tasks: extract-local-data-package

## 1. Package scaffold

- [x] 1.1 Create `packages/local-data/package.json`: name `@trata/local-data`, `exports`/`main`/`types` → `./src/index.ts` (source-consumed, no build step, `packages/api` pattern); runtime deps `drizzle-orm`, `@trata/{api,dates,money}` (`workspace:*`); dev deps `typescript`, `vitest`, `@types/node`; `engines.node >= 22`; scripts `type-check`, `test`
- [x] 1.2 Create `packages/local-data/tsconfig.json` following `packages/api` (`moduleResolution: bundler`, strict; Node types visible to tests)
- [x] 1.3 Add `vitest.config.ts` (node environment) and a placeholder `src/index.ts` with one smoke test proving the harness runs
- [x] 1.4 Write the package `README.md`: what lives here (schema/outbox/sync/local repositories/migrations), the two platform seams (generic `LocalDatabase` type, `configureIdFactory`), and the `db:generate` command location

## 2. Core seams

- [x] 2.1 Declare `LocalDatabase` / `LocalTransaction` in the package over `BaseSQLiteDatabase<'sync', RunResult, typeof schema>` (`drizzle-orm/sqlite-core`); no expo types imported anywhere in `packages/local-data/src`
- [x] 2.2 Implement the id factory: default `globalThis.crypto.randomUUID()`, `configureIdFactory(fn)` override, `generateId()` used by package code; tests assert the default works unconfigured and the override takes effect

## 3. db layer + migrations pipeline move

- [x] 3.1 Move `schema.ts` into the package; exports unchanged plus `LocalDatabase`/`LocalTransaction` (2.1)
- [x] 3.2 Move `outbox.ts` into the package; replace the `generate-id` import with the package id factory, the db-type import with the package type
- [x] 3.3 Move `migrations.generated.ts` into the package (regenerated in 3.4)
- [x] 3.4 Relocate the migrations pipeline: `drizzle.config.ts` (schema → `./src/schema.ts`), `scripts/inline-migrations.mjs`, the `db:generate` script, and the `drizzle/` journal (3 entries, verbatim); move `drizzle-kit` to the package dev deps
- [x] 3.5 Run `db:generate` in the package and verify the journal produces **zero** new migrations (schema lineage continuity — migrated on-device databases must be untouched)

## 4. Sync modules move

- [x] 4.1 Move `sync-meta.ts`, `offline-gate.ts`, `sync-data.ts` into the package with package-internal imports (`schema`, `outbox`, package types, `@trata/api` types)
- [x] 4.2 Move `conflicts.ts` (drop the `@/shared/lib/generate-id` import → package id factory; `nowIso` from `@trata/dates` stays)
- [x] 4.3 Move `sync-engine.ts` (transport stays injected; `UnauthorizedError`/`pushSyncOperations`/`pullSyncChanges` from `@trata/api` stay; db types from the package)
- [x] 4.4 Move `sync-status.ts`
- [x] 4.5 Define the package public surface in `src/index.ts` (engine factory + types, repository factories, schema, migrations, seams, `testing` entry)

## 5. Local repositories move

- [x] 5.1 Move the six `local-repository.ts` files (accounts, categories, transactions, debtors, debt-operations, planned payments) into the package with package-internal imports
- [x] 5.2 Move their tests; green on package vitest

## 6. Test infrastructure move

- [x] 6.1 Move `testing/test-database.ts` into the package; switch the driver from `drizzle-orm/expo-sqlite/driver` to `drizzle-orm/node-sqlite` (factory still builds a real SQLite db, applies `migrations`, returns the package `LocalDatabase`)
- [x] 6.2 Move `sync-engine.test.ts`, `outbox.test.ts`, `sync-status.test.ts` into the package; green on vitest with no semantic edits (import-path changes only)

## 7. Mobile migration

- [x] 7.1 Add `@trata/local-data` (`workspace:*`) to `apps/mobile/package.json`; add jest `moduleNameMapper` entry `^@trata/local-data$` → `packages/local-data/src/index.ts`
- [x] 7.2 Call `configureIdFactory(expoCrypto.randomUUID)` once in the mobile app entry, before any database open; delete `shared/lib/generate-id.ts`
- [x] 7.3 Update all mobile imports from `@/shared/lib/db/{schema,outbox,migrations.generated}` and `@/shared/lib/sync/*` to `@trata/local-data`; keep `db/database.ts` (expo driver + migrator, now typed as the package `LocalDatabase`), `sync/transport.ts`, `background-sync.ts`, and the React contexts wired to package APIs
- [x] 7.4 Delete the moved source files and per-entity `api/local-repository.ts` from mobile; update entity/model/feature importers to the package
- [x] 7.5 Mobile jest suite green (including `backend-integration.test.ts` compile; run it only if `SYNC_INTEGRATION_API` is set)

## 8. Guardrails

- [x] 8.1 Root `package.json` `arch:check`: add `packages/local-data/src` to the depcruise target list
- [x] 8.2 `.dependency-cruiser.packages.cjs`: add the `pkg-no-expo` rule — forbid `expo-*` and `react-native-*` imports from `^packages/[^/]+/src/`
- [x] 8.3 `.dependency-cruiser.mobile.cjs`: fix the `api-client-seam` exception that references `^src/shared/lib/sync/` (paths moved); the rule must still ban direct `shared/api` imports outside the session/sync seams — verified: the remaining app-side wiring (transport, background-sync, contexts) keeps the same path prefix, so the exception stays correct as-is; `arch:check` green
- [x] 8.4 Run `pnpm knip`; add a `packages/local-data` workspace entry (with commented `ignoreIssues`) only if it flags false positives — run was clean after removing one unused re-export; no entry needed

## 9. Documentation sync

- [x] 9.1 Root `AGENTS.md`: packages list (`web: …, mobile: …` lines), dependency direction (`api → money` is no longer the only edge — add `local-data → {api, dates, money}`), and the repo-layout comment
- [x] 9.2 `apps/mobile/AGENTS.md`: update db/sync paths and the `db:generate` command location (now in the package)
- [x] 9.3 `docs/architecture/overview.md`: system map and file-level evidence for the new package; note that web remains online-first until stage 4
- [x] 9.4 `docs/architecture/invariants.md`: update evidence file paths for moved modules only — no wording changes to any invariant

## 10. Final gates

- [x] 10.1 `pnpm -r type-check` green (package alone; mobile with the new mapping)
- [x] 10.2 Package vitest + mobile jest green
- [x] 10.3 `pnpm arch:check` and `pnpm knip` green
- [x] 10.4 Drizzle journal still produces zero new migrations after the move; `openspec validate extract-local-data-package` passes
