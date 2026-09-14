// Balance computation over the minor-units money model. Pure integer
// arithmetic - no floats, no DOM, no framework. Kept generic over the account
// shape so this package has no dependency on the domain package (which depends
// on this one for the currency model), avoiding an import cycle.

/** Minimal account shape the balance math needs from any concrete account. */
export interface BalanceAccount {
  id: string
  openingBalance: number
  manualAdjustment: number
}

export type TransactionImpact =
  | { readonly type: 'income' | 'expense'; readonly accountId: string; readonly amount: number }
  | {
      readonly type: 'transfer'
      readonly fromAccountId: string
      readonly toAccountId: string
      /** Debited from `fromAccountId` in the source account's currency. */
      readonly amount: number
      /**
       * Credited to `toAccountId` in the destination account's currency;
       * present iff the two accounts' currencies differ, otherwise the
       * transfer moves `amount` as is.
       */
      readonly destinationAmount?: number
    }

const isTransfer = (
  transaction: TransactionImpact,
): transaction is Extract<TransactionImpact, { type: 'transfer' }> => transaction.type === 'transfer'

export const getTransactionImpactForAccount = (
  transaction: TransactionImpact,
  accountId: string,
) => {
  if (!isTransfer(transaction)) {
    if (transaction.type === 'income') {
      return transaction.accountId === accountId ? transaction.amount : 0
    }

    return transaction.accountId === accountId ? -transaction.amount : 0
  }

  if (transaction.fromAccountId === accountId) {
    return -transaction.amount
  }

  if (transaction.toAccountId === accountId) {
    return transaction.destinationAmount ?? transaction.amount
  }

  return 0
}

export const sumTransactionsImpactForAccount = (
  transactions: TransactionImpact[],
  accountId: string,
) =>
  transactions.reduce(
    (total, transaction) => total + getTransactionImpactForAccount(transaction, accountId),
    0,
  )

export const getAccountsBalances = <T extends BalanceAccount>(
  accounts: T[],
  transactions: TransactionImpact[],
) => {
  const balancesByAccountId = Object.fromEntries(
    accounts.map((account) => [account.id, account.openingBalance + account.manualAdjustment]),
  ) as Record<string, number>

  for (const transaction of transactions) {
    if (!isTransfer(transaction)) {
      const currentBalance = balancesByAccountId[transaction.accountId]

      if (currentBalance !== undefined) {
        balancesByAccountId[transaction.accountId] =
          currentBalance +
          (transaction.type === 'income' ? transaction.amount : -transaction.amount)
      }

      continue
    }

    const fromBalance = balancesByAccountId[transaction.fromAccountId]

    if (fromBalance !== undefined) {
      balancesByAccountId[transaction.fromAccountId] = fromBalance - transaction.amount
    }

    const toBalance = balancesByAccountId[transaction.toAccountId]

    if (toBalance !== undefined) {
      balancesByAccountId[transaction.toAccountId] =
        toBalance + (transaction.destinationAmount ?? transaction.amount)
    }
  }

  return balancesByAccountId
}

export const getComputedAccountBalance = <T extends BalanceAccount>(
  account: T,
  transactions: TransactionImpact[],
) =>
  account.openingBalance +
  account.manualAdjustment +
  sumTransactionsImpactForAccount(transactions, account.id)
