-- Re-add the dropped free-text note columns with their original definition
-- (000003_add_debts): nullable history is not restored, only the shape.
ALTER TABLE debtors ADD COLUMN note TEXT NOT NULL DEFAULT '';

ALTER TABLE debt_operations ADD COLUMN note TEXT NOT NULL DEFAULT '';
