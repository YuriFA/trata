## Why

A real user reported the web debts flow freezing on mobile: debts → debtor
history drawer → operation drawer → «удалить» opened a confirmation that was
invisible yet blocked every tap. Root cause: the centered `AlertDialog`
(z-50) renders beneath the open drawer sheet (z-[60]) while staying fully
modal - focus trap, body pointer-events lock, and its own overlay swallow all
input. The "destructive confirms stay centered at every viewport" rule made
EVERY confirm a potential freeze when opened above any open overlay, and it
was the one overlay surface in the app that was not a mobile bottom sheet.

## What Changes

- Add `shared/ui/responsive-alert-dialog/` (`ResponsiveAlertDialog`): a
  compact centered confirm dialog on viewports of 768px and wider, a
  bottom-sheet drawer on narrower viewports - the same split
  `ResponsiveDialog` applies to forms and pickers.
- Migrate all 10 `AlertDialog` consumers to it (debts operation + debtor
  delete, plan delete, household code rotate, delete transaction, delete
  account, remove member, dissolve, leave, ownership gate); on desktop the
  surfaces unify on the design-system centered confirm (icon circle,
  flex-1 buttons).
- Guard z-scale: `AlertDialog` overlay/content raised z-50 → z-[70] with the
  scale documented in the shared components (dialogs z-50 < drawers z-[60] <
  alerts z-[70]), so a stray centered alert can never be buried again.
- Reverse the e2e-pinned presentation rule: on mobile, destructive confirms
  render as bottom sheets and must stay clickable; on desktop they stay
  compact centered alert dialogs. Add an e2e regression for the reported
  debts flow (confirm visible and clickable above two stacked sheets).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-screens`: the "Mobile overlay presentation" requirement drops the
  "destructive-confirmation dialogs SHALL remain centered dialogs at every
  viewport" clause; destructive and decision confirmations join the
  bottom-sheet idiom on phone viewports, stay compact centered dialogs on
  desktop, and must never be presented centered above an open drawer.

## Impact

- `apps/web/src/shared/ui/responsive-alert-dialog/` - new shared component.
- `apps/web/src/shared/ui/alert-dialog/`, `.../drawer/` - z-scale guard.
- 10 confirm call sites across debts, plans, accounts, transaction delete,
  settings, and the global ownership gate.
- `apps/web/e2e/overlay-presentation.spec.ts` - presentation rule reversal
  plus the new stacked-flow regression; `OperationFormDialog.test.ts` -
  confirm interaction via the shared component's test ids.
- Mobile app, backend, OpenAPI contract: untouched.
