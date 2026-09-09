# Tasks: adopt-rhf-zod-forms

## 1. Dependencies

- [x] 1.1 Add to `apps/mobile/package.json` dependencies: `react-hook-form@^7`,
  `zod@^4.4.2` (same range as `apps/web`), `@hookform/resolvers@^5` — install
  from `apps/mobile` so the lockfile records the consumer workspace.
- [x] 1.2 Smoke-check resolver + Zod 4 compatibility without committing usage:
  temporarily add a scratch file importing `useForm` + `zodResolver` over a
  minimal schema, run `pnpm type-check` in `apps/mobile`, then delete the
  scratch file (design D3).
- [x] 1.3 Add `react-hook-form`, `zod`, `@hookform/resolvers` to root
  `knip.json` → `workspaces["apps/mobile"]` → `ignoreDependencies` with a
  comment `# adopt-rhf-zod-forms: remove when the first form imports them`
  (design D10); verify `pnpm knip` passes.
- [x] 1.4 Run `pnpm test` in `apps/mobile` once after install to confirm the
  dependency installation itself breaks nothing (workspace resolution,
  lockfile). Nothing imports the packages yet, so a green run proves nothing
  about Jest transforms — real transform verification lands with the first
  form's tests; if those hit module-format issues (e.g. an ESM-only resolver
  build), allowlist the package in `jest.config.js`
  `transformIgnorePatterns` at that point.

## 2. Reference examples (`apps/mobile/docs/conventions/forms.md`)

- [x] 2.1 Fix the §2 `createTransactionSchema` amount validation: replace the
  `Number(value.replace(',', '.'))` float math with a parseability check via
  `parseMajorUnitsToMinor` from `@trata/money` (valid = the string
  parses to int64 minor units). Keep payload construction and the money
  conversion out of the schema — they belong to the §4 named mapper
  (design D7, money invariant).
- [x] 2.2 Add a short server-error pattern section: on repository/mutation
  failure call `form.setError('root', …)` with the message from the shared
  code-keyed mapping (`getRepositoryErrorText`), render
  `form.formState.errors.root?.message` at form level, keep entered values for
  retry (design D8).
- [x] 2.3 Add the deliberate reset/lifecycle pattern to the Bottom Sheet
  section: explicit `form.reset(defaultValues)` on successful submit and on
  flow restart (mode change), or a remount/key strategy when clearer (design
  D6) — never assume opening/closing the container resets the form.
- [x] 2.4 Re-read the whole document for invariant consistency (no float
  money, code-keyed errors, `handle*`/`on*` naming, `BottomSheetInput` inside
  sheets) and fix any remaining drift.

## 3. Conventions (`apps/mobile/AGENTS.md`)

- [x] 3.1 Update the Forms section to record the adopted decision: the stack
  is installed (`react-hook-form` + `zod` + `@hookform/resolvers`) per this
  change, and `docs/conventions/forms.md` is the canonical worked-example
  reference (link it).
- [x] 3.2 Confirm the existing Forms-section rules (schema placement
  `model/schema.ts`; `Controller`/`useController` integration and the
  `FormProvider` thresholds — never merely to avoid passing one or two props;
  the sheet pattern; `handle*` vs `on*` including the
  `form.handleSubmit(handleSubmit)` submit boundary with optional extraction
  and no gratuitous `handlePress` wrapper) match `docs/conventions/forms.md`
  after phase 2 edits. Reconcile wording drift and keep `AGENTS.md`
  rule-focused — link the worked examples rather than embedding them.

## 4. Verification

- [x] 4.1 In `apps/mobile`: `pnpm type-check`, `pnpm lint`, `pnpm format` all
  pass.
- [x] 4.2 In `apps/mobile`: `pnpm test` passes (no behavior changed — existing
  suite must stay green).
- [x] 4.3 From the workspace root: `pnpm knip` passes with the temporary
  `ignoreDependencies` entry.
- [x] 4.4 In `apps/mobile`: `pnpm test:e2e` passes — kept as the project's
  standard regression gate required by `AGENTS.md`, not as an RHF/Zod
  integration check; nothing imports the new dependencies yet.
- [x] 4.5 In `apps/mobile`: `pnpm exec expo export --platform ios` succeeds
  (production bundle check).
- [x] 4.6 Confirm scope: `git status` shows only `apps/mobile/package.json`,
  `pnpm-lock.yaml`, `knip.json`, `apps/mobile/docs/conventions/forms.md`,
  `apps/mobile/AGENTS.md`, and this change's files — no app source files, no
  form migrations.

## 5. Follow-up addition: mutually exclusive form variants

- [x] 5.1 Record the multi-mode rule: forms with mutually exclusive modes
  (e.g. transaction expense/income/transfer) model their values as
  `z.discriminatedUnion('kind', [...])` — one object per mode sharing the
  discriminator — never a single `z.object()` padded with `optional()` fields;
  mode-specific invariants live in the schema and its inferred types, with no
  non-null assertions (`!`) for mode-specific form values. Reflected in
  `design.md` (decision D11), `apps/mobile/AGENTS.md` (Forms → Multi-mode
  forms), and `docs/conventions/forms.md` §2 (short schema + discriminator
  narrowing example, verified against the installed Zod 4). Scope unchanged:
  docs/design only, no existing form migrated.
