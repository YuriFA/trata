import type { CurrencyCode } from '@trata/money'

export interface Debtor {
  id: string
  name: string
  /** Optional free-form note; always a string on the wire (never null). */
  note: string
  /**
   * Immutable ledger currency: every debt operation's amount is interpreted
   * in it. Defaults to the household's base currency at creation.
   */
  currency: CurrencyCode
  /** Optimistic-concurrency revision (bumped on every server update). */
  version: number
}
