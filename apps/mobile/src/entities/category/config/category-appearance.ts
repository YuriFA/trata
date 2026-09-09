// Canonical category appearance set: the closed emoji vocabulary plus the
// pre-paired background color every category creation UI offers (spec:
// "an icon chosen from the predefined list of that type; the color is
// auto-assigned from the icon's pre-paired color"). One icon = one color;
// the pair travels together and the user only picks the emoji. This file
// is the CANONICAL copy - the web app mirrors it and a drift guard test
// fails when the two diverge (same model as the design-tokens palette).
//
// Colors are raw hex DATA rendered via inline styles (tinted circle
// backgrounds, chart fills), not Uniwind classes - which is why this file
// sits on the design-tokens-guard exemption list. Hues are hand-picked to
// stay mutually distinct (charts rely on it) within the muted band the
// web palette established.
//
// Glyphs are single-codepoint emoji only (no ZWJ sequences): they render
// predictably across the platform emoji fonts and older Android.

import type { CategoryType } from '@trata/api'

export interface CategoryIconOption {
  icon: string
  color: string
  /** Category types this icon is offered for. */
  types: readonly CategoryType[]
}

export const CATEGORY_ICONS: readonly CategoryIconOption[] = [
  // Food
  { icon: '🛒', color: '#16a34a', types: ['expense'] }, // groceries
  { icon: '🍽️', color: '#ea580c', types: ['expense'] }, // restaurant
  { icon: '☕', color: '#92400e', types: ['expense'] }, // cafes
  { icon: '🛵', color: '#e11d48', types: ['expense'] }, // food delivery
  { icon: '🍔', color: '#dc2626', types: ['expense'] }, // fast food
  { icon: '🍭', color: '#f472b6', types: ['expense'] }, // sweets / junk food
  { icon: '🚬', color: '#1f2937', types: ['expense'] }, // cigarettes
  { icon: '🍺', color: '#9a3412', types: ['expense'] }, // alcohol
  // Transport & travel
  { icon: '🚗', color: '#64748b', types: ['expense'] }, // car / taxi
  { icon: '🚌', color: '#d97706', types: ['expense'] }, // public transport
  { icon: '⛽', color: '#075985', types: ['expense'] }, // fuel
  { icon: '✈️', color: '#0284c7', types: ['expense'] }, // flight tickets
  { icon: '🏝️', color: '#0d9488', types: ['expense'] }, // vacation
  // Home
  { icon: '🏠', color: '#115e59', types: ['expense'] }, // rent / home
  { icon: '🧾', color: '#78716c', types: ['expense'] }, // utilities / bills
  { icon: '🛠️', color: '#57534e', types: ['expense'] }, // repairs
  { icon: '🛋️', color: '#a8a29e', types: ['expense'] }, // furniture / appliances
  // Health
  { icon: '💊', color: '#b91c1c', types: ['expense'] }, // pharmacy / medicine
  { icon: '🏥', color: '#166534', types: ['expense'] }, // doctors / medical care
  { icon: '💪', color: '#0891b2', types: ['expense'] }, // sport
  // Entertainment & education
  { icon: '🎬', color: '#7c3aed', types: ['expense'] }, // cinema
  { icon: '🎮', color: '#4f46e5', types: ['expense'] }, // games
  { icon: '📚', color: '#2563eb', types: ['expense'] }, // education
  // Finance & obligations
  { icon: '🏛️', color: '#312e81', types: ['expense', 'income'] }, // taxes / state support
  { icon: '🏦', color: '#334155', types: ['expense'] }, // loans / debt payments
  { icon: '🛡️', color: '#155e75', types: ['expense'] }, // insurance
  { icon: '💸', color: '#c2410c', types: ['expense'] }, // fines / fees
  // Family & personal
  { icon: '🧒', color: '#fb923c', types: ['expense'] }, // kids
  { icon: '💅', color: '#d81b60', types: ['expense'] }, // beauty / hairdresser
  { icon: '🌷', color: '#4d7c0f', types: ['expense'] }, // garden / dacha
  // Singles
  { icon: '👕', color: '#c026d3', types: ['expense'] }, // clothing
  { icon: '📱', color: '#65a30d', types: ['expense'] }, // connection / internet
  { icon: '📺', color: '#9333ea', types: ['expense'] }, // subscriptions
  { icon: '🐾', color: '#14b8a6', types: ['expense'] }, // pets
  { icon: '🎁', color: '#db2777', types: ['expense', 'income'] }, // gifts
  { icon: '❤️', color: '#9f1239', types: ['expense'] }, // charity
  { icon: '🏢', color: '#1e40af', types: ['expense'] }, // office
  // Income
  { icon: '💼', color: '#6d28d9', types: ['income'] }, // salary
  { icon: '🖥️', color: '#475569', types: ['income'] }, // freelance
  { icon: '🔧', color: '#78350f', types: ['income'] }, // odd jobs / side gigs
  { icon: '🚀', color: '#facc15', types: ['income'] }, // additional earnings
  { icon: '📈', color: '#059669', types: ['income'] }, // investments
  { icon: '💰', color: '#a16207', types: ['income'] }, // savings
  { icon: '🎉', color: '#ca8a04', types: ['income'] }, // bonuses
  { icon: '🤝', color: '#86198f', types: ['income'] }, // cashback / referrals
  { icon: '🧧', color: '#be123c', types: ['income'] }, // money gifts
  { icon: '📦', color: '#a78bfa', types: ['income'] }, // selling things
  { icon: '🔑', color: '#0f766e', types: ['income'] }, // rental income
  { icon: '💵', color: '#15803d', types: ['income'] }, // other income
]

/** Icons offered for a category of the given type (picker filter). */
export function categoryIconsForType(type: CategoryType): readonly CategoryIconOption[] {
  return CATEGORY_ICONS.filter((option) => option.types.includes(type))
}

/** Default picker selection for a category type. */
export function defaultCategoryIcon(type: CategoryType): string {
  return type === 'income' ? '💼' : '🛒'
}

/**
 * Color for a category: the icon's paired color, or the nearest free
 * palette color (walking outward from the pair) when it is already taken -
 * keeps chart colors mutually distinct for as long as the palette allows.
 */
export function pickCategoryColor(icon: string, existingColors: readonly string[]): string {
  const taken = new Set(existingColors)
  const index = CATEGORY_ICONS.findIndex((option) => option.icon === icon)
  const anchor = index === -1 ? CATEGORY_ICONS[0]! : CATEGORY_ICONS[index]!
  const ordered =
    index === -1
      ? CATEGORY_ICONS
      : [...CATEGORY_ICONS.slice(index), ...CATEGORY_ICONS.slice(0, index)]
  return ordered.find((option) => !taken.has(option.color))?.color ?? anchor.color
}
