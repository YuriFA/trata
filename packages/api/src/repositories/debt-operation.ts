import type { DebtOperation } from '../domain/debt-operation'
import type { Repository } from '../repository'

export type CreateDebtOperationPayload = Pick<
  DebtOperation,
  'debtorId' | 'direction' | 'kind' | 'amount' | 'occurredAt'
> & Partial<Pick<DebtOperation, 'id'>>
/**
 * PATCH carries the CAS `version`; `debtorId`, `direction`, and `kind` are
 * immutable server-side and therefore not updatable.
 */
export type UpdateDebtOperationPayload = Partial<
  Pick<DebtOperation, 'amount' | 'occurredAt'>
> & {
  /** Optimistic-concurrency CAS token: the version the caller previously read. */
  version: number
}

export interface DebtOperationQuery {
  /** Restrict the listing to one debtor's operations. */
  debtorId?: string
}

export type DebtOperationRepository = Repository<
  DebtOperation,
  CreateDebtOperationPayload,
  UpdateDebtOperationPayload
> & {
  query(options: DebtOperationQuery): Promise<DebtOperation[]>
}
