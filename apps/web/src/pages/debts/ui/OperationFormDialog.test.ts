import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import OperationFormDialog from './OperationFormDialog.vue'
import type { Debtor, DebtOperation } from '@trata/api'
import {
  createMockDebtorRepository,
  createMockDebtOperationRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const debtor: Debtor = { id: 'd1', name: 'Анна', note: '', currency: 'RUB', version: 1 }

const debtOperation: DebtOperation = {
  id: 'o1',
  debtorId: 'd1',
  direction: 'receivable',
  kind: 'debt',
  amount: 500000,
  note: 'Займ',
  occurredAt: '2026-08-20T12:00:00.000Z',
  version: 3,
}

const overRepaymentOperation: DebtOperation = {
  ...debtOperation,
  kind: 'repayment',
  amount: 600000,
}

// Dialog content teleports to document.body, so assertions query the document.
const inDialog = (selector: string) => document.querySelector(selector)
const allInDialog = (selector: string) => [...document.querySelectorAll(selector)]

const mounted: ReturnType<typeof mountWithProviders>[] = []

describe('OperationFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(async () => {
    // Unmount first: wiping document.body under live teleports breaks patching.
    for (const wrapper of mounted.splice(0)) {
      wrapper.unmount()
    }
    await flushPromises()
    document.body.innerHTML = ''
  })

  function mountDialog(props: { operation?: DebtOperation | null; operations?: DebtOperation[] }) {
    const operationsRepo = createMockDebtOperationRepository()
    operationsRepo.update.mockResolvedValue(debtOperation)
    operationsRepo.remove.mockResolvedValue(undefined)
    const debtorsRepo = createMockDebtorRepository()

    const wrapper = mountWithProviders(OperationFormDialog, {
      props: {
        open: true,
        debtor,
        direction: 'receivable',
        operation: props.operation ?? null,
        operations: props.operations ?? [debtOperation],
      },
      repositories: { debtOperations: operationsRepo, debtors: debtorsRepo },
    })
    mounted.push(wrapper)
    return { operationsRepo }
  }

  it('create mode shows the kind switch defaulting to debt with the fixed context', async () => {
    mountDialog({})
    await flushPromises()

    const kindSwitch = inDialog('[data-testid="debts-operation-kind"]')
    expect(kindSwitch).not.toBeNull()
    const debtButton = allInDialog('[data-testid="debts-operation-kind"] button')[0]!
    expect(debtButton.getAttribute('aria-pressed')).toBe('true')
    // The fixed context rows: contact and direction.
    const dialog = inDialog('[data-testid="debts-operation-dialog"]')!
    expect(dialog.textContent).toContain('Анна')
    expect(dialog.textContent).toContain('Owed to me')
  })

  it('edit mode preloads values and shows kind as immutable', async () => {
    mountDialog({ operation: debtOperation })
    await flushPromises()

    expect(inDialog('[data-testid="debts-operation-kind"]')).toBeNull()
    const dialog = inDialog('[data-testid="debts-operation-dialog"]')!
    expect(dialog.textContent).toContain('Debt')
    expect(
      (
        inDialog(
          '[data-testid="debts-operation-dialog"] form input:not([type="date"])',
        ) as HTMLInputElement
      ).value,
      // AmountField renders through the deterministic money formatter: the
      // en shape prefixes the narrow symbol (₽) with no separator.
    ).toBe('₽5,000.00')
    // DateField renders the picked day as its button label (long en format).
    expect(inDialog('#debts-operation-date')!.textContent).toBe('August 20, 2026')
    expect((inDialog('#debts-operation-note') as HTMLInputElement).value).toBe('Займ')
  })

  it('warns (without blocking) when a repayment exceeds the remaining balance', async () => {
    // The debtor's balance is ₽5,000.00; the edited repayment is ₽6,000.00.
    mountDialog({ operation: overRepaymentOperation, operations: [debtOperation] })
    await flushPromises()

    expect(inDialog('[data-testid="debts-operation-over-repayment"]')).not.toBeNull()
    expect(inDialog('[data-testid="debts-operation-over-repayment"]')!.textContent).toContain(
      '₽5,000.00',
    )
    // The submit button stays enabled: over-repayment is a warning, not a block.
    expect((inDialog('[data-testid="debts-operation-submit"]') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('deletes from edit mode after confirmation', async () => {
    const { operationsRepo } = mountDialog({ operation: debtOperation })
    await flushPromises()

    ;(inDialog('[data-testid="debts-operation-delete"]') as HTMLElement).click()
    await flushPromises()

    const confirm = allInDialog('[role="alertdialog"] button').at(-1) as HTMLElement
    confirm.click()
    await flushPromises()

    expect(operationsRepo.remove).toHaveBeenCalledWith('o1')
  })
})
