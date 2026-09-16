import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import NewDebtorDebtDialog from './NewDebtorDebtDialog.vue'
import { CurrencySelect } from '@/shared/ui/currency-select'
import { AmountField } from '@/shared/ui/amount-field'
import { provideDisplayCurrency } from '@/shared/store/use-display-currency'
import type { Debtor } from '@trata/api'
import {
  createMockDebtorRepository,
  createMockDebtOperationRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const createdDebtor: Debtor = {
  id: 'd1',
  name: 'Анна',
  currency: 'RUB',
  version: 1,
}

// Composition-root stand: publishes the household-base link the same way
// AppShell does, so the creation default can be asserted against it.
const Host = defineComponent({
  setup() {
    provideDisplayCurrency('USD')
    return () => h(NewDebtorDebtDialog, { direction: 'receivable', open: true })
  },
})

const mounted: ReturnType<typeof mountWithProviders>[] = []

describe('NewDebtorDebtDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(async () => {
    for (const wrapper of mounted.splice(0)) {
      wrapper.unmount()
    }
    await flushPromises()
    document.body.innerHTML = ''
  })

  function mountDialog(component: typeof NewDebtorDebtDialog | typeof Host = NewDebtorDebtDialog) {
    const debtorsRepo = createMockDebtorRepository()
    debtorsRepo.create.mockResolvedValue(createdDebtor)
    const operationsRepo = createMockDebtOperationRepository()
    operationsRepo.create.mockResolvedValue({
      id: 'o1',
      debtorId: 'd1',
      direction: 'receivable',
      kind: 'debt',
      amount: 500000,
      occurredAt: '2026-08-20T12:00:00.000Z',
      version: 1,
    })

    const wrapper = mountWithProviders(component, {
      props: component === NewDebtorDebtDialog ? { direction: 'receivable', open: true } : {},
      repositories: { debtors: debtorsRepo, debtOperations: operationsRepo },
    })
    mounted.push(wrapper)
    return { wrapper, debtorsRepo, operationsRepo }
  }

  it('preselects the household base currency and sends it with the debtor payload', async () => {
    const { wrapper, debtorsRepo, operationsRepo } = mountDialog(Host)
    await flushPromises()

    // The composition root publishes USD as the household base; the fresh
    // debtor form preselects it (multi-currency, debts capability).
    expect(wrapper.findComponent(CurrencySelect).props('modelValue')).toBe('USD')

    await fillAndSubmit(wrapper)
    await vi.waitFor(() => expect(debtorsRepo.create).toHaveBeenCalledTimes(1))
    expect(debtorsRepo.create).toHaveBeenCalledWith({ name: 'Анна', currency: 'USD' })
    await vi.waitFor(() => expect(operationsRepo.create).toHaveBeenCalledTimes(1))
  })

  it('falls back to the catalog default without a household and hides the change hint', async () => {
    const { wrapper, debtorsRepo } = mountDialog()
    await flushPromises()

    expect(wrapper.findComponent(CurrencySelect).props('modelValue')).toBe('RUB')

    await fillAndSubmit(wrapper)
    await vi.waitFor(() => expect(debtorsRepo.create).toHaveBeenCalledTimes(1))
    expect(debtorsRepo.create).toHaveBeenCalledWith({ name: 'Анна', currency: 'RUB' })
  })
})

// Fills the teleported dialog form (name + amount; date keeps its today
// default) and submits through the footer button.
async function fillAndSubmit(wrapper: ReturnType<typeof mountWithProviders>) {
  const nameInput = document.querySelector<HTMLInputElement>('#debts-new-debt-name')
  if (nameInput) {
    nameInput.value = 'Анна'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await nextTick()
  wrapper.findComponent(AmountField).vm.$emit('update:modelValue', 5000)
  await nextTick()
  const submit = document.querySelector<HTMLButtonElement>('[data-testid="debts-new-debt-submit"]')
  submit?.click()
  await flushPromises()
}
