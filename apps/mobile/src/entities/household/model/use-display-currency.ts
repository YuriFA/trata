// The app's display currency (multi-currency design D3): the resolved
// presentation target of every aggregate figure. Chain: the device's
// explicit preference (shared app settings), then the household base
// currency, then the DEFAULT_CURRENCY fallback. Lives in the household
// slice because the chain's middle link is the household's base; callers
// pass the household query's currency (undefined while anonymous/loading).

import { isCurrencyCode, type CurrencyCode } from '@trata/money'
import { resolveDisplayCurrency } from '@/shared/lib/money/aggregate'
import { useDisplayCurrencySetting } from '@/shared/lib/db/app-settings'

export function useDisplayCurrency(householdBase?: string): CurrencyCode {
  const setting = useDisplayCurrencySetting()
  return resolveDisplayCurrency(
    setting.data,
    isCurrencyCode(householdBase) ? householdBase : undefined,
  )
}
