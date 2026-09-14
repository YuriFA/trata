## MODIFIED Requirements

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
