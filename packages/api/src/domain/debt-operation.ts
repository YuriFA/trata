/** Money owed to the user («мне должны») vs money the user owes («я должен»). */
export type DebtDirection = 'receivable' | 'payable'
/** `debt` grows the owed amount; `repayment` («списание») shrinks it. */
export type DebtOperationKind = 'debt' | 'repayment'

export interface DebtOperation {
  id: string
  debtorId: string
  direction: DebtDirection
  kind: DebtOperationKind
  /** Positive minor units (divisor 100). */
  amount: number
  occurredAt: string
  /** Optimistic-concurrency revision (bumped on every server update). */
  version: number
  /**
   * Who created/last changed the record (household authorship, household-ux):
   * the local-data row's `userId`. Absent on the REST contract surface (only
   * sync delivers it) and on records authored before authorship existed.
   */
  authorId?: string | null
}
