// RU display names of the supported currency catalog (TODO(i18n): RU strings
// are hardcoded until react-i18next is wired; the values mirror
// packages/i18n ru.json `currencyNames.*`). Presentation-only: pickers and
// settings show "Турецкая лира", stored data carries the ISO code.

import { AVAILABLE_CURRENCIES, type CurrencyCode } from '@trata/money'

const CURRENCY_NAMES_RU: Record<CurrencyCode, string> = {
  USD: 'Доллар США',
  EUR: 'Евро',
  RUB: 'Российский рубль',
  GBP: 'Британский фунт',
  CNY: 'Китайский юань',
  TRY: 'Турецкая лира',
  PLN: 'Польский злотый',
  GEL: 'Грузинская лари',
  KZT: 'Казахстанский тенге',
  UAH: 'Украинская гривна',
  AMD: 'Армянский драм',
  AZN: 'Азербайджанский манат',
  BYN: 'Белорусский рубль',
  UZS: 'Узбекский сум',
  KGS: 'Киргизский сом',
  RSD: 'Сербский динар',
  ILS: 'Израильский шекель',
  AED: 'Дирхам ОАЭ',
  THB: 'Тайский бат',
}

/** Catalog order (the pickers' presentation order). */
export const CURRENCY_OPTIONS = AVAILABLE_CURRENCIES.map((code) => ({
  code,
  name: CURRENCY_NAMES_RU[code],
}))
