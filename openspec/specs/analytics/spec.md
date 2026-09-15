## Purpose

Period-scoped spending and income insight on mobile: category distribution
of expenses and income over a selected week, month, or year, rendered as
donut charts with legends and per-category breakdowns, computed entirely
from the user's local data.

## Requirements

### Requirement: Analytics tab overview

The analytics tab SHALL show two summary cards — expenses («Расходы») and
income («Доходы») — for the current device-local month. Each card SHALL show
the direction's month total, a donut chart of the per-category distribution,
and a color-matched legend of the largest categories. Selecting a card SHALL
open the detail screen for that direction. The tab SHALL render entirely
from local data with no network dependency.

#### Scenario: Overview cards with data

- **WHEN** the current month contains expenses and income across several categories
- **THEN** both cards show their direction totals, donut charts whose segment colors match the category colors, and legends whose markers use the same colors as their segments

#### Scenario: Opening a detail screen

- **WHEN** the user selects the expenses card (likewise the income card)
- **THEN** the detail screen for that direction opens

#### Scenario: Month without data

- **WHEN** the current month contains no transactions of a direction
- **THEN** that card still renders its donut chart — as a single neutral grey ring with the direction's zero total in the center — shows the empty-state message in place of the legend, and the card remains selectable

#### Scenario: Analytics offline

- **WHEN** the user opens the analytics tab with no connectivity after transactions have been recorded or synced locally
- **THEN** the overview cards render the local figures

### Requirement: Detail screen period selection

The detail screen SHALL offer a three-way period selector — week («Неделя»),
month («Месяц»), year («Год») — with month selected by default and the
active option visually marked and exposed as selected to accessibility
services. Switching the period kind SHALL select the current period of the
new kind.

#### Scenario: Default period on open

- **WHEN** the user opens a detail screen
- **THEN** month is the selected period kind and the current month is the selected period

#### Scenario: Switching period kind

- **WHEN** the user selects «Неделя»
- **THEN** the screen shows the current week's figures and «Неделя» is the marked, accessibly selected option

### Requirement: Period navigation

The detail screen SHALL provide previous/next controls that step one period
at a time, and SHALL display a human-readable label of the selected period's
inclusive date range in the app's date locale: a week as its first and last
day («3 августа – 9 августа», Monday through Sunday), a month as its first
and last day («1 августа – 31 августа»), a year including the year («1
января – 31 декабря 2026»). Labels SHALL include the year whenever the range
spans two calendar years or would otherwise be ambiguous. A left/right swipe
over the chart section SHALL step to the next/previous period exactly like
the controls. Switching periods SHALL animate ONLY the donut chart while the
rest of the screen stays static, like a carousel: a swipe tracks the finger
with the adjacent period's chart sliding in during the drag, and the step
settles in the swipe direction on release (or springs back when the swipe
traveled too little); the controls animate the same settle. Navigation SHALL
NOT be blocked at the current period: future periods are reachable and
display their (normally empty) state like any other period.

#### Scenario: Stepping weeks

- **WHEN** the selected period is the week of 3–9 August and the user steps next
- **THEN** the screen shows the week of 10–16 August

#### Scenario: Stepping months

- **WHEN** the selected period is August and the user steps next
- **THEN** the screen shows September with its full range label

#### Scenario: Stepping years across the year boundary

- **WHEN** the selected period is a year and the user steps next
- **THEN** the screen shows the following year with a label that includes it

#### Scenario: Swiping between periods

- **WHEN** the user swipes left over the chart section
- **THEN** the screen shows the next period exactly as with the next control (swiping right steps to the previous one), the donut chart following the swipe - the adjacent period's chart sliding in during the drag and the step settling on release - while the rest of the screen stays static

#### Scenario: Navigating into the future

- **WHEN** the selected period is the current period and the user steps next
- **THEN** the next (future) period is shown with its empty state and both navigation controls remain enabled

### Requirement: Period attribution

A transaction SHALL belong to the selected period iff its occurred-at
instant falls within that period in the device's local timezone. Weeks SHALL
start on Monday. This attribution SHALL be identical across every
period-scoped figure shown on a screen (totals, donut segments, legend,
category rows, percentages).

#### Scenario: Transaction at a period boundary

- **WHEN** a transaction occurs at 00:30 local time on the first day of a week, month, or year
- **THEN** it is attributed to that new period in every period-scoped figure and to no figure of the preceding period

#### Scenario: Transaction at the end of a period

- **WHEN** a transaction occurs at 23:30 local time on the last day of a period
- **THEN** it is attributed to that period and not to the following one

### Requirement: Category breakdown

The detail screen SHALL list every category of the direction, ordered by
total descending (categories without movement keep their place, at 0), each
row showing the category's amount and its percentage of the direction's
FULL period total, plus a leading summary row («Все расходы» / «Все
доходы») with the direction total and 100%. Each category row SHALL carry a
checkbox controlling whether the category appears in the donut; the summary
row's checkbox SHALL be a master toggle — on iff every category is included,
tapping it includes or excludes all. Percentages SHALL always be computed
against the full period total, regardless of checkbox state. Tapping a
category row outside its checkbox SHALL open that category's transaction
sheet scoped to the same period and direction. Transfers SHALL be excluded
from both directions: a transfer is neither income nor expense. A period
without movement SHALL render the same composition with zero figures —
total 0, every category row at 0 and 0% — instead of a separate empty
state. Changing the period SHALL reset selection and checkbox filtering to
the complete picture.

#### Scenario: Breakdown with percentages

- **WHEN** the selected period contains expenses of 20 113 ₽ in «Такси» out of 30 325 ₽ total
- **THEN** the breakdown lists «Такси» with its amount and percentage (66,32%) in descending order below the summary row showing 30 325 ₽ and 100%

#### Scenario: Transfers excluded

- **WHEN** the selected period contains transfers between the user's accounts
- **THEN** they appear in neither the expenses nor the income figures

#### Scenario: Single category in period

- **WHEN** the selected period contains movement in exactly one category
- **THEN** that row shows 100% and the summary row shows the same total

#### Scenario: Excluding categories from the donut

- **WHEN** the user unchecks two of five category rows
- **THEN** the donut charts only the three checked categories (renormalized to fill the ring) while every row keeps its full-total amount and percentage

#### Scenario: Master toggle

- **WHEN** the user unchecks the «Все расходы» checkbox and every category checkbox turns off
- **THEN** the donut renders as a single neutral grey ring; checking the master checkbox back restores every segment

#### Scenario: Category drill-down

- **WHEN** the user taps a category row outside its checkbox
- **THEN** that category's transaction sheet opens showing the category's transactions for the selected period (week, month, and year alike), with the period navigable inside the sheet

#### Scenario: Empty period keeps the full layout

- **WHEN** the selected period contains no transactions of the direction
- **THEN** the screen renders exactly as with data but zeroed: the total shows 0, and every direction category is listed with a 0 amount and 0%

### Requirement: Donut presentation

Donut charts SHALL render one segment per displayed category, sized
proportionally to the category's share of the charted total, colored with
the category's color, with a small visual gap between segments. The tab
cards' small charts SHALL display at most five categories individually; the
remainder SHALL be aggregated into one «Прочие» segment, and the accompanying
legend SHALL mirror exactly what the chart shows. The detail chart SHALL
display every included category individually — no cap and no «Прочие»
aggregate. A period with movement in exactly one category SHALL render as a
full ring without gaps. When the period has no movement, the tab cards
SHALL render the chart as a single neutral grey ring with the direction's
zero total in the center, and SHALL show the empty-state message in place
of the legend (the detail screen likewise renders its zeroed full layout —
see the breakdown requirement). The donut center SHALL show the direction
total on the tab cards and the selected period's range label on the detail
screen.

#### Scenario: Many categories aggregate into «Прочие»

- **WHEN** the current month has movement in seven categories
- **THEN** the tab card's donut shows the five largest categories plus one «Прочие» segment covering the remaining two, and the legend lists those six entries

#### Scenario: Segment colors match categories

- **WHEN** a category with a violet color is among the displayed categories
- **THEN** its donut segment and its legend marker are both violet

#### Scenario: Empty period renders the neutral ring (tab cards)

- **WHEN** the current month contains no transactions of a direction
- **THEN** that tab card's donut renders as a single neutral grey ring with the zero direction total in its center, and the empty-state message (e.g. «Нет расходов за этот период») is shown in place of the legend

### Requirement: Interactive detail donut

The detail donut SHALL reflect the breakdown's checkboxes: only included
categories are charted, and their segments SHALL be sized proportionally to
the INCLUDED total (the ring stays full — excluding a category grows the
remaining segments). When nothing is chartable — a period without movement
or every category excluded — the chart SHALL render as a single neutral
grey ring with the period label still in its center.
Tapping a segment SHALL select its category: the tapped segment scales up in
place (the chart does not reorder) while the other segments dim, and in the
breakdown list the selected category's row moves to the top (below the
summary row) while the other rows dim; tapping the selected segment again
SHALL clear the selection, and changing the period SHALL clear both
selection and filtering.

#### Scenario: Selecting a segment emphasizes the category

- **WHEN** the user taps the «Такси» segment
- **THEN** that segment scales up in place, the other segments dim, and «Такси» becomes the first category row below the summary row with the other rows dimmed

#### Scenario: Deselecting

- **WHEN** the user taps the selected segment again
- **THEN** all segments and breakdown rows return to their normal, unfiltered state

#### Scenario: All categories excluded

- **WHEN** every category checkbox is unchecked
- **THEN** the donut renders as a single neutral grey ring and the period label remains in its center

### Requirement: Currency of analytics figures

Analytics figures SHALL be computed per currency as integer minor-unit
sums of transaction amounts; sums SHALL NOT cross currencies. Account-less
amounts join the display-currency bucket. When a period's figures span
more than one currency, the screens SHALL additionally present a
converted total in the display currency, computed per the exchange-rates
capability, marked approximate («≈»), and accompanied by the rate's
as-of date; donut composition, percentages, and category ordering SHALL
follow the converted figures in that case. When a required rate is not
cached, the converted total SHALL be omitted and per-currency figures
SHALL remain.

#### Scenario: Totals are plain minor-unit sums

- **WHEN** the selected period contains transactions of 20 113 ₽ and 10 212 ₽ in one direction and one currency
- **THEN** the direction total is exactly 30 325 ₽, computed as an integer sum of minor units

#### Scenario: Mixed-currency period shows per-currency and converted totals

- **WHEN** the selected period contains expenses of 20 113 ₽ and $100.00 with display currency RUB
- **THEN** the expenses figure shows the per-currency totals 20 113 ₽ and $100.00 plus an «≈» converted total in RUB with the rate date, and donut segments and percentages follow the converted figures

#### Scenario: Missing rate keeps per-currency figures

- **WHEN** a converted total needs a pair with no cached rate
- **THEN** the converted total is omitted and both per-currency totals are shown

### Requirement: Adjustment transactions are excluded from direction figures

Adjustment transactions SHALL be excluded from every income and expense
figure the analytics capability computes: direction totals, per-category
totals and percentages, and donut compositions, on the overview cards and
the detail screens alike. An adjustment is neither income nor expense; it
corrects a balance without representing a money-flow event. Adjustment
transactions SHALL nonetheless remain visible in period-scoped transaction
listings (subject to the transaction type filter).

#### Scenario: Adjustments excluded from overview cards

- **WHEN** the current month contains expenses of 5000, income of 3000, and an adjustment of -2000 on one of the accounts
- **THEN** the overview cards show an expenses total of 5000 and an income total of 3000, and the adjustment contributes to neither

#### Scenario: Adjustments excluded from category breakdown

- **WHEN** the selected period contains expenses of 20113 in «Такси» and an adjustment of -2000
- **THEN** the breakdown shows the direction total of 20113 with «Такси» at 100%, and the adjustment appears in no category row and no total

#### Scenario: Adjustment visible in the period's transaction listing

- **WHEN** the user opens a period-scoped transaction listing that includes an adjustment transaction
- **THEN** the listing shows the adjustment with its signed amount and no category
