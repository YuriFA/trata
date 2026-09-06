## MODIFIED Requirements

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
