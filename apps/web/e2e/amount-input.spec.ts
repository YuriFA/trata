import { test, expect } from '@playwright/test'

test.beforeEach(({ page }) => {
  page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))
})

async function seedAccount(
  page: import('@playwright/test').Page,
  name: string,
  openingBalance: string,
) {
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Create' }).first().click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Opening balance').fill(openingBalance)
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByText('Account added')).toBeVisible()
}

async function openReconcile(page: import('@playwright/test').Page, account: string) {
  await page.goto('/accounts')
  const card = page.getByRole('listitem').filter({ hasText: account })
  await card.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Reconcile balance' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('opening balance accepts pasted formatted money and blurs back to pretty money', async ({ page }) => {
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Create' }).first().click()
  await page.getByLabel('Name').fill('Cash')

  const openingBalance = page.getByLabel('Opening balance')
  await openingBalance.click()
  await openingBalance.evaluate((element, text) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => text },
    })
    element.dispatchEvent(event)
  }, '1 234,56 ₽')

  await expect(openingBalance).toHaveValue('1234,56')
  await page.getByLabel('Name').click()
  await expect(openingBalance).toHaveValue('₽1,234.56')

  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cash' })).toContainText('₽1,234.56')
})

test('keyboard focus selects the full reconcile balance for fast replacement', async ({ page }) => {
  await seedAccount(page, 'Wallet', '120')
  await openReconcile(page, 'Wallet')

  const dialog = page.getByRole('dialog')
  const actualBalance = dialog.getByLabel('Actual balance')
  await actualBalance.focus()
  await page.keyboard.type('115')

  await expect(actualBalance).toHaveValue('115')
  await dialog.getByTestId('reconcile-submit').click()

  await expect(page.getByText('Balance reconciled')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Wallet' })).toContainText('₽115.00')
})

test('opening balance stays editable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Create' }).first().click()

  const openingBalance = page.getByLabel('Opening balance')
  await openingBalance.click()
  await page.keyboard.type('1234.5')
  await expect(openingBalance).toHaveValue('1234.5')

  await page.getByLabel('Name').click()
  await expect(openingBalance).toHaveValue('₽1,234.50')
})

test('adjustment edit accepts a signed draft directly', async ({ page }) => {
  await seedAccount(page, 'Cash', '50')
  await openReconcile(page, 'Cash')

  const reconcileDialog = page.getByRole('dialog')
  await reconcileDialog.getByLabel('Actual balance').fill('48')
  await reconcileDialog.getByTestId('reconcile-submit').click()
  await expect(page.getByText('Balance reconciled')).toBeVisible()

  await page.goto('/transactions')
  const row = page.getByRole('listitem').filter({ hasText: 'Adjustment' })
  await row.getByRole('button', { name: 'Row actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()

  const editDialog = page.getByRole('dialog')
  const amount = editDialog.getByLabel('Amount')
  await amount.focus()
  await page.keyboard.type('-4.5')
  await expect(amount).toHaveValue('-4.5')
  await editDialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Transaction updated')).toBeVisible()
  await page.goto('/accounts')
  await expect(page.getByRole('listitem').filter({ hasText: 'Cash' })).toContainText('₽45.50')
})
