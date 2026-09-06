## ADDED Requirements

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
