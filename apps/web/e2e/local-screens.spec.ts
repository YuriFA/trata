import { test, expect } from '@playwright/test'

// Backendless flows for the web-screens-parity screens (analytics, debts,
// plans, quick income). Same rules as local-data.spec.ts: no backend, every
// read/write runs against the local SQLite/OPFS worker, fresh profile per
// test, seeded through the UI. These flows double as the deep-link and
// back-button checks for the new routes (web-native navigation requirement).

test.beforeEach(({ page }) => {
  // The product default locale is RU (web-locales); this suite's copy
  // assertions are English, so pin the stored locale choice to EN.
  page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))
})

/** One account named `name` on the accounts page. */
async function seedAccount(page: import('@playwright/test').Page, name: string) {
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Create' }).first().click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByText('Account added')).toBeVisible()
}

/** An expense category created inline through the unified creation flow. */
async function seedExpenseCategory(
  page: import('@playwright/test').Page,
  name: string,
) {
  await page.goto('/')
  await page.getByTestId('sidebar-add-operation').click()
  const expenseDialog = page.getByRole('dialog')
  await expect(expenseDialog).toBeVisible()
  await expenseDialog.getByTestId('open-new-category').click()
  await page.getByTestId('new-category-name').fill(name)
  await page
    .getByTestId('new-category-dialog')
    .getByRole('button', { name: 'Create' })
    .click()
  await expect(page.getByText('Category created')).toBeVisible()
  // Close the inline category dialog, then the outer expense dialog.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

test('analytics renders from local data with route-based detail navigation', async ({ page }) => {
  await seedAccount(page, 'Cash')

  // One expense with an inline new category, all in one dialog session (the
  // created category is auto-selected by the form).
  await page.goto('/')
  await page.getByTestId('sidebar-add-operation').click()
  const expenseDialog = page.getByRole('dialog')
  await expect(expenseDialog).toBeVisible()
  await expenseDialog.getByTestId('open-new-category').click()
  await page.getByTestId('new-category-name').fill('Groceries')
  await page
    .getByTestId('new-category-dialog')
    .getByRole('button', { name: 'Create' })
    .click()
  await expect(page.getByText('Category created')).toBeVisible()

  await page.locator('#account-id').click()
  await page.getByRole('option', { name: /Cash/ }).click()
  await page.getByLabel('Note').fill('Weekly shop')
  await page.getByLabel('Amount').fill('42.50')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Transaction added')).toBeVisible()

  // Overview: the expenses card carries the total, donut, and legend.
  await page.goto('/analytics')
  const expenseCard = page.getByTestId('analytics-card-expenses')
  await expect(expenseCard).toBeVisible()
  await expect(expenseCard).toContainText('₽42.50')
  await expect(expenseCard.getByTestId('chart-legend')).toContainText('Groceries')
  // The income direction shows its empty state.
  await expect(page.getByTestId('analytics-card-income')).toContainText(
    'No income for this period',
  )

  // Detail opens by route (card click), and the browser back returns.
  await expenseCard.click()
  await expect(page).toHaveURL(/\/analytics\/expense$/)
  await expect(page.getByTestId('analytics-detail-total')).toContainText('₽42.50')
  await expect(page.getByTestId('analytics-category-list')).toContainText('Groceries')

  // Deep link directly into the detail route.
  await page.goto('/analytics/income')
  await expect(page.getByTestId('analytics-detail-total')).toContainText('₽0.00')

  await page.goBack()
  await expect(page).toHaveURL(/\/analytics\/expense$/)
})

test('debts: create debtor with first debt, review history, edit the operation', async ({ page }) => {
  await page.goto('/debts')
  await expect(page.getByText('Nobody owes you')).toBeVisible()

  // Combined contact + first debt creation for the receivable direction.
  await page.getByTestId('debts-section-add-receivable').click()
  await page.locator('#debts-new-debt-name').fill('Анна')
  await page.getByLabel('Amount').fill('50')
  await page.getByTestId('debts-new-debt-submit').click()
  await expect(page.getByText('Debt added')).toBeVisible()

  const debtorRow = page.locator('[data-testid^="debts-debtor-"]').first()
  await expect(debtorRow).toContainText('Анна')
  await expect(debtorRow).toContainText('₽50.00')

  // History: day-grouped operations with the derived balance header.
  await debtorRow.click()
  await expect(page.getByTestId('debts-history-balance')).toHaveText('₽50.00')

  // Edit the operation's amount; the derived balance recalculates.
  await page.locator('[data-testid^="debts-history-op-"]').first().click()
  await page.getByLabel('Amount').fill('70')
  await page.getByTestId('debts-operation-submit').click()
  await expect(page.getByText('Operation updated')).toBeVisible()
  await expect(page.getByTestId('debts-history-balance')).toHaveText('₽70.00')
})

test('plans: create a plan, confirm it, and the transaction appears', async ({ page }) => {
  await seedAccount(page, 'Cash')
  await seedExpenseCategory(page, 'Subscriptions')

  await page.goto('/plans')
  await expect(page.getByTestId('plans-total-expense')).toHaveText('₽0.00/mo')

  await page.getByTestId('plans-card-expense').click()
  await page.getByTestId('plans-list-add').click()

  await page.getByLabel('Name').fill('Netflix')
  await page.getByLabel('Amount').fill('15')
  // Anchor on yesterday so the row is deterministically overdue: the
  // default (the form's local today) already counts as due-today, but a
  // past anchor keeps the assertion independent of day-boundary timing.
  await page.locator('#plans-form-date').fill(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))
  await page.locator('#plans-form-account').click()
  await page.getByRole('option', { name: /Cash/ }).click()
  await page.locator('#plans-form-category').click()
  await page.getByRole('option', { name: /Subscriptions/ }).click()
  await page.getByTestId('plans-form-submit').click()
  await expect(page.getByText('Plan created')).toBeVisible()

  // The plan row is anchored in the past, so it is overdue.
  await expect(page.getByTestId('plans-list-dialog')).toContainText('Netflix')
  await expect(page.locator('[data-testid$="-overdue"]').first()).toBeVisible()

  // Confirm: a transaction is materialized from the plan.
  await page.locator('[data-testid$="-confirm"]').first().click()
  await page.getByTestId('plans-confirm-submit').click()
  await expect(page.getByText('Payment confirmed')).toBeVisible()

  // The open list re-renders from the post-confirm refetch (user report:
  // the row stayed overdue-looking with the plan never advancing): the
  // overdue badge is gone and the row's next-due label is in the future,
  // while the confirm pill downgrades to the outline variant.
  await expect(page.locator('[data-testid$="-overdue"]')).toHaveCount(0)
  await expect(page.getByTestId('plans-list-dialog')).toContainText('Netflix')

  await page.goto('/transactions')
  await expect(page.getByText('Netflix')).toBeVisible()
})

test('plans: the deep-linked confirm flow advances the plan in the list', async ({ page }) => {
  await seedAccount(page, 'Cash')
  await seedExpenseCategory(page, 'Subscriptions')

  await page.goto('/plans')
  await page.getByTestId('plans-card-expense').click()
  await page.getByTestId('plans-list-add').click()
  await page.getByLabel('Name').fill('Housing')
  await page.getByLabel('Amount').fill('20')
  await page
    .locator('#plans-form-date')
    .fill(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))
  await page.locator('#plans-form-account').click()
  await page.getByRole('option', { name: /Cash/ }).click()
  await page.locator('#plans-form-category').click()
  await page.getByRole('option', { name: /Subscriptions/ }).click()
  await page.getByTestId('plans-form-submit').click()
  await expect(page.getByText('Plan created')).toBeVisible()

  // Capture the plan id from the open list dialog before closing it.
  const planId = await page
    .locator('[data-testid^="plans-row-"]')
    .first()
    .getAttribute('data-testid')
  const id = planId!.slice('plans-row-'.length)
  await page.keyboard.press('Escape')

  // The reminder-notification route: /plans?confirm=<id> opens the confirm
  // dialog directly; confirming must advance the row in the list behind it.
  await page.goto(`/plans?confirm=${id}`)
  await expect(page.getByTestId('plans-confirm-dialog')).toBeVisible()
  await page.getByTestId('plans-confirm-submit').click()
  await expect(page.getByText('Payment confirmed')).toBeVisible()

  await expect(page.locator('[data-testid$="-overdue"]')).toHaveCount(0)
  await expect(page.getByTestId('plans-list-dialog')).toContainText('Housing')
})

test('quick income entry lands in the cashflow data', async ({ page }) => {
  await seedAccount(page, 'Cash')

  await page.goto('/')
  // Unified flow (web-unified-transaction-entry): the sidebar CTA opens the
  // tabbed creation dialog; switch it to the income tab.
  await page.getByTestId('sidebar-add-operation').click()
  const incomeDialog = page.getByRole('dialog')
  await expect(incomeDialog).toBeVisible()
  await incomeDialog.getByRole('tab', { name: 'Income' }).click()
  // Inline category creation (anonymous local mode starts without categories).
  await page.getByTestId('open-new-category').click()
  await page.getByTestId('new-category-name').fill('Salary')
  await page
    .getByTestId('new-category-dialog')
    .getByRole('button', { name: 'Create' })
    .click()
  await expect(page.getByText('Category created')).toBeVisible()

  await page.locator('#account-id').click()
  await page.getByRole('option', { name: /Cash/ }).click()
  await page.getByLabel('Note').fill('Monthly salary')
  await page.getByLabel('Amount').fill('100')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Transaction added')).toBeVisible()

  // The income shows up in the analytics overview's income card.
  await page.goto('/analytics')
  await expect(page.getByTestId('analytics-card-income')).toContainText('₽100.00')
})
