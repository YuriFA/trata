import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import AddAccountForm from './AddAccountForm.vue'
import type { AccountWithBalance } from '@/entities/account'
import { createMockAccountRepository } from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const createdAccount: AccountWithBalance = {
  version: 1,
  id: 'a1',
  name: 'Main',
  currency: 'RUB',
  openingBalance: 100,
  balance: 100,
}

// The form owns its ResponsiveDialog, so the open surface renders through a
// portal: the DOM lives under document.body and is driven at the DOM level.
describe('AddAccountForm', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  async function mountForm() {
    const accounts = createMockAccountRepository()
    accounts.create.mockResolvedValue(createdAccount)
    mountWithProviders(AddAccountForm, {
      props: { open: true } as never,
      repositories: { accounts },
    })
    // The dialog portal mounts asynchronously.
    await flushPromises()
    return { accounts }
  }

  const query = (selector: string) => document.querySelector(selector)

  async function setName(value: string) {
    const input = query('input#name') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }

  async function submit() {
    query('#add-account-form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await flushPromises()
  }

  it('renders name and opening balance fields', async () => {
    await mountForm()
    expect(query('input#name')).not.toBeNull()
    expect(query('input#opening-balance')).not.toBeNull()
  })

  // multi-currency: the 18-currency picker is back, preselected with the
  // resolved creation default (household base; RUB without a provider).
  it('renders the currency picker preselected with the default', async () => {
    await mountForm()
    expect(query('label[for="currency"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-slot="select-trigger"]').length).toBe(1)
    expect(query('[data-testid="new-account-currency"]') ?? query('#currency')).not.toBeNull()
  })

  it('renders submit button', async () => {
    await mountForm()
    expect(query('button[form="add-account-form"]')).not.toBeNull()
  })

  it('renders with valid props and exposes handlers', async () => {
    await mountForm()
    // Submit button should be rendered and clickable
    expect(query('button[form="add-account-form"]')).not.toBeNull()
  })

  it('does not call create when name is empty', async () => {
    const { accounts } = await mountForm()

    expect(query('#add-account-form')).not.toBeNull()
    await submit()

    expect(accounts.create).not.toHaveBeenCalled()
  })

  it('submits with the RUB default currency', async () => {
    const { accounts } = await mountForm()

    await setName('Main')
    await submit()
    // vee-validate resolves the async schema on its own schedule; poll
    // instead of a fixed flush count.
    await vi.waitFor(() => expect(accounts.create).toHaveBeenCalledTimes(1))

    expect(accounts.create).toHaveBeenCalledWith({
      name: 'Main',
      currency: 'RUB',
      openingBalance: 0,
    })
  })
})
