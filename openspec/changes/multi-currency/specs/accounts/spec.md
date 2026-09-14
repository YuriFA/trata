## MODIFIED Requirements

### Requirement: Account creation

A user SHALL be able to create an account with a name, a currency, and
an opening balance. The supported currency catalog is: USD, EUR, RUB,
TRY, GEL, KZT, UAH, AMD, AZN, UZS, KGS, RSD, ILS, AED, THB, CNY, PLN,
GBP. All catalog currencies are two-decimal, and money remains int64
minor units (divisor 100) in every one of them; a request with any other
currency SHALL be rejected. Money values MAY be negative (e.g. a debt
card with a negative opening balance).

#### Scenario: Create an account

- **WHEN** the user creates an account named "Cash" in USD with an opening balance of 5000 (i.e. $50.00)
- **THEN** the account is created and its balance equals 5000 until transactions change it

#### Scenario: Every catalog currency is accepted

- **WHEN** accounts are created in previously unsupported catalog currencies (e.g. TRY, GEL, KZT)
- **THEN** each account is created and carries that currency

#### Scenario: Unsupported currency

- **WHEN** an account is created with currency JPY (not in the catalog)
- **THEN** the request is rejected

### Requirement: Server-computed balance

The account balance SHALL be computed by the system as
`opening balance + net transaction contribution`, where income adds its
amount, expense subtracts it, a transfer subtracts its source amount
from the source account and adds its destination amount to the
destination account (the two amounts are equal for same-currency
transfers), and an adjustment adds its signed amount. Clients never send
the balance; updates to transactions are reflected in the computed
balance.

#### Scenario: Balance after transactions

- **WHEN** an account with opening balance 10000 receives an income transaction of 2500 and an expense transaction of 400
- **THEN** the account's balance is 12100

#### Scenario: Transfer moves value between accounts

- **WHEN** a transfer of 3000 is created from account A to account B
- **THEN** account A's balance decreases by 3000 and account B's balance increases by 3000

#### Scenario: Cross-currency transfer moves value

- **WHEN** a transfer from a RUB account carries source amount 3500 and destination amount 4000 into a USD account
- **THEN** the RUB account's balance decreases by 3500 and the USD account's balance increases by 4000

#### Scenario: Reconciliation via adjustment transaction

- **WHEN** the user reconciles an account whose computed balance is 12000 by creating an adjustment transaction of -500
- **THEN** the account's balance is 11500
