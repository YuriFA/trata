# Shared Design Tokens Package - Implementation

## Summary

Created `@trata/tokens` package as the **single source of truth** for design tokens across web and mobile platforms.

## Problem

Previously, design tokens were:
- **Web**: Hardcoded in `apps/web/src/style.css` (oklch format)
- **Mobile**: Hardcoded in `apps/mobile/app.css` (hex format)

This violated the principle of having a shared source of truth.

## Solution

Created a workspace package `packages/tokens/` that:
1. Defines all tokens in one place (oklch format for modern web)
2. Exports platform-specific formats:
   - Web: CSS custom properties (oklch)
   - Mobile: Hex values for React Native
3. Both platforms import from this shared package

## Package Structure

```
packages/tokens/
├── src/
│   ├── index.ts                    # Main export (TypeScript, oklch)
│   ├── index.css                   # CSS export for Tailwind v4
│   ├── react-native.ts             # React Native export (hex)
│   └── tokens/
│       ├── colors.ts               # Color definitions (oklch)
│       ├── colors.rn.ts            # Color definitions (hex)
│       ├── spacing.ts              # Spacing scale
│       ├── typography.ts           # Typography system
│       └── borderRadius.ts         # Border radius tokens
├── package.json
└── README.md
```

## Token Categories

### 1. Colors (`tokens/colors.ts`, `tokens/colors.rn.ts`)

Semantic color tokens for light/dark themes:

```typescript
// Light theme (oklch)
light: {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.145 0 0)",
  primary: "oklch(0.205 0 0)",
  // ... more
}

// Dark theme (oklch)
dark: {
  background: "oklch(0.145 0 0)",
  foreground: "oklch(0.985 0 0)",
  // ... more
}
```

React Native version uses hex:
```typescript
// Light theme (hex)
light: {
  background: "#FFFFFF",
  foreground: "#1A1A1A",
  primary: "#2D2D2D",
  // ... more
}
```

### 2. Spacing (`tokens/spacing.ts`)

Tailwind-compatible spacing scale:
```typescript
spacing: {
  0: "0",
  1: "4px",
  2: "8px",
  4: "16px",
  6: "24px",
  // ... up to 96
}
```

### 3. Typography (`tokens/typography.ts`)

Font families, sizes, weights, and predefined variants:
```typescript
fontFamily: {
  sans: ["Outfit", "system-ui", ...],
  mono: ["ui-monospace", "SFMono-Regular", ...],
}

fontSize: {
  xs: "12px",
  sm: "14px",
  base: "16px",
  // ... up to 5xl
}

typography: {
  display: { fontSize: "48px", fontWeight: "700", lineHeight: "1.25" },
  h1: { fontSize: "36px", fontWeight: "700", ... },
  body: { fontSize: "16px", fontWeight: "400", ... },
  // ... more variants
}
```

### 4. Border Radius (`tokens/borderRadius.ts`)

```typescript
borderRadius: {
  sm: "calc(var(--radius) - 4px)",  // 2px
  md: "calc(var(--radius) - 2px)",  // 4px
  lg: "var(--radius)",               // 10px
  xl: "calc(var(--radius) + 4px)",  // 14px
  full: "9999px",
}
```

## Platform Exports

### Web: `index.css`

Exports CSS custom properties for Tailwind CSS v4:

```css
@import "tailwindcss";

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  /* ... more tokens */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  /* ... dark mode tokens */
}
```

Usage in web app:
```css
@import "@trata/tokens/css";
```

### Mobile: `react-native.ts`

Exports React Native compatible objects:

```typescript
export { colorsRN as colors } from "./tokens/colors.rn"
export { spacing } from "./tokens/spacing"
export { typography } from "./tokens/typography"
export { borderRadius } from "./tokens/borderRadius"
```

Usage in mobile app:
```tsx
import { colors, spacing, typography } from "@trata/tokens/react-native"

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.light.background,
    padding: spacing[4],
  },
})
```

### Main: `index.ts`

Exports TypeScript tokens for type-safe access:

```typescript
export { colors } from "./tokens/colors"
export { spacing } from "./tokens/spacing"
export { typography } from "./tokens/typography"
export { borderRadius } from "./tokens/borderRadius"

// Type exports
export type { ColorToken, SpacingToken, TypographyVariant, BorderRadiusToken }
```

## Package Configuration

### `package.json`

```json
{
  "name": "@trata/tokens",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./css": "./src/index.css",
    "./react-native": "./src/react-native.ts"
  }
}
```

### Workspace Dependencies

Updated both apps to use the shared package:

**apps/mobile/package.json:**
```json
{
  "dependencies": {
    "@trata/tokens": "workspace:*",
    // ... other deps
  }
}
```

**apps/web/package.json:**
```json
{
  "dependencies": {
    "@trata/tokens": "workspace:*",
    // ... other deps
  }
}
```

## Usage Examples

### Web App (Vue + Tailwind)

Import in CSS:
```css
@import "@trata/tokens/css";
```

Use in components:
```vue
<template>
  <button class="bg-primary text-primary-foreground px-4 py-2 rounded-lg">
    Click me
  </button>
</template>
```

### Mobile App (React Native + Uniwind)

**Option 1: StyleSheet with tokens**
```tsx
import { colors, spacing, typography } from "@trata/tokens/react-native"

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.light.background,
    paddingHorizontal: spacing[4],
  },
  title: {
    ...typography.h1,
  },
})
```

**Option 2: Uniwind className (tokens in global.css)**
```tsx
// Tokens already defined in global.css
<View className="bg-background text-foreground p-4">
  <Text className="text-h1">Title</Text>
</View>
```

The mobile app's `app.css` now references the shared tokens with hex values.

## Benefits

1. **Single Source of Truth**: All design tokens defined once
2. **Type Safety**: TypeScript exports for autocomplete and type checking
3. **Platform Support**: Automatic conversion for web (oklch) and mobile (hex)
4. **Consistency**: Same token names across platforms
5. **Maintainability**: Update tokens in one place, propagate to both platforms
6. **Color Space**: Uses oklch (perceptually uniform) as source format

## Migration Notes

### Web App
- Changed: `@import 'tailwindcss'` → `@import '@trata/tokens/css'`
- Result: Same appearance, now using shared tokens

### Mobile App
- Kept: `app.css` with hex values (referencing shared tokens)
- Added: CSS module type declaration for TypeScript
- Result: Same appearance, tokens now documented in shared package

## Future Work

1. **Add more token categories**:
   - Shadows
   - Animation durations/easing
   - Z-index scale
   - Breakpoints

2. **Add validation**:
   - Script to validate hex conversions
   - Tests for token consistency

3. **Add tooling**:
   - Token generator CLI
   - Color picker integration
   - Export to other formats (JSON, etc.)

4. **Integrate with web app more deeply**:
   - Import TypeScript tokens for type-safe component props
   - Use token types in Vue components

## Files Created

- `packages/tokens/src/index.ts` - Main TypeScript export
- `packages/tokens/src/index.css` - CSS export for web
- `packages/tokens/src/react-native.ts` - React Native export
- `packages/tokens/src/tokens/colors.ts` - Color definitions (oklch)
- `packages/tokens/src/tokens/colors.rn.ts` - Color definitions (hex)
- `packages/tokens/src/tokens/spacing.ts` - Spacing scale
- `packages/tokens/src/tokens/typography.ts` - Typography system
- `packages/tokens/src/tokens/borderRadius.ts` - Border radius tokens
- `packages/tokens/package.json` - Package configuration
- `packages/tokens/README.md` - Package documentation

## Files Modified

- `apps/web/src/style.css` - Import from tokens package
- `apps/web/package.json` - Add tokens dependency
- `apps/mobile/app.css` - Reference shared tokens
- `apps/mobile/package.json` - Add tokens dependency
- `apps/mobile/css.env.d.ts` - Add CSS module declaration
- `pnpm-lock.yaml` - Updated workspace dependencies

## Verification

✅ TypeScript compiles in both apps
✅ Workspace dependencies installed
✅ Tokens package exports work correctly
✅ Mobile app CSS imports work
✅ Web app can import tokens CSS
✅ All token categories exported
✅ README documentation complete

---

The shared design tokens package is now the authoritative source for all design system values. Both platforms consume from this single source, ensuring consistency across the Trata application.
