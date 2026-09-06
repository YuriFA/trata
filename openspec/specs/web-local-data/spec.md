# web-local-data Specification

## Purpose
Browser-side local-first behavior of the web app: all data operations work
against durable local storage without a network, anonymous usage is the
default, and account login binds local data to a server account through an
explicit ownership gate and initial sync.

## Requirements

### Requirement: Local-first data operation

The web app SHALL serve every read and write of accounts, categories, and
transactions from durable local browser storage, without contacting the
backend. Local writes SHALL be recorded with their pending sync operations
atomically. Local data SHALL survive page reloads and browser restarts.

#### Scenario: Offline mutation

- **WHEN** the network is unavailable and the user creates, edits, or deletes
  an account, category, or transaction
- **THEN** the operation succeeds locally and is reflected immediately in the
  UI, with its sync operation queued for later delivery

#### Scenario: Persistence across reload

- **WHEN** the user reloads the page after local changes
- **THEN** all previously written data is present without any network access

### Requirement: Anonymous-first application

The app SHALL be fully usable without signing in: navigation SHALL NOT
redirect unauthenticated users away from data screens, and login/register
SHALL remain reachable as standalone pages from an always-available entry
point. The app SHALL display an indicator distinguishing the local
(anonymous) mode from the signed-in mode.

The session restore SHALL distinguish why no session was restored: a
server-confirmed sign-out (401) is terminal for the app run, while a
network/timeout failure SHALL enter a recoverable offline state. While in
the offline state with a local owner binding, the indicator SHALL
communicate offline mode (data available, sign-in pending) rather than
guest mode. The restore SHALL be retried automatically when connectivity
returns (`online`) and when the app becomes visible again, without
requiring a reload; a successful retry SHALL authenticate through the
ownership gate and resume the sync engine.

#### Scenario: Direct visit without session

- **WHEN** an unauthenticated user opens any data screen URL directly
- **THEN** the screen renders and operates on local data instead of
  redirecting to login

#### Scenario: Backend unavailable at startup

- **WHEN** the app starts while the backend is unreachable and no session can
  be restored
- **THEN** the app continues in anonymous mode on local data instead of
  showing a blocking error screen

#### Scenario: Signed-in user starts offline and connectivity returns

- **WHEN** a user with a live session starts the app under an unreachable
  backend (airplane mode or a blackholed network), and connectivity later
  returns or the app is brought back into the foreground
- **THEN** the session restore is retried automatically and, on success, the
  app transitions to the signed-in state and the sync engine resumes
  without a manual reload

#### Scenario: Offline indicator distinguishes offline from guest

- **WHEN** the session restore failed due to the network while the local
  database has an owner binding
- **THEN** the mode indicator communicates offline mode (sign-in pending)
  rather than guest mode

### Requirement: Ownership gate and initial sync

On the first login over unowned local data, the app SHALL bind the local
data to the authenticated account and run the initial sync defined by
`sync-protocol` (push all local records as creates, pull server records). On
a login as a different account than the local owner, the app SHALL require
an explicit choice between clearing all local data and cancelling the login;
cancelling SHALL sign the just-authenticated session back out and keep local
data untouched.

#### Scenario: First login migrates anonymous data

- **WHEN** a user with anonymous local data signs in
- **THEN** the local data is bound to the account and the initial sync pushes
  local records as creates and pulls server records

#### Scenario: Different owner blocks login

- **WHEN** the local data is owned by account A and account B signs in
- **THEN** the user must choose between deleting the local data and cancelling
  the login, and choosing cancel signs B back out leaving the data intact

### Requirement: Logout preserves local data

Signing out SHALL keep all local data on the device and return the app to
anonymous mode; queued sync operations SHALL wait until the next
authentication.

#### Scenario: Logout then continued anonymous use

- **WHEN** a signed-in user signs out
- **THEN** the app switches to anonymous mode and all local data remains
  usable and intact

### Requirement: Sync status visibility and conflict surfacing

The app SHALL display the current synchronization state (including pending
operations, operations the server is rejecting, running state, and
paused-due-to-auth state) on every screen where data is visible. Unresolved
sync conflicts SHALL be surfaced from any screen and resolvable there (keep
local / take server flows per `sync-protocol`).

Operations whose last push attempt produced a per-item error result (or that
failed local wire validation before being sent) SHALL be shown as a distinct
failing state - not as plain pending - and the last recorded error SHALL be
discoverable from the status surface without developer tooling.

#### Scenario: Pending operations visible

- **WHEN** local changes are queued but not yet synchronized
- **THEN** the sync status indicator shows the pending state

#### Scenario: Server-rejected operations visible as failing

- **WHEN** queued operations are being rejected by the server on every push
  attempt (per-item error results, e.g. a domain-rule violation)
- **THEN** the sync status indicator shows a failing state with the count of
  rejected operations, distinct from the pending state
- **AND** the last recorded operation error is shown as the indicator's
  tooltip/title

#### Scenario: Rejected operation recovers

- **WHEN** a previously rejected operation is pushed again and the server
  applies it
- **THEN** the failing indicator disappears and the indicator reflects the
  remaining outbox state

#### Scenario: Conflict resolution from any screen

- **WHEN** unresolved conflicts exist
- **THEN** the user can open the conflict view and resolve each conflict
  without navigating away from the current workflow context

### Requirement: Single-tab storage exclusivity

The local database SHALL be opened by at most one browser tab at a time.
When another tab already holds the database, the app SHALL present a clear
"already open in another tab" state offering to retry, and SHALL NOT corrupt
or overwrite the data of the holding tab.

#### Scenario: Second tab blocked

- **WHEN** the app is already open in one tab and a second tab loads
- **THEN** the second tab shows the already-open state and does not open the
  database, while the first tab keeps working

### Requirement: Persistent storage request

The app SHALL request persistent browser storage for its local database
early in the application lifecycle.

#### Scenario: Storage persistence requested

- **WHEN** the application starts
- **THEN** a persistent-storage request is issued for the origin

### Requirement: Local category archive and cascade semantics

The local mirror SHALL store each category's archived-at timestamp, and
local reads SHALL follow the listing rules: active categories by default,
archived categories included only on explicit request. Archiving or
unarchiving a category SHALL be a local update mutation enqueuing the
corresponding update sync operation. A cascaded delete SHALL apply in the
local mirror atomically - the category and every non-deleted local
transaction referencing it are tombstoned in one local transaction - and
SHALL enqueue a single delete sync operation carrying the cascade flag.
Local validation SHALL reject assigning an archived category to a
transaction with the archived-category error code, matching the backend.
Transaction counts used by management UIs SHALL be computed from the local
mirror.

#### Scenario: Offline archive

- **WHEN** the user archives a category while offline
- **THEN** the category disappears from pickers immediately and an update sync operation is queued

#### Scenario: Offline cascaded delete

- **WHEN** the user confirms a cascaded delete while offline
- **THEN** the category and its referencing local transactions are tombstoned atomically, balances update immediately, and a single delete operation with the cascade flag is queued

#### Scenario: Local archived-category rejection

- **WHEN** the user assigns an archived category to a new local transaction
- **THEN** the mutation is rejected with the archived-category error code

#### Scenario: Pull applies a remote cascade

- **WHEN** a pull delivers tombstones for a category and its transactions deleted by another device's cascade
- **THEN** the local mirror applies them like any other deletions and balances update accordingly

### Requirement: Account-less cashflow in the local mirror

Local creation and update of an income or expense transaction without an
account reference SHALL be accepted with the same domain rules as the
backend (the category remains required and type-matched; no account
existence check applies). The queued sync operation for such a mutation
SHALL carry the absent account reference and SHALL NOT be held back as a
local error. A pulled account-less cashflow transaction SHALL persist with
the absent account reference intact and be served to every local read.

#### Scenario: Offline account-less expense

- **WHEN** the user creates an account-less expense while offline
- **THEN** the transaction is stored locally, its queued upsert is valid, and it appears in history and period analytics without changing any account balance

#### Scenario: Pull applies an account-less row

- **WHEN** the sync pull delivers an account-less income transaction
- **THEN** the local mirror stores it without an account reference and serves it to subsequent reads

#### Scenario: Clearing the account locally

- **WHEN** the user edits an accounted expense locally and switches it to «Без счета»
- **THEN** the local row loses its account reference, the queued upsert carries the cleared reference, and the account's local balance no longer includes the transaction

### Requirement: Bounded request timeouts

The shared API client SHALL bound every request with a configurable
timeout (aborting the request when it expires) instead of relying on the
browser's default TCP timeout. The default timeout SHALL be 10 seconds;
session/auth requests SHALL use 5 seconds and the sync transport 30
seconds. An aborted request SHALL surface through the existing network
failure error path (no new error taxonomy), so existing retry and backoff
behavior applies unchanged.

#### Scenario: Hanging backend does not stall the login entry point

- **WHEN** the backend connection hangs (requests neither fail nor respond)
  and the user opens the login or register page
- **THEN** the page renders within the session-restore timeout bound
  instead of waiting for the browser's TCP timeout
