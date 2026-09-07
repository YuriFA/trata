# web-pwa Specification

## Purpose
Installability, offline application shell, and update behavior of the web
app distributed as a Progressive Web App.

## Requirements

### Requirement: Installability

The web app SHALL provide a complete web app manifest (product name, icons
including maskable variants, standalone display, token-derived theme and
background colors) and SHALL be installable as a standalone app on browsers
supporting PWA installation. On iOS only Safari performs PWA installation:
a home-screen shortcut created from another browser's share menu (e.g.
Chrome) is a plain web clip, and the offline start below is not guaranteed
for it — an iOS platform limitation, not an app defect.

#### Scenario: Install on a phone

- **WHEN** the user opens the app in a PWA-capable mobile browser and
  chooses to install it
- **THEN** the app installs with its name and icons and opens standalone
  without browser chrome

#### Scenario: Install on iOS

- **WHEN** the user on iOS adds the app to the home screen via Safari's
  share sheet and opens it later with no connectivity
- **THEN** the installed app starts on the precached shell and local data
  like on any other platform

#### Scenario: Home-screen shortcut created from Chrome on iOS

- **WHEN** the user on iOS adds the site to the home screen from Chrome's
  share menu and opens the shortcut with no connectivity
- **THEN** no offline start is guaranteed, because iOS home-screen
  shortcuts from non-Safari browsers do not carry the PWA installation;
  users who need offline on iOS install via Safari

### Requirement: Offline application shell

After the app has been loaded once, it SHALL start without any network
connection: the shell, application code, worker code, and the WASM binary
SHALL be served from the service worker's precache, and the app SHALL
operate on local data per the `web-local-data` capability.

#### Scenario: Cold start offline

- **WHEN** the device has no connectivity and the user opens the installed
  app (or reloads the tab)
- **THEN** the application loads and works on local data without network
  access

#### Scenario: Cold start into a hanging network

- **WHEN** connectivity exists but the backend (and any non-precached
  origin) blackholes requests - carrier whitelist, DPI middlebox - and the
  user opens the installed app
- **THEN** the application shell paints from the precache without waiting
  for any hung network request, and the app operates on local data in the
  offline state per `web-local-data`

### Requirement: No cached API responses

The service worker SHALL NOT serve cached backend API responses: network
requests to the API either reach the backend or fail, so the app never
displays stale server data. Offline behavior comes from local data, not
from HTTP caching.

#### Scenario: API traffic bypasses precache

- **WHEN** the service worker handles a request to an API endpoint
- **THEN** the request passes through to the network and no cached response
  is substituted

### Requirement: Prompted updates

When a new version of the app is published and detected, the app SHALL
prompt the user on two surfaces: a transient notification, and a
persistent update status on the settings page. The new version SHALL
activate after the user accepts from either surface (reload) or when
the app is next cold-started. Neither surface SHALL lose unsaved user
state by reloading without consent.

#### Scenario: Update available

- **WHEN** a new build is deployed and the running app fetches the updated
  worker
- **THEN** the user is offered a reload action and the app does not reload
  on its own while the user is working

#### Scenario: Settings page shows a pending update

- **WHEN** an updated worker is installed and waiting
- **THEN** the settings page shows an update-available status with an accept
  action
- **WHEN** the user accepts it
- **THEN** the app reloads into the new version without losing state in any
  other way than that deliberate reload

### Requirement: Explicit update check

The settings page SHALL offer an explicit update-check action that
triggers the browser's service-worker update check through the same
detection path as the automatic one. A completed check that finds no
update SHALL present an up-to-date status. A failed check (e.g. while
offline) SHALL present a failure status with a retry action and SHALL
NOT present an up-to-date status. An update check SHALL also run
automatically and silently when the about-app section is opened, with
its result reflected in the same statuses. In builds without a
service worker (local development), no update status or check action
SHALL be shown.

#### Scenario: Manual check finds nothing

- **WHEN** the user triggers the update check and no updated worker is found
- **THEN** the settings page shows an up-to-date status

#### Scenario: Manual check finds an update

- **WHEN** the user triggers the update check and an updated worker installs
  and begins waiting
- **THEN** the settings page shows the update-available status with an accept
  action

#### Scenario: Check fails offline

- **WHEN** an update check runs while offline and fails
- **THEN** the settings page shows a check-failure status with a retry action,
  and does not show an up-to-date status

#### Scenario: Opening settings checks silently

- **WHEN** the settings page is opened in a production build
- **THEN** an update check runs without user action and its outcome is
  reflected in the status shown

#### Scenario: Development build shows no update UI

- **WHEN** the app runs without a service worker (local development)
- **THEN** the about-app section shows the build version without any update
  status or check action

### Requirement: Push event handling

The service worker SHALL handle Web Push events for planned payment
reminders and display the notification without requiring the app to be
open in the foreground. Push handling SHALL NOT introduce response
caching: the no-cached-API-responses posture is unchanged, and the push
and notification handlers SHALL NOT cache backend API responses.

#### Scenario: Reminder arrives with the app closed

- **WHEN** the browser delivers a reminder push while no app window is open
- **THEN** the reminder notification is displayed with the plan's name and default amount

#### Scenario: Push handling does not cache API responses

- **WHEN** the service worker processes a push event
- **THEN** no backend API response is stored or served from cache

### Requirement: Notification activation routing

Activating a reminder notification SHALL focus an already-open app window
or open the app, and SHALL navigate to the confirm flow of the plan the
notification refers to. Focusing an open window SHALL NOT discard the
user's in-progress state (no forced reload).

#### Scenario: Notification opens the confirm flow

- **WHEN** the user activates a reminder notification and no app window is open
- **THEN** the app opens directly at the plan's confirm flow with the amount editable

#### Scenario: Open window is focused, not reloaded

- **WHEN** the user activates a reminder notification while an app window is open
- **THEN** the window is focused, navigated to the plan's confirm flow, and is not reloaded
