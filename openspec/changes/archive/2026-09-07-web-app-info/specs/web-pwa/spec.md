# web-pwa Delta

## MODIFIED Requirements

### Requirement: Prompted updates

When a new version of the app is published and detected, the app SHALL
prompt the user on two surfaces: a transient notification, and a
persistent update status on the settings page. The new version SHALL
activate after the user accepts from either surface (reload) or when
the app is next cold-started. Neither surface SHALL lose unsaved user
state by reloading without consent.

#### Scenario: Update available

- **WHEN** a new build is deployed and the running app fetches the updated worker
- **THEN** the user is offered a reload action and the app does not reload on its own while the user is working

#### Scenario: Settings page shows a pending update

- **WHEN** an updated worker is installed and waiting
- **THEN** the settings page shows an update-available status with an accept action
- **WHEN** the user accepts it
- **THEN** the app reloads into the new version without losing state in any other way than that deliberate reload

## ADDED Requirements

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

- **WHEN** the user triggers the update check and an updated worker installs and begins waiting
- **THEN** the settings page shows the update-available status with an accept action

#### Scenario: Check fails offline

- **WHEN** an update check runs while offline and fails
- **THEN** the settings page shows a check-failure status with a retry action, and does not show an up-to-date status

#### Scenario: Opening settings checks silently

- **WHEN** the settings page is opened in a production build
- **THEN** an update check runs without user action and its outcome is reflected in the status shown

#### Scenario: Development build shows no update UI

- **WHEN** the app runs without a service worker (local development)
- **THEN** the about-app section shows the build version without any update status or check action
