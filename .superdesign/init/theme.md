# theme.md — design tokens (apps/web + packages/tokens)

## Part 1 — Compact token summary

Stack: Tailwind CSS v4 CSS-first (`@theme`), no tailwind.config file. Shared palette lives in the workspace package `@trata/tokens` (imported by `apps/web/src/style.css` line 3 as `@import '@trata/tokens/css'`). App CSS must NOT re-declare shared values — web-only extras (chart/sidebar/avatar vars) live in `apps/web/src/style.css`. A MOBILE copy (`mobile.css`) must keep identical sRGB hex values (mobile copy is canonical).

### Fonts
- Family: `"Outfit", system-ui, -apple-system, sans-serif` (Google Fonts import, weights 400/500/600/700). `--font-heading: var(--font-sans)`.
- Applied on `body` in the tokens base layer. Type scale = Tailwind defaults (`text-sm` body, `text-2xl font-bold` hero numbers).

### Border radius (web)
`--radius: 0.625rem` (10px) · `--radius-sm: 2px` · `--radius-md: 4px` · `--radius-lg: var(--radius)` · `--radius-xl: calc(var(--radius) + 4px)`. (Mobile copy: 10/2/4/10/14 px; `--radius-sm/md` literals must stay identical across copies.)

### Light theme (`:root`)
| Token | Value |
|---|---|
| background / foreground | `#ffffff` / `#1b1927` |
| card / card-foreground | `#ffffff` / `#1b1927` |
| popover / popover-foreground | `#ffffff` / `#1b1927` |
| primary / primary-foreground | `#6366f1` (indigo) / `#ffffff` |
| secondary / secondary-foreground | `#e9e4fb` / `#312e58` |
| muted / muted-foreground | `#f0ede6` (warm paper) / `#6e6b7c` |
| accent / accent-foreground | `#e4ddfe` (pastel lavender) / `#312e58` |
| brand-aliceblue / brand-indigo / brand-violet / brand-lilac | `#f1f3fd` / `#6366f1` / `#7c5cff` / `#a78bfa` |
| brand-orange / brand-green / brand-leaf | `#f97316` / `#22c55e` / `#16a34a` |
| destructive (fg) | `#dc2626` (`#ffffff`) |
| border / input / ring | `#e4dded` / `#1b1927` / `#6366f1` |
| success (fg) / warning (fg) | `#16a34a` (`#ffffff`) / `#ea580c` (`#ffffff`) |

### Dark theme (`.dark`) — defined but NOT wired (no theme switcher in UI)
background `#16151c` · foreground `#f4f2fa` · card `#211f2b` · primary `#818cf8` · secondary `#2c2a3e`/`#ddd8f6` · muted `#26242f`/`#a5a3b2` · accent `#312e45`/`#ddd8f6` · destructive `#ef4444` · border/input `#57526b` · ring `#818cf8` · success `#22c55e` · warning `#f97316`. Brand accents identical to light.

### Web-only extras (`apps/web/src/style.css`, sanctioned exception, sRGB)
- Charts: light `--chart-1..5` = `#ec5600 #009488 #104e64 #fabc00 #f69e00`; dark = `#1447e6 #00b981 #f69e00 #ab4eff #ff2357`.
- Sidebar set (currently unused visually — no sidebar yet): light `--sidebar:#ffffff`, `--sidebar-foreground:#1b1927`, `--sidebar-primary:#6366f1`, `--sidebar-primary-foreground:#ffffff`, `--sidebar-accent:#e4ddfe`, `--sidebar-accent-foreground:#312e58`, `--sidebar-border:#1b1927`, `--sidebar-ring:#6366f1`; dark variants in `.dark`.
- Account avatar palette `--avatar-color-1..16`: light pastels `#f0afc2 #f4b0ac #f1b499 #e7bb8c #d8c288 #c5ca8e #aed09c #99d4b0 #88d6c6 #83d4da #8ad0eb #9acaf6 #afc2f9 #c5bbf4 #d8b5e9 #e7b1d7`; dark deeps `#621f38 #651f21 #632500 #553100 #493800 #3c3e00 #214502 #004728 #00453c #004348 #004154 #003d68 #26356e #3d2e69 #4d275e #59224d`.

### Shadows / spacing / breakpoints
- No custom shadow tokens on web (Tailwind `shadow-sm` etc.). Mobile copy defines soft-brutalist `shadow-card { 0 0 24px -8px rgba(0,0,0,.2) }` and `shadow-fab { 0 0 12px 4px rgba(0,0,0,.1) }`.
- Spacing = Tailwind v4 defaults. Container: `mx-auto max-w-5xl px-4 py-6` (AppShell main).

### Base layer
`* { @apply border-border outline-ring/50 }`, `body { @apply bg-background text-foreground; font-family: "Outfit", … }`. Dark variant declared as `@custom-variant dark (&:is(.dark *))` in `style.css`.

### Sync constraints (hard gates)
1. Any palette change must be made in BOTH `packages/tokens/src/index.css` (`:root`/`.dark`) and `packages/tokens/src/mobile.css` (`@variant light/dark`, `--color-*` prefixed) with **identical sRGB hex strings** — `apps/mobile/src/shared/lib/design-tokens-sync.test.ts` fails otherwise. No oklch.
2. `--radius-sm`/`--radius-md` literals must stay identical across copies.
3. Mobile `design-tokens-guard.test.ts` bans raw hex in mobile app code (only 2 data-file exemptions) — palette lives ONLY in the tokens package.

## Part 2 — Raw sources

### `packages/tokens/src/index.css`
```css
/**
 * Design tokens (web copy) - CSS custom properties for Tailwind CSS v4.
 *
 * Consumed by apps/web via `@import '@trata/tokens/css'`. The
 * MOBILE copy lives in `packages/tokens/src/mobile.css` (Uniwind
 * `@variant light/dark` blocks - React Native cannot use `.dark` class
 * selectors). Keep the two in sync by hand: same sRGB hex values, no
 * oklch/color conversion. The MOBILE copy is canonical (decided
 * 2026-08-20): when copies disagree, this web copy syncs to it.
 *
 * Palette direction: Pastel Playful Fintech with Soft-Brutalist influences -
 * warm paper background, ink lines, indigo brand primary, pastel lavender
 * fills, and a vivid "brand" accent palette.
 */

@import "tailwindcss";

@theme inline {
  --font-heading: var(--font-sans);

  /* Border radius (sm/md are literal px - the mobile copy is canonical,
   * decided 2026-08-20; do not reintroduce calc() drift here) */
  --radius: 0.625rem;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  /* Semantic colors (will be overridden by :root and .dark below) */
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
    font-family: "Outfit", system-ui, -apple-system, sans-serif;
  }
}

:root {
  /* Radius base */
  --radius: 0.625rem;

  /* Light theme */
  --background: #ffffff;
  --foreground: #1b1927;
  --card: #ffffff;
  --card-foreground: #1b1927;
  --popover: #ffffff;
  --popover-foreground: #1b1927;
  --primary: #6366f1;
  --primary-foreground: #ffffff;
  --secondary: #e9e4fb;
  --secondary-foreground: #312e58;
  --muted: #f0ede6;
  --muted-foreground: #6e6b7c;
  --accent: #e4ddfe;
  --accent-foreground: #312e58;
  --brand-aliceblue: #f1f3fd;
  --brand-indigo: #6366f1;
  --brand-violet: #7c5cff;
  --brand-lilac: #a78bfa;
  --brand-orange: #f97316;
  --brand-green: #22c55e;
  --brand-leaf: #16a34a;
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;
  --border: #e4dded;
  --input: #1b1927;
  --ring: #6366f1;
  --success: #16a34a;
  --success-foreground: #ffffff;
  --warning: #ea580c;
  --warning-foreground: #ffffff;
}

.dark {
  /* Dark theme */
  --background: #16151c;
  --foreground: #f4f2fa;
  --card: #211f2b;
  --card-foreground: #f4f2fa;
  --popover: #211f2b;
  --popover-foreground: #f4f2fa;
  --primary: #818cf8;
  --primary-foreground: #16151c;
  --secondary: #2c2a3e;
  --secondary-foreground: #ddd8f6;
  --muted: #26242f;
  --muted-foreground: #a5a3b2;
  --accent: #312e45;
  --accent-foreground: #ddd8f6;
  --brand-aliceblue: #f1f3fd;
  --brand-indigo: #6366f1;
  --brand-violet: #7c5cff;
  --brand-lilac: #a78bfa;
  --brand-orange: #f97316;
  --brand-green: #22c55e;
  --brand-leaf: #16a34a;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: #57526b;
  --input: #57526b;
  --ring: #818cf8;
  --success: #22c55e;
  --success-foreground: #16151c;
  --warning: #f97316;
  --warning-foreground: #16151c;
}
```


### `packages/tokens/src/mobile.css`
```css
/**
 * Design tokens (mobile copy) - Uniwind / Tailwind CSS v4 theme.
 *
 * Imported by apps/mobile/global.css via
 * `@import '@trata/tokens/mobile'` (the app entry keeps only the
 * framework imports: 'tailwindcss' and 'uniwind'). Contains the mobile theme:
 * `@theme` statics, the soft-brutalist card shadow utility, and the per-theme
 * semantic colors as `@variant light/dark` blocks (React Native has no DOM, so
 * the web copy's `.dark` class selectors cannot be used here).
 *
 * The WEB copy of the same palette lives in src/index.css (:root/.dark).
 * Keep the two in sync by hand: same sRGB hex values, no oklch/conversion.
 */

@theme {
  /* Border radius (base = 10px; web uses rem equivalents in the web copy) */
  --radius: 10px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 10px;
  --radius-xl: 14px;

  /* Single font only - React Native has no font fallback chains */
  --font-sans: 'Outfit';

  /* Plain neutrals as first-class tokens (scrim, on-accent icon color). */
  --color-white: #ffffff;
  --color-black: #000000;
}

/**
 * Soft-brutalist card contour: a hard offset shadow in the same ink the
 * `border` token uses per theme. `light-dark()` is allowed in `@utility`,
 * but not in `@theme`.
 */
@utility shadow-card {
  box-shadow: 0px 0px 24px -8px rgba(0, 0, 0, 0.2);
}

/**
 * The speed-dial FAB's soft elevation halo.
 */
@utility shadow-fab {
  box-shadow: 0px 0px 12px 4px rgba(0, 0, 0, 0.1);
}

/**
 * Semantic colors per theme. Light and dark must define the exact same set of
 * variables (mismatched sets are a runtime error). Classes like `bg-background`
 * resolve the active theme's value automatically.
 */
@layer theme {
  :root {
    @variant light {
      --color-background: #ffffff;
      --color-foreground: #1b1927;
      --color-card: #ffffff;
      --color-card-foreground: #1b1927;
      --color-primary: #6366f1;
      --color-primary-foreground: #ffffff;
      --color-secondary: #e9e4fb;
      --color-secondary-foreground: #312e58;
      --color-muted: #f0ede6;
      --color-muted-foreground: #6e6b7c;
      --color-accent: #e4ddfe;
      --color-accent-foreground: #312e58;
      --color-popover: #ffffff;
      --color-popover-foreground: #1b1927;
      --color-brand-aliceblue: #f1f3fd;
      --color-brand-indigo: #6366f1;
      --color-brand-violet: #7c5cff;
      --color-brand-lilac: #a78bfa;
      --color-brand-orange: #f97316;
      --color-brand-green: #22c55e;
      --color-brand-leaf: #16a34a;
      --color-destructive: #dc2626;
      --color-destructive-foreground: #ffffff;
      --color-border: #e4dded;
      --color-input: #1b1927;
      --color-ring: #6366f1;
      --color-success: #16a34a;
      --color-success-foreground: #ffffff;
      --color-warning: #ea580c;
      --color-warning-foreground: #ffffff;
    }

    @variant dark {
      --color-background: #16151c;
      --color-foreground: #f4f2fa;
      --color-card: #211f2b;
      --color-card-foreground: #f4f2fa;
      --color-primary: #818cf8;
      --color-primary-foreground: #16151c;
      --color-secondary: #2c2a3e;
      --color-secondary-foreground: #ddd8f6;
      --color-muted: #26242f;
      --color-muted-foreground: #a5a3b2;
      --color-accent: #312e45;
      --color-accent-foreground: #ddd8f6;
      --color-popover: #211f2b;
      --color-popover-foreground: #f4f2fa;
      --color-brand-aliceblue: #f1f3fd;
      --color-brand-indigo: #6366f1;
      --color-brand-violet: #7c5cff;
      --color-brand-lilac: #a78bfa;
      --color-brand-orange: #f97316;
      --color-brand-green: #22c55e;
      --color-brand-leaf: #16a34a;
      --color-destructive: #ef4444;
      --color-destructive-foreground: #ffffff;
      --color-border: #57526b;
      --color-input: #57526b;
      --color-ring: #818cf8;
      --color-success: #22c55e;
      --color-success-foreground: #16151c;
      --color-warning: #f97316;
      --color-warning-foreground: #16151c;
    }
  }
}
```


### `apps/web/src/style.css`
```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');

@import '@trata/tokens/css';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

/*
 * The shared semantic palette (:root/.dark, radius, base layer, Tailwind) is
 * imported from @trata/tokens/css above - do NOT re-declare it here.
 * This file only carries web-only extras: the Tailwind `--color-*` wiring for
 * them plus chart/sidebar/avatar values (sRGB hex; keep them sRGB so the web
 * copy stays diff-able against apps/mobile/global.css).
 */
@theme inline {
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
}

:root {
  --chart-1: #ec5600;
  --chart-2: #009488;
  --chart-3: #104e64;
  --chart-4: #fabc00;
  --chart-5: #f69e00;
  --sidebar: #ffffff;
  --sidebar-foreground: #1b1927;
  --sidebar-primary: #6366f1;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #e4ddfe;
  --sidebar-accent-foreground: #312e58;
  --sidebar-border: #1b1927;
  --sidebar-ring: #6366f1;

  --avatar-color-1: #f0afc2;
  --avatar-color-2: #f4b0ac;
  --avatar-color-3: #f1b499;
  --avatar-color-4: #e7bb8c;
  --avatar-color-5: #d8c288;
  --avatar-color-6: #c5ca8e;
  --avatar-color-7: #aed09c;
  --avatar-color-8: #99d4b0;
  --avatar-color-9: #88d6c6;
  --avatar-color-10: #83d4da;
  --avatar-color-11: #8ad0eb;
  --avatar-color-12: #9acaf6;
  --avatar-color-13: #afc2f9;
  --avatar-color-14: #c5bbf4;
  --avatar-color-15: #d8b5e9;
  --avatar-color-16: #e7b1d7;
}

.dark {
  --chart-1: #1447e6;
  --chart-2: #00b981;
  --chart-3: #f69e00;
  --chart-4: #ab4eff;
  --chart-5: #ff2357;
  --sidebar: #211f2b;
  --sidebar-foreground: #f4f2fa;
  --sidebar-primary: #818cf8;
  --sidebar-primary-foreground: #16151c;
  --sidebar-accent: #312e45;
  --sidebar-accent-foreground: #ddd8f6;
  --sidebar-border: #57526b;
  --sidebar-ring: #818cf8;

  --avatar-color-1: #621f38;
  --avatar-color-2: #651f21;
  --avatar-color-3: #632500;
  --avatar-color-4: #553100;
  --avatar-color-5: #493800;
  --avatar-color-6: #3c3e00;
  --avatar-color-7: #214502;
  --avatar-color-8: #004728;
  --avatar-color-9: #00453c;
  --avatar-color-10: #004348;
  --avatar-color-11: #004154;
  --avatar-color-12: #003d68;
  --avatar-color-13: #26356e;
  --avatar-color-14: #3d2e69;
  --avatar-color-15: #4d275e;
  --avatar-color-16: #59224d;
}
```
