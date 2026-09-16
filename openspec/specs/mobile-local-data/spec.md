# Mobile Local Data Specification

## Purpose

The mobile app's on-device data layer: a local database is the source of
truth for the UI, user operations work fully offline through the shared
repository contracts, and every mutation leaves a persistent pending
operation for later synchronization with the backend.

## Requirements

### Requirement: Local database is the source of truth

The mobile app SHALL store accounts, categories, and transactions in an
on-device database. All reads and writes by the app SHALL go through that
database, and the UI SHALL NOT depend on network availability to display
or modify data.

#### Scenario: Fresh install with no connectivity

- **WHEN** the app starts for the first time with no network connection
- **THEN** the user can create accounts, categories, and transactions, and all data is retained after an app restart

### Requirement: User operations never require the network

Every create, update, delete, and list operation SHALL complete locally
and update the UI immediately. The success of a user operation SHALL NOT
depend on connectivity or on any backend response.

#### Scenario: Create a transaction in airplane mode

- **WHEN** the user creates an expense transaction while offline
- **THEN** the transaction is stored locally, the visible balances update immediately, and the operation succeeds without any network exchange

### Requirement: Domain rules enforced locally

Local mutations SHALL enforce the same domain rules and error semantics
as the backend: household-unique category names, deletion guards for
accounts and categories referenced by transactions, category type
matching on cashflow transactions, distinct source and destination
accounts for transfers, and valid references. Violations SHALL be
reported with the shared machine-readable error codes. Mutating a
locally deleted (tombstoned) record SHALL be rejected with a not-found
error and SHALL NOT enqueue a sync operation.

#### Scenario: Offline deletion of an account in use

- **WHEN** the user deletes an account that local transactions reference
- **THEN** the deletion is rejected with the account-in-use error code

#### Scenario: Offline category type mismatch

- **WHEN** the user records an expense referencing an income category while offline
- **THEN** the operation is rejected with the category-type-mismatch error code

#### Scenario: Edit after local delete

- **WHEN** the user edits a record that was deleted locally and not yet synchronized
- **THEN** the operation is rejected with the not-found error code and no sync operation is queued for it

### Requirement: Version and sync state per record

Each stored record SHALL carry a local logical revision (`version`) and
the last server-confirmed revision (`server_version`). A record SHALL be
CLEAN iff the two are equal and DIRTY iff the local revision is greater.
A local mutation SHALL increment only the local revision. When the server
confirms a pushed operation, the server-confirmed revision SHALL be set
to the revision returned by the server; if other pending operations
remain for the record, the record stays DIRTY, otherwise the local
revision is set equal to the confirmed revision and the record is CLEAN.

#### Scenario: Offline edits keep the record dirty

- **WHEN** a record confirmed at server revision 5 is edited twice offline
- **THEN** its local revision is 7, its server-confirmed revision is 5, and it is DIRTY

#### Scenario: Clean after the last confirmation

- **WHEN** the last pending operation for a record is confirmed with server revision 7
- **THEN** the server-confirmed revision and the local revision both equal 7 and the record is CLEAN

#### Scenario: Coalesced confirmation realigns the local revision

- **WHEN** three offline edits (local revision 8, server-confirmed revision 5) are pushed as a single coalesced operation and the server confirms it at revision 6
- **THEN** the local revision is set to 6 to match the server-confirmed revision and the record is CLEAN, not left dirty at 8 despite the queue being empty

### Requirement: Pending operation for every mutation

Every local create, update, or delete SHALL atomically persist both the
record change and a pending sync operation in a single database
transaction. A pending operation SHALL carry a unique operation id, the
entity and record id, the operation kind (upsert or delete), the full
record payload, and the base revision captured at creation time (the
last server-confirmed revision when the operation is created, never the
local revision).

#### Scenario: Mutation and queue write are atomic

- **WHEN** a mutation is interrupted before the sync operation is durably recorded
- **THEN** neither the record change nor the queued operation exists; a changed record never exists without its pending operation

#### Scenario: Base revision is captured at creation

- **WHEN** an operation is created while the server-confirmed revision is 5 and the record is later edited again, raising the local revision to 7
- **THEN** the operation still carries base revision 5

### Requirement: Confirmed operations are removed individually

The sync queue SHALL remove exactly those operations the server confirmed
as applied, matched by operation id. An operation created while an
earlier operation for the same record is still in flight SHALL remain
pending and SHALL NOT be removed by the confirmation of that earlier
operation.

#### Scenario: Edit during in-flight push

- **WHEN** operation A for a record at server-confirmed revision 5 is being pushed, the user edits the record (creating operation B), and the server confirms A as applied at revision 6
- **THEN** only A is removed from the queue, the record's server-confirmed revision becomes 6, its local revision stays 7, and B remains pending

### Requirement: Coalescing unsent operations

Before a push, multiple not-yet-sent operations for the same record SHALL
be coalesced into one operation carrying the full current record state,
the base revision of the first operation in the group, and a stable
operation id reused across retries. Operations created during an
in-flight push form a new group and are not coalesced with it. A record
created and deleted locally without ever being confirmed by the server
SHALL leave no pending operation.

#### Scenario: Three offline edits push as one operation

- **WHEN** a record is edited three times offline and then synchronized
- **THEN** a single operation containing the final state is pushed with the base revision captured before the first edit

#### Scenario: Create then delete before first sync

- **WHEN** a category is created and deleted offline before any synchronization
- **THEN** no operation for it exists in the queue and nothing is ever sent for it

### Requirement: Sync status visibility

The app SHALL display the current synchronization state while signed in:
unresolved conflicts first, then operations the server is rejecting, the
paused (auth expired) state, the in-flight cycle, the pending outbox count,
and the settled synced state. Operations whose last push attempt produced a
per-item error result SHALL be shown as a distinct failing state - not as
plain pending.

#### Scenario: Server-rejected operations visible as failing

- **WHEN** queued operations are being rejected by the server on every push
  attempt (per-item error results, e.g. a domain-rule violation)
- **THEN** the sync status indicator shows a failing state with the count of
  rejected operations, distinct from the pending state

#### Scenario: Settings sync card distinguishes rejected operations

- **WHEN** the settings sync card is visible and some queued operations are
  being rejected by the server
- **THEN** the card reports the rejected count as an error alongside the
  pending outbox state

### Requirement: Home screen data behavior

The home screen SHALL derive entirely from local data: total expenses for
the selected month grouped by category, the full list of expenses for the
selected month, and three balance modes — month expenses, month balance
(income minus expenses, transfers excluded), and total balance across
accounts. The selected month SHALL be the device's local calendar month:
a transaction belongs to the selected month iff its occurred-at instant
falls within that calendar month in the device's local timezone, and this
attribution SHALL be consistent across every month-scoped figure the home
screen shows (category totals, expense lists, month expenses, month
balance). The category list SHALL start empty on a fresh install, and a
category SHALL be created with a name, a type, and an icon chosen from
the predefined emoji list of that type; the circle background color SHALL
be auto-assigned from the icon's pre-paired color and SHALL NOT be
user-chosen.

#### Scenario: Month totals without connectivity

- **WHEN** the user opens the home screen offline after recording expenses in the selected month
- **THEN** per-category totals, the expense list, and all three balance modes are rendered from local data

#### Scenario: Transaction at a month boundary

- **WHEN** a transaction occurs at 00:30 local time on the first day of a month
- **THEN** it is attributed to the new month in every month-scoped figure on the home screen and to neither figure of the previous month

#### Scenario: Fresh install category list

- **WHEN** the app is freshly installed and the user opens the category creation sheet
- **THEN** the category list is empty and a new category can be created by choosing a name, type, and icon from the predefined list, with the color auto-assigned from the icon

#### Scenario: Category icon created on the web app

- **WHEN** a category created on the web app with an emoji icon is synced to the device
- **THEN** the category renders its emoji icon and pre-paired color like a locally created category

#### Scenario: Legacy Ionicons icon from an earlier mobile version

- **WHEN** a category created by an earlier mobile version stores an Ionicons glyph name as its icon
- **THEN** the device displays a mapped emoji icon instead of a blank glyph, without rewriting the stored value

### Requirement: Income screen data behavior

The income screen SHALL derive entirely from local data and scope every
figure to income: the summary figure SHALL be the income total for the
selected month (the home screen's balance modes are not offered), the
income list SHALL cover the month's incomes grouped by day, and the
category breakdown SHALL show per-category income totals for the month.
Expenses and transfers SHALL be excluded from every figure on this screen,
and only income-type categories SHALL appear in its category breakdown. The
selected month SHALL follow the same attribution as the home screen: the
device's local calendar month, consistent across every month-scoped figure,
navigable to previous and next months. The screen SHALL be reachable via an
enabled «Доходы» quick action on the home screen, and category creation
started from the income screen SHALL default to the income type (the type
choice remains available).

#### Scenario: Income totals without connectivity

- **WHEN** the user opens the income screen offline after recording incomes in the selected month
- **THEN** the month income total, the day-grouped income list, and the per-category income totals are rendered from local data

#### Scenario: Expenses and transfers are excluded

- **WHEN** the selected month contains expenses and transfers alongside incomes
- **THEN** no figure on the income screen includes them — the summary total, the income list, and every category total count income transactions only

#### Scenario: Transaction at a month boundary

- **WHEN** an income occurs at 00:30 local time on the first day of a month
- **THEN** it is attributed to the new month in every month-scoped figure on the income screen and to neither figure of the previous month

#### Scenario: Month navigation rescopes every figure

- **WHEN** the user navigates to the previous or next month on the income screen
- **THEN** the summary total, the income list, and the category breakdown all re-scope to the newly selected month

#### Scenario: Income categories only

- **WHEN** the user opens the income screen and expense-type categories exist
- **THEN** the category breakdown lists only income-type categories, and a category created from the income screen defaults to the income type

#### Scenario: Quick action opens the income screen

- **WHEN** the user taps the «Доходы» quick action on the home screen
- **THEN** the income screen opens showing the selected month's income total

### Requirement: Debts screen behavior

The debts screen SHALL derive entirely from local data: the two direction
totals («Мне должны» / «Я должен»), the per-debtor balances, and the
operation history SHALL be computed from the local debtors and debt
operations via the local repository. Balances SHALL follow the debts
capability's derivation (per-debtor per-direction sums, no netting across
directions). Creating, editing, and deleting debtors and debt operations
SHALL be available offline through the local repository and SHALL converge
via sync. The screen SHALL be reachable via an enabled «Долги» quick action
on the home screen, which replaces the «Цели» action; the goals placeholder
screen SHALL be removed. Debtors whose balance is zero in a direction SHALL
be hidden from that direction's section by default behind an explicit
reveal affordance, and visible debtors SHALL be sorted by balance
descending. The two direction sections SHALL always render — an empty
section shows its hint («Вам никто не должен» / «Вы никому не должны»)
together with the section's creation affordance; there is no separate
empty-state placeholder. Creating a new debtor together with their initial
debt SHALL be a single per-section flow whose direction comes from the
section («Кто должен» / «Кому должен»); debt operations for an existing
debtor SHALL be recorded from that debtor's history sheet. The screen
SHALL NOT offer period switching (debts are not month-scoped) and SHALL
NOT include an all-operations card.

#### Scenario: Debt figures without connectivity

- **WHEN** the user opens the debts screen offline after recording debtors and operations
- **THEN** both direction totals and every debtor row render from local data, and recording a new operation works without connectivity

#### Scenario: Sections split by direction

- **WHEN** Анна owes the user 5 000,00 ₽ and the user owes Сергей 2 000,00 ₽
- **THEN** Анна appears only in «Мне должны» with 5 000,00 ₽, Сергей only in «Я должен» with 2 000,00 ₽, and the summary shows both totals separately

#### Scenario: Fully repaid debtor is hidden until revealed

- **WHEN** a debtor's balance in a direction reaches zero through a repayment
- **THEN** the debtor disappears from that section, and a reveal affordance shows the count of hidden (settled) debtors and lists them on demand

#### Scenario: Quick action opens the debts screen

- **WHEN** the user taps the «Долги» quick action on the home screen
- **THEN** the debts screen opens showing the two direction totals and the two debtor sections

#### Scenario: Debtor created with an initial debt

- **WHEN** the user taps the «+» affordance in a direction section («Мне должны» / «Я должен»)
- **THEN** a single form titled by the direction («Кто должен» / «Кому должен») creates the debtor and their initial debt in that direction in one submit: a name, a positive amount entered as digits, and a date

#### Scenario: Debtor history sheet

- **WHEN** the user taps a debtor row
- **THEN** a sheet opens showing the debtor's remaining balance in that direction and the day-grouped operation history labeled by kind («Долг» / «Списание»), with a «Новая операция» action that opens the operation form for that debtor and direction, a rename affordance, and a destructive delete-debtor action

#### Scenario: Operation form

- **WHEN** the user records a debt operation from a debtor's history sheet
- **THEN** the form fixes the debtor and direction as static context rows, offers a Долг ↔ Списание kind switch (Долг by default), and offers a positive amount entered as digits and a date through a one-row action toolbar with expandable quick dates

#### Scenario: Over-repayment is warned, not blocked

- **WHEN** the user records a repayment larger than the debtor's remaining balance in that direction
- **THEN** the form shows a warning but accepts the operation, and the resulting balance reflects the over-repayment

#### Scenario: Debtor deletion cascades offline

- **WHEN** the user deletes a debtor that has live (non-deleted) debt operations in the local repository
- **THEN** a confirmation shows the number of operations and warns when the balance is non-zero, and confirming tombstones the debtor and its live operations offline in one local transaction that later synchronizes per the debts capability's deletion rules

### Requirement: Plans screen data behavior

The plans screen SHALL derive entirely from local data: the per-type plan
counts, the normalized monthly totals, the plan lists, and overdue
detection SHALL be computed from the local planned payments via the
local repository. The normalized monthly total of a type SHALL convert
each live plan's amount to a monthly figure (monthly as-is; yearly
divided by 12; weekly multiplied by 52/12; daily multiplied by 365/12)
and sum the results. The screen SHALL present two cards — «Расходы»
(Подписки, платежи по кредитам и прочее) and «Доходы» (Зарплата, премии
и прочее) — each showing its live plan count and normalized monthly
total. Tapping a card SHALL open a sheet with that type's live plans as
a flat list sorted by next-due ascending (overdue plans come first,
badged as overdue); each row SHALL show the plan's name or, when
unnamed, its category's name, the amount, a regularity label, and the
next-due date, and the sheet SHALL carry a bottom «Добавить
расход/доход» action above the bottom safe area. Tapping a row SHALL open an edit sheet with the
same form plus deletion. The add/edit form SHALL fix the plan's type
from the card and offer a positive amount entered as digits with the
selected account's currency shown beside the input, an optional name,
a required account («Счёт списания» for expenses, «Счёт зачисления»
for incomes), a required type-matched category, a next-due date
chosen from a calendar (past dates allowed), a regularity choice
(день / неделя / месяц / год), a confirmation-mode choice (ручное /
авто), a reminder choice (выкл / за день / в день), and an optional
note. The form SHALL render the account, category, date, regularity,
confirmation-mode, reminder, and note fields as one-line rows with the
label on the left and the current value on the right; tapping a row
SHALL open that field's picker sheet (the note row SHALL focus its
input), and the sheet content SHALL keep bottom safe-area padding. Creating, editing, and deleting plans SHALL be available offline
through the local repository and SHALL converge via sync; deleting an
account or category referenced by live local plans SHALL be rejected
locally with the corresponding in-use error. Manually confirming a plan
SHALL open a confirm sheet with an editable amount (defaulting to the
plan's amount, shown with the account's currency), an editable date
(defaulting to the occurrence's scheduled date), and an optional note,
with the account and category fixed as context; the confirm sheet
SHALL use the same one-line row layout and safe-area bottom padding as
the add/edit form; submitting SHALL create the transaction and advance
the plan in one local transaction, per the planned-payments capability's
manual-confirmation rules. The screen SHALL replace the «Планы» tab
placeholder and SHALL NOT touch the home screen or analytics.

#### Scenario: Plans figures without connectivity

- **WHEN** the user opens the plans screen offline after creating plans
- **THEN** both cards show their counts and monthly totals from local data, and creating a new plan works without connectivity

#### Scenario: Monthly normalization

- **WHEN** the user has an expense plan of 599,00 ₽ monthly and another of 6 000,00 ₽ yearly
- **THEN** the «Расходы» card shows 2 plans totaling 1 099,00 ₽/мес

#### Scenario: Overdue plans sort first

- **WHEN** one expense plan is overdue and another is due next month
- **THEN** the overdue plan is listed first with an overdue badge, ahead of the future one

#### Scenario: Unnamed plan row shows its category

- **WHEN** a plan has no name and references category "Развлечения"
- **THEN** its row title is the category name "Развлечения"

#### Scenario: Confirm sheet adjusts the amount

- **WHEN** the user opens the confirm sheet for a 2 400,00 ₽ utilities plan and submits with the amount changed to 2 650,00 ₽
- **THEN** a 2 650,00 ₽ transaction is created locally, the plan advances one period, and both later converge via sync

#### Scenario: Local in-use guard

- **WHEN** the user deletes an account that a live local plan references
- **THEN** the deletion is rejected locally with an account-in-use error

### Requirement: Planned payment reminders

The mobile app SHALL schedule local notifications for plans whose
reminder setting is not `off`: a `day_before` reminder fires the day
before the occurrence's scheduled date and an `on_day` reminder fires on
it, both at 10:00 device-local time. Reminders SHALL be rescheduled from
the current live local plans whenever plans change locally or a sync
pull delivers plan changes; a deleted plan (locally or via pull) SHALL
have its pending reminders canceled, and no reminder SHALL be scheduled
for a date already in the past. Reminder copy SHALL reflect the
confirmation mode — an `auto` plan's reminder announces the upcoming
charge, a `manual` plan's reminder prompts the user to confirm it.
Notification permission SHALL be requested when the user first enables a
reminder; when permission is denied, reminders silently do not fire
while the setting is stored and synced. Reminders are scheduled
independently on each device from its local data — there is no server
push.

#### Scenario: Reminder fires the day before

- **WHEN** a manual plan with reminder `day_before` is due on September 5 and the app is closed
- **THEN** the device shows a local notification on September 4 at 10:00 local time prompting the user to confirm the payment

#### Scenario: Denied permission degrades silently

- **WHEN** the user declines notification permission and keeps a plan with reminders enabled
- **THEN** no notification fires, the app keeps working, and the reminder setting is stored and synced like any other field

#### Scenario: Editing a plan moves its reminder

- **WHEN** the user changes a plan's next-due date from the 5th to the 20th
- **THEN** the pending reminder is rescheduled to match the new date

#### Scenario: Deleting a plan cancels its reminder

- **WHEN** the user deletes a plan that has a pending reminder
- **THEN** the reminder is canceled and never fires

#### Scenario: A pulled plan gets a reminder on the second device

- **WHEN** a plan with reminders enabled is created on one device and synchronized to another
- **THEN** the second device schedules its own local reminder from the pulled data

### Requirement: Archived categories in local data

The local database SHALL store each category's archived-at timestamp
received via sync or local mutation. Category pickers and any surface
offering a category for a new or edited transaction SHALL exclude
archived categories; transactions and period breakdowns that already
reference archived categories SHALL keep displaying them. Local
validation SHALL reject creating or re-categorizing a transaction to an
archived category with the shared archived-category error code, mirroring
the backend.

#### Scenario: Picker excludes archived categories

- **WHEN** the user opens the category picker on the transaction form and an archived category exists
- **THEN** the archived category is not offered

#### Scenario: Offline archived-category rejection

- **WHEN** the user records a transaction referencing an archived category while offline
- **THEN** the operation is rejected with the archived-category error code

#### Scenario: History keeps archived categories

- **WHEN** the user views per-category lists or period breakdowns containing transactions of an archived category
- **THEN** the archived category and its transactions are displayed

### Requirement: Account-less cashflow records in local data

The local mirror SHALL accept, persist, and serve income and expense
transactions without an account reference: local validation SHALL skip the
account existence check when no account is referenced (the category remains
required), pushed upserts for such records SHALL be valid, and pulled
account-less rows SHALL persist with the reference absent. Such
transactions SHALL contribute to no locally computed account balance while
remaining visible in history and period analytics. Mobile forms continue
to require an account until their own change; this requirement covers the
data layer only.

#### Scenario: Pull an account-less row on mobile

- **WHEN** the mobile device pulls a change feed containing an account-less expense
- **THEN** the transaction is stored locally, shown in history and analytics, and excluded from account balances

#### Scenario: Local validation accepts account-less cashflow

- **WHEN** a data-layer operation writes an income transaction with a valid category and no account
- **THEN** the write is accepted under the same rules as the backend
