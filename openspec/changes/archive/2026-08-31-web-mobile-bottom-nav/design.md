# Design: web-mobile-bottom-nav

## Context

The app shell is `AppShell.vue` (FSD `app/layout`): it JS-gates navigation with
`useMediaQuery('(min-width: 1024px)')` — `AppSidebar` (desktop) vs
`MobileTopBar` (hamburger opening a left `Sheet` hosting `AppSidebarNav` with
`footer?: false`). The JS gate (not CSS hiding) exists so exactly one instance
of the sync badge / guest indicator exists per viewport — e2e matches those
testids strictly. Nav items and active-state logic live in `AppSidebarNav.vue`
(active = `route.name.startsWith(item.name)`, so `/analytics/:direction` keeps
Аналитика active). The add-transaction UI is `features/transaction/add`
(`CashflowForm` / `TransferForm`); `pages/dashboard/ui/QuickActionsCard.vue`
already hosts three separate dialogs (expense / transfer / income) embedding
those forms directly — the canonical one-dialog-per-kind pattern
(vue-patterns §4). Styling is Tailwind v4 + `@trata/tokens`
(Direction D «Бумага»); the approved target look is superdesign draft
`99e2a910-ec8e-4ac6-97a9-4aab96545efb` v5 (variant A).

## Goals / Non-Goals

**Goals:**

- One breakpoint switch (768px) between the desktop sidebar and the new mobile
  shell (top bar + bottom tab bar + FAB speed-dial).
- Pixel-faithful shell per the approved mockup: floating pill tab bar
  (container radius 24px, active tab pill 20px, soft elevation shadow), 56px
  teal FAB straddling the bar's top edge.
- Reuse existing creation flows, session/auth logic, and badge components —
  no new data or API surface.
- Safe-area correctness in PWA standalone mode.

**Non-Goals:**

- No tablet-specific intermediate layout (768–1023 shows the desktop sidebar).
- No dark-theme work (dark is unwired on web).
- No changes to the PWA manifest or service worker (stale `theme_color` is a
  separate concern).
- No RN code changes; the parity is visual/interaction only.

## Decisions

1. **Single breakpoint 768px in `AppShell.vue`.** Change the existing
   `useMediaQuery` to `(min-width: 768px)` and swap Tailwind `lg:` classes for
   `md:` in the shell (`AppSidebar` `hidden md:flex`; mobile chrome
   `md:hidden`). Alternative considered — keeping 1024 for the sidebar and
   tabs only below 768 (three nav modes) — rejected per product decision:
   two modes, one switch, minimal state space. The JS gate (vs CSS-only) is
   kept to preserve the single-instance badge invariant and e2e stability.
2. **New FSD widget `widgets/mobile-shell/`.** Hosts `MobileTopBar.vue`
   (reworked: brand + sync badge + account area), `BottomTabBar.vue`
   (4 `RouterLink` tabs + central slot), `SpeedDialFab.vue`, and
   `UserMenu.vue` (avatar dropdown). A widget is warranted: the shell renders
   on every page (widgets decision tree "used on 2+ pages") and mirrors the RN
   `widgets/bottom-tab-bar` seam. Alternative — inline in `app/layout` —
   rejected: `app/` stays a composition root; the tab bar is a stateful,
   testable unit. Tabs are plain `RouterLink`s (web-native, deep-linkable);
   no headless tab primitive is needed — active state comes from the router.
3. **Active-tab logic shared with the sidebar convention.** Extract the
   `route.name.startsWith(item.name)` check into a small shared helper
   (`shared/lib` or a `mobile-shell` internal) consumed by both
   `AppSidebarNav` and `BottomTabBar`, so `/analytics/:direction` keeps
   Аналитика active in both shells. Alternative — duplicating the one-liner —
   rejected: the convention is contractual (spec scenario "Active tab follows
   the current route").
4. **Speed-dial reuses the QuickActionsCard dialog pattern.** Three `Dialog`
   instances mounted once in the widget (outside any loop), each embedding
   `CashflowForm` / `TransferForm` directly — same as QuickActionsCard, giving
   the RN parity of "tap → form for that kind" with zero extra taps.
   Alternative — one dialog with `AddTransactionTabs` — rejected: adds a
   tab-switch step on the primary creation path. Preserve existing testids
   (`quick-action-expense/transfer/income` semantics; keep
   `sidebar-add-operation` on the FAB or rename consistently across e2e).
   Final composition (canvas-approved round 2, draft v6 + per-screen v2/v3):
   a horizontal row of three pastel tint tiles above the FAB — перевод
   `primary/10`, расход `warning/10`, доход `success/10`, saturated glyphs,
   11px labels under the circles — the design-system icon-tile pattern shared
   with QuickActionsCard; scrim is white at 70% (RN backdrop parity) instead
   of a dark overlay.
5. **Account zone moves into the top bar.** `UserMenu.vue` wraps the existing
   `DropdownMenu` primitive: avatar → menu with email + «Выйти» (reusing the
   session sign-out flow currently in `AppSidebarNav`'s footer; desktop footer
   stays unchanged). Anonymous users get the guest badge + a «Войти»
   `RouterLink` to `/login`. The sync badge and guest indicator keep their
   current testids and remain hosted only in the top bar (mobile) / sidebar
   footer (desktop) — one instance per viewport, guaranteed by the JS gate.
6. **Safe-area via CSS only.** `index.html` gets `viewport-fit=cover`; the
   shell reserves `env(safe-area-inset-bottom)` under the tab bar and offsets
   the FAB relative to the same wrapper. A single `BottomNavLayout` wrapper in
   `mobile-shell` owns both bar and FAB positioning (web equivalent of the RN
   `tab-bar-height-context`, without the JS). Alternative — an insets bridge —
   rejected: `env()` collapses to 0 in browsers without insets.
7. **Visual contract fixed by the approved mockup (variant A v5).** Elevation
   shadow on the floating bar (`0 0 24px -8px rgba(0,0,0,.25)`) and FAB halo
   are sanctioned despite Direction D's flat bias — the mockup is the approved
   artifact; values already match the RN `shadow-card` / `shadow-fab`
   utilities, and any token addition goes through `packages/tokens` (web copy
   hand-synced with the mobile palette per the existing comment convention).
   Radii: container 24px, active pill 20px, FAB circular; icon set lucide;
   labels via new i18n keys (`nav.*` already exist for tabs; menu adds
   `shell.*` keys) in ru and en, gated by `pnpm i18n:lint`.

## Risks / Trade-offs

- [e2e specs navigate via the drawer below 1024px] → update affected specs in
  the same change; keep badge testids stable; run the mobile-viewport suite
  before merge.
- [Tablet widths 768–1023 get the desktop sidebar] → accepted product
  decision; verify `w-62` sidebar + `max-w-6xl` content fit at 768px during
  implementation.
- [Duplicated dialog wiring between SpeedDialFab and QuickActionsCard] →
  accepted for now; both are thin over the same feature forms; revisit only if
  a third entry point appears.
- [`env()` unsupported in old browsers] → padding collapses to 0; no breakage.
- [768px switch changes what returning tablet users see] → one-time visual
  shift, no data impact; covered by release notes.

## Migration Plan

Client-only change; no data migration. Ship as a normal commit; rollback =
revert. The old drawer is deleted (not feature-flagged) — the e2e suite is the
gate.

## Open Questions

None material — scope, tab set, breakpoint, header content, account
placement, and visual style were settled during design interviews and the
approved superdesign draft.
