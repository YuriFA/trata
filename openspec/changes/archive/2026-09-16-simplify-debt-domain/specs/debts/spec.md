## MODIFIED Requirements

### Requirement: Debtor shape

A debtor SHALL have a non-empty name and a currency from the supported
currency catalog (defined by the accounts capability). On create, an
absent currency SHALL default to the household's current base currency.
The currency SHALL NOT be changeable after creation: a debtor's ledger
stays single-currency for its whole life. A create or update request with
a missing or empty name SHALL be rejected. A debtor carries no free-text
note: the `note` field no longer exists in the contract, storage, or sync
payloads.

#### Scenario: Create a debtor

- **WHEN** the user creates a debtor with name "Анна"
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
inherits the debtor's), and an occurred-at timestamp. A request with a
missing or invalid field, a non-positive amount, or a reference to a
nonexistent, foreign, or deleted debtor SHALL be rejected. A debt
operation carries no free-text note: the `note` field no longer exists in
the contract, storage, or sync payloads.

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

### Requirement: Updating a debtor

A user SHALL be able to update a debtor's name, and the name SHALL be the
only updatable debtor field. An update request that changes no fields
SHALL be rejected. A rename to a name another non-deleted debtor of the
same household already has SHALL be rejected with an already-exists error.

#### Scenario: Rename succeeds

- **WHEN** the user renames a debtor to a name no other live debtor of the household uses
- **THEN** the new name appears in every surface listing the debtor, and no other field changes

#### Scenario: Rename to a taken name

- **WHEN** the user renames a debtor to a name that another of their household's live debtors already uses
- **THEN** the request is rejected with an already-exists error

#### Scenario: No-op update rejected

- **WHEN** an update request carries the name the debtor already has
- **THEN** the request is rejected as a no-op update

### Requirement: Debt operation update constraints

A debt operation's amount and occurred-at date SHALL be updatable. Its
direction and kind SHALL be immutable: an update attempting to change
either SHALL be rejected. An update that changes no fields SHALL be
rejected.

#### Scenario: Direction change rejected

- **WHEN** an update request attempts to change an operation's direction from `receivable` to `payable`
- **THEN** the request is rejected with an invalid-payload error

#### Scenario: Amount edit recalculates balances

- **WHEN** the user edits a debt operation's amount from 5 000,00 ₽ to 4 000,00 ₽
- **THEN** every derived figure involving that operation reflects 4 000,00 ₽

### Requirement: Versioned delete and tombstone semantics

Deleting a debtor SHALL be a versioned mutation across the whole cascade:
the debtor and every live operation the cascade tombstones each get the
deletion timestamp set and their `version` incremented exactly once, and
each change-log tombstone records that record's new version. Deleting a
debt operation directly SHALL remain a single-record versioned mutation.
These semantics inherit the existing synced-entity behavior verbatim:

- REST delete carries no version parameter (identical to accounts,
  categories, and transactions); deleting a missing or already-deleted
  record behaves as not-found.
- REST update of a tombstoned record behaves as not-found (deleted equals
  not-found).
- Sync delete is idempotent and delete-wins: a record the server never saw
  is reported as applied with version 0; an already-tombstoned record is
  reported as applied with its current version; a live record is tombstoned
  and reported as applied with the new version. A concurrent edit SHALL NOT
  turn a sync delete into a version conflict.
- Sync upsert against a record deleted on the server is reported as a
  deleted-conflict carrying the server state, resolved by the sync
  protocol's delete-wins flow.

#### Scenario: Successful versioned delete

- **WHEN** the server deletes a debtor at version 3
- **THEN** the record's version becomes 4 with the deletion timestamp set, and the change-log tombstone records version 4

#### Scenario: Cascade delete versions every record

- **WHEN** a debtor at version 3 with live operations at versions 5 and 7 is deleted
- **THEN** the debtor's version becomes 4, each operation's version increments exactly once, and one change-log tombstone per record records each new version

#### Scenario: Concurrent delete and update

- **WHEN** one device pushes a sync delete for a debt operation while another device's edit of the same operation is already applied or in flight
- **THEN** the delete is applied (delete-wins), never reported as a version conflict, and the editing device learns of the tombstone via a deleted-conflict or pull

#### Scenario: Update of a deleted entity

- **WHEN** a REST update targets a debtor that has been deleted
- **THEN** the request is rejected as not-found

#### Scenario: Delete of an already-deleted entity

- **WHEN** a REST delete targets an already-deleted debtor, and a sync delete is delivered for the same debtor
- **THEN** the REST delete is rejected as not-found, while the sync delete is reported as applied with the tombstone's current version

### Requirement: Sync participation

Debtors and debt operations SHALL be first-class sync entities: every
server-side mutation SHALL append to the change log in the same transaction
(deletes as tombstones); sync push SHALL apply creates, updates, and
deletes with the same validation and ownership rules as the REST API,
under base-version compare-and-swap semantics; sync pull SHALL deliver
debtor and debt operation upserts and tombstones so devices converge on the
same derived balances. A debtor-name collision on sync push SHALL be
reported as a per-item already-exists error (the same treatment a category
name collision receives), without aborting the batch.

A sync delete of a debtor SHALL cascade exactly like the REST delete: the
debtor's live operations are tombstoned in the same transaction, the delete
item is reported as applied, and pulling devices receive tombstones for
both the debtor and its operations.

A debt operation pushed for a debtor that is not among the user's live
debtors (for example, the debtor was deleted on another device while the
operation was recorded offline) SHALL be reported as a per-item error with
a debtor-not-found code. Per the sync protocol's per-item result rules, the
operation SHALL NOT be applied and SHALL NOT be silently discarded: it
stays queued on the device, is retried under the standard backoff, does not
become a sync conflict, and the user's data is preserved until the user
edits or deletes the operation locally — the same handling a transaction
referencing a remotely deleted account or category receives today.

#### Scenario: Debt created offline converges

- **WHEN** a debtor and a debt operation are created offline on the mobile app and later synchronized
- **THEN** both records exist on the server under their client-generated ids, and another device pulling the changes derives the same balance

#### Scenario: Delete propagates as a tombstone

- **WHEN** a debt operation is deleted on one device
- **THEN** the change log records a tombstone and other devices stop including the operation in derived balances after pulling

#### Scenario: Sync create with a taken debtor name

- **WHEN** a sync push creates a debtor whose name another live debtor of the user already has
- **THEN** that item is reported as a per-item already-exists error and the rest of the batch is unaffected

#### Scenario: Sync delete of a debtor cascades

- **WHEN** a sync push delivers a delete for a debtor that has live debt operations
- **THEN** the item is reported as applied, the debtor and its live operations are tombstoned in one transaction, and pulling devices receive tombstones for both

#### Scenario: Offline operation for a debtor deleted on the server

- **WHEN** a device records a debt operation offline for debtor X, debtor X is deleted and synchronized by another device, and the offline device then pushes the operation
- **THEN** the push yields a per-item debtor-not-found error, the operation is not applied but remains queued and retried per the sync protocol's backoff without entering conflict resolution, and no data is lost silently

## ADDED Requirements

### Requirement: Cascade deletion rules

Deleting a debtor SHALL delete the debtor together with all of its live
(non-deleted) debt operations in one atomic action: every live operation
of the debtor is tombstoned and the debtor is tombstoned in the same
transaction. There is no debtor-in-use rejection: a debtor with live
operations, with only tombstoned operations, or with no operations at all
is deleted the same way. Other debtors and their operations SHALL NOT be
affected. Deleting a single debt operation SHALL always be allowed and
SHALL NOT touch its debtor. Both deletions SHALL be soft: the records are
marked deleted (tombstones), excluded from listings, and the tombstones
SHALL be retained so synchronized devices learn of the deletions.
Deleting operations SHALL recalculate the derived balances. A freed
debtor name MAY be reused.

#### Scenario: Delete a debtor with live operations

- **WHEN** the user deletes a debtor that has live debt operations
- **THEN** the debtor and all of its live operations are tombstoned in one atomic action, disappear from listings, and the freed name may be reused

#### Scenario: Delete a debtor with no operations

- **WHEN** the user deletes a debtor with no live debt operations
- **THEN** the debtor no longer appears in listings, other devices learn of the deletion via the change feed, and the freed name may be reused

#### Scenario: Cascade does not touch other debtors

- **WHEN** a household has two debtors and the user deletes one of them
- **THEN** the other debtor and all of its operations remain live and unchanged

#### Scenario: Delete an operation recalculates

- **WHEN** the user deletes a debt operation
- **THEN** the operation is tombstoned, excluded from listings, and the debtor's derived balance changes accordingly

## REMOVED Requirements

### Requirement: Deletion rules

**Reason**: The debtor-in-use guard semantics are replaced outright by
cascade deletion; the behavior now lives in the "Cascade deletion rules"
requirement.

### Requirement: Optional note semantics

**Reason**: Debtors and debt operations no longer carry a free-text note.
The field is removed from the contract, storage, sync payloads, and UI.
The shared optional-note convention remains in force where it still
applies (transactions, planned payments).
