## Purpose

Delivers planned payment reminders to web devices over Web Push: per-device
subscriptions managed by authenticated users, server-side dispatch driven by
the plan reminder setting, and the in-app device opt-in flow.

## ADDED Requirements

### Requirement: Push subscription management

A web device SHALL register for reminder pushes by creating a push
subscription through an authenticated endpoint (session cookie). A
subscription SHALL carry the push endpoint identifier, the delivery
encryption keys, and the device's IANA timezone name reported by the client.
Re-registering with the same endpoint SHALL upsert the existing
subscription (refreshing the timezone), not duplicate it. A user MAY hold
several subscriptions (several devices); a user SHALL be able to delete
their subscriptions. Push subscriptions are device-local records: they
SHALL NOT participate in the sync protocol (no change-log entries, no
pull, no push) and SHALL NOT be visible to other household members.
Unauthenticated requests to the subscription endpoints SHALL be rejected.

#### Scenario: Register a device

- **WHEN** an authenticated user's browser registers a push subscription with its endpoint, keys, and timezone
- **THEN** the subscription is stored for that user and the device becomes eligible for reminder pushes

#### Scenario: Re-registration refreshes the timezone

- **WHEN** a device that already has a subscription re-registers with the same endpoint and a new timezone
- **THEN** the existing subscription is updated with the new timezone and no duplicate is created

#### Scenario: Subscriptions are not synced

- **WHEN** a push subscription is created, updated, or deleted
- **THEN** no change-log entry is appended and the mutation is absent from sync pull results

#### Scenario: Anonymous registration rejected

- **WHEN** a request without an authenticated session creates or deletes a push subscription
- **THEN** the request is rejected

### Requirement: Reminder dispatch timing

For every live plan of the household with a reminder setting other than
`off`, the server SHALL send one reminder push per occurrence to each
subscription: `day_before` occurrences SHALL be delivered at 10:00
subscriber-local time on the day before the scheduled date, `on_day`
occurrences at 10:00 subscriber-local time on the scheduled date, where
subscriber-local time is computed from the subscription's stored timezone.
An occurrence whose reminder moment has already passed when dispatch runs
SHALL NOT be notified (no catch-up pushes for missed or long-overdue
occurrences), and an occurrence SHALL NOT be notified more than once per
subscription. Reminder pushes SHALL NOT be sent for deleted plans.

#### Scenario: Day-before reminder at ten local

- **WHEN** a plan with reminder `day_before` is due on June 5th and a subscriber's timezone is Europe/Moscow
- **THEN** the subscriber's devices receive one reminder on June 4th at 10:00 Moscow time

#### Scenario: One push per occurrence and device

- **WHEN** dispatch runs repeatedly across the reminder window of one occurrence
- **THEN** each subscription receives at most one push for that occurrence

#### Scenario: No catch-up for overdue occurrences

- **WHEN** a plan's reminder moment passed while dispatch did not run, or the plan is already long overdue
- **THEN** no push is sent for that occurrence

### Requirement: Reminder dispatch recipients

A plan's reminder pushes SHALL be delivered to the registered devices of
ALL members of the household that owns the plan (household parity): any
member's device with a subscription receives the household's plan
reminders, regardless of who created or last edited the plan. A member
whose devices have no subscription receives nothing. For a plan with
confirmation mode `auto` whose due occurrence has already been executed
by the time the `on_day` reminder would fire, the reminder SHALL be
skipped (the executed transaction reaches devices through sync); the
reliable informative setting for auto plans is `day_before`.

#### Scenario: Every subscribed member is reminded

- **WHEN** a household's plan with reminder enabled is due tomorrow and both members have subscribed devices
- **THEN** both members' subscribed devices receive the day-before reminder

#### Scenario: Unsubscribed member receives nothing

- **WHEN** the same plan's reminder fires and one member has never registered a device
- **THEN** that member receives no push and no error occurs

#### Scenario: Executed auto occurrence skips the on-day push

- **WHEN** an auto plan's occurrence was executed by the server earlier on its scheduled day and the 10:00 dispatch runs
- **THEN** no on-day reminder push is sent for that occurrence

### Requirement: Reminder content and activation

A reminder push SHALL identify the plan and carry the plan's default
amount. Manual plans SHALL use action-prompting copy ("time to confirm"),
auto plans informational copy ("will be charged today"). Activating the
notification SHALL bring the app to the plan's confirm flow where the
amount defaults to the plan's amount and MAY be adjusted before
submitting, per the `planned-payments` capability - covering plans whose
real amount varies (e.g. utilities).

#### Scenario: Variable-amount plan confirmed after a push

- **WHEN** the user activates a "time to confirm" push for a utilities plan and changes the amount in the opened confirm flow
- **THEN** the created transaction carries the adjusted amount and the plan advances one occurrence

### Requirement: Web device opt-in

The web app SHALL offer reminder enablement per device: an unobtrusive
entry SHALL appear on the plans screen and in the dashboard attention card
whenever the household has at least one live plan with a reminder other
than `off` and this device has no push subscription. Activating the entry
SHALL request notification permission and register the subscription only
when the app runs in standalone (installed) mode; in a regular browser
tab the entry SHALL instead show an install hint, since notifications are
unavailable there. The app SHALL NOT request notification permission on
app open or navigation - only from the explicit opt-in entry or from
enabling a reminder on a plan.

#### Scenario: Opt-in from the plans screen

- **WHEN** the household has plans with reminders enabled, the device has no subscription, the app runs standalone, and the user activates the entry
- **THEN** notification permission is requested and, on grant, a subscription is registered for the device

#### Scenario: Install hint in a regular tab

- **WHEN** the same entry is activated while the app runs in a browser tab
- **THEN** no permission prompt appears and the user is told to install the app to receive reminders

#### Scenario: No prompts on open

- **WHEN** the app starts or the user navigates between screens
- **THEN** no notification permission is requested

### Requirement: Dead subscription pruning

When the push service reports a subscription as gone (not-found or
expired), the server SHALL delete the subscription silently; reminder
dispatch to other subscriptions SHALL be unaffected, and the device SHALL
be offered the opt-in entry again (its subscription no longer exists).

#### Scenario: Push service reports the subscription gone

- **WHEN** a push delivery attempt returns a permanent not-found or expired response
- **THEN** the subscription is deleted and subsequent dispatches skip it without failing
