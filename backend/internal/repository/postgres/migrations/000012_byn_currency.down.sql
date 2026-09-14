-- Restore the pre-BYN catalog check constraints (000011 state).

ALTER TABLE accounts DROP CONSTRAINT accounts_currency_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_currency_check
    CHECK (currency IN ('USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL',
                        'KZT', 'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS',
                        'AED', 'THB'));

ALTER TABLE households DROP CONSTRAINT households_currency_check;
ALTER TABLE households ADD CONSTRAINT households_currency_check
    CHECK (currency IN ('USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL',
                        'KZT', 'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS',
                        'AED', 'THB'));

ALTER TABLE debtors DROP CONSTRAINT debtors_currency_check;
ALTER TABLE debtors ADD CONSTRAINT debtors_currency_check
    CHECK (currency IN ('USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL',
                        'KZT', 'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS',
                        'AED', 'THB'));
