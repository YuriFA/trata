import { isCurrencyCode, type CurrencyCode } from '@trata/money'
import { asInteger, asNonEmptyString, asString, isRecord } from '../lib/normalize'

export type Account = {
  id: string
  name: string
  currency: CurrencyCode
  openingBalance: number
  /** Optimistic-concurrency revision (bumped on every server update). */
  version: number
}

export type AccountWithBalance = Account & {
  balance: number
}

export const normalizeAccount = (value: unknown): Account | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = asNonEmptyString(value.id)
  const name = asString(value.name)
  const currency = isCurrencyCode(value.currency) ? value.currency : null
  const openingBalance = asInteger(value.openingBalance)
  const version = asInteger(value.version)

  if (!id || name === null || currency === null || openingBalance === null || version === null) {
    return null
  }

  return {
    id,
    name,
    currency,
    openingBalance,
    version,
  }
}

export const parseAccountsStorage = (value: string): Account[] => {
  try {
    const parsedValue: unknown = JSON.parse(value)

    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue.flatMap((item) => {
      const account = normalizeAccount(item)

      return account ? [account] : []
    })
  } catch {
    return []
  }
}

export const serializeAccountsStorage = (value: Account[]) => JSON.stringify(value)
