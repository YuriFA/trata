// Wizard state machine of the CSV import dialog: file → preview (per-row
// outcomes, categories to create, exclude toggles) → commit → result counts,
// with TRANSACTION_ALREADY_EXISTS reported as skipped, not failed.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
// The local repository rejects duplicate ids with AlreadyExistsError (the
// coarse `already-exists` code survives the worker bridge; apiCode does not).
import { AlreadyExistsError } from '@trata/api'
import ImportCsvDialog from './ImportCsvDialog.vue'
import type { AccountWithBalance } from '@/entities/account'
import {
  createMockAccountRepository,
  createMockCategoryRepository,
  createMockTransactionRepository,
} from '@/__tests__/helpers/mock-repositories'
import { mountWithProviders } from '@/__tests__/helpers/mount-with-providers'

const accounts: AccountWithBalance[] = [
  { id: 'a1', name: 'Наличка', currency: 'RUB', openingBalance: 0, balance: 0, version: 1 },
]

const CSV = [
  'дата;тип;категория;сумма;примечание;счёт',
  '01.09.2026;расход;Транспорт;100;;',
  '02.09.2026;расход;Транспорт;200,50;;',
  '03.09.2026;доход;Зарплата;70000;;Наличка',
  '04.09.2026;бартер;Еда;100;;',
].join('\r\n')

// Dialog content teleports to document.body, so assertions and interactions
// go through document (the NewAccountDialog test pattern).
const inDialog = (selector: string) => document.querySelector(selector)
const allInDialog = (selector: string) => [...document.querySelectorAll(selector)]

describe('ImportCsvDialog', () => {
  let accountRepo: ReturnType<typeof createMockAccountRepository>
  let categoryRepo: ReturnType<typeof createMockCategoryRepository>
  let transactionRepo: ReturnType<typeof createMockTransactionRepository>
  let mounted: VueWrapper | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    accountRepo = createMockAccountRepository()
    accountRepo.getAll.mockResolvedValue(accounts)
    categoryRepo = createMockCategoryRepository()
    categoryRepo.getAll.mockResolvedValue([])
    transactionRepo = createMockTransactionRepository()
  })

  afterEach(() => {
    // Unmount first: wiping document.body under live teleports breaks patching.
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  function mountDialog() {
    const Wrapper = defineComponent({
      setup() {
        const open = ref(true)
        return () =>
          h(ImportCsvDialog, {
            open: open.value,
            'onUpdate:open': (value: boolean) => {
              open.value = value
            },
          })
      },
    })
    mounted = mountWithProviders(Wrapper, {
      repositories: {
        accounts: accountRepo,
        categories: categoryRepo,
        transactions: transactionRepo,
      },
    })
    return mounted
  }

  async function chooseFile(csv: string) {
    const input = inDialog('[data-testid="import-file-input"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    const file = new File([csv], 'import.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })
    Object.defineProperty(input!, 'files', { value: [file] })
    input!.dispatchEvent(new Event('change'))
    await flushPromises()
  }

  it('previews row outcomes and the categories to create', async () => {
    mountDialog()
    await flushPromises()

    await chooseFile(CSV)

    expect(inDialog('[data-testid="import-row-2"]')).not.toBeNull()
    expect(inDialog('[data-testid="import-row-5"]')?.textContent).toContain('доход')
    expect(document.body.textContent).toContain('Транспорт')
    expect(document.body.textContent).toContain('Зарплата')
    expect(inDialog('[data-testid="import-commit"]')).not.toBeNull()
  })

  it('creates categories first, then transactions, and reports the result', async () => {
    categoryRepo.create.mockImplementation(async ({ name }: { name: string }) => ({
      id: `cat-${name}`,
      name,
      type: 'expense',
      icon: '',
      color: '',
      archivedAt: null,
      version: 1,
    }))
    transactionRepo.create.mockResolvedValue({} as never)

    mountDialog()
    await flushPromises()
    await chooseFile(CSV)
    ;(inDialog('[data-testid="import-commit"]') as HTMLElement).click()
    await flushPromises()

    const createdCategories = categoryRepo.create.mock.calls.map((call) => call[0]?.name)
    expect(createdCategories).toEqual(expect.arrayContaining(['Транспорт', 'Зарплата']))
    expect(transactionRepo.create).toHaveBeenCalledTimes(3)
    const firstPayload = transactionRepo.create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(firstPayload).toMatchObject({
      type: 'expense',
      amount: 10_000,
      accountId: null,
      categoryId: 'cat-Транспорт',
      occurredAt: '2026-09-01T12:00:00.000Z',
    })
    expect(document.body.textContent).toContain('Created: 3')
  })

  it('counts already-imported rows as skipped, not failed', async () => {
    categoryRepo.getAll.mockResolvedValue([
      {
        id: 'c1',
        name: 'Транспорт',
        type: 'expense',
        icon: '',
        color: '',
        archivedAt: null,
        version: 1,
      },
    ] as never)
    transactionRepo.create.mockRejectedValue(
      new AlreadyExistsError('Transaction already exists', {
        apiCode: 'TRANSACTION_ALREADY_EXISTS',
      }),
    )

    mountDialog()
    await flushPromises()
    await chooseFile(CSV)
    ;(inDialog('[data-testid="import-commit"]') as HTMLElement).click()
    await flushPromises()

    expect(document.body.textContent).toContain('Skipped (already imported): 3')
    expect(document.body.textContent).not.toContain('Failed')
  })

  it('excluded rows are not committed', async () => {
    transactionRepo.create.mockResolvedValue({} as never)

    mountDialog()
    await flushPromises()
    await chooseFile(CSV)

    // Uncheck the first valid row (line 2): the checkbox is a native input
    // bound with v-model, so flip `checked` and fire `change`.
    const includeBox = allInDialog(
      '[data-testid="import-row-2"] input[type="checkbox"]',
    )[0] as HTMLInputElement
    includeBox.checked = false
    includeBox.dispatchEvent(new Event('change'))
    await flushPromises()
    ;(inDialog('[data-testid="import-commit"]') as HTMLElement).click()
    await flushPromises()

    expect(transactionRepo.create).toHaveBeenCalledTimes(2)
  })

  it('surfaces a header error without leaving the pick stage', async () => {
    mountDialog()
    await flushPromises()

    await chooseFile('категория;сумма\nЕда;100')

    expect(inDialog('[data-testid="import-header-error"]')?.textContent).toContain('columns')
    expect(inDialog('[data-testid="import-commit"]')).toBeNull()
  })
})
