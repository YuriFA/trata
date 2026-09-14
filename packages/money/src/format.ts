import { toDecimal } from 'dinero.js'
import { getDineroCurrency, type CurrencyCode } from './currencies'
import { toMoney } from './money'

/**
 * Narrow currency symbol for the supported currencies. A static map keeps
 * formatting deterministic and `Intl`-free (Hermes-safe on React Native);
 * unknown currencies fall back to their ISO code.
 */
const CURRENCY_SYMBOLS: Partial<Record<CurrencyCode, string>> = {
  USD: '$',
  EUR: '€',
  RUB: '₽',
  GBP: '£',
  CNY: '¥',
  TRY: '₺',
  PLN: 'zł',
  GEL: '₾',
  KZT: '₸',
  UAH: '₴',
  AMD: '֏',
  AZN: '₼',
  ILS: '₪',
  THB: '฿',
}
// UZS, KGS, RSD and AED have no narrow display symbol in common typographic
// use - they fall back to their ISO code via the `?? currency` rule below.

/** The two locales the app supports; anything else resolves to the `en` shape. */
type SupportedShape = 'en' | 'ru'

/** Per-locale number shaping: grouping, decimal separator, symbol placement. */
interface LocaleShape {
  groupSeparator: string
  decimalSeparator: string
  /** Currency symbol before (`prefix`) or after (`suffix`) the amount. */
  symbolPlacement: 'prefix' | 'suffix'
  /** Separator between the amount and a suffix symbol (empty for prefix). */
  symbolSeparator: string
  /** Compact unit suffixes per tier key (trillions, billions, millions). */
  compactSuffixes: Record<CompactTier['key'], string>
}

const LOCALE_SHAPES: Record<SupportedShape, LocaleShape> = {
  en: {
    groupSeparator: ',',
    decimalSeparator: '.',
    symbolPlacement: 'prefix',
    symbolSeparator: '',
    compactSuffixes: { trillions: 'T', billions: 'B', millions: 'M' },
  },
  ru: {
    // Narrow no-break space grouping is the ru-RU typographic convention and
    // avoids a stray regular space that could wrap mid-number.
    groupSeparator: '\u202F',
    decimalSeparator: ',',
    symbolPlacement: 'suffix',
    // No-break space keeps the symbol glued to the amount across line breaks.
    symbolSeparator: '\u00A0',
    compactSuffixes: { trillions: 'трлн', billions: 'млрд', millions: 'млн' },
  },
}

/** Narrow display symbol for a currency (e.g. "₽"); unknown codes fall back to their ISO code. */
export function currencySymbol(currency: CurrencyCode): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}

/** Resolve a BCP-47 locale string to the closest supported shape (default en). */
function shapeFor(locale: string): LocaleShape {
  return locale.toLowerCase().startsWith('ru') ? LOCALE_SHAPES.ru : LOCALE_SHAPES.en
}

/** Insert `separator` every three digits from the right of an unsigned int. */
function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/**
 * Format a minor-units amount for display, locale- and currency-aware, with NO
 * `Intl` dependency (Hermes-safe on React Native; identical output on web).
 *
 * The decimal value comes from dinero.js's `toDecimal` (pure integer math, no
 * floats); locale grouping, separators, and symbol placement are applied by
 * hand. All supported currencies are 2-minor-unit, so the result always shows
 * exactly two fractional digits.
 *
 * Examples: en `$1,234.50`, `-$100.00`; ru `1 234,50 ₽`. A leading minus sign
 * is always placed before the currency symbol.
 */
export function formatMoney(amountMinor: number, currency: CurrencyCode, locale: string): string {
  const money = toMoney(amountMinor, currency)
  // `toDecimal` returns e.g. "1234.50", "-0.50" - sign already embedded, no
  // grouping, fractional digits padded to the currency exponent.
  const decimal = toDecimal(money)

  const negative = decimal.startsWith('-')
  const unsigned = negative ? decimal.slice(1) : decimal
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.')

  const shape = shapeFor(locale)
  const numberBody = fractionPart
    ? `${groupThousands(integerPart, shape.groupSeparator)}${shape.decimalSeparator}${fractionPart}`
    : groupThousands(integerPart, shape.groupSeparator)
  const sign = negative ? '-' : ''
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency

  return shape.symbolPlacement === 'prefix'
    ? `${sign}${symbol}${numberBody}`
    : `${sign}${numberBody}${shape.symbolSeparator}${symbol}`
}

/**
 * Compact tiers in major units, largest first. A tier applies once the amount
 * reaches its threshold; below the million tier the amount renders exactly
 * (whole units, no fraction).
 */
interface CompactTier {
  majorPerUnit: number
  key: 'trillions' | 'billions' | 'millions'
}

const COMPACT_TIERS: readonly CompactTier[] = [
  { majorPerUnit: 1_000_000_000_000, key: 'trillions' },
  { majorPerUnit: 1_000_000_000, key: 'billions' },
  { majorPerUnit: 1_000_000, key: 'millions' },
]

/**
 * Dashboard-scale formatting: whole units below one major million, an
 * abbreviated figure with one fractional digit at or above it. Trades exact
 * magnitude for a bounded string that fits narrow summary tiles
 * ("999 999,00 ₽" -> "999 999 ₽"; "1 000 100,00 ₽" -> "1 млн ₽"), where the
 * exact figure remains one tap away on the linked detail screen.
 *
 * Rounding is half-up to one fractional digit, computed on integers; a
 * rounding carry ("999,97 млн" -> "1 000,0") escalates to the next tier.
 * Otherwise the contract matches `formatMoney` (sign placement, symbol side,
 * separators; no `Intl`, identical output on web and React Native).
 */
export function formatMoneyCompact(
  amountMinor: number,
  currency: CurrencyCode,
  locale: string,
): string {
  const shape = shapeFor(locale)
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency
  const minorPerMajor = 10 ** getDineroCurrency(currency).exponent

  const negative = amountMinor < 0
  const abs = Math.abs(amountMinor)

  let numberBody: string
  let unit = ''
  // First tier whose threshold the amount reaches wins.
  let tierKey: CompactTier['key'] | undefined
  let tierMajorPerUnit: number | undefined
  for (const tier of COMPACT_TIERS) {
    if (abs >= tier.majorPerUnit * minorPerMajor) {
      tierKey = tier.key
      tierMajorPerUnit = tier.majorPerUnit
      break
    }
  }
  if (tierKey === undefined || tierMajorPerUnit === undefined) {
    // Exact whole major units - kopecks add width without information here.
    numberBody = groupThousands(String(Math.floor(abs / minorPerMajor)), shape.groupSeparator)
  } else {
    // `scaled` is the tier value times ten, so one fractional digit is a
    // plain integer; thresholds divide exactly, keeping this float-free. A
    // rounding carry ("999,97 млн" -> "1 000,0") escalates one tier up - the
    // only possible one, tiers being 1000x apart.
    let scaled = Math.round(abs / ((tierMajorPerUnit * minorPerMajor) / 10))
    let key: CompactTier['key'] = tierKey
    while (scaled >= 1000) {
      scaled = Math.round(scaled / 1000)
      // Escalation moves UP the scale ("999,97 млн" -> "1 млрд"); from
      // trillions it is unreachable (would exceed safe integers).
      key = key === 'millions' ? 'billions' : 'trillions'
    }
    const whole = Math.trunc(scaled / 10)
    const fraction = scaled % 10
    numberBody = fraction > 0 ? `${whole}${shape.decimalSeparator}${fraction}` : `${whole}`
    unit = shape.compactSuffixes[key]
  }

  const sign = negative ? '-' : ''
  // Suffix currencies glue the unit and symbol on with no-break spaces
  // ("1,2 млн ₽"); prefix currencies abbreviate tightly ("$1.2M").
  const compactBody = unit ? `${numberBody}${shape.symbolSeparator}${unit}` : numberBody
  return shape.symbolPlacement === 'prefix'
    ? `${sign}${symbol}${compactBody}`
    : `${sign}${compactBody}${shape.symbolSeparator}${symbol}`
}
