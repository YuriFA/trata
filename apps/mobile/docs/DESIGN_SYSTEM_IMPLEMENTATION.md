# Design System Implementation Summary

> Note (2026-08): the mobile app has since migrated NativeWind v4 -> Uniwind
> (Tailwind CSS v4). The current styling setup is CSS-first in `global.css` +
> `metro.config.js` (`withUniwindConfig`); there is no `tailwind.config.ts` or
> `nativewind-env.d.ts` anymore. Component files have also been renamed to
> kebab-case (`button/Button.tsx` -> `button/button.tsx`). The sections below
> describe the state at the time of that change.

## Completed Implementation

### Phase 1: Foundation ✅

#### NativeWind v4 Setup
- Installed `nativewind@4.2.6` and `tailwindcss@4`
- Created `tailwind.config.ts` with theme extension
- Created `app.css` with design tokens (colors, border radius)
- Created `nativewind-env.d.ts` for TypeScript support
- Configured CSS import in root layout

#### Theme System
- Created `ThemeProvider` component for light/dark/system theme switching
- Created `useTheme` hook for accessing theme state
- Integrated with React Native's `useColorScheme` hook
- Theme classes applied to root element

#### Design Tokens
Adapted from `apps/web/src/style.css`:
- **Semantic colors**: background, foreground, card, primary, secondary, muted, accent, destructive, border, input, ring, success, warning
- **Light/dark themes**: Complete color sets for both modes
- **Border radius**: sm (2px), md (4px), lg (10px), xl (14px)
- **Typography**: display, h1, h2, h3, body, body-sm, caption, label, button
- **Font family**: Outfit (from web) + System fallback

### Phase 2: Core Primitives ✅

Created foundational components in `shared/ui/`:

| Component | Description | File |
|-----------|-------------|------|
| **Text** | Typography with semantic variants | `text/Text.tsx` |
| **Pressable** | Interactive element wrapper | `pressable/Pressable.tsx` |
| **Screen** | Screen container with safe areas | `screen/Screen.tsx` |
| **Icon** | Icon component using Ionicons | `icon/Icon.tsx` |

Layout is plain `View` + NativeWind classes (`flex-row`, `gap-*`, `items-*`,
`justify-*`) - there are deliberately no Box/Stack/Row wrappers.

### Phase 3: Basic Components ✅

Created reusable UI components:

| Component | Variants/Options | File |
|-----------|------------------|------|
| **Button** | primary, secondary, outline, ghost, destructive; sm, md, lg; loading state | `button/Button.tsx` |
| **IconButton** | sm, md, lg; accessibility support | `icon-button/IconButton.tsx` |
| **Input** | label, error, helper text, leading/trailing icons | `input/Input.tsx` |
| **Card** | default, outlined, elevated | `card/Card.tsx` |
| **Badge** | default, primary, secondary, success, warning, destructive; sm, md | `badge/Badge.tsx` |
| **Divider** | horizontal, vertical | `divider/Divider.tsx` |

### Phase 4: Trata Specific Components ✅

Created domain-specific components in `shared/components/`:

| Component | Description | File |
|-----------|-------------|------|
| **AmountInput** | Currency-aware numeric input with decimal handling, precision, min/max | `amount-input/AmountInput.tsx` |
| **TransactionRow** | Transaction display with amount, description, category, date, type | `transaction-row/TransactionRow.tsx` |

### Phase 5: Proof of Concept ✅

Migrated screens to demonstrate the new Design System:

1. **DashboardScreen** (`pages/dashboard/ui/DashboardScreen.tsx`)
   - Uses Screen, Text, Card, Button, TransactionRow
   - Displays balance card, quick actions, recent transactions
   - Demonstrates balance formatting and transaction list

2. **LoginScreen** (`pages/login/ui/LoginScreen.tsx`)
   - Uses Screen, Text, Input, Button
   - Email/password form with icons
   - Loading states, social login buttons
   - Sign up link

## File Structure

```
packages/tokens/                    # NEW! Shared design tokens
├── src/
│   ├── index.ts                   # TypeScript export (oklch)
│   ├── index.css                  # CSS export for web
│   ├── react-native.ts            # React Native export (hex)
│   └── tokens/
│       ├── colors.ts
│       ├── colors.rn.ts
│       ├── spacing.ts
│       ├── typography.ts
│       └── borderRadius.ts
├── package.json
└── README.md

apps/mobile/src/
├── shared/
│   ├── ui/
│   │   ├── text/
│   │   │   ├── Text.tsx
│   │   │   └── index.ts
│   │   ├── pressable/
│   │   │   ├── Pressable.tsx
│   │   │   └── index.ts
│   │   ├── screen/
│   │   │   ├── Screen.tsx
│   │   │   └── index.ts
│   │   ├── icon/
│   │   │   ├── Icon.tsx
│   │   │   └── index.ts
│   │   ├── button/
│   │   │   ├── Button.tsx
│   │   │   └── index.ts
│   │   ├── icon-button/
│   │   │   ├── IconButton.tsx
│   │   │   └── index.ts
│   │   ├── input/
│   │   │   ├── Input.tsx
│   │   │   └── index.ts
│   │   ├── card/
│   │   │   ├── Card.tsx
│   │   │   └── index.ts
│   │   ├── badge/
│   │   │   ├── Badge.tsx
│   │   │   └── index.ts
│   │   ├── divider/
│   │   │   ├── Divider.tsx
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── components/
│   │   ├── amount-input/
│   │   │   ├── AmountInput.tsx
│   │   │   └── index.ts
│   │   ├── transaction-row/
│   │   │   ├── TransactionRow.tsx
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── config/
│   │   └── theme/
│   │       ├── ThemeContext.tsx
│   │       ├── ThemeProvider.tsx
│   │       └── index.ts
│   └── index.ts
├── pages/
│   ├── dashboard/ui/DashboardScreen.tsx
│   └── login/ui/LoginScreen.tsx
└── app/
    └── _layout.tsx (updated with CSS import and ThemeProvider)

apps/mobile/
├── app.css (design tokens)
├── tailwind.config.ts (Tailwind configuration)
├── nativewind-env.d.ts (NativeWind types)
└── package.json (updated dependencies)
```

## Key Design Decisions

1. **Semantic Tokens Over Hardcoded Values**
   - Components use `bg-primary` instead of `bg-[#2563EB]`
   - Enables consistent theming and easier updates

2. **Domain Component Separation**
   - Generic primitives in `shared/ui/`
   - Domain-specific in `shared/components/` (TODO: move to entities/features)
   - Clear ownership and FSD compliance

3. **NativeWind as Primary Styling**
   - Single styling layer using Tailwind classes
   - StyleSheet only used when necessary (animations, dynamic values)

4. **Accessibility First**
   - All interactive components have accessibilityRole
   - IconButton requires accessibilityLabel
   - Proper disabled/pressed states

5. **Component API Design**
   - Props are typed and exported
   - Barrel exports via index.ts
   - Clear variant/size enums

## Shared Design Tokens Package ✅

Created `@trata/tokens` package as the **single source of truth** for design tokens:

### Package Structure
```
packages/tokens/
├── src/
│   ├── index.ts          # Main export (TypeScript tokens)
│   ├── index.css         # CSS export for web (oklch format)
│   ├── react-native.ts   # React Native export (hex format)
│   └── tokens/
│       ├── colors.ts      # Color definitions (oklch)
│       ├── colors.rn.ts   # Color definitions (hex)
│       ├── spacing.ts     # Spacing scale
│       ├── typography.ts  # Typography system
│       └── borderRadius.ts # Border radius tokens
├── package.json
└── README.md
```

### Token Categories
- **Colors**: Semantic tokens for light/dark themes
- **Spacing**: Tailwind-compatible scale (0-96)
- **Typography**: Font family, sizes, weights, variants
- **Border Radius**: sm, md, lg, xl, full

### Platform Support
- **Web**: Imports CSS custom properties (oklch format)
- **Mobile**: References shared tokens in app.css (hex format)

Both platforms now share the same design token definitions.

## Reused from Web Design System

- **Color definitions**: Converted from oklch (web) to hex (mobile) in shared tokens package
- **Semantic naming**: primary, secondary, muted, accent, destructive, etc.
- **Typography scale**: display, h1-h3, body, caption, label
- **Border radius values**: sm, md, lg, xl
- **Light/dark theme structure**: Same token names for consistency

## Not Created (Intentionally)

Per the plan's guidance, these components were NOT created because they lack current use cases:

- DataGrid, Carousel, Popover, Tooltip, RichTextEditor, Accordion
- Native controls that should use Expo/native primitives when needed (DatePicker, TimePicker, Switch, Slider, Picker)

## Next Steps (Future Work)

1. **Move domain components to proper FSD slices**
   - `AmountInput` → `entities/transaction/ui` or `features/transaction/ui`
   - `TransactionRow` → `entities/transaction/ui`

2. **Add additional components as needed**
   - BottomSheet (using `@gorhom/bottom-sheet`)
   - Tabs
   - Toast/Snackbar
   - Dialog/Modal
   - Checkbox/Switch (native primitives)

3. ✅ **Create shared design tokens package** DONE!
   - ✅ Created `packages/tokens` with color, spacing, typography, border radius
   - ✅ Both web and mobile now import from shared package

4. **Add component documentation**
   - Storybook or component explorer
   - Usage examples for each component

5. **Continue migrating screens**
   - Update remaining screens to use new Design System
   - One screen at a time as features are built

## Verification

✅ TypeScript compiles without errors
✅ All components have typed props
✅ Barrel exports configured correctly
✅ Theme provider integrated
✅ Design tokens adapted from web
✅ FSD structure maintained
✅ Accessibility properties included
✅ Proof of concept screens demonstrate the system

## Documentation

- **Design System Guide**: `apps/mobile/docs/DESIGN_SYSTEM.md`
- Complete API reference for all components
- Usage examples and best practices
- FSD rules and component placement guidelines
- Icon system reference (Ionicons)
