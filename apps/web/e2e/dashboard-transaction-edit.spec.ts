import { test, expect } from '@playwright/test'

// Dashboard edit path (web-screens): editing a transaction from the Recent
// Transactions row menu must refresh the list immediately. A stale list row
// both shows the old data AND carries the old `version` back into the edit
// dialog, so the next save dies with TRANSACTION_VERSION_CONFLICT.
// Backendless: anonymous local SQLite/OPFS worker, fresh profile per test.

test.beforeEach(({ page }) => {
  // The product default locale is RU (web-locales); this suite's copy
  // assertions are English, so pin the stored locale choice to EN.
  page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))
})

test('editing from the dashboard refreshes the list and a second edit saves', async ({
  page,
}) => {
  // Two account dialogs + creation + two edits: over the 30s default.
  test.setTimeout(90_000)

  // Two accounts: the first edit switches between them (the reported repro).
  // Assert on the durable account rows, not only the toast: toasts stack,
  // so the second iteration could otherwise pass on the first one's toast.
  await page.goto('/accounts')
  for (const name of ['Cash', 'Bank']) {
    await page.getByRole('button', { name: 'Create' }).first().click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Add account' }).click()
    await expect(page.getByText('Account added')).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible()
  }

  // Seed one expense through the unified creation flow.
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
  await page.getByLabel('Amount').fill('10.00')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Transaction added')).toBeVisible()

  const row = page.getByRole('listitem').filter({ hasText: 'Weekly shop' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Cash')

  // First edit: switch the account to Bank.
  await row.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const editDialog = page.getByRole('dialog')
  await expect(editDialog).toBeVisible()
  await editDialog.locator('#account-id').click()
  await page.getByRole('option', { name: /Bank/ }).click()
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Transaction updated')).toBeVisible()

  // The dashboard list must show the new account without any reload.
  await expect(row).toContainText('Bank')

  // Second edit right after: the stale-version conflict must not fire.
  await row.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect(editDialog).toBeVisible()
  await editDialog.getByLabel('Note').fill('Weekly shop #2')
  await editDialog.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('Weekly shop #2')
  await expect(page.getByText('Error updating transaction')).toHaveCount(0)
})
