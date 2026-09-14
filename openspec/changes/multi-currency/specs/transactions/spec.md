## MODIFIED Requirements

### Requirement: Transaction types and reference shape

The system SHALL support four transaction types: `income`, `expense`,
`transfer`, and `adjustment`. Income and expense transactions SHALL
reference exactly one category, MAY reference exactly one account, and
SHALL carry a positive amount; an income or expense transaction with no
account reference («Без счета») SHALL be valid. Transfer transactions
SHALL reference exactly one source (`from`) and one destination (`to`)
account, SHALL NOT reference a category, and SHALL carry a positive
source amount. When the source and destination accounts' currencies
differ, a transfer SHALL additionally carry a positive destination
amount in the destination account's currency; when the currencies match,
the destination amount SHALL NOT be carried. The destination-amount rule
SHALL be validated against the effective account references on every
create and update of a transfer. Adjustment transactions SHALL reference
exactly one account, SHALL NOT reference a category or any transfer
account, and SHALL carry a nonzero signed amount (negative lowers the
account balance, positive raises it). The reference shapes SHALL be
mutually exclusive; a request mixing or omitting the required
references, or violating the amount sign or destination-amount rules for
its type, SHALL be rejected as invalid.

#### Scenario: Income transaction with account and category

- **WHEN** the user creates an income transaction with an amount, an account, and a category
- **THEN** the transaction is stored with those references and contributes its amount to that account's balance

#### Scenario: Expense without an account

- **WHEN** the user creates an expense transaction with an amount and a category but no account reference
- **THEN** the transaction is stored with no account reference and is valid; it contributes to no account balance and appears in listings and period/category analytics like any expense

#### Scenario: Account-less income with no category

- **WHEN** an income or expense request omits both the account and the category
- **THEN** the request is rejected with an invalid-references error: the category is required even without an account

#### Scenario: Adjustment transaction contributes its signed amount

- **WHEN** the user creates an adjustment transaction of -7500 on an account
- **THEN** the transaction is stored with only that account reference and no category, and the account's balance decreases by 7500

#### Scenario: Adjustment with forbidden references

- **WHEN** an adjustment request includes `categoryId`, `fromAccountId`, or `toAccountId`, or omits `accountId`
- **THEN** the request is rejected with an invalid-references error and no transaction is stored

#### Scenario: Adjustment with a zero amount

- **WHEN** an adjustment request carries an amount of zero
- **THEN** the request is rejected with an invalid-amount error and no transaction is stored

#### Scenario: Transfer with wrong reference pair

- **WHEN** a transfer request includes `accountId` or `categoryId`, or a cashflow request includes `fromAccountId`/`toAccountId`, or a transfer omits one of its required accounts
- **THEN** the request is rejected with an invalid-references error and no transaction is stored

#### Scenario: Cross-currency transfer carries both amounts

- **WHEN** a transfer is created from a USD account with amount 5000 ($50.00) to a EUR account with destination amount 4600 (€46.00)
- **THEN** the transfer is stored with both amounts, and the effective rate is derivable from them

#### Scenario: Cross-currency transfer without destination amount rejected

- **WHEN** a transfer between accounts of different currencies is submitted without a destination amount
- **THEN** the request is rejected as invalid and no transaction is stored

#### Scenario: Same-currency transfer with destination amount rejected

- **WHEN** a transfer between two RUB accounts is submitted with a destination amount
- **THEN** the request is rejected as invalid

#### Scenario: Negative amount on a non-adjustment type

- **WHEN** an income, expense, or transfer request carries a negative amount or a negative destination amount
- **THEN** the request is rejected as invalid; signed amounts are allowed only for the adjustment type

### Requirement: Transaction type is immutable

The type of an existing transaction SHALL NOT be changeable. Updates
may modify the amount, description, occurrence timestamp, the
references appropriate for the existing type and, for transfers between
accounts of different currencies, the destination amount; the effective
reference set and amount rule after the update SHALL satisfy the same
rules as creation.

#### Scenario: Changing references of a cashflow transaction

- **WHEN** the user moves an expense transaction to a different expense category and account
- **THEN** the update succeeds if the new references are valid, and fails with a not-found or type-mismatch error if they are not

#### Scenario: Editing a cross-currency transfer

- **WHEN** the user edits the destination amount of a transfer between accounts of different currencies
- **THEN** the update succeeds and the destination account's balance reflects the new destination amount
