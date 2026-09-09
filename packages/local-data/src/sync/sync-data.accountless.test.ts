// Account-less cashflow («Без счета») through the sync-data mappers: the
// push-side payloadToSyncData must treat cashflow without an account as a
// VALID operation (it used to be a local error), and the pull-side
// syncDataToRowPatch must carry the null account through to the row.

import { describe, expect, it } from 'vitest'
import { payloadToSyncData, syncDataToRowPatch } from './sync-data'
import type { CashflowTransaction } from '@trata/api'

const accountlessExpense: CashflowTransaction = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'expense',
  amount: 42_500,
  description: '',
  occurredAt: '2026-08-20T12:00:00.000Z',
  version: 1,
  accountId: null,
  categoryId: '22222222-2222-4222-8222-222222222222',
}

describe('sync-data account-less cashflow', () => {
  it('payloadToSyncData accepts cashflow without an account', () => {
    const data = payloadToSyncData('transaction', accountlessExpense)
    expect(data).toMatchObject({
      type: 'expense',
      amount: 42_500,
      accountId: null,
      categoryId: accountlessExpense.categoryId,
    })
  })

  it('syncDataToRowPatch carries the null account into the row patch', () => {
    const patch = syncDataToRowPatch('transaction', {
      type: 'expense',
      amount: 42_500,
      description: '',
      occurredAt: '2026-08-20T12:00:00.000Z',
      accountId: null,
      categoryId: accountlessExpense.categoryId,
    })
    expect(patch).toMatchObject({
      type: 'expense',
      accountId: null,
      categoryId: accountlessExpense.categoryId,
    })
  })

  it('cashflow without a category is still invalid push data', () => {
    const data = payloadToSyncData('transaction', {
      ...accountlessExpense,
      categoryId: null,
    } as unknown as CashflowTransaction)
    expect(data).toBeNull()
  })
})
