## 1. Shared component

- [x] 1.1 Add `shared/ui/responsive-alert-dialog/` (`ResponsiveAlertDialog`:
      v-model:open, title, description, confirm/cancel labels, loading,
      optional icon, test-id props; centered AlertDialog on desktop,
      bottom-sheet drawer on mobile; confirm/cancel events)
- [x] 1.2 Raise AlertDialog overlay/content z-50 → z-[70] and document the
      z-scale in `AlertDialogContent.vue` + `DrawerContent.vue`

## 2. Migration

- [x] 2.1 Nested confirms: debts operation delete, debtor delete (history
      header), plan delete, household code rotate, delete transaction,
      ownership gate (store-owned open state, no v-model)
- [x] 2.2 Page-level confirms: delete account, remove member, dissolve,
      leave; drop the two `AlertDialogTrigger` usages for plain buttons
- [x] 2.3 Unify desktop presentation on the design-system centered confirm;
      keep every existing data-testid stable

## 3. Tests and verification

- [x] 3.1 Rewrite the overlay e2e rule test: destructive confirms render as
      bottom sheets and stay clickable (mobile); add the stacked
      debts-flow regression and the desktop centered-alert assertion
- [x] 3.2 Update `OperationFormDialog.test.ts` to the shared component's
      confirm test id
- [x] 3.3 Run web unit tests, type-check, lint, design lint, knip, and the
      e2e suites (chromium + firefox on a fresh build); all green
