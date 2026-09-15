# household Specification

## Purpose
The shared-data-space model of the product: every user belongs to exactly
one household, all shared records belong to the household rather than to
individual members, and membership controls access.

## Requirements

### Requirement: Automatic personal household

Every user SHALL belong to exactly one household, of which they are the
owner. Existing users are migrated automatically; new registrations create
their household implicitly. No user action is required to obtain a
household, and v1 exposes no way to hold more than one membership.

#### Scenario: Existing account after the migration

- **WHEN** the system upgrades with existing users
- **THEN** each user is the owner of exactly one household containing all
  of their existing records, with no data loss

#### Scenario: New registration

- **WHEN** a new user registers
- **THEN** a household owned by that user is created together with the
  account

### Requirement: Household-scoped data access

Accounts, categories, transactions, debtors, debt operations, and planned
payments SHALL belong to a household. A household's members SHALL see and
modify all of the household's data equally. Requests addressing a record
of a household the requester is not a member of SHALL behave as if the
record does not exist (not-found, no data revealed).

#### Scenario: Member sees a sibling's record

- **WHEN** a member lists or reads a record created by another member of
  the same household
- **THEN** the record is returned like any other household record

#### Scenario: Non-member gets not-found

- **WHEN** a request addresses a record id belonging to a household the
  requester does not belong to
- **THEN** the response is not-found with no data revealed

### Requirement: Uniqueness within the household

Names that are unique per user before this change (category names, debtor
names) SHALL be unique within the household among non-deleted records;
duplicates within the same household are rejected, while equal names
across different households coexist.

#### Scenario: Duplicate name inside a household

- **WHEN** any member creates a category (or debtor) whose name duplicates
  a non-deleted one in the same household
- **THEN** the request is rejected with an already-exists error

#### Scenario: Same name across households

- **WHEN** two users from different households each create a category
  named "Food"
- **THEN** both are created independently

### Requirement: Household and members listing

An authenticated endpoint SHALL return the requester's household with its
members: email, display name (when set), role, and joined date.

#### Scenario: Reading own household

- **WHEN** an authenticated user requests their household
- **THEN** the response lists every member with email, display name (or
  absence), role, and joined date

### Requirement: User display name

A user SHALL have an optional display name, editable through the profile
endpoint; it carries no access-control meaning and is intended for
member-facing labels (e.g. record authorship). When absent, consumers fall
back to the email.

#### Scenario: Setting and changing the display name

- **WHEN** the user sets a display name and later changes it
- **THEN** both operations succeed and the household members listing
  reflects the current value

#### Scenario: No display name set

- **WHEN** a user has never set a display name
- **THEN** the members listing reports its absence and consumers fall back
  to the email

### Requirement: Email invitations

The household owner SHALL be able to invite a member by email address.
An invitation SHALL carry a single-use accept token delivered by email
as a link, an expiry, and a revocation control for the owner. Accepting
SHALL require an authenticated session whose account email matches the
invitation; an unregistered inviteee SHALL be taken to registration
first and then accept. Invitations to an already-member email SHALL be
rejected, and re-sending a pending invitation to the same email SHALL
refresh it rather than duplicate it.

#### Scenario: Invite and accept by the matching account

- **WHEN** the owner invites wife@example.com and the user of that
  account opens the accept link while signed in
- **THEN** the invitation can be accepted and the account joins the
  household as a member

#### Scenario: Wrong account cannot accept

- **WHEN** a signed-in user whose email differs from the invitation
  opens the accept link
- **THEN** acceptance is refused with a clear error and the invitation
  remains pending

#### Scenario: Expired or revoked invitation

- **WHEN** the accept link is opened after expiry or revocation
- **THEN** acceptance is refused with a clear error

### Requirement: Home join code

The household owner SHALL be able to issue a join code for the
household. The code SHALL be multi-use, revocable, and rotatable (a new
code invalidates the previous one). Any authenticated user SHALL be able
to join the household by presenting an active code. A code SHALL not
identify or bind to a particular person.

#### Scenario: Joining with the code

- **WHEN** an authenticated user enters the household's active code
- **THEN** the user joins the household as a member

#### Scenario: Revoked code

- **WHEN** a user presents a revoked or rotated-out code
- **THEN** joining is refused with a clear error

### Requirement: Joining swaps membership and orphans the personal household

Accepting an invitation or code SHALL move the joiner's single
membership to the target household as a member. The joiner's former
personal household SHALL be retained server-side with access lost
(orphaned). Joining a household the user already belongs to SHALL be a
no-op.

#### Scenario: First join moves the membership

- **WHEN** a user with a personal household accepts an invitation
- **THEN** the user becomes a member of the inviting household and no
  longer has access to the personal household's data

#### Scenario: Repeated accept is idempotent

- **WHEN** the user accepts an invitation to their current household
  again
- **THEN** nothing changes

### Requirement: Joining device chooses what happens to local data

When the user accepts a join on a device holding local data, the client
SHALL offer an explicit choice before any synchronization as the new
household: carry this device's local data into the household, or start
clean (drop local data and pull the household's). Carrying data over
SHALL preserve the local records and merge them with the household's by
the sync protocol's union semantics.

Household currency SHALL be established at session boundaries — app start,
app foreground, regained connectivity, and authentication — before any sync
run is triggered: at each boundary the client SHALL verify that the local
household marker matches the user's current household and, on mismatch,
offer the carry/clean choice before synchronization proceeds. Runs
triggered within a session (for example, the debounced run after local
mutations or a manual refresh) need not re-check household currency. If the
household check cannot complete (for example, the device is offline), the
client SHALL skip the pending run rather than synchronize without the
check.

#### Scenario: Carry local data over

- **WHEN** the user accepts the join and chooses to carry this device's
  data
- **THEN** the device's local records appear in the household alongside
  the household's existing records, without duplicates by record id

#### Scenario: Start clean

- **WHEN** the user accepts the join and chooses to start clean
- **THEN** the device's prior local data is removed and the household's
  data is pulled onto the device

#### Scenario: Household changed on another device

- **WHEN** the user's household changed elsewhere and this device returns
  to the foreground (or reconnects, or re-authenticates)
- **THEN** the client detects the mismatch at that session boundary and
  offers the carry/clean choice before any sync run as the new household
  is triggered

#### Scenario: Runs within a session do not re-check

- **WHEN** the user is actively using the device in one session and local
  mutations trigger debounced sync runs or a manual refresh
- **THEN** those runs proceed without repeating the household-currency
  check

#### Scenario: Household check cannot complete

- **WHEN** a session-boundary sync run is due but the household check
  cannot complete (for example, no connectivity)
- **THEN** the run is skipped and retried at a later boundary; no
  synchronization happens without the check

### Requirement: Leaving, removal, and dissolution

A member SHALL be able to leave the household; the owner SHALL be able
to remove members. Leaving or removal revokes access only — the
household and its data remain. The owner SHALL be able to dissolve the
household as an explicit destructive action removing it with its data.
The owner SHALL NOT be able to leave a household that still has other
members.

#### Scenario: Member leaves

- **WHEN** a member leaves the household
- **THEN** their access to the household data ends and the remaining
  members' data is untouched

#### Scenario: Owner cannot abandon members

- **WHEN** the owner attempts to leave while other members exist
- **THEN** the leave is rejected with a clear error pointing to removal
  or dissolution instead

### Requirement: Household display name

A household SHALL have an optional display name, editable by the owner,
shown by invitation, join, and member interfaces. When absent,
interfaces fall back to a derived label from the owner's account.

#### Scenario: Named household in the accept flow

- **WHEN** an invited user opens the accept screen of a household named
  «Семья»
- **THEN** the screen presents the household by that name

### Requirement: Household management surface

Both clients SHALL provide a household section in settings showing the
current household's display name, and its members with display name (or
email fallback), role, and joined date. The owner SHALL manage
invitations (create by email, list with status, revoke, resend), the
home code (show, copy, rotate, revoke), member removal, household
rename, and dissolution (explicit destructive confirm). Members SHALL
have leave (with confirm) and the join-by-code entry. Actions the role
does not permit SHALL be hidden, not merely disabled.

#### Scenario: Owner manages the household

- **WHEN** the owner opens the household section
- **THEN** invitations, the home code, member removal, rename, and
  dissolution are available and functional

#### Scenario: Member's view

- **WHEN** a non-owner member opens the household section
- **THEN** the member list and leave are available, and owner-only
  actions are not shown

### Requirement: Authorship labels in shared data

Records carrying an author SHALL display who created them: always in the
record's detail view, and as a compact marker in lists/rows. Markers
SHALL appear only when the household has more than one member; records
authored by the current user and records without a known author SHALL
show no marker. Labels SHALL use the author's display name with the
email fallback.

#### Scenario: Sibling-created record in a shared household

- **WHEN** a multi-member household's member views a transaction created
  by another member
- **THEN** the detail view and the list row show that member's display
  name as the author

#### Scenario: Single-member household stays clean

- **WHEN** a user alone in their household views their data
- **THEN** no authorship markers are rendered

### Requirement: Display name editing

Both clients SHALL offer editing of the user's display name in settings
with an immediate preview of how household members will see them, and
the email fallback when the name is cleared.

#### Scenario: Edit and see the effect

- **WHEN** the user changes their display name and returns to the
  household section
- **THEN** the member list and authorship labels reflect the new name

### Requirement: Household base currency

The household SHALL carry a base currency from the supported currency
catalog (defined by the accounts capability). Households are created
implicitly at registration; the base currency SHALL default to RUB on
creation. The owner SHALL be able to change the base currency through
the household management surface; a change SHALL NOT rewrite,
reconvert, or re-validate any stored record - it changes only the
conversion target used for presentation from that point on. The base
currency SHALL be returned with every household response, so every
member's device learns it.

#### Scenario: Created with the server default

- **WHEN** a new user registers and their household is created
- **THEN** the household's base currency is RUB and every household response carries it

#### Scenario: Owner changes the base currency

- **WHEN** the owner changes the household's base currency from RUB to EUR
- **THEN** household responses carry EUR, stored records are unchanged, and presentation converts into EUR from then on

#### Scenario: Member cannot change it

- **WHEN** a non-owner member attempts to change the base currency
- **THEN** the request is rejected per the household management role rules
