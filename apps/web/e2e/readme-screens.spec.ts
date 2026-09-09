import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// README screenshot capture: seeds a realistic month of data through the UI
// (anonymous local mode, fresh profile, RU locale - the product default) and
// saves desktop + mobile shots into docs/screenshots/ for the root README.
// Opt-in only so the regular `pnpm test:e2e` suite stays fast:
//
//   README_SCREENS=1 pnpm exec playwright test e2e/readme-screens.spec.ts --project=chromium

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots')

// Playwright config ignores this file unless README_SCREENS=1, so the regular
// e2e suite never collects it.

test.setTimeout(300_000)

/** Account seeded on /accounts. */
async function seedAccount(page: import('@playwright/test').Page, name: string) {
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Создать' }).first().click()
  await page.getByLabel('Название').fill(name)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await expect(page.getByText('Счёт добавлен')).toBeVisible()
}

interface NewCategory {
  name: string
  /** Index in the type-filtered icon grid (`new-category-icon-${index}`). */
  icon: number
}

/** Creates a category through the transaction dialog's inline flow on the
 * given tab (the category type follows the active tab). The dialog is not
 * closed here - the next openDialog() navigates and resets it. */
async function createCategory(
  page: import('@playwright/test').Page,
  category: NewCategory,
  tab?: string,
) {
  await openDialog(page, tab)
  const dialog = page.getByRole('dialog')
  await dialog.getByTestId('open-new-category').click()
  await page.getByTestId('new-category-name').fill(category.name)
  await page.getByTestId(`new-category-icon-${category.icon}`).click()
  await page
    .getByTestId('new-category-dialog')
    .getByRole('button', { name: 'Создать' })
    .click()
  await expect(page.getByText('Категория создана')).toBeVisible()
}

interface ExpenseSeed {
  category: string
  amount: string
  note: string
  account: string
}

const EXPENSE_CATEGORIES: NewCategory[] = [
  { name: 'Продукты', icon: 0 },
  { name: 'Кафе и рестораны', icon: 2 },
  { name: 'Транспорт', icon: 9 },
  { name: 'Жильё', icon: 13 },
  { name: 'Здоровье', icon: 17 },
  { name: 'Развлечения', icon: 20 },
  { name: 'Подписки', icon: 32 },
]

const INCOME_CATEGORIES: NewCategory[] = [
  { name: 'Зарплата', icon: 2 },
  { name: 'Фриланс', icon: 3 },
]

const EXPENSES: ExpenseSeed[] = [
  { category: 'Жильё', amount: '45000', note: 'Аренда квартиры', account: 'Карта Т-Банка' },
  { category: 'Продукты', amount: '3240', note: 'ВкусВилл', account: 'Карта Т-Банка' },
  { category: 'Продукты', amount: '1175', note: 'Пятёрочка', account: 'Карта Т-Банка' },
  { category: 'Кафе и рестораны', amount: '1460', note: 'Обед с коллегами', account: 'Карта Т-Банка' },
  { category: 'Транспорт', amount: '620', note: 'Такси', account: 'Карта Т-Банка' },
  { category: 'Здоровье', amount: '2300', note: 'Аптека', account: 'Карта Т-Банка' },
  { category: 'Развлечения', amount: '1900', note: 'Кино', account: 'Карта Т-Банка' },
  { category: 'Подписки', amount: '599', note: 'YouTube Premium', account: 'Карта Т-Банка' },
  { category: 'Продукты', amount: '890', note: 'Магнит', account: 'Наличные' },
  { category: 'Кафе и рестораны', amount: '780', note: 'Кофейня', account: 'Наличные' },
  { category: 'Транспорт', amount: '56', note: 'Метро', account: 'Наличные' },
]

/** Opens the transaction dialog on the given tab. */
async function openDialog(page: import('@playwright/test').Page, tab?: string) {
  await page.goto('/')
  await page.getByTestId('sidebar-add-operation').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  if (tab) await dialog.getByRole('tab', { name: tab }).click()
  return dialog
}

test('seed a month of data and capture README screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  // --- Seed -----------------------------------------------------------

  await seedAccount(page, 'Карта Т-Банка')
  await seedAccount(page, 'Наличные')

  // All categories upfront, on their own tabs (expense icon grid:
  // 🛒☕🚌🏠💊🎬📺; income: 💼🖥️).
  for (const category of EXPENSE_CATEGORIES) {
    await createCategory(page, category)
  }
  for (const category of INCOME_CATEGORIES) {
    await createCategory(page, category, 'Доход')
  }

  // Expenses: pick the category and account from the dialog selects.
  for (const seed of EXPENSES) {
    const dialog = await openDialog(page)
    await page.locator('#category-id').click()
    await page.getByRole('option', { name: new RegExp(seed.category) }).click()
    await page.locator('#account-id').click()
    await page.getByRole('option', { name: new RegExp(seed.account) }).click()
    await page.getByLabel('Заметка').fill(seed.note)
    await page.getByLabel('Сумма').fill(seed.amount)
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByText('Транзакция добавлена')).toBeVisible()
  }

  // Income: Зарплата + Фриланс.
  for (const income of [
    { category: 'Зарплата', amount: '150000', note: 'Август' },
    { category: 'Фриланс', amount: '25000', note: 'Лендинг' },
  ]) {
    const dialog = await openDialog(page, 'Доход')
    await page.locator('#category-id').click()
    await page.getByRole('option', { name: new RegExp(income.category) }).click()
    await page.locator('#account-id').click()
    await page.getByRole('option', { name: /Карта/ }).first().click()
    await page.getByLabel('Заметка').fill(income.note)
    await page.getByLabel('Сумма').fill(income.amount)
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByText('Транзакция добавлена')).toBeVisible()
  }

  // Transfer: cash withdrawal Карта -> Наличные.
  const transferDialog = await openDialog(page, 'Перевод')
  await page.locator('#from-account-id').click()
  await page.getByRole('option', { name: /Карта/ }).click()
  await page.locator('#to-account-id').click()
  await page.getByRole('option', { name: /Наличные/ }).click()
  await page.locator('#transfer-amount').fill('5000')
  await transferDialog.getByLabel('Заметка').fill('Снятие наличных')
  await transferDialog.getByRole('button', { name: 'Перевести', exact: true }).click()
  await expect(page.getByText('Перевод выполнен')).toBeVisible()

  // Debt: Анна должна мне 5 000.
  await page.goto('/debts')
  await page.getByTestId('debts-section-add-receivable').click()
  await page.locator('#debts-new-debt-name').fill('Анна Петрова')
  await page.getByLabel('Сумма').fill('5000')
  await page.getByTestId('debts-new-debt-submit').click()
  await expect(page.getByText('Долг добавлен')).toBeVisible()

  // Plan: Netflix, due today (becomes overdue - a realistic list state).
  await page.goto('/plans')
  await page.getByTestId('plans-card-expense').click()
  await page.getByTestId('plans-list-add').click()
  await page.getByLabel('Название').fill('Netflix')
  await page.getByLabel('Сумма').fill('599')
  await page.locator('#plans-form-date').click()
  await page.locator('[data-today]').first().click()
  await page.locator('#plans-form-account').click()
  await page.getByRole('option', { name: /Карта/ }).click()
  await page.locator('#plans-form-category').click()
  await page.getByRole('option', { name: /Подписки/ }).click()
  await page.getByTestId('plans-form-submit').click()
  await expect(page.getByText('План создан')).toBeVisible()
  await page.keyboard.press('Escape')

  // --- Screenshots -----------------------------------------------------

  await page.goto('/')
  await expect(page.getByText('Расходы по категориям')).toBeVisible()
  await expect(page.getByRole('button', { name: /Жильё 45 000/ })).toBeVisible()
  // Screenshot settle: let the route progress bar and popover transitions finish.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'dashboard-desktop.png') })

  await page.goto('/transactions')
  await expect(page.getByText('ВкусВилл')).toBeVisible()
  // Screenshot settle: let the route progress bar and popover transitions finish.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'transactions-desktop.png') })

  await page.goto('/analytics')
  await expect(page.getByTestId('analytics-card-expenses')).toContainText('Жильё')
  // Screenshot settle: let the route progress bar and popover transitions finish.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'analytics-desktop.png') })

  await page.goto('/debts')
  await expect(page.getByText('Анна Петрова')).toBeVisible()
  // Screenshot settle: let the route progress bar and popover transitions finish.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'debts-desktop.png') })

  // Mobile shell (<768px): top bar + bottom tabs + FAB speed-dial.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('Расходы по категориям')).toBeVisible()
  // Screenshot settle: let the route progress bar and popover transitions finish.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'dashboard-mobile.png') })
})
