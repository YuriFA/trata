## REMOVED Requirements

### Requirement: Ruble-only account creation in the apps

**Reason**: Multi-currency is restored. The account-creation currency
picker returns and the supported catalog widens; the presentation policy
it enforced is replaced by the requirements below.

**Migration**: No data migration - accounts keep their stored currency.
Account creation now offers the supported catalog (see the accounts
capability).

### Requirement: Currency-less aggregates display in rubles

**Reason**: Aggregates now follow the display-currency policy with
per-currency totals and approximate conversion, not a fixed RUB
presentation.

**Migration**: The per-device display-currency preference replaces the
fixed RUB presentation; debts gain a currency of their own (debts
capability), and planned payments inherit their account's currency.

### Requirement: Default currency is rubles across apps

**Reason**: RUB is no longer a presentation mandate; it remains only the
final fallback of the default-currency chain (locale proposal, household
base currency, RUB).

**Migration**: `@trata/money` keeps `DEFAULT_CURRENCY = RUB` as the
fallback constant; presentation follows the display-currency preference.

## ADDED Requirements

### Requirement: Display currency preference

Each app SHALL offer a local, per-device display-currency setting
selectable from the supported catalog. It SHALL default to the
household's base currency and SHALL affect presentation only - never
stored amounts. The setting SHALL live in the app's local settings (web
settings store, mobile settings screen) and SHALL NOT be synchronized.

#### Scenario: Defaults to the household's base currency

- **WHEN** a fresh device of a household whose base currency is EUR opens its settings
- **THEN** the display currency shows EUR without user action

#### Scenario: Changing the display currency re-renders aggregates

- **WHEN** the user switches the display currency from EUR to USD
- **THEN** aggregates present converted into USD immediately and no stored record changes

### Requirement: Account creation offers the catalog

The account creation forms of both apps SHALL offer every currency of
the supported catalog, preselecting the household's base currency. The
form SHALL submit the chosen currency with the created account.

#### Scenario: Picker with the household default

- **WHEN** the user opens account creation in a household with base currency RUB
- **THEN** the picker shows the full catalog with RUB preselected, and the created account carries the chosen currency

### Requirement: Per-currency aggregates with approximate conversion

Aggregates spanning more than one currency SHALL be presented as
per-currency totals plus a converted total in the display currency.
Every converted figure SHALL be visibly marked as approximate («≈»), and
aggregates screens SHALL show the rate's as-of date. Single-currency
aggregates SHALL be presented exactly, with no approximation mark.

#### Scenario: Mixed accounts summary

- **WHEN** the user views the accounts summary holding RUB and USD accounts with display currency RUB
- **THEN** each currency shows its own total and an additional «≈» converted total in RUB with the rate date

#### Scenario: Single-currency exactness

- **WHEN** every account shares the display currency
- **THEN** totals are shown without an approximation mark and without conversion

### Requirement: Native currency visibility

Transaction rows, account rows, and debtor balances SHALL present
amounts in their native currency: the account's currency, the debtor's
currency, or - for account-less amounts - the display currency. Native
amounts SHALL NOT be replaced by converted ones; conversion appears only
in aggregates.

#### Scenario: Transaction in a foreign-currency account

- **WHEN** the user views a transaction of a USD account with display currency RUB
- **THEN** the row shows the USD amount, and conversion appears only in aggregates

### Requirement: Locale-based proposal of the base currency

When a device encounters its household still on the server-default base
currency (RUB) while the device locale maps to a different catalog
currency, the app SHALL suggest switching the household's base currency
to the locale-derived one. The suggestion SHALL be shown once per device
until acted on or dismissed, and SHALL NOT block any flow.

#### Scenario: Turkish device after registration

- **WHEN** a user with a tr-TR device locale registers and their household was created with the default RUB
- **THEN** the app suggests switching the base currency to TRY, once, and proceeds normally if dismissed
