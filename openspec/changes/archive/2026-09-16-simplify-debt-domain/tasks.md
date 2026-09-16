## 1. Contract

- [x] 1.1 Edit `docs/api/openapi.yaml`: remove `note` from the `Debtor` and `DebtOperation` schemas and from their create/update request schemas; debtor update becomes name-only; remove the 409 `DEBTOR_IN_USE` response from `DELETE /api/debtors/{id}` and the `DEBTOR_IN_USE` error definition
- [x] 1.2 Lint the spec: `npx @redocly/cli lint --config docs/api/redocly.yaml docs/api/openapi.yaml`
- [x] 1.3 Regenerate: `make gen` in `backend/` and `pnpm gen:api` (packages/api + apps/web)

## 2. Backend

- [x] 2.1 Add the next Postgres migration dropping `debtors.note` and `debt_operations.note` (up/down pair)
- [x] 2.2 Update sqlc queries/models: strip note fields; rewrite `DeleteDebtor` as a cascade - lock the debtor, tombstone its live operations and the debtor, append one change-log tombstone per record, all in one transaction; regenerate sqlc
- [x] 2.3 Remove `ErrDebtorHasOperations`, its `DEBTOR_IN_USE` spec in `errspec.go`, the errormap entry, and the sync-batch guard in `write_rules_debtor.go` so batch deletes reuse the same cascade
- [x] 2.4 Backend tests: REST cascade delete (versions incremented once per record, change-log rows written), sync-batch debtor delete cascade reported as applied, rename-only validation (no-op rejected, taken name rejected), per-item `debtor-not-found` for orphan operations unchanged, debtor delete of another household's debtor still not-found

## 3. Shared packages

- [x] 3.1 `packages/local-data`: drop the note columns from `schema.ts` and bump the schema version with a migration; add the debtor cascade delete (tombstone debtor + live operations + enqueue sync operations in one local transaction), keeping the single-operation tombstone path
- [x] 3.2 `packages/i18n`: remove debt note and contact-form keys (`debts.contact*`, `debts.note*`), add rename and delete-confirmation keys (operation count, non-zero balance warning) in en/ru; check `fields.description` usage before touching it (shared with transactions)

## 4. Web app

- [x] 4.1 Delete `DebtorFormDialog.vue`; add a rename-only dialog (single name field) behind the history pencil, surfacing the already-exists error by code
- [x] 4.2 Move debtor deletion into `DebtorHistoryDialog.vue`'s header with an AlertDialog showing the operation count and a non-zero balance warning, calling the cascade delete
- [x] 4.3 Remove note inputs from `NewDebtorDebtDialog.vue` and `OperationFormDialog.vue`; stop rendering `operation.note` in history rows

## 5. Mobile app

- [x] 5.1 Delete `debtor-form-sheet.tsx`; add a rename-only sheet behind the history header button, surfacing the already-exists error by code
- [x] 5.2 Move debtor deletion into `debtor-history-sheet.tsx`'s header with an Alert confirmation showing the operation count and a non-zero balance warning
- [x] 5.3 Remove note inputs from `new-debtor-debt-sheet.tsx` and the operation form; history rows show the kind label always (drop the `row.note` fallback)

## 6. Verification

- [x] 6.1 Backend suite: `go test ./...` in `backend/` (per `backend/AGENTS.md` commands)
- [x] 6.2 Workspace gates: `pnpm arch:check`, `pnpm knip`, `pnpm lint:design`, per-package type-checks
- [x] 6.3 Manual smoke: web - delete a debtor with live operations, rename; mobile - offline cascade delete converges after sync
- [x] 6.4 `openspec validate simplify-debt-domain --strict`
