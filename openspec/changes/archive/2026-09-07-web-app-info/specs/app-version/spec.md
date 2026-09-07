# app-version Delta

## ADDED Requirements

### Requirement: Web settings page displays build versions

The web settings page SHALL display the running web build version in
the UI, and SHALL additionally display the API build version from the
health payload as a secondary line when the API is reachable. When the
API is unreachable, the API version line SHALL be absent without an
error state. The display SHALL be available to unauthenticated users,
and the boot console line SHALL remain unchanged.

#### Scenario: Deployed build shows its version

- **WHEN** the user opens the settings page on a build produced with the image's version argument
- **THEN** the about-app section shows that build's version string (`sha-<short>`)

#### Scenario: API version appears as a secondary line

- **WHEN** the settings page is open and the API is reachable
- **THEN** the API's build version is displayed as a secondary, muted line next to the web version

#### Scenario: API version line absent when offline

- **WHEN** the settings page is open and the API is unreachable
- **THEN** the API version line is absent and no error state is shown

#### Scenario: Anonymous user sees the version display

- **WHEN** an unauthenticated user opens the settings page
- **THEN** the about-app section with the version display is visible
