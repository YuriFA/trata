# @trata/tokens

Design tokens as CSS - the single home of the shared palette. Two
platform-specific copies live side by side in `src/` (dark-mode mechanics
differ, so one literal file cannot serve both); apps import their copy and
must not re-declare token values.

| Platform | File | App import | Theme mechanism |
|---|---|---|---|
| Web | `src/index.css` | `@import "@trata/tokens/css"` | `:root` / `.dark` + `@custom-variant dark` |
| Mobile | `src/mobile.css` | `@import "@trata/tokens/mobile"` (from `apps/mobile/global.css`) | Uniwind `@variant light/dark` inside `@layer theme` |

The web copy also carries the radius tokens, the `@theme inline` sidebar
wiring and a base layer (`border-border`, body bg/fg + Outfit font). The
mobile copy carries `@theme` statics (px radii, single font, white/black) and
the `shadow-card` soft-brutalist utility.

## The two-copy contract

Keep the two copies in sync **by hand, with identical sRGB hex values** (no
oklch, no conversion step): when changing a color, edit BOTH files with the
same hex string. sRGB keeps the copies diff-able at a glance (they sit in the
same directory). App entries (`apps/web/src/style.css`,
`apps/mobile/global.css`) stay thin - no token values in apps.

## Palette

Direction: Pastel Playful Fintech with Soft-Brutalist influences - warm paper
background, ink lines/borders, indigo primary, pastel lavender fills, plus a
vivid brand accent palette (`brand-indigo`, `brand-violet`, `brand-lilac`,
`brand-orange`, `brand-green`, `brand-leaf` - same value in both themes) used
for quick-action chips and category colors on mobile.

## License

Private package for the Trata project.
