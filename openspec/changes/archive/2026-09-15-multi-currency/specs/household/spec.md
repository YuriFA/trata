## ADDED Requirements

### Requirement: Household base currency

The household SHALL carry a base currency from the supported currency
catalog (defined by the accounts capability). Households are created
implicitly at registration; the base currency SHALL default to RUB on
creation. The owner SHALL be able to change the base currency through
the household management surface; a change SHALL NOT rewrite,
reconvert, or re-validate any stored record - it changes only the
conversion target used for presentation from that point on. The base
currency SHALL be returned with every household response, so every
member's device learns it.

#### Scenario: Created with the server default

- **WHEN** a new user registers and their household is created
- **THEN** the household's base currency is RUB and every household response carries it

#### Scenario: Owner changes the base currency

- **WHEN** the owner changes the household's base currency from RUB to EUR
- **THEN** household responses carry EUR, stored records are unchanged, and presentation converts into EUR from then on

#### Scenario: Member cannot change it

- **WHEN** a non-owner member attempts to change the base currency
- **THEN** the request is rejected per the household management role rules
