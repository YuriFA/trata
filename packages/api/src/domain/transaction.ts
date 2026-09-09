import type { CurrencyCode } from '@trata/money'
import {
  asDateTimeString,
  asInteger,
  asNonEmptyString,
  asPositiveInteger,
  asString,
  isRecord,
} from '../lib/normalize'
import type {
  AdjustmentTransaction,
  CashflowTransaction,
  Transaction,
  TransferTransaction,
  TransactionType,
} from './transaction-types'

export type {
  Transaction,
  CashflowTransaction,
  TransferTransaction,
  AdjustmentTransaction,
  TransactionType,
} from './transaction-types'

export type AccountRef = { id: string; currency: CurrencyCode }
export type CategoryRef = { id: string; type: TransactionType }

type TransactionRecord = Record<string, unknown>

type BaseTransaction = {
  id: string
  type: TransactionType
  amount: number
  description: string
  occurredAt: string
  updatedAt?: string
  version: number
  authorId?: string | null
}

const isTransactionType = (value: unknown): value is TransactionType =>
  value === 'income' ||
  value === 'expense' ||
  value === 'transfer' ||
  value === 'adjustment'

/** Amount sign rule mirrors the backend: positive for the classic types,
 * nonzero signed for adjustment (the reconciliation delta). */
const normalizeAmount = (type: TransactionType, value: unknown): number | null => {
  if (type === 'adjustment') {
    const amount = asInteger(value)
    return amount !== null && amount !== 0 ? amount : null
  }
  return asPositiveInteger(value)
}

const normalizeBaseTransaction = (value: TransactionRecord): BaseTransaction | null => {
  const id = asNonEmptyString(value.id)
  const type = isTransactionType(value.type) ? value.type : null
  const amount = type ? normalizeAmount(type, value.amount) : null
  const description = asString(value.description) ?? ''
  const occurredAt = asDateTimeString(value.occurredAt)
  const updatedAtValue =
    value.updatedAt === undefined ? undefined : asDateTimeString(value.updatedAt)
  // Optimistic-concurrency version is server-provided; localStorage-created
  // transactions default to 1 so they round-trip through PATCH unchanged.
  const versionValue = typeof value.version === 'number' ? value.version : 1
  const authorIdValue = value.authorId == null ? undefined : asString(value.authorId)

  if (!id || !type || !amount || description === null || !occurredAt) {
    return null
  }

  if (value.updatedAt !== undefined && !updatedAtValue) {
    return null
  }

  return {
    id,
    type,
    amount,
    description,
    occurredAt,
    version: versionValue,
    ...(updatedAtValue ? { updatedAt: updatedAtValue } : {}),
    ...(authorIdValue !== undefined ? { authorId: authorIdValue } : {}),
  }
}

const normalizeCashflowTransaction = (
  value: TransactionRecord,
  baseTransaction: BaseTransaction | null,
): CashflowTransaction | null => {
  if (
    !baseTransaction ||
    (baseTransaction.type !== 'income' && baseTransaction.type !== 'expense')
  ) {
    return null
  }

  // The account is optional («Без счета» = absent/null); the category is not.
  const accountId = asNonEmptyString(value.accountId)
  const categoryId = asNonEmptyString(value.categoryId)

  if (!categoryId) {
    return null
  }

  return {
    ...baseTransaction,
    type: baseTransaction.type,
    accountId: accountId ?? null,
    categoryId,
  } as CashflowTransaction
}

const normalizeTransferTransaction = (
  value: TransactionRecord,
  baseTransaction: BaseTransaction | null,
): TransferTransaction | null => {
  if (!baseTransaction || baseTransaction.type !== 'transfer') {
    return null
  }

  const fromAccountId = asNonEmptyString(value.fromAccountId)
  const toAccountId = asNonEmptyString(value.toAccountId)

  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
    return null
  }

  return {
    ...baseTransaction,
    type: 'transfer',
    fromAccountId,
    toAccountId,
  }
}

const normalizeAdjustmentTransaction = (
  value: TransactionRecord,
  baseTransaction: BaseTransaction | null,
): AdjustmentTransaction | null => {
  if (!baseTransaction || baseTransaction.type !== 'adjustment') {
    return null
  }

  const accountId = asNonEmptyString(value.accountId)

  if (!accountId) {
    return null
  }

  return {
    ...baseTransaction,
    type: 'adjustment',
    accountId,
  }
}

export const isTransaction = (value: unknown): value is Transaction => {
  return normalizeTransaction(value) !== null
}

export const isTransferTransaction = (
  transaction: Transaction,
): transaction is TransferTransaction => {
  if (transaction.type === 'transfer') {
    return true
  }

  return false
}

export const isAdjustmentTransaction = (
  transaction: Transaction,
): transaction is AdjustmentTransaction => {
  if (transaction.type === 'adjustment') {
    return true
  }

  return false
}

export const isTransactionLinkedToAccount = (transaction: Transaction, accountId: string) => {
  if (isTransferTransaction(transaction)) {
    return transaction.fromAccountId === accountId || transaction.toAccountId === accountId
  }

  return transaction.accountId === accountId
}

export const isTransactionLinkedToCategory = (transaction: Transaction, categoryId: string) => {
  if (isTransferTransaction(transaction) || isAdjustmentTransaction(transaction)) {
    return false
  }

  return transaction.categoryId === categoryId
}

export const hasValidTransactionReferences = (
  transaction: Transaction,
  accounts: AccountRef[],
  categories: CategoryRef[],
) => {
  if (isTransferTransaction(transaction)) {
    const from = accounts.find((account) => account.id === transaction.fromAccountId)
    const to = accounts.find((account) => account.id === transaction.toAccountId)

    return (
      from !== undefined &&
      to !== undefined &&
      from.id !== to.id &&
      from.currency === to.currency
    )
  }

  if (isAdjustmentTransaction(transaction)) {
    return accounts.some((account) => account.id === transaction.accountId)
  }

  const hasAccount = (accountId: string) => accounts.some((account) => account.id === accountId)
  const category = categories.find((item) => item.id === transaction.categoryId)

  // Account-less cashflow (accountId null) references no account by design.
  return (
    (transaction.accountId === null || hasAccount(transaction.accountId)) &&
    category !== undefined &&
    category.type === transaction.type
  )
}

export const normalizeTransaction = (value: unknown): Transaction | null => {
  if (!isRecord(value)) {
    return null
  }

  const baseTransaction = normalizeBaseTransaction(value)

  if (!baseTransaction) {
    return null
  }

  if (baseTransaction.type === 'transfer') {
    return normalizeTransferTransaction(value, baseTransaction)
  }

  if (baseTransaction.type === 'adjustment') {
    return normalizeAdjustmentTransaction(value, baseTransaction)
  }

  return normalizeCashflowTransaction(value, baseTransaction)
}

export const parseTransactionsStorage = (value: string): Transaction[] => {
  try {
    const parsedValue: unknown = JSON.parse(value)

    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue.flatMap((item) => {
      const transaction = normalizeTransaction(item)

      return transaction ? [transaction] : []
    })
  } catch {
    return []
  }
}

export const serializeTransactionsStorage = (value: Transaction[]) => JSON.stringify(value)
