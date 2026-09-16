## Context

Web overlays split at 768px (`useDesktopPresentation`, provided once by
`AppShell`): `ResponsiveDialog` renders forms, pickers, and lists as reka
drawers (sheet `z-[60]`) on phones and centered dialogs (z-50) on desktop.
Confirmations alone kept a centered `AlertDialog` at every viewport. reka
portals both kinds to `body`; a confirm opened above an open drawer painted
beneath the sheet (z-50 < z-[60]) while staying modal - the reported freeze.
Desktop never saw it (equal z-50, later DOM wins).

## Goals / Non-Goals

**Goals:**

- A confirm is always visible and clickable above any open overlay.
- One confirm pattern across the app, matching the mobile sheet language.
- The buried-modal failure class is structurally impossible, not patched
  per surface.

**Non-Goals:**

- No change to what the confirmations do (flows, i18n, mutations).
- No redesign of desktop confirmation layout beyond unifying on the existing
  design-system card.
- No mobile-app work.

## Decisions

- **Sheets on mobile for ALL confirms, not only nested ones** - a
  context-dependent rule ("drawer only when another overlay is open") cannot
  be implemented by a shared component used from both page level and inside
  dialogs (`DeleteTransactionDialog`), and two coexisting confirm patterns is
  the drift this repo forbids. The centered mobile confirm was the single
  overlay exception; removing it removes the failure class. This reverses
  the previously pinned "destructive confirms stay centered" decision -
  deliberate and user-approved.
- **Guard z-scale anyway (alerts z-[70])** - the ownership gate remains a
  centered `AlertDialog` on desktop and any future stray alert must outrank
  drawers. The scale (dialogs z-50 < drawers z-[60] < alerts z-[70]) is
  documented in both shared components.
- **Prop-driven component, not composition** - all 10 call sites are
  title/description/labels/loading/icon; props collapse ~25 boilerplate
  lines each, i18n keys stay with callers, and the desktop/mobile split is
  encapsulated. A default slot carries the two richer descriptions
  (debtor balance warning, dissolve counts).
- **Unify desktop on the design-system card** - only 2 of 10 used the
  icon-circle confirm; the rest were plain wide alerts. One confirm pattern
  beats five legacy layouts; non-delete confirms (rotate, gate) use the same
  card without the trash icon.
- **Drawer semantics (role=dialog) accepted on mobile** - reka drawers
  cannot carry `role=alertdialog`; every stacked drawer in the app already
  uses dialog semantics, and the a11y stack machinery in `DrawerContent`
  (`data-nested-drawer-open` handling) applies unchanged.

## Risks / Trade-offs

- Reverses an e2e-pinned decision; the pinned test is rewritten to assert
  the new rule so the reversal is explicit in history.
- Confirm sheets are swipe-dismissible while `AlertDialog` was not - accepted:
  swipe-down equals cancel, matching every other mobile sheet.
