import { test, expect, type Page } from '@playwright/test'

async function seedAccount(page: Page, name: string) {
  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Create' }).first().click()
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByText('Account added')).toBeVisible()
}

async function dialogBounds(locator: ReturnType<Page['getByRole']>) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

async function expectVerticallyCentered(page: Page, box: { y: number; height: number }) {
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  // A centered overlay sits within a 10%-of-viewport band around the
  // vertical middle; a bottom-anchored drawer or top-anchored panel does not.
  const centerOffset = Math.abs(box.y + box.height / 2 - viewport!.height / 2)
  expect(centerOffset).toBeLessThan(viewport!.height * 0.1)
}

test.beforeEach(({ page }) => {
  page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))
})

test.describe('mobile overlay presentation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the add-transaction flow uses stacked drawers for the form and pickers', async ({ page }) => {
    await seedAccount(page, 'Cash')
    await page.goto('/')

    await page.getByTestId('fab-add-operation').click()
    await page.getByTestId('speed-dial-expense').click()

    const formDrawer = page.getByRole('dialog', { name: 'Expenses' })
    await expect(formDrawer).toHaveCount(1)
    await expect(formDrawer).toBeVisible()
    // Let the slide-in animation finish: taps landing mid-animation are
    // swallowed by the drawer's own drag handling (same as on a real phone).
    // eslint-disable-next-line playwright/no-wait-for-timeout -- animation settle
    await page.waitForTimeout(350)
    const formDrawerBox = await dialogBounds(formDrawer)
    // Bottom-anchored: the drawer starts below the header area and reaches
    // the bottom half of the viewport (not a centered dialog).
    expect(formDrawerBox.y).toBeGreaterThan(120)
    expect(formDrawerBox.height).toBeGreaterThan(350)

    // Dialog-in-drawer stacking: the inline category form opens above the
    // form drawer and closes back into it.
    const newCategory = page.getByTestId('open-new-category')
    await newCategory.scrollIntoViewIfNeeded()
    await newCategory.click()
    await expect(page.getByTestId('new-category-dialog')).toBeVisible()
    await expect(page.getByLabel('Note')).toBeVisible()
    await page.getByTestId('new-category-name').fill('Groceries')
    await page.getByTestId('new-category-dialog').getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText('Category created')).toBeVisible()
    await expect(formDrawer).toBeVisible()

    // Each picker must change only its own field: sibling fields keep their
    // values across every pick (web-screens picker requirement). The date
    // placeholder is the formatted initial date and the amount input formats
    // to a currency-prefixed string (on blur - hence the Note fill before
    // the snapshot), so "unchanged" means byte-equal to the pre-pick
    // snapshots.
    await page.getByLabel('Amount').fill('12.34')
    await page.getByLabel('Note').fill('sentinel-note')
    const amountBefore = await page.getByLabel('Amount').inputValue()
    const dateBefore = (await page.locator('#occurred-at').textContent())?.trim()
    const categoryBefore = (await page.locator('#category-id').textContent())?.trim()

    // Account picker drawer stacked above the form drawer.
    await page.locator('#account-id').click()
    await expect(page.getByRole('button', { name: 'Cash' }).last()).toBeVisible()
    await expect(page.getByLabel('Note')).toBeVisible()
    await page.getByRole('button', { name: 'Cash' }).last().click()
    await expect(page.locator('#account-id')).toContainText('Cash')
    await expect(page.getByLabel('Note')).toHaveValue('sentinel-note')
    await expect(page.getByLabel('Amount')).toHaveValue(amountBefore)
    await expect(page.locator('#occurred-at')).toHaveText(dateBefore!)
    await expect(page.locator('#category-id')).toHaveText(categoryBefore!)

    await page.locator('#category-id').click()
    await expect(page.getByRole('button', { name: 'Groceries' }).last()).toBeVisible()
    await expect(page.getByLabel('Note')).toBeVisible()
    await page.getByRole('button', { name: 'Groceries' }).last().click()
    await expect(page.getByLabel('Note')).toHaveValue('sentinel-note')
    await expect(page.getByLabel('Amount')).toHaveValue(amountBefore)
    await expect(page.locator('#account-id')).toContainText('Cash')
    await expect(page.locator('#occurred-at')).toHaveText(dateBefore!)

    await page.locator('#occurred-at').click()
    await expect(page.getByRole('button', { name: 'Today' }).last()).toBeVisible()
    await expect(page.getByLabel('Note')).toBeVisible()
    await page.getByRole('button', { name: 'Today' }).last().click()
    await expect(page.getByLabel('Note')).toHaveValue('sentinel-note')
    await expect(page.getByLabel('Amount')).toHaveValue(amountBefore)
    await expect(page.locator('#account-id')).toContainText('Cash')
    await expect(page.locator('#category-id')).toContainText('Groceries')

    // Swipe-down on the drag handle dismisses the form drawer. The wait
    // lets the just-closed date picker finish its exit animation first -
    // its overlay still intercepts pointer events mid-exit.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- exit animation settle
    await page.waitForTimeout(450)
    const handle = page.locator('[data-slot="drawer-handle"]').first()
    const handleBox = await handle.boundingBox()
    expect(handleBox).not.toBeNull()
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + step * 40)
      // Pointer moves need real time between them for the drag to register.
      // eslint-disable-next-line playwright/no-wait-for-timeout -- drag cadence
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    await expect(page.locator('[data-slot="drawer-content"][data-state="open"]')).toHaveCount(0)
  })

  test('stacked picker drawers keep the whole stack in the accessibility tree', async ({ page }) => {
    await seedAccount(page, 'Cash')
    await page.goto('/')

    await page.getByTestId('fab-add-operation').click()
    await page.getByTestId('speed-dial-expense').click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    // eslint-disable-next-line playwright/no-wait-for-timeout -- animation settle
    await page.waitForTimeout(350)

    // Picker drawer over the form drawer: the form's inputs stay exposed
    // (mobile-forms stacking requirement mirrored on web).
    await page.locator('#account-id').click()
    await expect(page.getByRole('dialog')).toHaveCount(2)
    await expect(page.getByLabel('Note')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cash' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.getByLabel('Note')).toBeVisible()
  })

  test('destructive confirms render as bottom sheets and stay clickable', async ({ page }) => {
    await seedAccount(page, 'Cash')

    await page.goto('/accounts')
    await page.getByRole('button', { name: 'Actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Delete account' }).click()

    // Mobile confirm rule: confirms are bottom sheets, matching every other
    // overlay. A centered alert would bury under the open drawer's z-[60]
    // sheet and stay modal while invisible (frozen page).
    const confirmButton = page.getByTestId('delete-account-confirm')
    await expect(confirmButton).toBeVisible()
    const sheet = page.getByRole('dialog').last()
    const sheetBox = (await sheet.boundingBox())!
    const viewport = page.viewportSize()!
    expect(viewport.height - (sheetBox.y + sheetBox.height)).toBeLessThan(24)

    // Clickability is the regression: a buried modal swallows the tap.
    await confirmButton.click()
    await expect(page.getByText('Account deleted')).toBeVisible()
  })

  test('a confirm opened from stacked dialog sheets stays clickable', async ({ page }) => {
    // The reported freeze: debts -> debtor history sheet -> operation sheet
    // -> delete confirm. The confirm must surface above the stack.
    await page.goto('/debts')
    await page.getByTestId('debts-section-add-receivable').click()
    const newDebtDialog = page.getByTestId('debts-new-debtor-dialog')
    await newDebtDialog.getByLabel('Name').fill('Vasya')
    await newDebtDialog.getByLabel('Amount').fill('100')
    await page.getByTestId('debts-new-debt-submit').click()
    await expect(page.getByText('Debt added')).toBeVisible()

    await page.locator('[data-testid^="debts-debtor-"]').first().click()
    await expect(page.getByTestId('debts-history-dialog')).toBeVisible()
    await page.locator('[data-testid^="debts-history-op-"]').first().click()
    await expect(page.getByTestId('debts-operation-dialog')).toBeVisible()
    await page.getByTestId('debts-operation-delete').click()

    const confirm = page.getByTestId('debts-operation-delete-confirm')
    await expect(confirm).toBeVisible()
    await confirm.click()
    await expect(page.getByText('Operation deleted')).toBeVisible()
  })
})

test.describe('desktop overlay presentation', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the unified creation flow stays a centered dialog on desktop widths', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('sidebar-add-operation').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCount(1)
    const dialogBox = await dialogBounds(dialog)
    expect(dialogBox.height).toBeGreaterThan(350)
    // Centered on the viewport, not bottom-anchored or top-anchored.
    await expectVerticallyCentered(page, dialogBox)
  })

  test('destructive confirms stay centered compact alert dialogs', async ({ page }) => {
    await seedAccount(page, 'Cash')

    await page.goto('/accounts')
    await page.getByRole('button', { name: 'Actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Delete account' }).click()

    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    const confirmBox = await dialogBounds(confirmDialog)
    expect(confirmBox.height).toBeLessThan(320)
    await expectVerticallyCentered(page, confirmBox)
  })
})
