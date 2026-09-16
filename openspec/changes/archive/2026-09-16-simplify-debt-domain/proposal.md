## Why

The debts domain carries more surface than the product needs. A debtor with
history cannot be deleted at all (the debtor-in-use guard rejects it), the
separate contact edit surface exists only to change a name and an unused
note, and every debtor and debt operation carries a free-text `note` field
that adds no user value. Product decision: a debt is its ledger and its
name, nothing more.

## What Changes

- **BREAKING**: Deleting a debtor now cascades - the debtor and all its
  live debt operations are tombstoned atomically in one transaction. The
  debtor-in-use guard is removed, in REST and in the sync batch write rules.
- **BREAKING**: The `note` field is removed from the debtor (create,
  update, response, sync payloads) and from the debt operation (same
  surfaces). The shared optional-note rule no longer applies to the debts
  capability.
- Debtor update becomes rename-only: updatable field is the name; the
  per-household name uniqueness and the already-exists rename conflict stay.
- UI (web + mobile): the contact edit surfaces (web `DebtorFormDialog`,
  mobile debtor form sheet) are replaced by a rename-only dialog behind the
  existing edit affordance in the debtor history. Debtor deletion moves to
  the debtor history header, confirmed by a dialog showing the operation
  count and warning when the balance is non-zero.
- Local SQLite schemas (web WASM and mobile via `@trata/local-data`) drop
  the note columns for `debtors` and `debt_operations`.
- Contract first: `docs/api/openapi.yaml` is edited first, then backend
  (`make gen`) and TS types (`pnpm gen:api`) are regenerated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `debts`: cascade deletion replaces the debtor-in-use guard (REST and
  sync); `note` removed from debtor and debt operation shapes and update
  constraints; the shared optional-note requirement is dropped from this
  capability.
- `mobile-local-data`: debts screen loses the note inputs (creation flow,
  operation form); the offline deletion guard scenario becomes a cascade
  with confirmation; a rename affordance lives in the debtor history sheet.
- `web-screens`: the debts screen's debtor form overlay is replaced by a
  rename-only dialog; deletion is offered from the debtor history overlay.
