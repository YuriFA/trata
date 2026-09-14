import { describe, expect, it } from '@jest/globals'
import type { AccountWithBalance, Transaction } from '@trata/api'
import type { MoneyPresentation } from '@/shared/lib/money/aggregate'
import { monthlyBalance, totalBalance } from './selectors'

// RUB-only presentation, no cached rates: balances stay exact single-currency.
const PRESENTATION: MoneyPresentation = {
  currencyByAccountId: new Map([
    ['a-card', 'RUB'],
    ['a-cash', 'RUB'],
  ]),
  displayCurrency: 'RUB',
  rates: null,
}

const CURSOR = { year: 2026, month: 7 } // August 2026
const inAugust = (day: number) => `2026-08-${String(day).padStart(2, '0')}T12:00:00.000Z`

const accounts: AccountWithBalance[] = [
  {
    id: 'a-cash',
    name: 'Наличные',
    currency: 'RUB',
    openingBalance: 100_000,
    version: 1,
    balance: 250_000,
  },
  {
    id: 'a-card',
    name: 'Карта',
    currency: 'RUB',
    openingBalance: 200_000_000,
    version: 1,
    balance: 150_000,
  },
]

const txs: Transaction[] = [
  {
    id: 't1',
    type: 'income',
    amount: 1_000_000,
    description: 'Зарплата',
    occurredAt: inAugust(3),
    version: 1,
    accountId: 'a-card',
    categoryId: 'c-salary',
  },
  {
    id: 't2',
    type: 'expense',
    amount: 400_000,
    description: 'Такси',
    occurredAt: inAugust(10),
    version: 1,
    accountId: 'a-card',
    categoryId: 'c-taxi',
  },
  {
    id: 't3',
    type: 'transfer',
    amount: 250_000,
    description: 'Перевод',
    occurredAt: inAugust(15),
    version: 1,
    fromAccountId: 'a-card',
    toAccountId: 'a-cash',
  },
]

describe('dashboard selectors · balances', () => {
  it('monthlyBalance is income minus expenses; transfers do not contribute', () => {
    const balance = monthlyBalance(txs, CURSOR, PRESENTATION)
    expect(balance.totals).toEqual([{ currency: 'RUB', amount: 1_000_000 - 400_000 }])
    expect(balance.converted).toBeNull()
  })

  it('totalBalance sums the computed account balances (incl. manualAdjustment)', () => {
    expect(totalBalance(accounts, PRESENTATION).totals).toEqual([
      { currency: 'RUB', amount: 400_000 },
    ])
  })
})
