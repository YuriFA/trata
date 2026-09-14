import { describe, expect, it } from 'vitest'
import {
  getAccountsBalances,
  getTransactionImpactForAccount,
  type BalanceAccount,
  type TransactionImpact,
} from './balance-calculator'

const accounts: BalanceAccount[] = [
  { id: 'rub', openingBalance: 10_000, manualAdjustment: 0 },
  { id: 'usd', openingBalance: 0, manualAdjustment: 0 },
]

describe('getTransactionImpactForAccount', () => {
  it('credits a cross-currency transfer with its destination amount', () => {
    const transfer: TransactionImpact = {
      type: 'transfer',
      fromAccountId: 'rub',
      toAccountId: 'usd',
      amount: 350_000,
      destinationAmount: 400_000,
    }
    expect(getTransactionImpactForAccount(transfer, 'rub')).toBe(-350_000)
    expect(getTransactionImpactForAccount(transfer, 'usd')).toBe(400_000)
  })

  it('moves the amount as is when no destination amount is present', () => {
    const transfer: TransactionImpact = {
      type: 'transfer',
      fromAccountId: 'rub',
      toAccountId: 'usd',
      amount: 350_000,
    }
    expect(getTransactionImpactForAccount(transfer, 'usd')).toBe(350_000)
  })
})

describe('getAccountsBalances', () => {
  it('computes per-account balances from a cross-currency transfer', () => {
    const transfer: TransactionImpact = {
      type: 'transfer',
      fromAccountId: 'rub',
      toAccountId: 'usd',
      amount: 350_000,
      destinationAmount: 400_000,
    }
    const balances = getAccountsBalances(accounts, [transfer])
    expect(balances.rub).toBe(-340_000)
    expect(balances.usd).toBe(400_000)
  })
})
