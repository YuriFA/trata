# Transactions Specification

## Purpose

Money movement records a user creates, edits, and browses: income and
expense transactions against an account and category, transfers
between two accounts, and signed adjustment transactions that correct
an account's computed balance, with idempotent creation,
concurrency-safe updates, and stable pagination.

## Requirements

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

### Requirement: Account-less cashflow semantics

An income or expense transaction without an account reference («Без
счета») SHALL contribute to no account balance and SHALL NOT change any
account's computed balance on create, update, or delete. It SHALL appear in
transaction listings and in period income/expense totals and category
breakdowns on the same terms as any other income or expense transaction.
Updates SHALL be able to set the account reference of an account-less
income/expense transaction and to clear the account reference of an
accounted one, producing the balance effect of the resulting reference set.
Account-less amounts carry no currency of their own; clients display them
in the app's default currency.

#### Scenario: Balance stays untouched

- **WHEN** the user creates, edits, or deletes an account-less expense
- **THEN** every account balance is unchanged

#### Scenario: Included in period analytics

- **WHEN** the user views the expense total or category breakdown for a period containing account-less expenses
- **THEN** those amounts are included exactly like accounted expenses

#### Scenario: Assigning an account on edit

- **WHEN** the user edits an account-less expense and selects an account
- **THEN** the update succeeds and the account's balance now includes the transaction

#### Scenario: Clearing the account on edit

- **WHEN** the user edits an accounted expense and switches it to «Без счета»
- **THEN** the update succeeds and the account's balance no longer includes the transaction

### Requirement: Referenced entities must exist, belong to the user, and match the type

Every account or category referenced by a transaction SHALL exist and
belong to the requesting user's household; otherwise the create or update
SHALL be rejected with a not-found error for that reference. For income
and expense transactions the category's type SHALL match the transaction
type (an income transaction requires an income category; an expense
transaction requires an expense category), otherwise the request SHALL be
rejected with a category-type-mismatch error.

#### Scenario: Category type does not match transaction type

- **WHEN** an expense transaction references an income category
- **THEN** the request is rejected with a category-type-mismatch error and no transaction is stored

#### Scenario: Referenced account belongs to another user

- **WHEN** a transaction references an account or category that exists but
  belongs to a different household
- **THEN** the request is rejected with a not-found error, as if the
  reference did not exist

### Requirement: Transfers between distinct accounts

A transfer SHALL have a source and a destination account that are
different accounts; a transfer from an account to itself SHALL be
rejected with a same-account-transfer error.

#### Scenario: Transfer to the same account

- **WHEN** the user creates a transfer whose `fromAccountId` equals its `toAccountId`
- **THEN** the request is rejected with a same-account-transfer error

### Requirement: Idempotent creation

Creating a transaction SHALL support idempotency: when the client sends
an `Idempotency-Key` with the create request, a repeated request with
the same key and the same body SHALL return the original response
without creating a second transaction. A repeated request with the same
key but a different body SHALL be rejected with an idempotency-key
mismatch error. A concurrent request with the same key while the
original is still in flight SHALL be rejected with an
idempotency-key-in-use error. Stored keys expire after 24 hours; a key
used after expiry is treated as new.

#### Scenario: Network retry with the same key and body

- **WHEN** the client retries a transaction create with the same `Idempotency-Key` and the same body
- **THEN** the original response is replayed and no duplicate transaction is created

#### Scenario: Same key, different body

- **WHEN** a create request reuses an `Idempotency-Key` whose stored request body differs
- **THEN** the request is rejected with an idempotency-key mismatch error

### Requirement: Client-generated identifier on creation

A transaction create request MAY carry a client-generated UUID v4
identifier, and the system SHALL use it as the transaction's identifier;
this lets offline-created transactions later synchronize under their
local identifiers. A create whose identifier already exists for the user
SHALL be rejected with an already-exists error and SHALL NOT overwrite
the existing transaction. (Replay of already-applied creates is handled
by the sync protocol's operation idempotency, not by this rule.)

#### Scenario: Offline-created transaction keeps its id

- **WHEN** a transaction is created offline with client-generated identifier X and later synchronized
- **THEN** the transaction exists on the server under identifier X

#### Scenario: Duplicate client identifier

- **WHEN** a create request arrives with an identifier that already exists for the user
- **THEN** the request is rejected with an already-exists error and the existing transaction is unchanged

### Requirement: Optimistic concurrency on update

Updating a transaction SHALL require the client to send the `version`
it previously read. If the transaction was modified concurrently, the
update SHALL be rejected with a version-conflict error and the client
SHALL refetch and retry. A successful update increments the version.
An update request that changes no fields SHALL be rejected.

#### Scenario: Concurrent edit

- **WHEN** two clients update the same transaction, both sending the version they read before either write landed
- **THEN** the first update succeeds and the second is rejected with a version conflict

#### Scenario: Empty update

- **WHEN** a PATCH request contains no updatable fields (only the required version)
- **THEN** the request is rejected and the transaction is unchanged

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

### Requirement: Deletion

A user SHALL be able to delete their own transaction. Deletion SHALL be
soft: the transaction is marked as deleted (a tombstone), its
contribution is removed from account balances, and it is excluded from
all listings; the tombstone is retained so synchronized devices learn of
the deletion. Deleting a nonexistent or other user's transaction SHALL
return not-found.

#### Scenario: Delete affects the balance

- **WHEN** the user deletes an expense transaction
- **THEN** the transaction is tombstoned, no longer listed, and the account's balance no longer includes its amount

#### Scenario: Other devices learn of the deletion

- **WHEN** a transaction is deleted on one device
- **THEN** other devices receive the tombstone via the change feed and their copies stop contributing to balances and listings

### Requirement: Cursor-paginated listing

Listing transactions SHALL return them newest-first by occurrence
timestamp, with ties broken by id, in pages navigated by an opaque
cursor. The response SHALL include a cursor for the next page, which is
null when no more pages exist. The list MAY be filtered by transaction
type, account, category, and an inclusive occurrence-date range, and
the page size is bounded (default 50, maximum 100). An invalid cursor
SHALL be rejected. Only the requesting user's transactions are
returned.

#### Scenario: Paging through history

- **WHEN** the user requests the transaction list and passes the returned next-cursor on subsequent requests
- **THEN** each response returns the next page in the same order, until a response with a null next-cursor

#### Scenario: Filtering by account and date range

- **WHEN** the list request filters by account and an inclusive from/to date range
- **THEN** only that account's transactions occurring within the range are returned
