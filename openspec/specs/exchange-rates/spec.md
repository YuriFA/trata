# Exchange Rates Specification

## Purpose

Sourcing and caching of exchange rates used to present money across
currencies: rates come from an external provider, are cached per device,
and every converted presentation carries the rate's date.

## Requirements

### Requirement: External rate source

Exchange rates SHALL be fetched from an external rate provider that
requires no API key (the initial provider is open.er-api.com), and the
provider SHALL cover every currency of the supported catalog (defined by
the accounts capability). A failed refresh SHALL be non-fatal: it leaves
the previously cached rates in effect and never blocks the app.

#### Scenario: Successful refresh

- **WHEN** the app refreshes rates while online
- **THEN** the fresh rates replace the cached ones and the cache's as-of date advances

#### Scenario: Provider failure is non-fatal

- **WHEN** a rate refresh fails (offline, provider error)
- **THEN** the previously cached rates remain in effect and the app stays fully usable

### Requirement: Per-device local cache

Rates SHALL be cached in the device's local database and SHALL NOT be
synchronized: the sync protocol carries no rate records, and refreshes
on one device never reach other devices through synchronization.

#### Scenario: Rates stay local

- **WHEN** rates are refreshed on one device
- **THEN** no rate data is pushed to the server or pulled onto other devices by synchronization

### Requirement: Refresh policy

The client SHALL refresh rates at session boundaries (app start, app
foreground, regained connectivity) and MAY refresh on explicit user
action. A refresh SHALL NOT block any interaction: presentation uses the
cached rates immediately and updates when a refresh completes.

#### Scenario: Offline start

- **WHEN** the app starts with no connectivity
- **THEN** cached rates are used and no refresh blocks the interface

### Requirement: Conversion across the catalog

Any amount in one catalog currency SHALL be convertible into any other
catalog currency using the cached rates, computing cross rates when the
provider publishes them against a single base. Conversion SHALL be a
presentation-only operation: no stored amount is ever rewritten.

#### Scenario: Cross rate without a direct published pair

- **WHEN** an amount in GEL is presented in KZT while the provider publishes rates against one base currency
- **THEN** the conversion uses the two cached rates and yields the GEL amount's equivalent in KZT

### Requirement: Rate provenance and graceful degradation

Converted figures SHALL be accompanied by the cached rate's as-of date,
shown on aggregates screens and available on demand elsewhere. When no
rate for a required pair has ever been cached, the client SHALL omit the
converted figure and keep the per-currency figures intact instead of
erroring.

#### Scenario: Stale rate shows its date

- **WHEN** converted totals are displayed from rates cached three days ago
- **THEN** the screen shows that as-of date next to the converted figures

#### Scenario: Missing rate degrades gracefully

- **WHEN** a converted total needs a pair with no cached rate (fresh install, offline)
- **THEN** the converted total is omitted, per-currency totals are shown, and no error blocks the screen
