import { test, expect } from '@playwright/test'

// Dashboard category drill-down (web-screens): activating a breakdown row
// opens the category's transactions for the selected month in the shared
// overlay, the period is navigable inside the overlay, and reopening after
// a dashboard month switch rescopes to the newly selected month.
// Backendless: data is seeded through the CSV import wizard (two Groceries
// expenses - one this month, one on the 15th of the previous month), dates
// computed from the real clock so no clock pinning is needed.
test.beforeEach(({ page }) => {
  // The product default locale is RU (web-locales); this suite's copy
  // assertions are English, so pin the stored locale choice to EN.
  page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))
})

/** dd.MM.yyyy - the import template's date format. */
const ruDate = (date: Date) =>
  [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getFullYear()),
  ].join('.')

test('category row opens the month drill-down overlay with in-overlay period navigation', async ({
  page,
}) => {
  const now = new Date()
  // Local midday on the 15th: inside the previous month under any offset.
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12)

  const csv = [
    'дата;тип;категория;сумма;примечание;счёт',
    `${ruDate(now)};расход;Groceries;42,50;Monthly shop;`,
    `${ruDate(prevMonth)};расход;Groceries;10,00;Earlier shop;`,
  ].join('\n')

  // Seed via the import wizard: the category auto-creates, rows are
  // account-less (the same template contract as data-transfer.spec.ts).
  await page.goto('/settings/data')
  await page.getByTestId('open-import-dialog').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('import-file-input').setInputFiles({
    name: 'groceries.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(dialog.getByText('Ready to import: 2')).toBeVisible()
  await dialog.getByTestId('import-commit').click()
  await expect(dialog.getByText('Created: 2')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()

  const breakdown = page.getByTestId('dashboard-category-breakdown')
  const row = page.locator('[data-testid^="dashboard-category-row-"]', { hasText: 'Groceries' })
  const overlay = page.getByTestId('category-cashflow-dialog')

  // Activating the row opens the overlay scoped to the category and the
  // current month: this month's expense is listed, the dashboard stays put.
  await page.goto('/')
  await expect(breakdown.getByText('Groceries')).toBeVisible()
  await row.click()
  await expect(overlay).toBeVisible()
  await expect(overlay.getByText('Groceries')).toBeVisible()
  await expect(overlay.getByText('Monthly shop')).toBeVisible()
  await expect(overlay.getByText('Earlier shop')).toBeHidden()
  await expect(breakdown).toBeVisible()

  // The period is navigable inside the overlay: stepping back lands on the
  // previous month (its expense), stepping forward returns to this month.
  await page.getByTestId('category-cashflow-prev').click()
  await expect(overlay.getByText('Earlier shop')).toBeVisible()
  await expect(overlay.getByText('Monthly shop')).toBeHidden()
  await page.getByTestId('category-cashflow-next').click()
  await expect(overlay.getByText('Monthly shop')).toBeVisible()
  await expect(overlay.getByText('Earlier shop')).toBeHidden()

  // Closing and re-activating after a dashboard month switch rescopes the
  // overlay to the newly selected month.
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
  await page.getByTestId('period-nav-prev').click()
  await expect(breakdown.getByText('Groceries')).toBeVisible()
  await row.click()
  await expect(overlay).toBeVisible()
  await expect(overlay.getByText('Earlier shop')).toBeVisible()
  await expect(overlay.getByText('Monthly shop')).toBeHidden()
})
