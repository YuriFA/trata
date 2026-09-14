// Locale-derived base-currency proposal (multi-currency, app-currency spec):
// when a device meets its household still on the server-default RUB while the
// device locale maps to a different catalog currency, the app suggests the
// switch once. The mapping is region-based over the supported catalog;
// anything outside it proposes nothing.

import { DEFAULT_CURRENCY, type CurrencyCode } from '@trata/money'

// The euro area: every member state's region resolves to EUR.
const EURO_REGIONS = [
  'AT',
  'BE',
  'HR',
  'CY',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PT',
  'SK',
  'SI',
  'ES',
]

const REGION_CURRENCIES: Record<string, CurrencyCode> = {
  US: 'USD',
  GB: 'GBP',
  CN: 'CNY',
  TR: 'TRY',
  PL: 'PLN',
  GE: 'GEL',
  KZ: 'KZT',
  UA: 'UAH',
  AM: 'AMD',
  AZ: 'AZN',
  UZ: 'UZS',
  KG: 'KGS',
  RS: 'RSD',
  IL: 'ILS',
  AE: 'AED',
  TH: 'THB',
  RU: DEFAULT_CURRENCY,
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, 'EUR' as CurrencyCode])),
}

/**
 * The catalog currency for a BCP-47 locale ('tr-TR' → TRY), or null when the
 * locale carries no catalog region (undetermined, or outside the catalog).
 * Exported name: the domain concept of the locale-proposal rule; the
 * `Intl.Locale` maximization is the non-obvious part it names.
 */
export function localeCurrency(language: string): CurrencyCode | null {
  try {
    const region = new Intl.Locale(language).maximize().region
    return (region && REGION_CURRENCIES[region]) || null
  } catch {
    return null
  }
}
