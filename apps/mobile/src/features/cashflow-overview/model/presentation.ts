// The money-presentation context of the cashflow screens (multi-currency
// design D9): each consumer composes the account-currency map, the resolved
// display currency, and the cached rate snapshot once and threads the result
// through the pure selectors. Auth gating mirrors the household-join
// pattern; anonymous (local-only) use falls through the resolution chain.

import { useAuth } from '@/entities/session'
import { useAccounts } from '@/entities/account'
import { useDisplayCurrency, useHousehold } from '@/entities/household'
import { useRates } from '@/shared/lib/db/rates'
import type { MoneyPresentation } from '@/shared/lib/money/aggregate'

export function useCashflowPresentation(): MoneyPresentation {
  const { status } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const displayCurrency = useDisplayCurrency(householdQuery.data?.currency)
  const accounts = useAccounts().data ?? []
  const rates = useRates().data ?? null

  const currencyByAccountId = new Map(accounts.map((account) => [account.id, account.currency]))
  return { currencyByAccountId, displayCurrency, rates }
}
