import {
  AED,
  AMD,
  AZN,
  CNY,
  EUR,
  GBP,
  GEL,
  ILS,
  KGS,
  KZT,
  PLN,
  RSD,
  RUB,
  THB,
  TRY,
  UAH,
  USD,
  UZS,
} from 'dinero.js/currencies'
import type { DineroCurrency } from 'dinero.js'

/**
 * The supported currency catalog: 18 ISO currencies, all two-decimal, so a
 * single minor-unit divisor (100) holds at every storage/transport/sync
 * boundary. The catalog is a fixed list - expanding it must land together
 * with the DB check constraint and the OpenAPI enum in the same coordinated
 * change (never free-form currency strings).
 */
export const CURRENCY_MAP = {
  USD,
  EUR,
  RUB,
  GBP,
  CNY,
  TRY,
  PLN,
  GEL,
  KZT,
  UAH,
  AMD,
  AZN,
  UZS,
  KGS,
  RSD,
  ILS,
  AED,
  THB,
} as const satisfies Record<string, DineroCurrency<number>>

export const AVAILABLE_CURRENCIES = Object.keys(CURRENCY_MAP) as (keyof typeof CURRENCY_MAP)[]
export type CurrencyCode = keyof typeof CURRENCY_MAP

export const DEFAULT_CURRENCY: CurrencyCode = 'RUB'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (AVAILABLE_CURRENCIES as readonly string[]).includes(value)
}

export function getDineroCurrency(code: CurrencyCode): DineroCurrency<number> {
  return CURRENCY_MAP[code]
}
