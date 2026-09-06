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

#### Scenario: Category row opens the selected month's transactions

- **WHEN** the dashboard shows a month with expenses and the user activates a category row in the expense breakdown
- **THEN** an overlay opens listing that category's expense transactions for the selected month, with the period navigable inside the overlay, and the dashboard stays underneath

#### Scenario: Drill-down follows the selected month

- **WHEN** the user switches the dashboard month and then activates a category row
- **THEN** the overlay is scoped to the newly selected month
