## MODIFIED Requirements

### Requirement: Debtor shape

A debtor SHALL have a non-empty name, an optional note, and a currency
from the supported currency catalog (defined by the accounts
capability). On create, an absent currency SHALL default to the
household's current base currency. The currency SHALL NOT be changeable
after creation: a debtor's ledger stays single-currency for its whole
life. A create or update request with a missing or empty name SHALL be
rejected. Note handling follows the shared optional-note rule below.

#### Scenario: Create a debtor

- **WHEN** the user creates a debtor with name "Анна" and an optional note
- **THEN** the debtor is created and appears in the user's debtor list

#### Scenario: Currency defaults to the household base

- **WHEN** a debtor is created without a currency in a household whose base currency is USD
- **THEN** the debtor carries USD

#### Scenario: Currency is immutable

- **WHEN** an update request attempts to change a debtor's currency
- **THEN** the request is rejected as invalid and the debtor is unchanged

#### Scenario: Empty name rejected

- **WHEN** the user submits a debtor with an empty name
- **THEN** the request is rejected with an invalid-payload error

### Requirement: Debt operation shape

A debt operation SHALL reference a debtor owned by the same user, carry
a direction (`receivable` — money owed to the user, or `payable` — money
the user owes), a kind (`debt` — the owed amount grows, or `repayment` —
the owed amount shrinks), a positive non-zero amount in minor units of
the debtor's currency (an operation carries no currency of its own and
inherits the debtor's), an occurred-at timestamp, and an optional note.
A request with a missing or invalid field, a non-positive amount, or a
reference to a nonexistent, foreign, or deleted debtor SHALL be
rejected. Note handling follows the shared optional-note rule below.

#### Scenario: Record a receivable debt

- **WHEN** the user records a `debt` operation for 5 000,00 ₽ in direction `receivable` on debtor "Анна" whose currency is RUB
- **THEN** the operation is created and Анна's receivable balance becomes 5 000,00 ₽

#### Scenario: Record a repayment

- **WHEN** the user records a `repayment` operation for 1 500,00 ₽ in direction `receivable` on debtor "Анна"
- **THEN** the operation is created and Анна's receivable balance decreases by 1 500,00 ₽

#### Scenario: Operation amounts are in the debtor's currency

- **WHEN** a debt operation of 5000 is recorded on a debtor whose currency is EUR
- **THEN** the operation's amount is €50.00 and the debtor's ledger sums in EUR

#### Scenario: Non-positive amount rejected

- **WHEN** a debt operation is submitted with amount 0 or a negative amount
- **THEN** the request is rejected with an invalid-payload error

#### Scenario: Unknown or deleted debtor reference rejected

- **WHEN** a debt operation references a debtor id that does not exist, belongs to another user, or has been deleted
- **THEN** the request is rejected with a debtor-not-found error
