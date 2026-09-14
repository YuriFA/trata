// Catalog presentation helpers (multi-currency): localized currency names
// and picker options. Names resolve over static i18n keys (the strict i18n
// lint bans dynamic keys), so the catalog is spelled out once here.

import { AVAILABLE_CURRENCIES, currencySymbol, type CurrencyCode } from '@trata/money'
import i18n from '@/shared/i18n'

/** The localized catalog name («Турецкая лира» / "Turkish Lira"). */
function currencyName(code: CurrencyCode): string {
  const { t } = i18n.global
  switch (code) {
    case 'USD':
      return t('currencyNames.USD')
    case 'EUR':
      return t('currencyNames.EUR')
    case 'RUB':
      return t('currencyNames.RUB')
    case 'GBP':
      return t('currencyNames.GBP')
    case 'CNY':
      return t('currencyNames.CNY')
    case 'TRY':
      return t('currencyNames.TRY')
    case 'PLN':
      return t('currencyNames.PLN')
    case 'GEL':
      return t('currencyNames.GEL')
    case 'KZT':
      return t('currencyNames.KZT')
    case 'UAH':
      return t('currencyNames.UAH')
    case 'AMD':
      return t('currencyNames.AMD')
    case 'AZN':
      return t('currencyNames.AZN')
    case 'BYN':
      return t('currencyNames.BYN')
    case 'UZS':
      return t('currencyNames.UZS')
    case 'KGS':
      return t('currencyNames.KGS')
    case 'RSD':
      return t('currencyNames.RSD')
    case 'ILS':
      return t('currencyNames.ILS')
    case 'AED':
      return t('currencyNames.AED')
    case 'THB':
      return t('currencyNames.THB')
  }
}

export interface CurrencyOption {
  value: CurrencyCode
  /** Composite picker label: «TRY · ₼» (the mockup's chip-analog prefix). */
  label: string
  /** The localized name shown muted next to the label. */
  name: string
}

/** The full catalog in catalog order, for creation-form pickers. */
export function getCurrencyOptions(): CurrencyOption[] {
  return AVAILABLE_CURRENCIES.map((code) => ({
    value: code,
    label: `${code} · ${currencySymbol(code)}`,
    name: currencyName(code),
  }))
}
