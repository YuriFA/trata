export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment'

type BaseTransaction = {
  id: string
  type: TransactionType
  amount: number
  description?: string
  occurredAt: string
  updatedAt?: string
  /** Optimistic-concurrency version from the server; sent back on PATCH. */
  version: number
  /**
   * Who created/last changed the record (household authorship, household-ux):
   * the local-data row's `userId`. Absent on the REST contract surface (only
   * sync delivers it) and on records authored before authorship existed.
   */
  authorId?: string | null
}

export type CashflowTransaction = BaseTransaction & {
  type: 'income' | 'expense'
  /**
   * Referenced account, or null for an account-less («Без счета»)
   * transaction: visible in history and analytics, contributes to no
   * account balance.
   */
  accountId: string | null
  categoryId: string
}

export type TransferTransaction = BaseTransaction & {
  type: 'transfer'
  fromAccountId: string
  toAccountId: string
  /**
   * Amount credited to `toAccountId` in the destination account's currency
   * (positive minor units). Present iff the two accounts' currencies differ;
   * the effective rate is derivable as destinationAmount / amount.
   */
  destinationAmount?: number
  categoryId?: never
}

/** A signed balance reconciliation: no category, no transfer pair, the
 * nonzero amount may be negative (lowers the balance) or positive. */
export type AdjustmentTransaction = BaseTransaction & {
  type: 'adjustment'
  accountId: string
  categoryId?: never
  fromAccountId?: never
  toAccountId?: never
}

export type Transaction = CashflowTransaction | TransferTransaction | AdjustmentTransaction
