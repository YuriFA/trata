# Coding principles

Engineering judgement rules for agents (and humans) working in this repo: how
to keep implementations minimally complex, where new logic belongs, what to
comment, and how to review your own change before reporting it done.

Every rule here is extracted from this codebase and carries evidence
pointers. This is not a general style guide: platform-specific patterns live
in the app conventions (`apps/mobile/docs/conventions/`,
`apps/web/docs/conventions/`), architectural constraints in
`docs/architecture/invariants.md`, working rules in the `AGENTS.md` files.

## 1. Minimal complexity

Prefer the simplest implementation that preserves the existing architecture
and invariants. Concretely:

- Search for an existing equivalent before adding an abstraction (mobile
  `AGENTS.md` → "Code quality rules"): the repo already has query hooks,
  repository DI, error mapping, named value→payload mappers, sheet wrappers,
  and a UI kit. Extending an established pattern beats introducing a new one.
- An abstraction must earn its keep at (or clearly foresee) a second call
  site or a real boundary (mobile conventions §3/§5). One-call-site
  indirection is negative value. Anti-examples from this repo:
  `useTransactionActions` (`apps/mobile/src/app/(tabs)/_layout.tsx`) — a
  `use*`-named function with no hooks inside and one caller; the local
  `toMinorUnits` in `apps/mobile/src/features/sync-conflicts/ui/conflict-center.tsx`
  — a new function shadowing the shared money converter's name with different
  semantics.
- Don't add state, effects, contexts, or memoization "while in there" — each
  has a specific job and cost (mobile conventions §1–§4; web conventions
  §2).
- Don't split files or components for size; split on boundaries (mobile
  conventions §5; forms.md §7).

## 2. Where new logic goes

Before writing, decide: reuse / hook / composable / component / plain helper
/ config data / nothing new. The per-platform criteria live in:

- `apps/mobile/docs/conventions/components-and-state.md` — hooks (§3),
  components (§5), state (§2), effects (§1), memoization (§4).
- `apps/web/docs/conventions/vue-patterns.md` — composables, computed/watch
  budget, forms, lists.

Cross-app rule: logic that would be duplicated in both apps and has no
platform dependency belongs in `packages/*` (fetch-family only, invariant
#12) — check `@trata/{api,money,dates,i18n,tokens}` before writing
it twice. Money and date logic ALWAYS goes through the shared packages,
never re-implemented app-side (invariants #2/#14).

## 3. Comments

What this repo comments (keep doing):

- **Why, not what** — constraints the code cannot express: `reset()` doesn't
  re-run the resolver, so `trigger()` follows
  (`apps/mobile/src/features/create-transaction/ui/new-transaction-form.tsx`);
  the @gorhom modal host must sit inside the data providers
  (`apps/mobile/src/app/_layout.tsx`).
- **Design-decision citations** — pure logic modules carry header comments
  citing their source ("design D6" in
  `apps/mobile/src/shared/lib/db/outbox.ts`, "invariant #15" in
  `apps/mobile/src/features/cashflow-overview/ui/category-cashflow-sheet.tsx`,
  "forms.md §3" in `apps/mobile/src/app/_layout.tsx`). A new pure-logic
  module under `shared/lib` gets one naming its design decision.
- **Platform/library gotchas and deliberate workarounds** — why
  `UniwindInsetsBridge` exists (no SafeAreaListener in
  safe-area-context@5.6); why the dev-menu FAB is disabled
  (`plugins/with-dev-menu-fab.js`).
- **TODO markers for known debts** with stable tags registered in the area
  `AGENTS.md`: `TODO(i18n)`, `TODO(sheet-dismiss)`.

What not to write: restatements of the code, commented-out code, change
narration ("now we…"), explanations aimed at a reviewer of the current diff.
If a comment documents an architectural DECISION recorded nowhere else, move
the decision to `docs/architecture/invariants.md`, an ADR, or
`docs/assumptions.md` — a decision must not live only in a comment.

Comment language is English; user-facing strings follow each app's i18n
state (mobile: RU until i18n wiring lands).

## 4. Self-review before finishing

Run this against your own diff before reporting done; it extends the
per-area Definition of Done in each `AGENTS.md`:

1. **Effects** — every `useEffect` synchronizes with an external system;
   nothing derives or handles events there; async effects have a
   `cancelled` flag or cleanup (mobile conventions §1; web: a watch must
   bridge an external system — web conventions §2).
2. **State** — nothing stored that is derivable; no parallel mirror of
   query/form/props state; the mechanism matches the kind of value (mobile
   conventions §2).
3. **Subscriptions** — each value is subscribed to where it is rendered;
   form roots hold no watches/formState reads they don't render (forms.md
   §8).
4. **Boundaries** — UI → query hook → repository only; errors mapped by
   machine `code`, never HTTP status; money converted exactly once in a
   named mapper (invariants #2/#4/#11/#16).
5. **Naming** — `handle*` implementation-side / `on*` callback props;
   kebab-case role-suffixed files; `use*` only for functions containing
   hooks; testIDs present for user-facing elements.
6. **Complexity** — nothing the task didn't need: no speculative options,
   params, memoization, contexts, or one-caller abstractions (§1).
7. **Conventions debt** — if you had to deviate from a convention or
   established a new pattern, record it: update the conventions doc or
   register the deviation (`docs/technical-debt.md` /
   `docs/architecture/findings.md`) instead of leaving it implicit.
8. **Quality bar** — run the checks the area `AGENTS.md` requires.
