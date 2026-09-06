## MODIFIED Requirements

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

## ADDED Requirements

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
