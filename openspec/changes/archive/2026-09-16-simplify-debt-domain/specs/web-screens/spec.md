## MODIFIED Requirements

### Requirement: Debts screens

The web app SHALL provide the debts screen satisfying the `debts`
capability: the two-direction list with summary cards, debtor history, debt
operation create/edit, and debtor creation. The screen SHALL NOT provide a
contact management form: the debtor's name is edited through a rename-only
dialog, and a debtor is deleted through a destructive action in the debtor
history whose confirmation shows the operation count and warns when the
balance is non-zero. The overlay surfaces of the screen (rename dialog,
debtor history, debt operation form) SHALL follow the Mobile overlay
presentation requirement: a bottom-sheet drawer on viewports narrower than
768px and a centered dialog on viewports of 768px and wider.

#### Scenario: Debts list and history on web

- **WHEN** the user opens the debts screen and selects a debtor
- **THEN** the debtor's operation history and balance are shown, and the
  user can record or edit operations per the debts capability

#### Scenario: Rename and delete from the history overlay

- **WHEN** the user opens a debtor's history overlay and uses the rename or delete affordance
- **THEN** rename opens a dialog with a single name field, and delete asks for confirmation showing the operation count before tombstoning the debtor and its operations
