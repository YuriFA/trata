import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import TransferForm from './TransferForm.vue'
import { AccountSelect } from '@/entities/account'
import { AmountField } from '@/shared/ui/amount-field'
import type { AccountWithBalance } from '@/entities/account'
import type { Category } from '@/entities/category'
import type { TransferTransaction } from '@/entities/transaction'
import { createMockAccountRepository } from '@/__tests__/helpers/mock-repositories'
import { createMockCategoryRepository } from '@/__tests__/helpers/mock-repositories'
import { createMockTransactionRepository } from '@/__tests__/helpers/mock-repositories'
import { refreshRates } from '@/shared/lib/money'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'
// Pin the form-open instant: the date field defaults to it and a day-level
// pick keeps its clock time (asserted below).
const { openMoment } = vi.hoisted(() => ({ openMoment: '2026-08-29T10:20:30.400Z' }))
vi.mock('@/shared/lib/date', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/date')>()
  return { ...actual, nowIsoString: () => openMoment }
})

const accounts: AccountWithBalance[] = [
  { id: 'a1', name: 'Main', currency: 'USD', openingBalance: 1000, balance: 1000, version: 1 },
  { id: 'a2', name: 'Savings', currency: 'USD', openingBalance: 500, balance: 500, version: 1 },
]

const categories: Category[] = []

const createdTransfer: TransferTransaction = {
  id: 't1',
  type: 'transfer',
  amount: 100,
  description: '',
  occurredAt: '2024-01-01T00:00:00Z',
  fromAccountId: 'a1',
  toAccountId: 'a2',
} as never

const newFromAccount: AccountWithBalance = {
  id: 'a-new-from',
  name: 'Card',
  currency: 'RUB',
  openingBalance: 0,
  balance: 0,
  version: 1,
}

const newToAccount: AccountWithBalance = {
  id: 'a-new-to',
  name: 'Cash',
  currency: 'RUB',
  openingBalance: 0,
  balance: 0,
  version: 1,
}

const mounted: ReturnType<typeof mountWithProviders>[] = []

describe('TransferForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(async () => {
    // Unmount first: wiping document.body under live teleports (the inline
    // dialogs) breaks patching.
    for (const wrapper of mounted.splice(0)) {
      wrapper.unmount()
    }
    await flushPromises()
    document.body.innerHTML = ''
  })

  function mountForm(
    props: Record<string, unknown> = {},
    accountsList: AccountWithBalance[] = accounts,
  ) {
    const accountsRepo = createMockAccountRepository()
    accountsRepo.getAll.mockResolvedValue(accountsList)
    const categoriesRepo = createMockCategoryRepository()
    categoriesRepo.getAll.mockResolvedValue(categories)
    const transactionsRepo = createMockTransactionRepository()
    transactionsRepo.create.mockResolvedValue(createdTransfer)

    const wrapper = mountWithProviders(TransferForm, {
      props: { ...props } as never,
      repositories: {
        accounts: accountsRepo,
        categories: categoriesRepo,
        transactions: transactionsRepo,
      },
      // The footer's DialogClose requires a DialogRoot the tests don't mount.
      global: { stubs: { DialogClose: true } },
    })
    mounted.push(wrapper)
    return { wrapper, accountsRepo, categoriesRepo, transactionsRepo }
  }

  it('renders form element', () => {
    const { wrapper } = mountForm()
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('renders submit button', () => {
    const { wrapper } = mountForm()
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true)
  })

  it('renders description input', () => {
    const { wrapper } = mountForm()
    expect(wrapper.find('input#transfer-description').exists()).toBe(true)
  })

  it('mounts and renders with accounts data loaded', async () => {
    const { wrapper, accountsRepo } = mountForm()
    await flushPromises()
    expect(accountsRepo.getAll).toHaveBeenCalled()
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('offers a per-selector inline account creation affordance', () => {
    const { wrapper } = mountForm()
    expect(wrapper.find('[data-testid="open-new-from-account"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="open-new-to-account"]').exists()).toBe(true)
  })

  it('routes each inline creation into its own selector only', async () => {
    const { wrapper, accountsRepo } = mountForm({}, [])
    await flushPromises()

    // Create the from-account inline.
    accountsRepo.create.mockResolvedValueOnce(newFromAccount)
    await createAccountInline(wrapper, 'open-new-from-account', 'Card')

    const selects = () => wrapper.findAllComponents(AccountSelect)
    const fromSelect = () => selects().find((s) => s.props('inputId') === 'from-account-id')!
    const toSelect = () => selects().find((s) => s.props('inputId') === 'to-account-id')!
    expect(fromSelect().props('modelValue')).toBe('a-new-from')
    // The other selector is untouched (its form initial value).
    expect(toSelect().props('modelValue')).toBe('')

    // Create the to-account inline.
    accountsRepo.create.mockResolvedValueOnce(newToAccount)
    await createAccountInline(wrapper, 'open-new-to-account', 'Cash')
    expect(toSelect().props('modelValue')).toBe('a-new-to')
  })

  it('submits with accounts created inline and preserves the entered amount', async () => {
    const { wrapper, accountsRepo, transactionsRepo } = mountForm({}, [])
    await flushPromises()

    wrapper.findComponent(AmountField).vm.$emit('update:modelValue', 100)
    accountsRepo.create.mockResolvedValueOnce(newFromAccount)
    await createAccountInline(wrapper, 'open-new-from-account', 'Card')
    accountsRepo.create.mockResolvedValueOnce(newToAccount)
    await createAccountInline(wrapper, 'open-new-to-account', 'Cash')

    await nextTick()
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(transactionsRepo.create).toHaveBeenCalledTimes(1))

    expect(transactionsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAccountId: 'a-new-from',
        toAccountId: 'a-new-to',
        amount: 10000,
      }),
    )
  })

  it('submits the form-open moment when the date is untouched', async () => {
    const { wrapper, transactionsRepo } = mountForm()
    await flushPromises()

    await fillAndSubmit(wrapper)
    // vee-validate resolves the async schema on its own schedule; poll
    // instead of a fixed flush count.
    await vi.waitFor(() => expect(transactionsRepo.create).toHaveBeenCalledTimes(1))

    expect(transactionsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: openMoment }),
    )
  })

  it('carries the destination amount for a cross-currency pair', async () => {
    const { wrapper, transactionsRepo } = mountForm({}, crossCurrencyAccounts)
    await flushPromises()

    // Picking the USD → EUR pair surfaces the destination-amount field.
    pickAccounts(wrapper, 'a1', 'a2')
    await nextTick()
    expect(wrapper.find('#transfer-destination-amount').exists()).toBe(true)

    wrapper.findComponent(AmountField).vm.$emit('update:modelValue', 100)
    // The second AmountField is the destination credit (€92.00 for $100.00).
    wrapper.findAllComponents(AmountField)[1]!.vm.$emit('update:modelValue', 92)
    await nextTick()
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(transactionsRepo.create).toHaveBeenCalledTimes(1))

    expect(transactionsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAccountId: 'a1',
        toAccountId: 'a2',
        amount: 10000,
        destinationAmount: 9200,
      }),
    )
  })

  it('hints the suggested rate from the cached rates', async () => {
    // The rates seam: a successful refresh publishes the snapshot the hint
    // reads (1 USD ≈ 0.92 EUR from the stubbed provider).
    const fetchSpy = vi.fn<() => Promise<RateFetchResponse>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: 'success',
        base_code: 'USD',
        rates: { USD: 1, EUR: 0.92 },
        time_last_update_unix: 1_786_000_000,
      }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    await refreshRates()

    const { wrapper } = mountForm({}, crossCurrencyAccounts)
    await flushPromises()

    pickAccounts(wrapper, 'a1', 'a2')
    await nextTick()
    expect(wrapper.find('#transfer-destination-amount').exists()).toBe(true)
    expect(wrapper.text()).toContain('1 USD ≈ 0.92 EUR')
    vi.unstubAllGlobals()
  })

  it('blocks the submit of a cross-currency transfer without a destination amount', async () => {
    const { wrapper, transactionsRepo } = mountForm({}, crossCurrencyAccounts)
    await flushPromises()

    pickAccounts(wrapper, 'a1', 'a2')
    wrapper.findComponent(AmountField).vm.$emit('update:modelValue', 100)
    await nextTick()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await nextTick()

    // The iff-rule's required leg (createTransferSchema's superRefine):
    // a cross-currency transfer without the destination credit never
    // reaches the repository. The message itself is covered at the schema
    // level (transfer-schema.test.ts).
    expect(transactionsRepo.create).not.toHaveBeenCalled()
  })

  it('never carries a destination amount for a same-currency pair', async () => {
    const { wrapper, transactionsRepo } = mountForm()
    await flushPromises()

    // Same-currency accounts: the destination field stays hidden even when a
    // stale value lingers in the form state.
    expect(wrapper.find('#transfer-destination-amount').exists()).toBe(false)

    await fillAndSubmit(wrapper)
    await vi.waitFor(() => expect(transactionsRepo.create).toHaveBeenCalledTimes(1))

    const payload = transactionsRepo.create.mock.calls[0]![0]! as Record<string, unknown>
    expect(payload).not.toHaveProperty('destinationAmount')
  })
})

// The slice of the fetch Response the rates provider consumes.
type RateFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<{
    result: string
    base_code: string
    rates: Record<string, number>
    time_last_update_unix: number
  }>
}

const crossCurrencyAccounts: AccountWithBalance[] = [
  accounts[0]!,
  { id: 'a2', name: 'Savings', currency: 'EUR', openingBalance: 500, balance: 500, version: 1 },
]

// Picks the two accounts without submitting (unlike fillAndSubmit).
function pickAccounts(wrapper: VueWrapper, fromId: string, toId: string) {
  const selects = wrapper.findAllComponents(AccountSelect)
  selects
    .find((s) => s.props('inputId') === 'from-account-id')
    ?.vm.$emit('update:modelValue', fromId)
  selects.find((s) => s.props('inputId') === 'to-account-id')?.vm.$emit('update:modelValue', toId)
}

async function fillAndSubmit(wrapper: VueWrapper) {
  const selects = wrapper.findAllComponents(AccountSelect)
  selects.find((s) => s.props('inputId') === 'from-account-id')?.vm.$emit('update:modelValue', 'a1')
  selects.find((s) => s.props('inputId') === 'to-account-id')?.vm.$emit('update:modelValue', 'a2')
  wrapper.findComponent(AmountField).vm.$emit('update:modelValue', 100)
  await nextTick()
  await wrapper.find('form').trigger('submit')
}

// Opens the inline create-account dialog from the given "+" testid, fills
// the name, and submits. The dialog content teleports to document.body.
async function createAccountInline(wrapper: VueWrapper, openTestId: string, name: string) {
  await wrapper.find(`[data-testid="${openTestId}"]`).trigger('click')
  await flushPromises()
  const input = document.querySelector('input[id="new-account-name"]') as HTMLInputElement
  input.value = name
  input.dispatchEvent(new Event('input', { bubbles: true }))
  ;(document.querySelector('button[type="submit"][form="new-account-form"]') as HTMLElement).click()
  await vi.waitFor(() => expect(document.querySelector('#new-account-form')).toBeNull())
  await flushPromises()
}
