-- Reverse of 000011: restore the pre-multi-currency catalog, the
-- same-currency-only transfer credit, and drop the added columns.

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
SELECT to_account_id, amount AS signed
FROM transactions
WHERE type = 'transfer' AND deleted_at IS NULL
UNION ALL
SELECT account_id, amount AS signed
FROM transactions
WHERE type = 'adjustment' AND deleted_at IS NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_destination_amount_positive;
ALTER TABLE transactions DROP COLUMN IF EXISTS destination_amount;
ALTER TABLE debtors DROP COLUMN IF EXISTS currency;
ALTER TABLE households DROP COLUMN IF EXISTS currency;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_currency_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_currency_check
    CHECK (currency IN ('USD', 'EUR', 'RUB'));
