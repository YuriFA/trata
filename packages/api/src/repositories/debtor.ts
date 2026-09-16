import type { CurrencyCode } from '@trata/money'
import type { Debtor } from '../domain/debtor'
import type { Repository } from '../repository'

export type CreateDebtorPayload = Pick<Debtor, 'name'> & {
  /** Ledger currency; absent means the household's base currency. */
  currency?: CurrencyCode
} & Partial<Pick<Debtor, 'id'>>
export type UpdateDebtorPayload = Partial<Pick<Debtor, 'name'>> & {
  /** Optimistic-concurrency CAS token: the version the caller previously read. */
  version: number
}

export type DebtorRepository = Repository<Debtor, CreateDebtorPayload, UpdateDebtorPayload>
