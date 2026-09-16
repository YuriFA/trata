-- The debts domain loses the free-text note: debtors and debt operations are
-- their ledger and their name, nothing more (simplify-debt-domain). The data
-- is dropped without copy-out.
ALTER TABLE debtors DROP COLUMN note;

ALTER TABLE debt_operations DROP COLUMN note;
