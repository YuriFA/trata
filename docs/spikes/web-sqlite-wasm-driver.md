# Spike findings: SQLite-WASM + OPFS driver for the web app

**Date:** 2026-08-26 · **Branch:** `spike/web-sqlite-wasm` (throwaway code, kept for
reference; only this document and two strict-mode guards landed on `main`) ·
**Verdict: GO** — SQLite-WASM is the primary storage choice for stage 4; the
IndexedDB+Dexie fallback is not needed.

## Question

Can `@trata/local-data` (drizzle schema + repositories + outbox +
sync engine, extracted in stage 3) run in the browser unchanged, and what does
the platform wiring cost?

## Driver choice

- `@firtoz/drizzle-sqlite-wasm` (v2.0.5, alive, drizzle ^0.45.2) — **rejected**:
  it is part of a fullstack toolkit and depends on `react`, `@tanstack/db`,
  `zod`, `valibot`. Wrong shape for a Vue app.
- **Chosen:** official `@sqlite.org/sqlite-wasm` (3.53.0-build1, Apache-2.0) +
  a ~90-line adapter in the app, following the proven pattern of the package's
  node:sqlite test factory: wrap the client into the `prepareSync →
  executeSync/executeForRawResultSync` surface consumed by
  `drizzle-orm/expo-sqlite/driver`, which yields exactly the `'sync'`-mode
  `LocalDatabase` type. No package changes required for the happy path.

## Verified in Chromium (dev server AND production build)

| Check | Result |
| --- | --- |
| OPFS available (in worker) | `getDirectory()` ok |
| WASM boot + driver + migrations | 3/3 migrations, 31–56 ms |
| Atomic «entity + outbox» write | both rows in one transaction |
| Persistence across reloads | all rows from previous sessions intact |
| Full sync-engine cycle (mock transport) | pushed=3, pulled=1, conflicts=0; outbox drained; remote change applied |
| `storage.persist()` + quota | `persist()=true`; 0.3 MB used / 288 GB quota |

Bundle (production build): worker chunk **310 KB raw / 88 KB gzip** (drizzle +
repositories + engine + adapter), `sqlite3.wasm` **845 KB raw / 392 KB gzip**
loaded lazily with the worker, page shell 2.9 KB. `react` never enters the
bundle (custom migrator, see below).

Safari ≥17 / Firefox were **not** executed in this spike (both ship sync access
handles per current docs); a manual pass remains for stage 4 hardening.

## Architecture requirements discovered (design inputs for stage 4)

1. **The DB must live in a dedicated Web Worker.** OPFS sync access handles
   exist only in worker scope; on the main thread
   `installOpfsSAHPoolVfs()` fails with "Missing required OPFS APIs". Every
   package API is promise-based, so a plain async RPC bridge (postMessage) is
   enough — no sync proxy / COOP-COEP / SharedArrayBuffer needed.
2. **Multi-tab: sahpool is single-instance per directory.** A second tab fails
   at `createSyncAccessHandle` ("another open Access Handle … associated with
   the same file"); the first tab keeps working. Stage 4 must pick a strategy:
   Web Locks guard with an "app already open in another tab" notice, or DB
   ownership handoff between tabs (BroadcastChannel).
3. **Migrator seam:** `drizzle-orm/expo-sqlite/migrator` imports `react` at
   module level — unusable in a web bundle. The web wiring replicates its two
   steps (`readMigrationFiles` + `db.dialect.migrate`) in ~10 lines against the
   package's inline migrations bundle. Candidate package seam for stage 4:
   export a driver-agnostic `migrateLocalDatabase(db)`.
4. **Adapter details:** OO1 `bind()` throws on statements with no bindable
   parameters — skip binding for empty param lists; the migrations bundle is
   nested `{ journal, migrations: { m#### } }`; `changes()` +
   `capi.sqlite3_last_insert_rowid()` provide run results; `getAllSync` lazily
   re-executes SELECTs (same double-execution as the node adapter — negligible
   at personal-data scale, worth a note if perf ever matters).
5. **Package source must compile under web's stricter tsconfig**
   (`noUncheckedIndexedAccess`): two unreachable guards added in
   `packages/local-data/src/outbox.ts` and `src/sync/sync-engine.ts` (package
   tests stay green, 128/128). Any future package code must keep this flag
   clean, or the package must ship prebuilt declarations.
6. `navigator.storage.persist()` is not exposed in the worker scope of the
   tested webview — call it from the main thread at app start.
7. Vite emits unused `sqlite3-worker1.js` (206 KB) and
   `sqlite3-opfs-async-proxy.js` (32 KB) assets because the sqlite-wasm entry
   statically references them via `new Worker(new URL(...))`; trimmable via
   config if the dist size matters.

## How to rerun

On the spike branch: `pnpm -C apps/web dev` → open `/spike/sqlite` (dev-only
public route). The checklist runs inside `spike-worker.ts`; "Перезагрузить"
re-checks persistence. Key files:
`apps/web/src/shared/lib/local-db/sqlite-wasm-database.ts` (adapter + boot +
react-free migrator), `apps/web/src/pages/spike-sqlite/` (worker + page +
route entry in `src/app/router/index.ts`).
