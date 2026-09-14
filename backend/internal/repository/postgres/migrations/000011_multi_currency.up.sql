-- Multi-currency (openspec/changes/multi-currency): widen the supported
-- currency catalog to 18 two-decimal ISO currencies, give households a base
-- currency (the presentation conversion target), debtors an immutable ledger
-- currency, and transfers a destination amount for cross-currency moves.
-- The catalog is a fixed list: expanding it is a coordinated change across
-- this constraint, the OpenAPI enum and @trata/money - never a data edit.

ALTER TABLE accounts DROP CONSTRAINT accounts_currency_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_currency_check
    CHECK (currency IN ('USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL',
                        'KZT', 'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS',
                        'AED', 'THB'));

-- Cross-currency transfers store the exact credited amount in the destination
-- account's currency alongside `amount` (debited in the source currency).
-- NULL iff the two accounts share a currency; the iff-rule itself needs the
-- referenced accounts and is enforced at the service layer.
ALTER TABLE transactions ADD COLUMN destination_amount BIGINT;
ALTER TABLE transactions ADD CONSTRAINT transactions_destination_amount_positive
    CHECK (destination_amount IS NULL OR destination_amount > 0);

-- The balance view credits the transfer destination with the destination
-- amount when the two accounts' currencies differ (falls back to `amount`
-- for same-currency transfers, so old rows behave unchanged). Runs AFTER the
-- column exists.
CREATE OR REPLACE VIEW account_contributions AS
SELECT
    account_id,
    CASE
        WHEN type = 'income'  THEN amount
        WHEN type = 'expense' THEN -amount
    END AS signed
FROM transactions
WHERE type IN ('income', 'expense') AND deleted_at IS NULL
UNION ALL
SELECT from_account_id, -amount AS signed
FROM transactions
WHERE type = 'transfer' AND deleted_at IS NULL
UNION ALL
SELECT to_account_id, COALESCE(destination_amount, amount) AS signed
FROM transactions
WHERE type = 'transfer' AND deleted_at IS NULL
UNION ALL
SELECT account_id, amount AS signed
FROM transactions
WHERE type = 'adjustment' AND deleted_at IS NULL;

-- Base currency of the household: defaults to RUB at implicit creation (the
-- server default; clients propose the device locale's currency on top).
-- Editing it only changes the presentation conversion target - no stored
-- amount is ever rewritten.
ALTER TABLE households
    ADD COLUMN currency TEXT NOT NULL DEFAULT 'RUB'
        CHECK (currency IN ('USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL',
                            'KZT', 'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS',
                            'AED', 'THB'));

-- Ledger currency of a debtor: every debt operation inherits it, keeping a
-- debtor's ledger single-currency. Immutable after creation (service-level);
-- the DB default RUB is the backstop for the household default.
ALTER TABLE debtors
    ADD COLUMN currency TEXT NOT NULL DEFAULT 'RUB'
        CHECK (currency IN ('USD', 'EUR', 'RUB', 'GBP', 'CNY', 'TRY', 'PLN', 'GEL',
                            'KZT', 'UAH', 'AMD', 'AZN', 'UZS', 'KGS', 'RSD', 'ILS',
                            'AED', 'THB'));
