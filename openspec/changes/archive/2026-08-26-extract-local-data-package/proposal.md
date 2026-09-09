# Proposal: extract-local-data-package

## Why

The mobile app's local-first layer — drizzle SQLite schema, outbox, sync engine
with conflict records, local repositories for all six entities, and the
migrations pipeline — is the core asset of the product's offline direction.
The roadmap rebuilds the web app as offline-first on the same machinery
(stage 4); without extraction, the web app would have to duplicate or fork
~3.5k lines of engine/repository code. One shared package gives both clients a
single implementation of the sync semantics and turns the layer into a deep,
reusable module.

## What Changes

- **New workspace package `@trata/local-data`** (`packages/local-data`)
  holding the platform-neutral local data layer:
  - `db` layer: entity schema (6 entity tables + syncOutbox/syncConflicts/syncMeta),
    outbox mechanics, generated migrations, and the drizzle-kit generate pipeline
    (config + inline-migrations script);
  - sync machinery: `sync-engine`, `conflicts`, `sync-data`, `sync-meta`,
    `offline-gate`, `sync-status`;
  - local repositories for all six entities (accounts, categories, transactions,
    debtors, debt operations, planned payments);
  - tests (engine, outbox, sync-status, repository tests) on vitest and the
    `node:sqlite` test-database factory.
- **Mobile migrates onto the package** with no behavior change. React/Expo
  wiring stays in the app: the expo-sqlite driver (`db/database.ts`), transport
  binding, background sync, React contexts, and the backend-integration test.
- **Platform seams introduced by the package**: a generic drizzle database type
  (no expo types), an injectable id factory (default `crypto.randomUUID`,
  mobile overrides with `expo-crypto`).
- **Guardrails updated**: `arch:check` covers `packages/local-data/src`; new
  `pkg-no-expo` dependency-cruiser rule (today's platform rule misses `expo-*`);
  the mobile `api-client-seam` exception path is fixed up; knip config if needed.
- **Docs synced**: root `AGENTS.md` (packages map, dependency direction),
  `apps/mobile/AGENTS.md`, `docs/architecture/overview.md`, evidence paths in
  `docs/architecture/invariants.md` (paths only, no wording changes).

No OpenAPI, backend, `apps/web`, or `packages/api` changes. No user-visible
behavior changes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- None. This is a pure structural refactor: no spec-level behavior changes, so
  the change sets `skip_specs: true` in `.openspec.yaml` (per proposal
  instructions — no requirement is invented just to satisfy validation).
  Architecture constraints are carried by `AGENTS.md`, `pnpm arch:check`, and
  `docs/architecture/invariants.md`; this change's structure is recorded in
  `design.md`.

## Impact

- **apps/mobile**: files move out of `src/shared/lib/{db,sync}` and
  `src/entities/*/api/local-repository.ts`; jest `moduleNameMapper` gains
  `@trata/local-data`; bootstrap calls `configureIdFactory`;
  `drizzle.config.ts`, `scripts/inline-migrations.mjs`, and the `drizzle/`
  journal move to the package.
- **packages/local-data** (new): runtime deps `drizzle-orm` +
  `@trata/{api,dates}`; vitest as its test runner; own `tsconfig` +
  `type-check` per package rules.
- **Root tooling**: `package.json` `arch:check` script, `.dependency-cruiser.packages.cjs`
  (new `pkg-no-expo` rule), `.dependency-cruiser.mobile.cjs` (exception path),
  `knip.json` (only if needed). `pnpm-workspace.yaml` already covers the new
  package via its `packages/*` glob.
- **Docs**: root `AGENTS.md`, `apps/mobile/AGENTS.md`,
  `docs/architecture/overview.md`, `docs/architecture/invariants.md`
  (evidence paths only).
- **Not affected**: `backend/`, `docs/api/openapi.yaml`, `apps/web`,
  `packages/api`, CI workflows.
