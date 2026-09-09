# Web (`apps/web/`) - agent memory

Vue 3 + Vite web frontend, **local-first**: all account/category/transaction
data lives in a SQLite-WASM/OPFS worker (`shared/lib/local-db/`), the app is
fully usable anonymously, and login binds local data through the ownership
gate + initial sync (invariant #16 in `docs/architecture/invariants.md`;
capability spec `openspec/specs/web-local-data`). Project-wide invariants
and the canonical documentation map live in the root `AGENTS.md`.

## Feature-Sliced Design

FSD layers with the Fractal FSD `pages/*/features/` extension; authoritative
layout, segment conventions, and placement decision trees:
`apps/web/docs/ARCHITECTURE.md`. Steiger (`pnpm exec steiger`, config
`steiger.config.ts`) must stay green. Component-level conventions (query
idiom, reactivity budget, vee-validate forms, lists/dialogs):
`apps/web/docs/conventions/vue-patterns.md`.

Screen set (capability `openspec/specs/web-screens` — mobile UX semantics,
web-native presentation): dashboard (`/`), transactions, analytics overview
(`/analytics`) + per-direction detail (`/analytics/:direction`), debts
(`/debts`), plans (`/plans`), quick income (`/income`), accounts, settings —
all exposed in `AppNav`. Settings also carries the household management
section + profile display-name editor (change `household-ux`: page-local
features under `pages/settings/features/*` over `entities/household`
actions; authorship markers via `features/household-author` on transaction
rows, the edit dialog, debtor history, and plan rows). Analytics selectors
live in `entities/analytics`; debts/plans screens own their view-model
selectors under `pages/*/model/`.

## Design contract (UI work)

UI changes follow the design canvas `.superdesign/design-system.md` (repo
root) — read it before touching UI. It holds the hard rules (page headers
have two patterns only: root pages, child pages with the back control;
button variants; dialog anatomy) and the canonical token values: components
consume tokens via Tailwind classes/CSS vars, never raw hex. The mechanical
slice is enforced by `pnpm lint:design` (`src/__tests__/page-header-rule.test.ts`,
`src/__tests__/design-tokens-raw-hex.test.ts`,
`src/__tests__/design-flat-system.test.ts`,
`src/__tests__/design-system-spec.test.ts`); run it after UI changes. A green
suite covers only the checkable subset — the rest of the canvas still applies.

## Spec-first (contract from `docs/api/openapi.yaml`)

- Never hand-write fetch/types. `pnpm gen:api` regenerates
  `packages/api/src/schema.ts`; re-run + commit after spec changes. The client
  factory, error mapping, repository interfaces, and HTTP implementations all
  live in `@trata/api`; web only adds Vite base-URL resolution
  (`shared/api/client.ts`). Old import paths (`@/shared/api`, `@/shared/lib/data`,
  entity `model/*`) stay stable via thin re-export barrels.
- Error mapping is code-driven: every non-2xx -> `RepositoryError` keyed on
  `ErrorResponse.code`, not HTTP status.

## PWA (`web-pwa` capability)

- `vite-plugin-pwa` generateSW is configured in `vite.config.ts`: app-shell
  precache (incl. the SQLite-WASM binary and worker chunk; unused emscripten
  side files excluded), `navigateFallback` with an `/api` denylist, NO
  runtime caching — API responses are never served from cache. The manifest
  is hand-maintained at `public/site.webmanifest` (token-derived colors
  synced by review).
- Prompted updates: `app/register-service-worker.ts` (prod-only) shows the
  «Доступно обновление» toast via vue-sonner; never auto-reloads.
- PWA e2e specs live in `e2e/pwa/` with their own
  `playwright.pwa.config.ts` (`pnpm test:e2e:pwa`) — they need the
  production build's service worker; the dev-server e2e suite ignores
  `pwa/**`. Manual install checklist: the change notes of `web-pwa-i18n`.

## i18n (`web-locales` capability)

- RU is the product default (`DEFAULT_LOCALE` in `@trata/i18n`);
  EN is complete (strict `pnpm i18n:lint` + a package key-parity test).
  The settings screen has a RU/EN switcher; the choice persists in
  localStorage and `app/setup-i18n-locale-watcher.ts` applies it
  immediately (and rehydrates it at startup). Component/unit tests and the
  dev-server e2e suite pin EN; the PWA e2e suite asserts the RU default.

## Domain conventions

- **Transactions:** PATCH update with required `version` (optimistic concurrency);
  create sends an `Idempotency-Key`; list is cursor-paginated
  (`{transactions,nextCursor}`).
- **Auth:** anonymous-first. `entities/session` holds the typed auth API +
  Pinia store with the mobile status machine (`restoring -> anonymous <->
  authenticated`); restore is network-tolerant (401 or unreachable backend =>
  anonymous); login/register/restored sessions pass the ownership gate
  (different owner => wipe-or-cancel AlertDialog); logout keeps local data.
  Ownership gate policy (decision table + atomic rebind) lives in
  `@trata/local-data` (`sync/ownership.ts`); the store keeps only
  presentation (AlertDialog) and control-plane side effects (server logout,
  cache invalidation). The router is public-by-default; `main.ts` wires the
  401 interceptor (`setUnauthorizedHandler` -> clearSession, no redirect).
  Session APIs call the apiClient directly - the sanctioned control-plane
  exception to the repository seam (invariant #11).
- **Repos:** a single `local` variant - Comlink remotes of the worker-side
  `@trata/local-data` repositories, provided in
  `app/repositories.ts` (calls queue behind the worker's ready handshake;
  worker errors rehydrate into typed RepositoryErrors). The worker holds a
  Web Locks guard for single-tab exclusivity: a second tab gets the
  "already open in another tab" state - never assume multi-tab access to the
  database. The Vite dev/preview server proxies `/api` -> `localhost:8080`
  (same-origin cookie, no CORS).

## Quality bar

`pnpm type-check`, `pnpm lint` (oxlint + eslint), `pnpm i18n:lint` (strict i18n),
`pnpm format` (oxfmt), `pnpm test:unit`, and `pnpm exec steiger src` all green. For UI
changes,
`pnpm lint:design` is part of the required green set. `knip` runs repo-wide
from the workspace root (`pnpm knip`, config in the root `knip.json`). E2E
(`apps/web/e2e`, `pnpm test:e2e`): the default suite is backendless (local
CRUD, reload persistence, offline via `context.setOffline`, multi-tab lock
banner) and needs no backend; the PWA suite (`e2e/pwa/`,
`pnpm test:e2e:pwa`) builds and runs against `vite preview` (the SW only
exists in production builds); the sync suites (`sync-backend.spec.ts`,
`household-join-sync.spec.ts` — two-household join/carry/clean/rebase) are
  env-gated on `SYNC_INTEGRATION_API` like mobile's integration tests;
  `invite-preview.spec.ts` introduced `page.route` API interception for
  backendless API-state screens, extended by `household-ux.spec.ts` (mocked
  auth/household/sync control plane driving the settings section and
  authorship markers end-to-end). Playwright
projects are chromium + firefox only: the bundled WebKit exposes no OPFS
(`getDirectory()` throws), so the local-first core cannot boot there — real
Safari ≥ 17 needs a manual verification pass.

E2E run strategy: never start with the full matrix. During work run only the
specs covering the touched flows, one project (`--project=firefox`) and
capped workers (`--workers=2`); the full both-project suite runs ONCE at the
end of the session, not after every change. Local runs are headed by default
and the full suite overloads dev machines - pass `E2E_HEADLESS=1` for
headless (env opt-in in both playwright configs; CI is unaffected).
