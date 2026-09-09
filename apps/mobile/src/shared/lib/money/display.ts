// Live display of an amount string ("125", "125,5", "125,50", transient
// "125,"), grouped and suffixed with the currency symbol. The
// always-two-digits `formatMoney` is wrong for this: it must not pad or
// normalize digits the user is still typing. No float math - string only.

import { currencySymbol, type CurrencyCode } from '@trata/money'

const GROUP_SEPARATOR = '\u202F'
const SYMBOL_SEPARATOR = '\u00A0'

/** Groups the integer part of an amount string: "1250,5" -> "1 250,5". */
export function groupAmountInput(value: string): string {
  const [integer = '0', fraction] = value.split(',')
  const digits = integer === '' ? '0' : integer.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR)
  return fraction === undefined ? digits : `${digits},${fraction}`
}

/** Groups an amount string and appends the currency symbol: "1 250,5 ₽". */
export function formatAmountInput(value: string, currency: CurrencyCode): string {
  return `${groupAmountInput(value)}${SYMBOL_SEPARATOR}${currencySymbol(currency)}`
}

/**
 * Minor units -> canonical amount string (the keypad/edit-input format):
 * 3134331 -> "31343,31", 20000 -> "200", -500 -> "-5". String/integer
 * arithmetic only - the inverse of `parseMajorUnitsToMinor`, so a round-trip
 * loses nothing.
 */
export function minorToInputValue(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const integer = Math.trunc(Math.abs(minor) / 100)
  const fraction = Math.abs(minor) % 100
  const integerDigits = String(integer)
  if (fraction === 0) return `${sign}${integerDigits}`
  const fractionDigits = String(fraction).padStart(2, '0').replace(/0+$/, '')
  return `${sign}${integerDigits},${fractionDigits}`
}
