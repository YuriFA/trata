## MODIFIED Requirements

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
