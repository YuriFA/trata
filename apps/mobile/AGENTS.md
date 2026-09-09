# Mobile (`apps/mobile/`) — agent memory

React Native + Expo (SDK 57 / RN 0.86 / React 19.2 / TS 6). Workspace member
`@trata/mobile`, twin of `apps/web` — shares the domain model and the
`@trata/{api,dates,local-data,money,tokens}` packages (i18n wiring
pending, see §i18n). Project-wide invariants and the canonical documentation map
live in the root `AGENTS.md`. The offline-first data layer and sync protocol are
specified in `openspec/specs/mobile-local-data` and `openspec/specs/sync-protocol`;
the local-first engine/schema/repositories themselves live in
`packages/local-data` (`@trata/local-data`).

## Architecture: FSD + Expo Router

Feature-Sliced Design like `apps/web`, with one adaptation: Expo Router reserves
`src/app/` for routes, so the FSD `app/` layer is routes-only; app-level
initialization that lived in `app/` on web moves into the root `_layout.tsx`.

```
src/
├── app/            Expo Router routes ONLY - every file is a route
│   ├── _layout.tsx     root: providers (SafeArea, GestureHandler, StatusBar) + Stack
│   ├── (auth)/         unauthenticated flows, no tab bar
│   └── (tabs)/         bottom-tab navigator - twin of the web top nav
├── pages/          screen bodies each route renders (index.ts barrel + ui/)
├── widgets/        composite cross-screen UI (bottom-tab-bar, sync-status)
├── features/       global reusable features (2+ consumers)
├── entities/       domain models (account/category/transaction/session)
└── shared/         infrastructure: ui/, lib/, api/, config/, i18n/
```

Import direction is strictly downward, identical to web: `app → pages →
widgets → features → entities → shared` (six layers; `widgets/` is canonical).
Hard rule, no exceptions: `shared` MUST NOT import from entities, features,
widgets, pages, or app; cross-layer upward imports are forbidden anywhere;
cross-imports between slices of the same layer are forbidden; each slice
exports through an `index.ts` barrel. The rule is deliberately mechanical —
any `shared → higher layer` import is always an error — and is enforced by the
dependency-cruiser `fsd-*` rules (root `pnpm arch:check`, zero exclusions).

There is deliberately no segment-level `shared/ui/index.ts` aggregate — import
each component from its slice (e.g. `@/shared/ui/button`, `@/shared/ui/text`).

Route files are thin — they only re-export the screen:
```ts
export { DashboardScreen as default } from '@/pages/dashboard'
```
Screen-specific UI belongs under `pages/<page>`. A component used by exactly
one screen should normally stay close to that screen rather than being
prematurely promoted to `features`/`shared`; promote only on genuine reuse or
a meaningful cross-screen concept.

## Routes & tab bar

Route groups `(auth)` and `(tabs)` organize the navigator without touching
URLs. Root `/` resolves to `(tabs)/index` (Dashboard). Auth is deliberately
not gated — the app is fully usable anonymously on local data (the sync
ownership gate makes this coherent); Settings exposes sign-in/out.

The bottom tab bar is built on expo-router's headless tab components
(`expo-router/ui`: `Tabs`/`TabSlot`/`TabList`/`TabTrigger`), not
`@react-navigation/bottom-tabs`. The custom `widgets/bottom-tab-bar/` renders
the 4 real tabs + a central spacer; each tab reads focus/press state from
`useTabTrigger(name)`.

The central `+` is a SpeedDial overlay (`shared/ui/speed-dial`) mounted as a
sibling of `<Tabs>` in `(tabs)/_layout.tsx` — a global floating action, not a
route and not a tab. It's fully uncontrolled (internal open state), always
centered, with fixed `speed-dial-*` testIDs (Maestro relies on them). Its
Expense/Income/Transfer actions are wired in that layout.

Stack (non-tab) destinations (`income`, `accounts`, `goals`, the `(auth)`
screens) render the shared collapsible large-title header
(`shared/ui/screen-header`) as a sibling of the screen's scroll body:
`<Screen topInset={false}>` hosts the scroll wiring and composes
`<ScreenHeader title … />` + the matching `Screen*` scroll wrapper
(the header owns the top inset). Native headers stay hidden (`headerShown:
false` on the root and `(auth)` Stacks); tab roots keep plain in-screen
titles without a back affordance. The slice README documents the animation
model and the fixed `screen-header-*` testID contract.

## Styling

Styling is Uniwind (Tailwind CSS v4, CSS-first) — no `tailwind.config.*`.
`global.css` is a thin entry: framework imports (`tailwindcss`, `uniwind`) +
`@import '@trata/tokens/mobile'`. The mobile tokens copy is the
canonical shared palette; web syncs to it, and drift fails the mobile
`design-tokens-sync` test (same sRGB hex values, no oklch/conversion).

Every color must be a token — via `className` (e.g. `bg-card`), an icon's
`colorClassName`, or a complete class string stored in data (e.g.
`bg-brand-violet`). Raw hex/rgb values in `src/` fail the `design-tokens-guard`
Jest test.

`className` → style resolution runs in Metro (`withUniwindConfig`, with
`polyfills.rem = 14` to keep NativeWind-era spacing). No Babel preset/plugin
needed for Uniwind — `babel.config.js` has only `babel-preset-expo`; Expo
auto-adds `react-native-worklets/plugin` for Reanimated, don't add it
explicitly. `uniwind-types.d.ts` is generated and committed — keep it in tsconfig.

## Naming conventions

Component files: kebab-case (`dashboard-screen.tsx`, `new-transaction-sheet.tsx`).
Exported component identifiers stay PascalCase (`DashboardScreen`,
`NewTransactionSheet`). Expo Router route/layout files stay lowercase as
required by Expo Router.

### `handle*` vs `on*`

Use `handle*` for functions implemented by the current component that handle
events or callbacks:

```tsx
const handleSubmit = (values: FormValues) => {}
const handlePress = () => {}
```

Use `on*` only for callback props exposed by a component:

```tsx
interface Props {
  onSubmit: (value: FormValues) => void
  onCancel: () => void
}
```

In short: `handle*` — implementation-side function; `on*` — component callback
prop. Do not name an internal handler `onPress` merely because it is passed to
`<Button onPress={...}>`. (`docs/conventions/forms.md` §6 links here as the
canonical rule.)

## Forms

Forms use React Hook Form + Zod (`react-hook-form` + `zod` +
`@hookform/resolvers` `zodResolver`), adopted by the `adopt-rhf-zod-forms`
OpenSpec change. Canonical requirements (declarative form state, validation
gating, error surfacing, money parsing, sheet composition, lifecycle, test
coverage): `openspec/specs/mobile-forms`. Canonical worked examples (page
form, FormProvider composite, Bottom Sheet split, values-vs-payload mapper,
server-error pattern, reset lifecycle, subscription/render scoping):
`docs/conventions/forms.md` — follow
them; don't re-derive the patterns here.

Rules beyond the worked examples:

- Keep form schemas separate from form UI: `features/<feature>/model/schema.ts`
  for reusable feature-level validation; co-locate the schema with a page-local
  form when it has no meaningful reuse. Infer form value types from the Zod
  schema instead of duplicating them manually.
- Money fields: amount values stay strings; the Zod schema only checks
  parseability, never converts; the single conversion to minor units happens
  in the named values→payload mapper — never `Number()` float math (invariant
  #2; worked examples forms.md §2/§4).
- Form submission: `form.handleSubmit(handleSubmit)` goes inline to `onPress`;
  when the wrapped submit is reused or passed down, extract it as
  `const handleFormSubmit = form.handleSubmit(handleSubmit)` — no extra
  `handlePress` wrapper without real added behavior. Repository errors map
  through `getRepositoryErrorText` from `@/shared/lib/data/repository-errors-ru`
  — code-keyed; never branch form logic on HTTP statuses. Error surfacing,
  retry, and pending/duplicate-submission semantics are specified in
  `openspec/specs/mobile-forms` (worked example: forms.md §5).
- Text fields inside a Bottom Sheet MUST use `BottomSheetInput` from
  `@/shared/ui/bottom-sheet` (not the plain `Input`): @gorhom ignores
  keyboard-show events until the focused input registers with the sheet's
  keyboard state, and only `BottomSheetTextInput` does. The shared
  `BottomSheet` wrapper also passes `accessible={false}` to @gorhom, whose
  `accessible` default swallows sheet content from the accessibility tree —
  Maestro ids and VoiceOver depend on that opt-out. Don't add sheet-context
  auto-detection to `shared/ui/input`; the sheet-aware variant lives with the
  sheet wrappers (forms.md §3).

## Component design

Prefer a single clear responsibility per component — it shouldn't
simultaneously be a Bottom Sheet container, a full form implementation, a
domain validation engine, an API/repository adapter, and a large collection of
presentation primitives. Split container (`new-transaction-sheet.tsx`) from
presentation/form (`new-transaction-form.tsx`) once a component gets
non-trivial — but don't split trivial code into many files just to satisfy the
rule.

Prefer deriving values (e.g. `accounts.find(a => a.id === selectedAccountId)`)
over duplicating them in a parallel `useState`, unless there's a genuine
independent state transition. Don't use `useEffect` as a stand-in for ordinary
derived values or event handling — compute derived booleans/values directly
instead of syncing them into state via an effect. Effects are for
synchronization with external systems or lifecycle operations, not basic
computation.

Effects policy, state-choice decision tree, custom-hook criteria,
memoization, and component-boundary criteria:
`docs/conventions/components-and-state.md`.

## State management

Use the smallest appropriate mechanism: React Hook Form for form state,
TanStack Query for server/repository state and async mutations, plain React
state for local ephemeral UI state, Zustand/MobX only for shared client-only
UI state that genuinely needs global ownership, and the repository layer for
persistent local domain data. Don't duplicate server/local repository state
into global client state without a concrete reason, and don't reach for
Zustand/MobX just because several components need to read data TanStack Query
already owns.

## Data layer & sync (offline-first)

Read before touching data or sync code: `openspec/specs/mobile-local-data`
(local DB as source of truth, per-record versioning, atomic row+outbox
writes, op coalescing), `openspec/specs/sync-protocol` (cycle ordering,
push/pull, conflict flows, household rebase + authorship, login ownership
gate, auth-expiry pause), and invariant #16 (client local data boundary).
Household join flows: `features/household-join` (the shared carry/clean
choice + the `last_household` startup/foreground guard),
`entities/household` (control-plane API), `app/invite/[token]`, and the
settings household section. Household management (change `household-ux`):
the settings «Пространство» group + `pages/settings/ui/profile-section.tsx`
build on `entities/household` (`useHouseholdActions`, `authorLabel`);
authorship markers render in cashflow rows/sheets, the edit sheet, debtor
history, and plan rows; leave and dissolve are clean-start-only. This
section is only the working rules and the
code map.

Hard rules:

- UI components never touch SQLite/Drizzle or backend clients directly:
  `UI → TanStack Query hook → Repository → local DB`; the backend is reached
  only through the sync engine. TanStack Query is a UI cache, NOT the
  offline store.
- Direct `shared/api` client use is confined to the session and household
  control-plane APIs (`entities/session/api`, `entities/household/api`) and
  the sync transport (dependency-cruiser `api-client-seam` rule).
- Repositories mirror backend domain rules using the shared `RepositoryError`
  model and existing error-code mappings — don't invent ad-hoc error strings
  in screens when a shared mapping exists.
- Correctness never depends on background sync (`expo-background-fetch`,
  dev build only; anonymous devices skip it entirely).

Code map:

- `@trata/local-data` (`packages/local-data`) - the whole local-first
  layer: drizzle schema, outbox, sync engine with conflicts, local
  repositories, recurrence math, migrations. **Also houses ownership gate
  policy** (`sync/ownership.ts`: decision table, `adoptUnowned`, `rebindOwner`)
  and **restore-as-new policy** (`sync/restore.ts`: `restoreConflictAsNew`,
  `canRestoreAsNew`) and `conflictSubject`; apps keep only presentation and
  control-plane side effects. Generate migrations with
  `pnpm -C packages/local-data db:generate`.
- `shared/lib/db/database.ts` - the expo-sqlite driver + migrations call
  (the only production touchpoint of the driver; types come from the package).
- `shared/lib/sync/` - app-side wiring only: `transport.ts` (API-client
  binding), `sync-context.tsx` (the provider composes in
  `src/app/_layout.tsx`), `background-sync.ts`; conflict UI in
  `features/sync-conflicts`.
- `entities/session` (`AuthProvider`/`useAuth`) - delegates ownership gate
  decisions to the package; keeps Alert presentation + server-side logout.
- `widgets/sync-status`.

Env / tests: backend URL `EXPO_PUBLIC_API_URL`; integration suite against a
real backend: `SYNC_INTEGRATION_API=<url> pnpm test backend-integration`
(skips without the env var).

## i18n

Will use the shared `@trata/i18n` bundle via react-i18next; mobile
keeps its own native wiring, like web keeps vue-i18n. Until that wiring lands,
RU strings may stay hardcoded with explicit `TODO(i18n)` markers (localized
tab/screen titles included). Don't introduce a second ad-hoc translation
mechanism.

## Testing

`pnpm test` runs Jest (`jest-expo` + `@testing-library/react-native`). Test-only
repository fixtures live in `shared/lib/testing/mock-*-repository.ts`; real
local databases for tests come from `createTestDatabase()` in
`@trata/local-data/testing` (never import test helpers from
application code). Test observable behavior (e.g. `getByTestId('submit')` is
enabled/disabled), not internal state, computed Uniwind styles, animation
frames, or private function calls (unless mocking a genuine external
boundary). Components using `useSafeAreaInsets` need `SafeAreaProvider` with
`initialMetrics` in tests; wrap screens in `ThemeProvider`. Co-locate tests
next to the component (`new-transaction-form.tsx` + `.test.tsx`).

Form behavior and coverage requirements are defined in
`openspec/specs/mobile-forms`. Additionally cover conditional fields
appearing/disappearing correctly. Don't test RHF internals.

## E2E / Maestro

Flows live in `.maestro/flows/*.yaml`; shared launch logic is
`.maestro/_launch.yaml` + `.maestro/_launch.js` (sync flows 09/15/17 use
`_launch-online.yaml`, which also restores the anonymous-app and
offline-gate-OFF invariants). Every new user-facing flow
requires Maestro coverage — no new user-facing behavior ships without one.
Selectors use `testID`/Maestro `id` (lowercase-kebab, e.g. `screen-dashboard`,
`tab-dashboard`, `new-transaction-submit`), not visible text — including
inputs inside bottom sheets.

New flow template:
```yaml
appId: com.anonymous.mobile
---
- runFlow: ../_launch.yaml
- tapOn:
    id: <element-testid>
- assertVisible:
    id: <expected-testid>
```

Run the suite strictly via `pnpm test:e2e` (`scripts/e2e/run-maestro-ios.sh`),
never bare `maestro test`: the script primes the simulator pasteboard with the
test password (flow 09's native Paste fails without it), and ad-hoc
`maestro test` invocations while another Maestro driver holds the simulator
kill the run with "Device became unreachable". For a single flow, prime the
pasteboard the same way first and make sure no other Maestro run is active.

Before reporting a task done, `pnpm test:e2e` must pass — a failing run blocks
`done`; don't skip or weaken assertions to make the suite green.

## Dev build target (not Expo Go)

Target: a local iOS dev build (`com.anonymous.mobile` + `expo-dev-client`) —
the suite moved off Expo Go because `expo-background-fetch`/
`expo-task-manager` OS scheduling is not guaranteed inside Expo Go. Produce/
update the dev build with `pnpm ios` (`npx expo run:ios`; `ios/`/`android/`
are gitignored and config-synced from `app.json`, incl. the
`expo-background-fetch` plugin's `UIBackgroundModes`). Metro must be running
(default 8081): flows deep-link the dev client into it via
`exp+expensetracker://expo-development-client/?url=…` (see
`_launch.yaml`/`_launch.js`, overridable via `MAESTRO_EXPO_URL`).

`plugins/with-dev-menu-fab.js` disables the dev-menu floating button
(`EXDevMenuShowFloatingActionButton=false`): the default-ON button overlaid
app UI and intercepted taps (e2e flows tapped it instead of app buttons). The
dev menu stays reachable via ⌘D / shake / three-finger long-press.

## Quality bar

Before reporting a task complete, run the checks relevant to the change:
```bash
pnpm type-check
pnpm lint
pnpm lint:design
pnpm format
pnpm test
pnpm test:e2e
```
`pnpm knip` from the workspace root covers mobile. `pnpm exec expo export
--platform ios` is an additional end-to-end check on the iOS production bundle.

Known limitation: sheets do not reliably auto-dismiss after a successful
create — tracked as `TODO(sheet-dismiss)`; flows close via a backdrop tap
meanwhile. Don't silently remove or weaken this. Known failures documented in
this file are not considered regressions; report them explicitly when they
prevent a full green run.

## Code quality rules for agents

External agent skills under `.agents/skills/` are advisory; where one
conflicts with this file or `docs/conventions/*`, the repo's conventions win
(root `AGENTS.md` → "Agent skills"). Mobile-specific: Vercel's
`ui-native-modals` (native Modal over @gorhom) is deliberately NOT adopted;
don't apply skill memoization/profiling rules without a measured problem
(same bar as `components-and-state.md`).

Don't optimize for smallest diff at the expense of architecture. Before
implementing a feature, identify: what is domain state; what is server/
repository state; what is form state; what is ephemeral UI state; where the
feature belongs in FSD; which existing abstractions to reuse; what tests/e2e
coverage are required.

Don't invent a local architecture inside a component when the project already
has an established abstraction. Search the repo for an existing equivalent
before adding a new one. Before implementing a form, inspect existing form
patterns and follow the RHF + Zod conventions. Before implementing a Bottom
Sheet flow, inspect existing Bottom Sheet wrappers and form flows. Before
adding a new UI primitive, inspect `shared/ui`. Avoid clever abstractions that
only exist to shave a few lines — prefer boring, explicit, composable code.

## Definition of Done

A feature isn't complete just because TypeScript accepts it. For a normal
user-facing feature, completion means: correct FSD placement; existing project
abstractions reused where applicable; form state handled by React Hook Form
where the feature is a form; validation handled by Zod where applicable;
domain/server constraints mirrored on the client only for UX; repository/
TanStack Query boundaries respected; loading/error/empty states handled;
accessibility/testIDs added; unit/component tests added where behavior
warrants them; Maestro flow added/updated; `pnpm test:e2e` passes; type-check/
lint/format/tests pass; for UI changes `pnpm lint:design` passes; no
unnecessary duplicated state; no raw colors; no architectural shortcuts hidden
inside UI components.

If a requirement conflicts with an existing architecture rule, stop and
explain the conflict rather than silently violating it.

## Important agent behavior

When a task reveals a missing project convention, don't silently establish a
one-off pattern. Instead: determine whether it's project-wide; if yes, update
the appropriate `AGENTS.md`/architecture doc; implement the feature using that
convention; keep the implementation consistent with it. Don't add large
architectural rules to a feature-specific file when they're actually
project-wide.

Don't introduce a major library (e.g. React Hook Form, Zod) as an incidental
dependency of a single feature without checking whether the project has an
explicit decision/change adopting it. Use OpenSpec for architectural changes;
a focused implementation change is sufficient for ordinary work that follows
already-established architecture.
