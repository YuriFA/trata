# Debts Specification

## Purpose

Tracks money lent to and borrowed from people: per-user debtors and debt
operations in two independent directions (money owed to the user and money
the user owes), with balances derived from the operation history rather
than stored.

## Requirements

### Requirement: Debt ownership and scoping

Every debtor and every debt operation SHALL belong to exactly one
household. Reading, updating, or deleting a debtor or debt operation of a
household the requester does not belong to SHALL behave as if it does not
exist (not-found). Debtor names SHALL be unique per household among
non-deleted debtors; a duplicate name within the same household SHALL be
rejected with an already-exists error.

#### Scenario: Duplicate debtor name for the same user

- **WHEN** any member creates a debtor named "Анна" and the household
  already has a non-deleted debtor named "Анна"
- **THEN** the request is rejected with an already-exists error

#### Scenario: Same debtor name for different users

- **WHEN** two users from different households each create a debtor named
  "Анна"
- **THEN** both debtors are created independently

#### Scenario: Another user's debtor is invisible

- **WHEN** a request addresses a debtor id owned by a different household
- **THEN** the request is rejected as not-found and no data leaks

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

### Requirement: Two independent directions

Balances SHALL be tracked per direction independently: the receivable and
payable ledgers of the same debtor SHALL NOT be netted against each other,
and a debtor MAY have a nonzero balance in both directions at once. The
direction totals (money owed to the user overall, money the user owes
overall) SHALL each be the sum of that direction's per-debtor balances.

#### Scenario: The same person in both directions

- **WHEN** Анна owes the user 5 000,00 ₽ (receivable) and the user owes Анна 2 000,00 ₽ (payable)
- **THEN** both balances are reported separately — 5 000,00 ₽ receivable and 2 000,00 ₽ payable — and neither reduces the other

### Requirement: Derived balances

No debtor balance SHALL be stored. The balance of a debtor in a direction
SHALL be the sum of that direction's `debt` operations minus the sum of its
`repayment` operations, computed from the live (non-deleted) operation
history. Creating, updating, or deleting an operation SHALL automatically
recalculate every derived figure. A balance MAY be negative when repayments
exceed the recorded debt (over-repayment); the system SHALL record such an
operation rather than reject it.

#### Scenario: Deleting an operation recalculates the balance

- **WHEN** the user deletes a 1 500,00 ₽ repayment and the debtor's balance was 3 500,00 ₽
- **THEN** the debtor's balance becomes 5 000,00 ₽ without any stored value being edited

#### Scenario: Over-repayment is data, not an error

- **WHEN** the user records a 6 000,00 ₽ repayment against a 5 000,00 ₽ debt
- **THEN** the operation is recorded and the direction balance becomes −1 000,00 ₽

### Requirement: Optional note semantics

The optional `note` of a debtor and of a debt operation SHALL follow the
same rule, identical to the transaction `description` convention: on
create, an absent note means an empty string, and responses always carry
the note as a string (never null). On update, an absent field means "keep
the current value"; an explicit `null` SHALL be rejected as an invalid
payload (request schemas are never nullable); an empty string SHALL clear
the note. Notes SHALL be stored verbatim — no server-side trimming — so a
whitespace-only note is accepted and stored as-is (clients may trim at the
form layer).

#### Scenario: Clear a note with an empty string

- **WHEN** the user updates a debtor sending `note` as an empty string
- **THEN** the note becomes empty and every other field is unchanged

#### Scenario: Null note rejected

- **WHEN** an update request sends `note` as an explicit `null`
- **THEN** the request is rejected with an invalid-payload error

#### Scenario: Absent note keeps the value

- **WHEN** an update request omits the `note` field entirely
- **THEN** the stored note is unchanged

### Requirement: Client-generated identifier on creation

Debtor and debt operation create requests MAY carry a client-generated UUID
v4 identifier, and the system SHALL use it as the record's identifier; this
lets offline-created records later synchronize under their local
identifiers. A create whose identifier already exists for the user SHALL be
rejected with an already-exists error and SHALL NOT overwrite the existing
record.

The record identifier identifies the debtor or debt operation itself; a
sync mutation is identified separately by its operation id (`opId`). These
are distinct mechanisms: entity-id uniqueness governs which records may
exist; sync operation idempotency governs redelivery of the same mutation.
A replayed sync operation (same `opId`) SHALL be answered by the existing
sync idempotency mechanism — the stored applied result is returned, no
second record is created, and the replay SHALL NOT be reported as
already-exists. A new mutation with a different `opId` claiming an existing
entity id is NOT a replay and SHALL follow the duplicate-entity conflict
semantics.

#### Scenario: Offline-created debtor keeps its id

- **WHEN** a debtor is created offline with client-generated identifier X and later synchronized
- **THEN** the debtor exists on the server under identifier X

#### Scenario: Duplicate client identifier

- **WHEN** a create request arrives with an identifier that already exists for the user
- **THEN** the request is rejected with an already-exists error and the existing record is unchanged

#### Scenario: Replayed sync operation is idempotent

- **WHEN** a sync push delivers the same `opId` for a debtor create that the server already applied
- **THEN** the stored applied result is replayed, no second debtor is created, and the result is not already-exists

#### Scenario: Different operation id claiming an existing entity id

- **WHEN** a sync push delivers a create with a new `opId` but an entity id that already exists for the user
- **THEN** the item is reported as an already-exists conflict carrying the server's current state, and the stored record is not overwritten

### Requirement: Updating a debtor

A user SHALL be able to update a debtor's name and note. An update request
that changes no fields SHALL be rejected. A rename to a name another
non-deleted debtor of the same user already has SHALL be rejected with an
already-exists error.

#### Scenario: Rename to a taken name

- **WHEN** the user renames a debtor to a name that another of their debtors already uses
- **THEN** the request is rejected with an already-exists error

### Requirement: Optimistic concurrency on update

Updating a debtor or a debt operation SHALL require the client to send the
`version` it previously read (REST PATCH bodies and sync upserts alike;
sync upserts carry it as the base version). If the record was modified
concurrently, the update SHALL be rejected with a version-conflict error
and the client SHALL refetch and retry. A successful update increments the
version.

#### Scenario: Concurrent debtor edit

- **WHEN** two devices update the same debtor, both sending the version they read before either write landed
- **THEN** the first update succeeds and the second is rejected with a version conflict

### Requirement: Debt operation update constraints

A debt operation's amount, occurred-at date, and note SHALL be updatable.
Its direction and kind SHALL be immutable: an update attempting to change
either SHALL be rejected. An update that changes no fields SHALL be
rejected.

#### Scenario: Direction change rejected

- **WHEN** an update request attempts to change an operation's direction from `receivable` to `payable`
- **THEN** the request is rejected with an invalid-payload error

#### Scenario: Amount edit recalculates balances

- **WHEN** the user edits a debt operation's amount from 5 000,00 ₽ to 4 000,00 ₽
- **THEN** every derived figure involving that operation reflects 4 000,00 ₽

### Requirement: Deletion rules

Deleting a debtor that has any live (non-deleted) debt operation SHALL be
rejected with a debtor-in-use error. Tombstoned debt operations SHALL NOT
block debtor deletion: a debtor whose operations are all tombstoned SHALL
be deletable, and a debtor with no operations at all SHALL be deletable.
Deleting a debt operation SHALL always be allowed. Both deletions SHALL be
soft: the record is marked as deleted (a tombstone) and excluded from
listings, and the tombstone SHALL be retained so synchronized devices learn
of the deletion. Deleting an operation SHALL recalculate the derived
balances.

#### Scenario: Delete a debtor in use

- **WHEN** the user deletes a debtor that has live debt operations
- **THEN** the deletion is rejected with a debtor-in-use error

#### Scenario: Debtor with only tombstoned operations is deletable

- **WHEN** every debt operation of a debtor has been deleted (tombstoned) and the user deletes the debtor
- **THEN** the deletion succeeds: the debtor is tombstoned, disappears from listings, and the tombstone syncs to other devices like any deletion

#### Scenario: Delete a debtor with no operations

- **WHEN** the user deletes a debtor with no debt operations
- **THEN** the debtor no longer appears in listings, other devices learn of the deletion via the change feed, and the freed name may be reused

#### Scenario: Delete an operation recalculates

- **WHEN** the user deletes a debt operation
- **THEN** the operation is tombstoned, excluded from listings, and the debtor's derived balance changes accordingly

### Requirement: Versioned delete and tombstone semantics

Deleting a debtor or a debt operation SHALL be a versioned mutation: a
successful delete sets the deletion timestamp and increments the `version`
exactly once, and the change-log tombstone records that new version. These
semantics inherit the existing synced-entity behavior verbatim:

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

#### Scenario: Concurrent delete and update

- **WHEN** one device pushes a sync delete for a debt operation while another device's edit of the same operation is already applied or in flight
- **THEN** the delete is applied (delete-wins), never reported as a version conflict, and the editing device learns of the tombstone via a deleted-conflict or pull

#### Scenario: Update of a deleted entity

- **WHEN** a REST update targets a debtor that has been deleted
- **THEN** the request is rejected as not-found

#### Scenario: Delete of an already-deleted entity

- **WHEN** a REST delete targets an already-deleted debtor, and a sync delete is delivered for the same debtor
- **THEN** the REST delete is rejected as not-found, while the sync delete is reported as applied with the tombstone's current version

### Requirement: Listing

Listing debtors SHALL return the requesting user's non-deleted debtors.
Listing debt operations SHALL return the requesting user's non-deleted
operations and MAY be filtered by debtor. Tombstoned records SHALL NOT be
returned.

#### Scenario: List operations of one debtor

- **WHEN** the user requests debt operations filtered to a specific debtor
- **THEN** only that debtor's non-deleted operations are returned

#### Scenario: Deleted records are not listed

- **WHEN** the user requests either list after a deletion
- **THEN** the tombstoned record does not appear in the response

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

#### Scenario: Offline operation for a debtor deleted on the server

- **WHEN** a device records a debt operation offline for debtor X, debtor X is deleted and synchronized by another device, and the offline device then pushes the operation
- **THEN** the push yields a per-item debtor-not-found error, the operation is not applied but remains queued and retried per the sync protocol's backoff without entering conflict resolution, and no data is lost silently
