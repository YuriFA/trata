# Accounts Specification

## Purpose

The financial accounts a user tracks (e.g. cash, bank cards) with a
currency and an opening balance, whose current balance the system
computes from the account's transactions.

## Requirements

### Requirement: Account ownership and scoping

Every account SHALL belong to exactly one household. Reading, updating, or
deleting an account of a household the requester does not belong to SHALL
behave as if the account does not exist (not-found), never revealing its
data.

#### Scenario: Accessing another user's account

- **WHEN** a user requests an account id that belongs to a household they
  are not a member of
- **THEN** the response is not-found, with no account data revealed

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

### Requirement: Client-generated identifier on creation

An account create request MAY carry a client-generated UUID v4
identifier, and the system SHALL use it as the account's identifier;
this lets offline-created accounts later synchronize under their local
identifiers. A create whose identifier already exists for the user SHALL
be rejected with an already-exists error and SHALL NOT overwrite the
existing account. (Replay of already-applied creates is handled by the
sync protocol's operation idempotency, not by this rule.)

#### Scenario: Offline-created account keeps its id

- **WHEN** an account is created with client-generated identifier X, later offline, and synchronized
- **THEN** the account exists on the server under identifier X

#### Scenario: Duplicate client identifier

- **WHEN** a create request arrives with an identifier that already exists for the user
- **THEN** the request is rejected with an already-exists error and the existing account is unchanged

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

### Requirement: Limited mutability

Updating an account SHALL allow changing only its name. The currency and
opening balance SHALL NOT be changeable after creation. An update request
that changes no fields SHALL be rejected.

#### Scenario: Rename an account

- **WHEN** the user renames an account
- **THEN** the name changes and currency, opening balance, and computed balance semantics are unchanged

### Requirement: Optimistic concurrency on update

Updating an account SHALL require the client to send the `version` it
previously read. If the account was modified concurrently, the update
SHALL be rejected with a version-conflict error and the client SHALL
refetch and retry. A successful update increments the version.

#### Scenario: Concurrent account edit

- **WHEN** two clients update the same account, both sending the version they read before either write landed
- **THEN** the first update succeeds and the second is rejected with a version conflict

### Requirement: Deletion guard

Deleting an account that is referenced by any live cashflow transaction
(income or expense) or transfer of the user (including as a transfer source
or destination), or by any live planned payment of the user SHALL be
rejected with an account-in-use error. Adjustments never block the
deletion: they are the account's own reconciliation bookkeeping and SHALL
be tombstoned together with the account (each with its own change-feed
record). An account with no blocking references SHALL be deletable.
Deletion SHALL be soft: the account is marked as deleted (a tombstone) and
excluded from listings; the tombstone is retained so synchronized devices
learn of the deletion.

#### Scenario: Delete an account with cashflow history

- **WHEN** the user deletes an account that has live income, expense, or
  transfer transactions
- **THEN** the deletion is rejected with an account-in-use error and the account remains

#### Scenario: Delete an account that only has adjustments

- **WHEN** the user deletes an account whose only referencing transactions
  are adjustments
- **THEN** the deletion succeeds and every adjustment of the account is
  tombstoned together with it

#### Scenario: Delete an account referenced by a live plan

- **WHEN** the user deletes an account that a live planned payment references
- **THEN** the deletion is rejected with an account-in-use error

#### Scenario: Deleted account disappears from summaries

- **WHEN** the user deletes an account with no blocking references
- **THEN** the account no longer appears in listings and other devices learn of the deletion via the change feed

### Requirement: Listing

Listing accounts SHALL return all of the requesting user's non-deleted
accounts with their computed balances. Tombstoned accounts SHALL NOT be
returned.

#### Scenario: List accounts

- **WHEN** the user requests the account list
- **THEN** every account they own is returned with its current computed balance, and no other user's accounts appear

#### Scenario: Deleted accounts are not listed

- **WHEN** the user requests the account list after deleting an account
- **THEN** the deleted account does not appear in the response
