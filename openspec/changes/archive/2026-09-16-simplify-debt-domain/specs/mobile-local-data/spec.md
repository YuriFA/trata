## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Debts screen data behavior

**Reason**: Replaced by "Debts screen behavior": the contact entity
disappears from the screen's flows, note inputs are removed, and the
offline deletion guard is replaced by a confirmed cascade delete.
