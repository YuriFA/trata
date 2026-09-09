# Trata Mobile - Design System

## Overview

The Design System provides a unified visual language and component library for the Trata mobile app. It's built on React Native, Expo, Uniwind (Tailwind CSS v4), and TypeScript.

### Key Principles

1. **Shared Design Tokens**: Colors, typography, and spacing are shared with the web app
2. **Semantic Design**: Use semantic tokens (e.g., `bg-primary`) rather than hardcoded values
3. **FSD Architecture**: Generic components in `shared/ui`, domain-specific in their slices
4. **Accessibility First**: All interactive components support accessibility
5. **Platform Native**: Use Expo/native primitives where appropriate

## Architecture

```
src/
├── shared/
│   ├── ui/              # Generic UI primitives and components
│   ├── components/      # Domain-specific components (TODO: move to entities/features)
│   └── config/
│       └── theme/       # Theme configuration and context
├── entities/            # Domain entities (transaction, account, category)
├── features/            # Features (create-transaction, edit-transaction)
└── pages/               # Screen compositions
```

## Design Tokens

### Colors

Palette direction: **Pastel Playful Fintech with Soft-Brutalist influences** -
warm paper background, ink lines/borders, indigo primary, pastel lavender
fills, and a vivid brand accent palette. The tokens live in
`packages/tokens/src/mobile.css`, imported by `global.css` (see
"Color Tokens Source" below).

Semantic tokens (subset; full set in `packages/tokens/src/tokens/colors.rn.ts`):

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--color-background` | #faf7f2 | #16151c | Page background (warm paper) |
| `--color-foreground` | #1b1927 | #f4f2fa | Primary text (ink) |
| `--color-card` | #ffffff | #211f2b | Card surfaces |
| `--color-primary` | #6366f1 | #818cf8 | Primary actions (indigo) |
| `--color-secondary` | #e9e4fb | #2c2a3e | Secondary actions (pastel lavender) |
| `--color-muted` | #f0ede6 | #26242f | Subtle backgrounds (warm sand) |
| `--color-destructive` | #dc2626 | #ef4444 | Destructive actions |
| `--color-border` | #1b1927 | #57526b | Borders (ink line - soft-brutalist) |
| `--color-success` | #16a34a | #22c55e | Success states |
| `--color-warning` | #ea580c | #f97316 | Warning states |

Brand accent palette (vivid pops, same value in both themes) for quick-action
chips and category colors: `brand-indigo` #6366f1, `brand-violet` #7c5cff,
`brand-lilac` #a78bfa, `brand-orange` #f97316, `brand-green` #22c55e,
`brand-leaf` #16a34a.

**Color usage rules** (enforced by the `design-tokens-guard` jest test - no
raw hex/rgb/hsl literals anywhere in `src/`):

- Style-object properties → token classes: `bg-card`, `text-foreground`,
  `border-border`, `bg-success/10`, `shadow-card` (soft-brutalist offset
  contour defined in `global.css`).
- Non-style color props (`Icon color`, `ActivityIndicator color`,
  `TextInput placeholderTextColor`, ...) need the `accent-` prefix via the
  `{prop}ClassName` prop: `<Icon colorClassName="accent-primary" />`,
  `placeholderTextColorClassName="accent-muted-foreground"`. A plain
  `text-*`/`bg-*` class does NOT reach these props.
- Data-driven colors: store a COMPLETE class string in the data (e.g. a mock
  category's `'bg-brand-violet'`) so Tailwind's build-time scanner sees it.
  When the real API sends hex strings, switch that one surface to
  `style={{ backgroundColor }}` (the only sanctioned raw-color escape hatch).
- A raw value is genuinely needed in JS (reanimated worklets, gradients,
  chart configs)? Use `useCSSVariable('--color-primary')` (reactive) /
  `Uniwind.getCSSVariable(...)` (one-shot) - never hardcode hex.

### Typography

| Variant | Size | Weight | Usage |
|---------|------|--------|-------|
| `display` | 48px | bold | Hero text |
| `h1` | 36px | bold | Page titles |
| `h2` | 30px | semibold | Section headers |
| `h3` | 24px | semibold | Subsections |
| `body` | 16px | regular | Body text |
| `body-sm` | 14px | regular | Secondary text |
| `caption` | 12px | regular | Labels, hints |
| `label` | 14px | medium | Form labels |
| `button` | 16px | medium | Button text |

### Spacing

Uses Tailwind's default spacing scale:
- `1`: 4px, `2`: 8px, `3`: 12px, `4`: 16px, `5`: 20px, `6`: 24px, etc.

### Border Radius

| Token | Value |
|-------|-------|
| `--radius-sm` | 2px |
| `--radius-md` | 4px |
| `--radius-lg` | 10px |
| `--radius-xl` | 14px |

## Components

### Primitives

#### Layout (View + Uniwind)
There are no layout wrapper components - use `View` directly with Uniwind
classes (`flex-row`, `gap-*`, `items-*`, `justify-*`). Never build class names
dynamically (`gap-${gap}`): Uniwind compiles only classes it can scan.

```tsx
<View className="flex-row items-center gap-2">
  <Text>Left</Text>
  <Text>Right</Text>
</View>
```

#### Text
Typography with semantic variants.

```tsx
<Text variant="h1">Title</Text>
<Text variant="body">Body text</Text>
<Text variant="caption">Helper text</Text>
```

#### Screen
Screen wrapper with safe areas.

```tsx
<Screen>
  <View className="gap-4 p-4">
    <Text variant="h1">Dashboard</Text>
  </View>
</Screen>
```

#### Icon
Icon component using Ionicons, wrapped with `withUniwind` for className support.

```tsx
<Icon name="search" size={20} />
<Icon name="chevron-back" colorClassName="accent-primary" />
<Icon name="car" color={category.color} /> {/* dynamic data color only */}
```

### Interactive Components

#### Button
Primary action button with variants.

```tsx
<Button variant="primary" text="Save" onPress={handleSave} />
<Button variant="outline" text="Cancel" onPress={handleCancel} />
<Button variant="destructive" text="Delete" loading={isDeleting} />
```

**Variants**: `primary`, `secondary`, `outline`, `ghost`, `destructive`
**Sizes**: `sm`, `md`, `lg`

#### IconButton
Icon-only button for actions.

```tsx
<IconButton
  icon="close"
  accessibilityLabel="Close dialog"
  onPress={handleClose}
/>
```

#### Input
Text input with label, error, and icons.

```tsx
<Input
  label="Email"
  placeholder="Enter your email"
  value={email}
  onChangeText={setEmail}
  error={error}
  leadingIcon="mail"
/>
```

### Display Components

#### Card
Container for grouped content.

```tsx
<Card variant="elevated">
  <Stack gap="sm">
    <Text variant="h3">Card Title</Text>
    <Text variant="body">Card content</Text>
  </Stack>
</Card>
```

**Variants**: `default`, `outlined`, `elevated`

#### Badge
Status or category indicator.

```tsx
<Badge variant="success">Completed</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="destructive">Failed</Badge>
```

#### Divider
Visual separator.

```tsx
<Divider />
<Divider orientation="vertical" />
```

### Domain-Specific Components

#### AmountInput
Specialized input for currency amounts.

```tsx
<AmountInput
  value={amount}
  onValueChange={setAmount}
  currencySymbol="$"
  label="Amount"
  precision={2}
/>
```

Features:
- Handles decimal separator based on locale
- Stores value as cents/minor units (integer)
- Validates min/max bounds
- Formats display with currency symbol

#### TransactionRow
Display a transaction in a list.

```tsx
<TransactionRow
  transaction={{
    id: "1",
    amount: -4550,
    description: "Grocery shopping",
    category: "Food",
    date: "2024-01-15",
    type: "expense"
  }}
  onPress={handlePress}
/>
```

## Theme Switching

The app supports light/dark themes. `ThemeProvider` drives
`Uniwind.setTheme()` (default `system`); components follow the active theme
automatically via token classes - they never read theme values from a context.
A runtime switcher UI (settings) can grow a context on top of the provider
later.

```tsx
import { ThemeProvider } from "@/shared/config/theme"

<ThemeProvider defaultTheme="system">{/* app */}</ThemeProvider>
```

## FSD Rules

### Component Placement

**Place in `shared/ui` when:**
- Generic, reusable across domains
- No domain-specific logic
- Pure UI component

Examples: `Button`, `Input`, `Card`, `Badge`, `Divider`

**Place in `entities/*/ui` when:**
- Related to a domain entity
- Uses entity-specific types
- Not generic enough for shared

Examples: `TransactionRow`, `AccountCard`, `CategoryPicker`

**Place in `features/*/ui` when:**
- Implements a feature use case
- Combines multiple entities
- Feature-specific behavior

Examples: `CreateTransactionForm`, `TransactionFilters`

### Dependency Rules

```
pages → features → entities → shared
```

Lower layers can import from higher layers, but not vice versa.

## Usage Examples

### Create a Screen

```tsx
import { Screen, Text, Stack, Card, Button } from "@/shared"

export function MyScreen() {
  return (
    <Screen>
      <Stack gap="md" className="p-4">
        <Text variant="h1">My Screen</Text>
        <Card>
          <Text variant="body">Content</Text>
        </Card>
        <Button variant="primary" text="Action" onPress={handleAction} />
      </Stack>
    </Screen>
  )
}
```

### Create a Form

```tsx
import { Input, Button, Stack } from "@/shared"

export function MyForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  return (
    <Stack gap="md">
      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        leadingIcon="mail"
        keyboardType="email-address"
      />
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        leadingIcon="lock-closed"
        secureTextEntry
      />
      <Button variant="primary" text="Submit" onPress={handleSubmit} />
    </Stack>
  )
}
```

## Adding New Components

When adding a new component to `shared/ui`:

1. **Ask: Is it generic?** If domain-specific, place in entities or features
2. **Check for native/Expo alternative** - don't reinvent native controls
3. **Use semantic tokens** - no hardcoded colors or sizes
4. **Support accessibility** - add accessibilityRole, accessibilityLabel
5. **Handle states** - default, pressed, focused, disabled, loading, error
6. **Type the props** - export Props type for consumers
7. **Add index.ts** - barrel export with public API
8. **Update shared/ui/index.ts** - add to barrel export
9. **Document here** - add to this document

### Template

```tsx
// shared/ui/my-component/MyComponent.tsx
export interface MyComponentProps {
  // ... props
}

/**
 * MyComponent - Brief description
 *
 * Longer description if needed.
 *
 * @example
 * <MyComponent prop="value" />
 */
export function MyComponent(props: MyComponentProps) {
  // ... implementation
}
```

## Uniwind Setup

The app uses Uniwind (Tailwind CSS v4, CSS-first config) for styling:

1. **`global.css`** - thin entry: Tailwind/Uniwind imports +
   `@import '@trata/tokens/mobile'` (all tokens); no
   `tailwind.config.*` exists
2. **`metro.config.js`** - `withUniwindConfig` (`cssEntryFile`, `polyfills.rem: 14`)
3. **Import in `_layout.tsx`** - `global.css` imported at app root
4. **`ThemeProvider`** - Drives `Uniwind.setTheme()` for theme switching

## Color Tokens Source

All token values live in `packages/tokens` - two hand-maintained copies of the
same sRGB hex palette (dark-mode mechanics differ per platform, so one literal
file cannot serve both):

- **Mobile**: `packages/tokens/src/mobile.css` (Uniwind `@variant light/dark`),
  imported by the thin entry `apps/mobile/global.css`
- **Web**: `packages/tokens/src/index.css` (`:root`/`.dark`), imported by
  `apps/web/src/style.css`, which only adds web-only extras

To change a color: edit BOTH files with the same hex string. No oklch, no
conversion - the copies sit side by side and must stay diff-able at a glance.
App CSS entries must not re-declare token values.

## Icon System

Uses **Ionicons** from `@expo/vector-icons`.

[Browse available icons](https://icons.expo.fyi/)

Common icon names:
- Navigation: `chevron-back`, `chevron-forward`, `home`, `settings`
- Actions: `add`, `create`, `trash`, `search`, `close`
- Status: `checkmark-circle`, `alert-circle`, `information-circle`
- Inputs: `mail`, `lock-closed`, `eye`, `eye-off`

## Do's and Don'ts

### Do

- Use semantic tokens: `className="bg-primary"`
- Use `accent-*` classes via `{prop}ClassName` for non-style color props
- Place components in correct FSD slice
- Support accessibility
- Type your props
- Use existing components before creating new ones

### Don't

- Hardcode colors: `className="bg-[#2563EB]"`, `color="#7C5CFF"`
- Pass `text-*` classes to raw color props (`color={'text-primary'}`) - the
  accent- prefix is required there
- Read theme hex values in components (`colorsRN[resolvedTheme]...`) - use
  token classes or `useCSSVariable` instead
- Place domain components in `shared/ui`
- Create abstractions without clear value
- Duplicate native controls (DatePicker, Switch, Slider)
- Mix styling systems (Uniwind + StyleSheet) without reason

## Future Work

- [ ] Move `AmountInput`, `TransactionRow` to entities/features
- [ ] Add BottomSheet wrapper using `@gorhom/bottom-sheet`
- [ ] Add Tabs component
- [ ] Add Toast/Snackbar component
- [ ] Add Dialog/Modal component
- [ ] Add Checkbox/Switch components (native primitives)
- [x] Create shared design tokens package (`packages/tokens`, css-only web copy)
- [ ] Add component examples/Storybook
- [ ] Implement animation system
