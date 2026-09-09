# Proposal: web-local-first-core

## Why

The web app is online-first: every action requires the backend, and it cannot
serve the product's stated future — an offline-first public web app usable
without login, with anonymous data migrating into an account on first login.
Stage 3 extracted the local-first data layer (`@trata/local-data`)
and the driver spike proved it runs unchanged in the browser over SQLite-WASM
+ OPFS inside a dedicated worker (`docs/spikes/web-sqlite-wasm-driver.md`, GO).
This change rebuilds the web app's core on that foundation.

## What Changes

- **Local-first core in a dedicated worker**: SQLite-WASM + OPFS (sahpool)
  driver from the spike, Comlink RPC bridge, react-free migrator; repositories
  for account/category/transaction come from `@trata/local-data`.
- **BREAKING: single repository variant `local`** — the HTTP and localStorage
  entity repositories and `VITE_REPO_VARIANT` are removed; HTTP stays only for
  session APIs and the sync transport (api-client-seam, as on mobile).
- **Anonymous-first app**: router becomes public-by-default; the app is fully
  usable on local data without login; login/register remain standalone pages
  reachable from a guest indicator; session restore is network-tolerant
  (unavailable backend ⇒ anonymous shell, not an error screen).
- **Ownership gate + initial sync**: first login on unowned data binds the
  owner and runs the initial sync (push-all-as-creates + pull union, per
  `sync-protocol`); a different owner must explicitly clear local data or
  cancel; logout keeps all local data.
- **Sync engine with web triggers**: online event, visibility, post-mutation
  debounce, manual run; sync-status badge; web conflict center surfaced
  globally (reka-ui).
- **Multi-tab guard**: Web Locks around the worker's DB open; a second tab
  gets a "already open in another tab" state with a takeover-by-reload action.
- Migration of existing playwright e2e flows to the local-first core.

## Capabilities

### New Capabilities

- `web-local-data`: browser-side local-first behavior of the web app — worker
  storage lifecycle, repository access, anonymous usability, ownership gate
  and initial sync on login, logout semantics, sync status visibility,
  conflict surfacing, and the multi-tab lock contract.

### Modified Capabilities

(none — `sync-protocol` already specifies the anonymous-to-authenticated
lifecycle platform-neutrally; this change implements it on the web without
changing its requirements.)

## Impact

- `apps/web`: new `shared/lib/local-db` worker + Comlink bridge (from spike
  branch `spike/web-sqlite-wasm`), rewritten `app/repositories.ts`, reworked
  `entities/session` auth store (ownership gate, anonymous shell), router
  guard flip, new sync-status widget and conflict-center feature, dependencies
  `@trata/local-data`, `drizzle-orm`, `@sqlite.org/sqlite-wasm`,
  `comlink`.
- Removed: `entities/{account,category,transaction}/api` HTTP and localStorage
  repository implementations (interfaces/DI keys stay), `VITE_REPO_VARIANT`.
- Tests: `app/repositories.test.ts` rewritten; new unit tests for the bridge,
  auth gate, and boot states; e2e split into backendless local flows and
  sync flows requiring the backend.
- No backend changes; no OpenAPI changes.
