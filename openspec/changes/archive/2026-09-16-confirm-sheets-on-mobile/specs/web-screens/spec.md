## MODIFIED Requirements

### Requirement: Mobile overlay presentation

On viewports narrower than 768px, the modal overlay surfaces of the shared
feature set — creation and edit forms, detail and history lists, the
transactions filter panel, and destructive and decision confirmations
(delete, remove, leave, dissolve, code rotation, ownership gate) — SHALL be
presented as bottom-sheet drawers anchored to the bottom edge, dismissible
by swipe-down and by a close affordance. On viewports of 768px and wider the
same surfaces SHALL be presented as centered dialogs, and confirmations
SHALL be compact centered dialogs. A confirmation SHALL NOT be presented as
a centered dialog layered beneath an open bottom-sheet drawer: a centered
modal buried under the sheet stays modal while invisible and freezes the
page. Inside a form drawer, the account, category, and date picker rows
SHALL open a picker drawer stacked above the form drawer, and each picker
SHALL change only its own field. While a stack of drawers is open, the
content of every drawer in the stack SHALL remain exposed to the
accessibility tree. Where another requirement names a dialog or a modal
without a viewport qualifier, its presentation SHALL follow this
requirement.

#### Scenario: Form opens as a drawer on a phone

- **WHEN** the user opens a creation or edit overlay at a viewport narrower
  than 768px
- **THEN** it is presented as a bottom-sheet drawer, and swipe-down or the
  close affordance dismisses it

#### Scenario: Centered dialog on desktop widths

- **WHEN** the same overlay is opened at a viewport of 768px or wider
- **THEN** it is presented as a centered dialog

#### Scenario: Destructive confirms open as a drawer on a phone

- **WHEN** a delete, remove, leave, dissolve, code-rotation, or
  ownership-gate confirmation opens at a phone viewport
- **THEN** it is presented as a bottom-sheet drawer that stays visible and
  interactive above any already-open drawer

#### Scenario: Confirms stay compact and centered on desktop widths

- **WHEN** a confirmation opens at a viewport of 768px or wider
- **THEN** it is presented as a compact centered dialog regardless of any
  other open overlay

#### Scenario: Picker opens stacked above the form

- **WHEN** the user activates the account, category, or date picker row
  inside a form drawer
- **THEN** a picker drawer opens stacked above the form drawer and only
  that field changes

#### Scenario: Drawer stack stays accessible

- **WHEN** a picker drawer is open above a form drawer
- **THEN** the content of both drawers remains exposed to the accessibility
  tree

#### Scenario: Filters open as a drawer on a phone

- **WHEN** the user opens the transactions filters at a viewport narrower
  than 768px
- **THEN** the filter panel is presented as a bottom-sheet drawer; at 768px
  and wider the side panel remains
