# Technical Debt & Gotchas

Known, accepted-but-unresolved debts (audited 2026-08-20; additions from the
2026-09-01 full-repo audit — `docs/architecture/audit-2026-09.md`,
findings A16–A20/B7 — are tagged). Not a backlog —
concrete work items belong in an issue tracker or an OpenSpec change;
future work that is merely undecided lives in `docs/assumptions.md`. Fixed
or stale entries are removed, not archived.

## Workspace / CI

- **JS/TS CI is minimal.** JS jobs cover the contract drift gate
  (`ts-gen-check`), architecture (`arch-check` + web FSD lint), and design
  lint; everything else is local-only: no type-check, no web or mobile
  tests, no knip. (2026-09-01 audit, A18; also no `openspec validate`
  step anywhere.)
- **Web coverage thresholds are disabled** (acknowledged debt; ~500 unit
  tests exist but the bar is not enforced).

## Packages

- **Seed categories are hand-synced** across Go `domain/seeds.go`, TS
  `DEFAULT_CATEGORIES`, `SEED_KEY_BY_SLUG`, and the locale JSON keys;
  `slug` exists only on the TS side (the backend never returns it).
- `packages/tokens` has no tsconfig/type-check; `api`/`money`/`i18n` have
  no READMEs.

## Web

- **`workbox-window` is an undeclared runtime dependency of web** (deploy-vps review): vite-plugin-pwa's virtual module imports it, but it resolves only through the repo's hoisted install (`.npmrc` `node-linker=hoisted`) — a clean isolated install fails. The web Dockerfile copies `.npmrc` as the workaround; the proper fix is declaring `workbox-window` in `apps/web/package.json` (version matching vite-plugin-pwa's workbox) and then dropping the .npmrc coupling.
- **Overlay primitives reach into reka-ui internals** (web-mobile-drawers):
  `shared/ui/drawer/DrawerContent.vue` neutralizes the nested picker's
  `aria-hidden` via a MutationObserver on reka's content root, and the
  responsive select components read `injectSelectRootContext` internals
  (`optionsSet`, `onTriggerChange`, `onOptionAdd`, `contentId`). Both are
  brittle against reka-ui upgrades (pinned 2.10.x); the tripwires are the
  overlay-presentation e2e (stack accessibility) and the select unit tests.
- `pages/accounts` edit-account feature has no public API barrel (FSD
  violation).
- No catch-all 404 route.
- Sentry integration is a TODO in `log-error.ts`.

- **`completeAuthentication` hand-rolls the adopt-if-unowned RPC pair**
  (unify-sync-run-policy Non-Goal): `entities/session/model/use-auth-store.ts`
  calls `db.meta.getOwnerUserId()` + `setOwnerUserId()` because the worker
  bridge exposes no `adoptUnowned` method, while the package already owns
  that invariant. Follow-up: expose `meta.adoptUnowned` on the bridge and
  delegate.

## Mobile

- **Analytics tab cards diverge from the spec's empty state** (since
  `web-analytics-empty-donut`): `openspec/specs/analytics/spec.md` now
  describes the tab-card empty period as a neutral-ring donut with the
  zero total in the center and the message in the legend's slot; the web
  card implements that, while `apps/mobile/src/pages/analytics/ui/
analytics-screen.tsx` keeps the legacy text-only empty state (no chart,
  its `DonutChart` also lacks the neutral empty ring). Catch up in a
  dedicated parity change.
- **Sheet auto-dismiss after success is runtime-flaky**
  (`TODO(sheet-dismiss)`, hedged in 4+ Maestro flows): the imperative
  dismiss is implemented but not reliable at runtime (Expo Go e2e).
- **Accessibility tree collapse after a successful create+sync cycle —
  RESOLVED 2026-08-25** (`fix-accessibility-tree-collapse`; root cause,
  evidence, and fix in that change's design.md "Root Cause Report"). Two
  combined factors: a server-confirmed create arms the app, and dismissing
  a `BottomSheetModal` rendered inside another sheet's portal content
  (the sheet-in-sheet pickers) then kills ALL RN accessibility exposure and
  the visual sheet stack until restart — JS/@gorhom stay consistent, the
  failure is in the Fabric AX bookkeeping on RN 0.86/iOS 26 (symptom-class
  matches upstream: react-native#57282, Maestro#3367/#3056, all closed
  without fixes). Fix: `useSheetContentPickers`/`SheetContentPortal`
  (`shared/ui/sheet-content-portal`) re-parents every sheet-in-sheet picker
  to the owning form-sheet component (the experimentally safe placement);
  plus `key={editingPlan.id}` in plans-screen (a masked latent bug: the
  edit form never re-presented after a first edit) and flow 17 phase D/E
  staging completions (list sheet reopened before row asserts) that the
  collapse had made unreachable. Regression evidence (2026-08-25): the
  armed minimal-repro probe and flows 16/17/09/15 pass post-fix; full
  `pnpm test:e2e` 17/17 × 3 consecutive runs; mobile type-check/lint/
  format/test, root `arch:check` + `knip`, backend `go test` + `make
  gen-check` all green.
- **Paste-based e2e sign-in degrades on freshly provisioned iOS 18.6
  simulators** (found 2026-08-25): the long-press → Paste delivery into
  secureTextEntry drops characters (17/18 observed) on a fresh 18.6 sim;
  the tuned 26.5 sim is unaffected. Blocks cross-iOS-version a11y
  investigations (see the change's D4-F limitation). Infra-hardening
  candidate for `run-maestro-ios.sh` / flow 09's sign-in.
- **Transport-level sync push failures are invisible per-op.** When
  `POST /api/sync/push` fails at the HTTP level (offline gate, network,
  request-level `VALIDATION_FAILED` during contract skew), the engine
  leaves every queued op with `attempts` climbing, `sent_at` set, and
  `last_error` NULL — per-op `last_error` is only written from per-item
  results, so whole-batch failures have no outbox-visible diagnostic.
  Retry semantics are correct (backoff + idempotent opId replay); only
  observability is missing (found 2026-08-25: 23 ops retried ~16× over
  19 h with no recorded reason). Related (2026-09-01 audit): even the
  per-op `last_error` that IS persisted has no mobile UI surface.

- **Headless background fetch bypasses the household gate**
  (unify-sync-run-policy Non-Goal): `shared/lib/sync/background-sync.ts`
  runs a second engine instance gated only by the owner marker — no
  household-currency check, unlike the foreground run-policy. Server-side
  household scoping still applies to its pushes; revisit in a dedicated
  change if strict household-spec coverage is needed there.

## Backend

- **`debtors.note` / `debt_operations.note` are dead columns awaiting their
  contract-phase drop** (simplify-debt-domain): no code has read or written
  them since `3e35f43`, but the drop migration (`000013_drop_debt_notes`,
  content in that commit) failed `scripts/check-migrations.sh` - rollback to
  the then-deployed `v2026.09.15` still inserts `note`, so dropping would
  break it (expand-contract, `docs/deployment.md` "Rollback"). The unshipped
  pair was removed; production stays at schema version 12. Next deploy after
  the expand deploy is tagged: restore the pair as `000013` (number never
  consumed in production) and add it to `grandfathered` in
  `scripts/check-migrations.sh` with that justification. Local dev DBs that
  already applied the old 13 need nothing.

## Stale configuration

- `backend/.sqlfluff` — `dialect = sqlite` (the project is Postgres).
- `apps/web/.i18nrc.json` — points at a nonexistent path (bundles live in
  `packages/i18n/src/locales/`).
