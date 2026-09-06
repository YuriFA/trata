# web-screens Specification

## Purpose
The web app's screen inventory and navigation contract: which screens
exist, how users reach them, and the parity principle that every domain
action available on mobile for the shared feature set is available on the
web with web-native presentation.

## Requirements

### Requirement: Screen inventory

The web app SHALL provide screens for dashboard, transactions, analytics
(overview and per-direction detail), debts, plans, accounts, and
settings. The full screen set SHALL be reachable on every viewport:
on viewports 768px and wider through a persistent sidebar listing all
entries, and on viewports narrower than 768px through the mobile
navigation shell (persistent bottom tab bar for the primary screens
dashboard, plans, analytics, and settings; transactions, debts, and
accounts reachable from the dashboard screen, which is always one tap
away). The settings screen SHALL include the household section (current
household, members, invitations, home code, leave), the profile
display-name editor, a category management section reachable at
`/settings/categories`, and a data section reachable at `/settings/data`
with CSV import and full CSV export of transactions. Anonymous and
signed-in users SHALL have the same screen set (the difference is
synchronization, not features).

#### Scenario: All screens reachable

- **WHEN** the user opens the navigation from any screen
- **THEN** entries for the primary screens are persistently available
  (sidebar on viewports of 768px and wider, bottom tab bar below 768px)
  and navigate to their screens, and the remaining screens
  (transactions, debts, accounts) are reachable via the sidebar or the
  dashboard links per the viewport

#### Scenario: All screens reachable on phone widths

- **WHEN** the user is on any screen at a viewport narrower than 768px
- **THEN** the bottom tab bar offers dashboard, plans, analytics, and
  settings, and the transactions, debts, and accounts screens remain
  reachable via links on the dashboard screen

#### Scenario: Screen set independent of authentication

- **WHEN** an anonymous user and a signed-in user compare their navigation
- **THEN** both see the same screen entries

#### Scenario: Household management from settings

- **WHEN** a signed-in user opens settings
- **THEN** the household section is present with the actions their role
  permits

#### Scenario: Category management from settings

- **WHEN** the user opens the settings screen
- **THEN** a categories section leads to the category management screen at `/settings/categories`

#### Scenario: Data section from settings

- **WHEN** the user opens the settings screen
- **THEN** a data section leads to the data screen at `/settings/data` offering CSV import and full CSV export

### Requirement: Dashboard screen

The web dashboard SHALL show a month-scoped overview composed of: summary stat cards for
the total balance across accounts, the period's income, the period's expenses, and the
net debt position (total receivable minus total payable); a breakdown of the period's
expenses by category; and the period's most recent transactions. It SHALL additionally
show period-independent snapshots — the accounts with their balances and the debtor
balances by direction. The dashboard SHALL NOT carry inline transaction-creation entry
points (quick actions); creation happens through the entry points defined by the
Transaction creation entry points requirement and, below 768px, the Mobile navigation
shell requirement. Month-scoped figures SHALL
attribute transactions to periods per the `analytics` capability, and money figures
SHALL be formatted per the `app-currency` capability.

The dashboard SHALL additionally show a period-independent attention card for planned
payments requiring action: the household's overdue plans and the plans due today or
tomorrow, per the `web-push` capability's opt-in rules the card MAY also carry the
device reminder opt-in entry. Each listed plan SHALL offer the plan confirm flow; the
card SHALL be hidden entirely when the household has nothing overdue and nothing due
today or tomorrow. The attention card is not month-scoped and is unaffected by period
navigation.

Each summary stat card SHALL act as a single navigation link detailing its figure: the
accounts balance card SHALL link to the accounts screen; the period income card SHALL
link to the transactions screen filtered to income transactions; the period expenses
card SHALL link to the transactions screen filtered to expense transactions; the net
debt card SHALL link to the debts screen. The income and expense card links SHALL carry
the dashboard's selected month as an inclusive calendar-day from/to range (the format
the transactions screen already parses from its URL query), so the opened list is
scoped to the same month as the figure on the card. The accounts and debts card links
SHALL NOT carry a date filter.

Each row of the expense-by-category breakdown SHALL act as a drill-down control:
activating a row SHALL open that category's transaction overlay scoped to the
expense direction and the dashboard's selected month, with the period navigable
inside the overlay - the same drill-down presentation the analytics detail screens
provide per the `analytics` capability. Transactions SHALL be attributed to the
month per the `analytics` capability. The breakdown rows SHALL NOT navigate away
from the dashboard; the overlay is the detail surface.

#### Scenario: Overview of the current month

- **WHEN** the user opens the dashboard in a month with income and expenses
- **THEN** the income and expense stat cards, the category breakdown, and the recent transactions list show that month's figures

#### Scenario: Snapshot figures are not month-scoped

- **WHEN** the user switches the dashboard month
- **THEN** the accounts total and balances and the debtor balances remain unchanged

#### Scenario: Quick actions

- **WHEN** the user views the dashboard looking for quick add actions
- **THEN** none are shown, and transaction creation is reachable only
  through the shell entry points (sidebar CTA, hotkey «N», command palette,
  transactions-screen button on desktop; FAB speed-dial below 768px)

#### Scenario: Balance and debt cards link to their screens

- **WHEN** the user activates the accounts balance stat card or the net debt stat card
- **THEN** the app navigates to the accounts screen or the debts screen respectively, without any date filter applied

#### Scenario: Income and expense cards carry the selected month

- **WHEN** the dashboard shows a past month and the user activates the income stat card (or the expenses stat card)
- **THEN** the app navigates to the transactions screen filtered to that direction with an inclusive from/to range covering the selected month, and the list shows the transactions behind the card's figure

#### Scenario: Link tracks the selected month

- **WHEN** the user switches the dashboard month
- **THEN** the income and expense card links' month range follows the newly selected month

#### Scenario: Attention card lists overdue and imminent plans

- **WHEN** the household has an overdue plan and a plan due tomorrow
- **THEN** the attention card lists both with their due labels and a confirm action for each, and confirming follows the `planned-payments` capability (transaction created, plan advanced, amount editable)

#### Scenario: Attention card hidden when empty

- **WHEN** the household has no overdue plans and none due today or tomorrow
- **THEN** the attention card is not rendered and the dashboard layout shows no empty placeholder

#### Scenario: Attention card ignores period navigation

- **WHEN** the user switches the dashboard month while a plan is overdue
- **THEN** the attention card's contents are unchanged

#### Scenario: Category row opens the selected month's transactions

- **WHEN** the dashboard shows a month with expenses and the user activates a category row in the expense breakdown
- **THEN** an overlay opens listing that category's expense transactions for the selected month, with the period navigable inside the overlay, and the dashboard stays underneath

#### Scenario: Drill-down follows the selected month

- **WHEN** the user switches the dashboard month and then activates a category row
- **THEN** the overlay is scoped to the newly selected month

### Requirement: Dashboard period navigation

The dashboard SHALL provide month navigation: it opens on the current device-local month;
the backward step SHALL have no lower bound; the forward step SHALL be unavailable while
the selected month is the current month. Switching the month SHALL rescope every
month-scoped dashboard figure — the income and expense stat cards, the category
breakdown, and the recent transactions list — to the selected month. The selected month
SHALL NOT persist: opening the dashboard anew starts on the current month.

#### Scenario: Stepping to the previous month

- **WHEN** the user steps back from the current month
- **THEN** the month label shows the previous month, and the income stat, expense stat, category breakdown, and recent transactions show that month's figures

#### Scenario: Forward step bounded at the current month

- **WHEN** the selected month is the current month
- **THEN** the forward step is not offered

#### Scenario: Category breakdown follows the selected month

- **WHEN** the user selects a month other than the current one
- **THEN** the category breakdown lists that month's expenses by category

#### Scenario: Selection does not persist

- **WHEN** the user selects an earlier month and opens the dashboard again
- **THEN** the dashboard starts on the current month

### Requirement: Analytics screens

The web app SHALL provide the analytics overview screen and per-direction
detail screens satisfying the `analytics` capability requirements, with
web-native presentation (route-based detail navigation instead of mobile
screen pushes).

#### Scenario: Analytics overview on web

- **WHEN** the user opens the analytics screen for a month with expenses
  and income
- **THEN** the overview shows the direction summary cards with donut charts
  and legends per the analytics capability

#### Scenario: Detail screen by route

- **WHEN** the user selects a direction card (or opens the detail URL
  directly)
- **THEN** the per-direction detail screen opens with period selection and
  navigation per the analytics capability

### Requirement: Debts screens

The web app SHALL provide the debts screen satisfying the `debts`
capability: the two-direction list with summary cards, debtor history, debt
operation create/edit, and debtor creation. The overlay surfaces of the
screen (debtor form, debtor history, debt operation form) SHALL follow the
Mobile overlay presentation requirement: a bottom-sheet drawer on viewports
narrower than 768px and a centered dialog on viewports of 768px and wider.

#### Scenario: Debts list and history on web

- **WHEN** the user opens the debts screen and selects a debtor
- **THEN** the debtor's operation history and balance are shown, and the
  user can record or edit operations per the debts capability

### Requirement: Plans screens

The web app SHALL provide the plans screen satisfying the
`planned-payments` capability: the list of planned payments, plan
create/edit, and the confirm flow that generates a real transaction and
advances the plan.

#### Scenario: Confirm a planned payment on web

- **WHEN** the user confirms a due planned payment
- **THEN** a transaction is created from the plan and the plan advances to
  its next occurrence per the planned-payments capability

### Requirement: Quick income entry

The web app SHALL provide an income creation entry matching the mobile income
flow parity: creating an income transaction with account and category
selection in a minimal number of steps. The entry SHALL be the unified
transaction creation flow defined by the Transaction creation entry points
requirement (the income tab, or an income action in the command palette);
the dashboard SHALL NOT provide a dedicated income shortcut.

#### Scenario: Record income

- **WHEN** the user opens the unified creation flow with income preselected
  (income tab, command palette income action, or FAB speed-dial income tile
  below 768px) and submits the form
- **THEN** an income transaction is created locally and appears in the
  cashflow data

### Requirement: Transaction occurrence date at creation

The web forms for creating a transaction — expense, income, and transfer,
reached through any transaction creation entry point — SHALL offer a day-level
occurrence date choice that defaults to the moment the form was opened and
allows selecting any day, past or future. Changing the selected day SHALL
preserve the clock time captured when the form was opened, and the created
transaction's occurred-at SHALL carry the chosen day with that time.

#### Scenario: Back-dating an expense

- **WHEN** the user creates an expense with the occurrence date set to an earlier day
- **THEN** the created transaction occurs on the chosen day and appears under that date in history

#### Scenario: Untouched date defaults to now

- **WHEN** the user submits a creation form without changing the date
- **THEN** the transaction's occurred-at is the moment the form was opened

### Requirement: Inline account creation from the transaction form

Every account selector in the web transaction forms — the creation forms
(expense/income and transfer, the transfer form's from and to selectors
included) and the edit forms (cashflow, transfer, adjustment) — SHALL offer
a create-account action rendered next to the selector. Activating it SHALL
open an inline account creation dialog layered over the transaction dialog
without closing it; every value already entered in the transaction form
SHALL be preserved.

The inline dialog SHALL create an account through the same rules as the
accounts screen creation form: a required name, an opening balance in major
units that SHALL be non-negative and SHALL default to 0, and the app's
fixed creation currency (rubles). On successful creation the inline dialog
SHALL close, report success the same way the accounts screen creation does,
and the new account SHALL be immediately selectable without reloading. On
failure the dialog SHALL surface the error and stay available for retry.

After a successful inline creation the transaction form SHALL auto-select
the new account in the selector whose create-account action was used; other
selectors SHALL be left unchanged. With no accounts in the list, the
create-account action SHALL remain the visible path to completing the form
(no automatic opening, no auto-seeded account).

#### Scenario: Cold start with no accounts

- **WHEN** the user opens the transaction creation form with zero accounts
  and activates the create-account action next to the account selector
- **THEN** the inline account creation dialog opens over the transaction
  dialog, and creating an account auto-selects it in that selector, letting
  the transaction be completed without leaving the flow

#### Scenario: Mid-form creation preserves entered values

- **WHEN** the user has already entered an amount, date, or description and
  creates an account inline
- **THEN** the transaction form keeps all previously entered values and the
  new account is selected in the triggering selector

#### Scenario: Transfer form selectors

- **WHEN** the user activates the create-account action next to the from or
  the to selector of the transfer form and creates an account
- **THEN** the new account is auto-selected only in the selector whose
  action was used

#### Scenario: Edit forms

- **WHEN** the user edits a transaction and activates the create-account
  action next to an account selector
- **THEN** the inline dialog opens over the edit dialog and the created
  account is auto-selected in that selector

#### Scenario: Validation matches the accounts screen

- **WHEN** the user submits the inline dialog with an empty name or a
  negative opening balance
- **THEN** creation is rejected with the same validation behavior as the
  accounts screen creation form

#### Scenario: Creation failure is retryable

- **WHEN** the account creation request fails
- **THEN** the error is surfaced in the inline dialog, the dialog remains
  open, and the transaction form state is untouched

### Requirement: Account-less option in web transaction forms

The account selector of the expense and income creation forms and of the
cashflow edit form SHALL offer a distinct «Без счета» choice alongside the
account list. With «Без счета» selected, the form SHALL NOT require an
account, the amount's currency cue SHALL show the app's default currency,
and submission SHALL persist the transaction without an account reference.
The transfer form's from/to selectors and the adjustment edit form SHALL
NOT offer the choice. Selecting «Без счета» SHALL be remembered like any
other account choice where the form remembers the last-used account.

#### Scenario: Create an account-less expense

- **WHEN** the user selects «Без счета» in the expense creation form and submits a valid amount, category, and date
- **THEN** the transaction is created without an account reference, appears in the history, and no account balance changes

#### Scenario: Edit switches an expense to «Без счета»

- **WHEN** the user edits an accounted expense and selects «Без счета»
- **THEN** the update succeeds and the transaction no longer contributes to the account's balance

#### Scenario: Transfer form unchanged

- **WHEN** the user opens the transfer creation form
- **THEN** both account selectors list only real accounts and cannot be left without an account

### Requirement: Mobile parity principle

For the shared feature set, every domain action available in the mobile app
SHALL be available in the web app, with behavior governed by the same
capability specs. Navigation idioms SHALL be web-native (routes, links)
rather than imitations of mobile navigation. Presentation of modal overlay
surfaces SHALL be viewport-aware per the Mobile overlay presentation
requirement: on viewports narrower than 768px they use the mobile
bottom-sheet drawer idiom; on viewports of 768px and wider they use centered
dialogs.

#### Scenario: Parity of actions

- **WHEN** a domain action (create, edit, delete, confirm, resolve) is
  available for a shared feature on mobile
- **THEN** the equivalent action is available on the web screen for that
  feature

#### Scenario: Web-native navigation

- **WHEN** the user moves between screens or opens a detail view
- **THEN** navigation uses web routes (deep-linkable, back-button working)
  rather than modal-only flows

#### Scenario: Viewport-aware overlay presentation

- **WHEN** the same overlay surface (for example, debtor history) is opened
  on a phone viewport and on a desktop viewport
- **THEN** it is presented as a bottom-sheet drawer on the phone and as a
  centered dialog on the desktop

### Requirement: Mobile overlay presentation

On viewports narrower than 768px, the modal overlay surfaces of the shared
feature set — creation and edit forms, detail and history lists, and the
transactions filter panel — SHALL be presented as bottom-sheet drawers
anchored to the bottom edge, dismissible by swipe-down and by a close
affordance. On viewports of 768px and wider the same surfaces SHALL be
presented as centered dialogs. Destructive-confirmation dialogs SHALL remain
centered dialogs at every viewport. Inside a form drawer, the account,
category, and date picker rows SHALL open a picker drawer stacked above the
form drawer, and each picker SHALL change only its own field. While a stack
of drawers is open, the content of every drawer in the stack SHALL remain
exposed to the accessibility tree. Where another requirement names a dialog
or a modal without a viewport qualifier, its presentation SHALL follow this
requirement.

#### Scenario: Form opens as a drawer on a phone

- **WHEN** the user opens a creation or edit overlay at a viewport narrower
  than 768px
- **THEN** it is presented as a bottom-sheet drawer, and swipe-down or the
  close affordance dismisses it

#### Scenario: Centered dialog on desktop widths

- **WHEN** the same overlay is opened at a viewport of 768px or wider
- **THEN** it is presented as a centered dialog

#### Scenario: Destructive confirms stay centered

- **WHEN** a delete, leave, dissolve, or remove confirmation opens at a
  phone viewport
- **THEN** it is presented as a centered dialog, not a bottom-sheet drawer

#### Scenario: Picker opens stacked above the form

- **WHEN** the user activates the account, category, or date picker row
  inside a form drawer
- **THEN** a picker drawer opens stacked above the form drawer and only
  that field changes

#### Scenario: Drawer stack stays accessible

- **WHEN** a picker drawer is open above a form drawer
- **THEN** the content of both drawers remains exposed to the accessibility
  tree

#### Scenario: Filters open as a drawer on a phone

- **WHEN** the user opens the transactions filters at a viewport narrower
  than 768px
- **THEN** the filter panel is presented as a bottom-sheet drawer; at 768px
  and wider the side panel remains

### Requirement: Mobile navigation shell

On viewports narrower than 768px the web app SHALL present a mobile
navigation shell consisting of a persistent bottom tab bar and a central
floating action button. The tab bar SHALL offer exactly four primary
tabs — dashboard, plans, analytics, settings, in that order — split
around a central gap slot. Each tab SHALL navigate to its route
(deep-linkable, back-button working), and the active tab SHALL reflect
the current route. The FAB SHALL straddle the tab bar's top edge in the
central slot and, when activated, SHALL open a speed-dial offering three
actions — create expense, create transfer, create income — each opening
the existing creation flow for that kind; activating the FAB SHALL NOT
navigate or change the current screen. The shell SHALL respect safe-area
insets when displayed in standalone (PWA) mode. On viewports of 768px
and wider the shell SHALL NOT be displayed (the sidebar is used
instead).

#### Scenario: Tab navigates by route

- **WHEN** the user activates a tab in the bottom tab bar
- **THEN** the app navigates to that tab's route, the tab becomes active,
  and the screen is deep-linkable with a working back button

#### Scenario: Active tab follows the current route

- **WHEN** the user opens a detail route of a primary screen (for
  example, an analytics direction detail)
- **THEN** the tab of that primary screen is shown as active

#### Scenario: Speed-dial actions

- **WHEN** the user activates the FAB and picks one of the three
  speed-dial actions
- **THEN** the corresponding transaction creation flow (expense,
  transfer, or income) opens

#### Scenario: FAB does not navigate

- **WHEN** the user activates the FAB
- **THEN** the current screen remains displayed and no navigation occurs

#### Scenario: Shell absent on desktop widths

- **WHEN** the viewport is 768px or wider
- **THEN** the bottom tab bar, FAB, and mobile top bar are not displayed

### Requirement: Mobile top bar account access

On viewports narrower than 768px the web app SHALL present a slim
persistent top bar showing the app brand on the left and, on the right,
the synchronization status badge and the account access control. For a
signed-in user the account access control SHALL be an avatar menu
displaying the user's email and a sign-out action. For an anonymous user
the top bar SHALL instead show the guest-mode badge and a sign-in
action that navigates to the login screen. The synchronization and
guest-mode indicators SHALL each appear exactly once per viewport.

#### Scenario: Signed-in account menu

- **WHEN** a signed-in user opens the avatar menu in the mobile top bar
- **THEN** their email and a sign-out action are shown, and activating
  sign-out signs the user out

#### Scenario: Anonymous sign-in entry

- **WHEN** an anonymous user views the mobile top bar
- **THEN** the guest-mode badge and a sign-in action are shown, and
  activating sign-in navigates to the login screen

#### Scenario: Indicators are single-instance

- **WHEN** the user views any screen in the mobile shell
- **THEN** the synchronization status badge and the guest-mode indicator
  are each rendered exactly once

### Requirement: Transaction creation entry points

On viewports 768px and wider the web app SHALL provide a single unified
transaction creation flow — one creation form with expense, income, and
transfer tabs, presented as a centered modal (web-native presentation) — and
every desktop entry point SHALL open exactly that flow. The entry points
SHALL be: the persistent sidebar CTA with the localized label «Добавить
операцию» (the primary path, visually emphasized as the sidebar's main
action), a keyboard shortcut «N» that is ignored while the user is typing in
a text field, a command palette opened with ⌘K / Ctrl+K offering add actions
(create expense, create income, create transfer, new category) as an
accelerator, and a contextual create button on the transactions screen. The
command palette and the hotkey SHALL be accelerators; the sidebar CTA SHALL
remain sufficient on its own. On viewports narrower than 768px the entry
point SHALL be the FAB speed-dial per the Mobile navigation shell
requirement, which is unchanged by this requirement.

#### Scenario: Sidebar CTA opens the unified flow

- **WHEN** the user activates the sidebar CTA «Добавить операцию» at a
  desktop viewport
- **THEN** the unified creation flow opens as a centered modal with
  expense, income, and transfer tabs, without navigating away from the
  current screen

#### Scenario: Hotkey opens the unified flow

- **WHEN** the user presses «N» on any screen at a desktop viewport while not
  typing in a text field
- **THEN** the unified creation flow opens exactly as when the sidebar CTA is
  used, and pressing the key inside a text field types the character instead

#### Scenario: Command palette offers creation actions

- **WHEN** the user opens the command palette and activates an add action
  (create expense, create income, or create transfer)
- **THEN** the unified creation flow opens with the matching tab preselected,
  and a new-category action opens the existing category creation flow

#### Scenario: Contextual trigger on the transactions screen

- **WHEN** the user activates the create button on the transactions screen
- **THEN** the same unified creation flow opens

#### Scenario: Single flow across triggers

- **WHEN** the user adds a transaction from any desktop entry point
- **THEN** the created transaction is persisted through the same creation
  form and appears in the transaction data regardless of which entry point
  was used

### Requirement: Canonical web amount-entry behavior

Every web form control that edits money in major units SHALL use one shared
amount-entry interaction contract across the accounts, transactions,
reconciliation, debts, and plans screens. Positive-only flows SHALL reject
negative entry; flows that already require a signed monetary value SHALL
accept a leading `-` and expose that signed value directly.

While the field is focused, it SHALL present a raw numeric draft rather than
an editable currency-formatted string. The currency SHALL remain visible as a
non-editable cue associated with the field so the user can still tell which
currency is being edited. Keyboard-driven focus SHALL support immediate full-
value replacement, while pointer placement SHALL still allow in-place edits.

When the field loses focus with a valid value, it SHALL render the locale-
aware money display for that currency. The field SHALL accept common pasted or
manually entered formats that express the same amount, including `.` or `,`
as the decimal separator, optional grouping spaces, and pasted currency
symbols. The editable value SHALL still be constrained to two fractional
places. If the user leaves an invalid partial draft, the field SHALL restore
the last valid numeric value; if the user cleared the field, it SHALL remain
empty.

When a surrounding selector changes the active currency after an amount has
already been entered, the field SHALL keep the numeric value and update only
its currency cue and blurred formatting.

#### Scenario: Focused draft and blurred money formatting

- **WHEN** the user focuses a prefilled positive amount field such as opening
  balance, transaction amount, debt amount, plan amount, or reconcile balance
- **THEN** the focused field shows an editable numeric draft without an
  editable currency symbol, and blurring it renders the locale-aware money
  string for the same numeric value

#### Scenario: Keyboard focus enables quick replacement

- **WHEN** the user reaches a prefilled amount field through keyboard
  navigation and starts typing a new amount
- **THEN** the existing numeric value is replaced directly without requiring
  manual deletion of a currency symbol or a forced caret move to the end

#### Scenario: Formatted money paste is accepted

- **WHEN** the user pastes a formatted money string such as `1 234,56 ₽` or
  `$1,234.56` into a compatible amount field
- **THEN** the field keeps the equivalent numeric value, constrains it to two
  fractional digits, and blurs back to the locale-aware formatted money
  display

#### Scenario: Signed adjustment edit remains direct

- **WHEN** the user edits an existing adjustment transaction with a negative
  signed value such as `-4.50`
- **THEN** the adjustment edit form accepts that signed draft directly,
  preserves the sign through submission, and updates the account balance from
  the edited signed amount

#### Scenario: Currency changes do not clear the numeric value

- **WHEN** a transaction or reconcile form already contains an entered amount
  and the user changes the selected account so the active currency changes
- **THEN** the numeric amount remains entered, and only the currency cue and
  blurred money formatting switch to the newly selected currency

### Requirement: Account balance reconciliation

The web accounts screen SHALL offer a reconcile action («Сверить баланс»)
on each account. Activating it SHALL open a dialog that shows a target
balance input in the account's currency, prefilled with the account's
current computed balance. The dialog SHALL show a live preview of the
computed delta while the input differs from the current balance. Submitting
SHALL create an `adjustment` transaction carrying the delta (target minus
current balance) on that account via the regular transaction-creation
endpoint with an empty description; the dialog SHALL offer no note or
description input. A user who wants a description on the adjustment SHALL
add it afterwards by editing the transaction. When the entered target
equals the current balance, the dialog SHALL indicate that the balance is
already accurate and SHALL NOT offer submission. The reconcile dialog
SHALL be the only creation surface for adjustment transactions; the
generic add-transaction flow SHALL NOT offer an adjustment tab.

#### Scenario: Reconciling a lower actual balance

- **WHEN** an account's computed balance is 12000 and the user enters 11500
- **THEN** the preview shows that 500,00 will be deducted, and submitting creates an adjustment transaction of -500 with an empty description, after which the balance is 11500

#### Scenario: Reconciling a higher actual balance

- **WHEN** an account's computed balance is 1000 and the user enters 2500
- **THEN** the preview shows that 1500,00 will be added, and submitting creates an adjustment transaction of +1500

#### Scenario: Zero delta is a no-op

- **WHEN** the entered target equals the account's current balance
- **THEN** the dialog indicates the balance is accurate and creates no transaction

#### Scenario: No adjustment tab in the add-transaction flow

- **WHEN** the user opens the generic add-transaction dialog
- **THEN** it offers only income, expense, and transfer

### Requirement: Adjustment transactions in history and filters

The web transaction history SHALL render adjustment transactions with a
distinct badge («Корректировка»), their signed amount, and no category.
The transactions type filter SHALL offer adjustment as a fourth option,
and unfiltered listings SHALL include adjustment transactions by default.
Editing an existing adjustment transaction SHALL use a dedicated form
exposing the signed amount directly (not a target-balance input), the
description, the occurrence timestamp, and the account; deleting an
adjustment transaction SHALL behave like deleting any other transaction.

#### Scenario: Adjustment row in history

- **WHEN** the transaction history includes an adjustment of -500
- **THEN** the row shows the «Корректировка» badge, the amount -500,00, and no category

#### Scenario: Filtering by adjustment type

- **WHEN** the user selects the adjustment option in the type filter
- **THEN** the listing shows only adjustment transactions

#### Scenario: Editing an adjustment transaction

- **WHEN** the user edits an adjustment transaction and changes its amount from -500 to -700
- **THEN** the update succeeds and the account's balance reflects the new contribution

### Requirement: Account-less transactions in the web history and filters

Transaction rows of account-less income/expense transactions SHALL display
«Без счета» in place of the account name. The transactions screen account
filter SHALL offer a «Без счета» entry that selects account-less
transactions; combined with account entries it SHALL act as an additional
selected source, not an exclusive mode.

#### Scenario: Row displays the label

- **WHEN** the history list renders an account-less expense
- **THEN** the row shows «Без счета» where accounted rows show the account name

#### Scenario: Filter by «Без счета»

- **WHEN** the user selects «Без счета» in the transactions screen account filter
- **THEN** the list shows only transactions without an account reference

### Requirement: Transactions screen export action

The transactions screen header SHALL offer an export action that downloads
a CSV of exactly the transactions matching the active screen filters
(account multi-select including «Без счета», type, date range), through
the shared CSV export feature. The action SHALL reflect the filtered set
at the moment of activation.

#### Scenario: Export honors the active filters

- **WHEN** the user activates the export action with filters applied
- **THEN** the downloaded CSV contains only the transactions matching those filters

#### Scenario: Export with no filters

- **WHEN** the user activates the export action with no filters applied
- **THEN** the downloaded CSV contains every non-deleted transaction

### Requirement: Category management screen

The category management screen at `/settings/categories` SHALL list the
household's non-deleted categories grouped by type (expense, income),
each row showing the category's icon, color, name, and its transaction
count computed from the local data, with actions to edit, archive
(unarchive for archived ones), and delete. Archived categories SHALL be
shown in a separate collapsible archive section of the same screen. The
screen SHALL offer category creation through a «Создать» button in its
page header. The create dialog SHALL offer the type (expense or income,
chosen in the dialog and defaulting to expense), the name, and the icon
from the unified type-filtered icon set (expense icons for an expense
category, income icons for an income category); the color SHALL be
auto-assigned from the pre-paired icon-color set and SHALL NOT be
user-chosen. The edit dialog SHALL allow changing the name and icon only
- the color follows the icon through its pre-paired value, and the type
SHALL NOT be editable after creation. Creation from the transaction form
dialog and the command palette SHALL remain available. A category whose
stored icon is no longer part of the set SHALL still render its stored
icon and color, and the edit dialog SHALL let the user pick any icon of
the set without preselecting the removed one.

#### Scenario: Browse categories

- **WHEN** the user opens `/settings/categories`
- **THEN** active categories are listed grouped by type with icon, color, name, and transaction count, the archive section is available, and a «Создать» button is present in the page header

#### Scenario: Create a category

- **WHEN** the user activates the header «Создать» button and submits the dialog with a type, a name, and a picked icon
- **THEN** a category of the chosen type is created with an auto-assigned color and appears in its type group

#### Scenario: Icon list follows the chosen type

- **WHEN** the user toggles the type in the create dialog between expense and income
- **THEN** the offered icon list switches to the expense set or the income set respectively, and a default icon of that set is preselected

#### Scenario: Edit a category

- **WHEN** the user edits a category from the list
- **THEN** a dialog offers the name and the icons of the category's type; the type and the color are shown read-only

#### Scenario: Editing a category with a removed icon

- **WHEN** the user edits a category whose stored icon is not part of the current set
- **THEN** the dialog offers the icons of the category's type without preselecting any, and saving without a new pick keeps the stored icon while the color re-derives through the pre-paired walk

#### Scenario: Archived section

- **WHEN** archived categories exist
- **THEN** the archive section lists them with an unarchive action, and they are absent from the active groups

### Requirement: Category deletion dialog

The delete flow SHALL branch by the category's references. A category
with no transactions and no live planned payments SHALL be deleted after
a plain confirmation. A category with transactions but no live planned
payments SHALL be offered a choice: archive (the default) or cascaded
delete; the cascaded option SHALL state the number of transactions to be
deleted and that account balances will change, and SHALL require typing
the category's exact name to confirm. An archived category with
transactions SHALL go directly to the cascaded-delete confirmation
(without the archive option). A category referenced by a live planned
payment SHALL NOT be deletable; the dialog SHALL explain the blocking
plans.

#### Scenario: Delete an unused category

- **WHEN** the user deletes a category with no transactions and no live plans
- **THEN** a plain confirmation deletes the category

#### Scenario: Delete a category with transactions

- **WHEN** the user deletes a category referenced by 12 transactions and no live plans
- **THEN** the dialog offers archiving as the default and cascaded delete as the alternative, stating the 12 transactions and the balance impact

#### Scenario: Typed confirmation for cascaded delete

- **WHEN** the user chooses the cascaded delete of a category with transactions
- **THEN** the destructive action stays disabled until the category's exact name is typed

#### Scenario: Delete blocked by a live plan

- **WHEN** the user attempts to delete a category referenced by a live planned payment
- **THEN** the dialog reports the block instead of offering deletion
