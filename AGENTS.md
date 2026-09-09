# Trata - agent memory

pnpm workspace monorepo for a spec-first expense tracker: a layered **Go API**
(`backend/`) wired to a **Vue 3** web app (`apps/web/`) and a **React Native
(Expo)** mobile app (`apps/mobile/`), sharing platform-agnostic TS packages
(`packages/*`). The OpenAPI contract is the single source of truth tying them
together.

Each area has its own rules in its own `AGENTS.md` (`backend/`, `apps/web/`,
`apps/mobile/`) - read the one for the area you touch. Code is the source of truth.

## Canonical documentation map

Architectural knowledge lives in docs, not here. Before changing architecture
or questioning a rule, read the relevant canonical document:

- Invariants (evidence-backed, with enforcement status): `docs/architecture/invariants.md`
- Architecture overview (observed baseline, file-level evidence): `docs/architecture/overview.md`
- Architectural decisions: `docs/adr/` (ADR-0001: auth/CSRF threat model; ADR-0002: household shared budget, implementation pending; ADR-0003: sync push-protocol engine, implemented)
- Open decisions & accepted assumptions: `docs/assumptions.md`
- Known technical debts: `docs/technical-debt.md`
- Finding classification & resolution history: `docs/architecture/findings.md`
- Domain behavior specs: `openspec/specs/`; proposed changes: `openspec/changes/`
- Web FSD architecture: `apps/web/docs/ARCHITECTURE.md`
- Web Vue conventions (query idiom, reactivity budget, forms): `apps/web/docs/conventions/vue-patterns.md`
- Mobile form conventions: `apps/mobile/docs/conventions/forms.md`
- Mobile component/state conventions (effects, hooks, memoization, decomposition): `apps/mobile/docs/conventions/components-and-state.md`
- Coding principles (minimal complexity, comments, self-review): `docs/development/coding-principles.md`

If a task conflicts with an invariant or an architecture decision, stop and
surface the conflict - do not silently violate it, and do not "improve" the
architecture as a side effect of an unrelated task.

## Cross-cutting invariants (all areas)

Full statements, evidence, and enforcement status live in
`docs/architecture/invariants.md`; the short forms below are the
non-negotiables an agent must see before touching code.

- **OpenAPI is the source of truth** at `docs/api/openapi.yaml`. Change the spec
  FIRST, then regenerate everywhere; never hand-maintain duplicate types/structs.
  - Backend server code: `make gen` (oapi-codegen); CI drift gate `make gen-check`.
  - TS types: `pnpm gen:api` (in `packages/api` or `apps/web`) regenerates
    `packages/api/src/schema.ts` via openapi-typescript; re-run + commit after
    spec changes. CI drift gate: the `ts-gen-check` job.
  - Spec lint: `npx @redocly/cli lint --config docs/api/redocly.yaml docs/api/openapi.yaml`.
- **Money is `int64` minor units** (divisor 100) at every persistence /
  transport / sync / calculation boundary - never float/decimal. Form/UI state
  may hold platform-appropriate majors (float on web, digit strings on mobile),
  converted exactly once at the mapper seam via round-based `toMinorUnits` /
  `parseMajorUnitsToMinor` (full boundary rule: invariant #2).
- **Timestamps are UTC** (`TIMESTAMPTZ` / `time.Time`).
- **IDs are UUID v4** (`github.com/google/uuid`).
- **Auth is a stateful session cookie** (`session_id`). Do NOT introduce JWT.
  CSRF/transport posture: ADR-0001.
- **Errors carry a machine `code` + human `message`.** Backend maps domain
  errors to `ErrorResponse{code,message}` in ONE place; frontends map every
  non-2xx to a `RepositoryError` by `code` (e.g. 409 `ACCOUNT_IN_USE` vs
  `TRANSACTION_VERSION_CONFLICT`), not by HTTP status.
- Backend-only invariants (household scoping per ADR-0002, change_log atomicity, tombstones,
  layering) are stated in `backend/AGENTS.md` (invariants #5-#8, #17-#18).

## Shared workspace packages (`packages/*`)

Platform-agnostic TS consumed by the apps — web: `@trata/{api,money,i18n,tokens}`;
mobile: `@trata/{api,dates,local-data,money,tokens}` (i18n wiring pending) —
resolved to source `.ts` via `exports` (no build step; `moduleResolution: bundler`).

- **MUST stay free of DOM/Vue/browser-only/RN APIs.** Only the fetch-family
  (`fetch`/`Request`/`Response`/`Headers`) is allowed (works in browser/Node/RN).
- **Fixed dependency direction:** `api → money` and
  `local-data → {api, dates, money}` are the only cross-package edges;
  `money`/`dates`/`i18n`/`tokens` are leaves.
- **Apps never import `date-fns` directly** - only the `@trata/dates`
  facade (web's app-local `@internationalized/date` adapter is a sanctioned
  temporary exception, see `docs/assumptions.md`).
- **Repository seam:** app data access goes through `Repository` interfaces
  from `@trata/api`; the package never imports app code (apps supply
  the base URL - no `window`).
- Each TS package has its own `tsconfig.json` + `type-check` and must
  type-check cleanly alone (`tokens` is css-only and exempt - its palette is
  guarded by the mobile `design-tokens-guard` and `design-tokens-sync` tests).
- The mobile copy of the `tokens` palette is canonical; web syncs to it, and
  drift fails the mobile `design-tokens-sync` test. App CSS entries stay thin
  and must not re-declare token values.
- Each package's source/README is authoritative for its contents (per-package
  APIs and consumption evidence: `docs/architecture/overview.md`). Only
  cross-cutting rules and decisions live here.

The first three rules are enforced by `pnpm arch:check` (see below). App-local
concerns stay OUT of packages: web keeps its vue-i18n instance, Vite base-URL
resolution, localStorage repos, Vue DI/composables, and Zod schemas; mobile
keeps its native wiring. Decided-direction-but-pending items (web migration
onto `@trata/dates`) are tracked in `docs/assumptions.md`.

## Monorepo tooling

Pre-commit formatting runs via lefthook (`lefthook.yml`, installed by the
root `prepare` script on any `pnpm install`): staged files under `apps/web/src`
and `apps/mobile/src` are oxfmt-formatted and re-staged automatically
(`stage_fixed`). No CI format gate by design; skip once with `LEFTHOOK=0`.

`pnpm knip` (workspace root) checks every workspace (`apps/*`, `packages/*`)
for unused files, dependencies, and exports. Single config: the root
`knip.json` `workspaces` object (knip 6 takes the workspace list from
`pnpm-workspace.yaml` and does NOT auto-load per-package knip configs - keep
all settings in the root file).

`pnpm arch:check` (workspace root) enforces architecture rules with
dependency-cruiser (root `.dependency-cruiser.*.cjs`; CI `arch-check` job):
package leaf/direction + platform-framework bans (`packages/*`), mobile FSD
layer direction + cross-slice + api-client seam, date-fns facade ban in
both apps. Backend layering is enforced by depguard rules in
`backend/.golangci.yml` (middleware allowlist exception lives in
`issues.exclusions` there).

`pnpm lint:design` (workspace root) runs the mechanical design-system checks
for web/mobile UI code and `.superdesign/design-system.md` drift. Run it for UI
changes.

## Agent skills

Vendored agent skills live in `.agents/skills/` (git-tracked, canonical).
`.zcode/skills/` is a local symlink mirror for the ZCode harness - recreate it
with `for d in .agents/skills/*/; do ln -sfn "../../${d%/}" ".zcode/skills/$(basename "$d")"; done`.

`skills-lock.json` (repo root) is the manifest of vendored skills: upstream
`source` + `skillPath` + sha256 of the vendored `SKILL.md` (`computedHash`).
Update it whenever a skill is added, removed, or refreshed.

Vendored skills are advisory reference material. Where a skill conflicts with
an `AGENTS.md`, a conventions doc, an OpenSpec spec, or an ADR, the repo's own
conventions win. Don't apply a skill's optimization/pattern rules without a
measured problem.

## Repo layout

```
backend/        Go API (Gin + sqlc + Postgres)
apps/web/       Vue 3 + Vite (Feature-Sliced Design, local-first: SQLite-WASM + PWA shell)
apps/mobile/    React Native + Expo (Feature-Sliced Design + Expo Router, offline-first)
packages/       shared TS: api, dates, local-data, money, i18n; shared css: tokens
deploy/backup/  production backup sidecar image (pg_dump + rclone + crond)
scripts/        deploy tooling: deploy tags/releases, rollback tag resolution, migration guard
docs/           architecture, ADRs, assumptions, API policy; docs/api/ = OpenAPI contract
openspec/       domain behavior specs + proposed changes
```

## Maintaining these files

Keep each `AGENTS.md` for knowledge useful to almost every session in its area:
what the area is, the rules an agent must see before touching code, the
commands that enforce them, and pointers to canonical docs. Do not repeat what
the codebase or canonical docs already show - point to the authoritative file
or command. Prefer rewriting/pruning over appending; never let an
architectural decision live ONLY in an AGENTS.md. Preserve this bar for all agents.
