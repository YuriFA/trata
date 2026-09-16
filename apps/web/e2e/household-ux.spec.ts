import { test, expect, type Page, type Route } from '@playwright/test'

// Backendless household surfaces (household-ux 5.1). Extends the
// invite-preview interception pattern: `page.route` stands in for the auth /
// household / sync control plane so the app boots as a signed-in member of a
// multi-member household. The first sync pull delivers one sibling-authored
// transaction, which pins the full authorship path end-to-end (pull-apply
// stamps the local row's author → the row marker resolves against the
// members cache). Dropping to a single-member household on reload removes
// the markers (the author becomes unresolvable) and flips the role-hidden
// owner actions visible.

const ME = '11111111-1111-4111-8111-111111111111'
const SIBLING = '22222222-2222-4222-8222-222222222222'
const HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333'
const TX_ID = '44444444-4444-4444-8444-444444444444'

function meUser() {
  return {
    id: ME,
    email: 'me@example.com',
    displayName: null,
    emailVerified: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function householdFixture(withSibling: boolean) {
  const members = [
    {
      userId: withSibling ? SIBLING : ME,
      email: withSibling ? 'wife@example.com' : 'me@example.com',
      displayName: withSibling ? 'Wife' : null,
      role: withSibling ? 'owner' : 'owner',
      joinedAt: '2026-08-01T00:00:00Z',
    },
  ]
  if (withSibling) {
    members.push({
      userId: ME,
      email: 'me@example.com',
      displayName: null,
      role: 'member',
      joinedAt: '2026-08-02T00:00:00Z',
    })
  }
  // `currency` is a required household field (base-currency conversion
  // target); normalizeHousehold rejects the fixture without it.
  return {
    id: HOUSEHOLD_ID,
    createdAt: '2026-08-01T00:00:00Z',
    currency: 'RUB',
    name: 'Family',
    members,
  }
}

/** The first pull page: account + category + one sibling-authored expense. */
function firstPullChanges() {
  return [
    {
      seq: 1,
      entity: 'account',
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      action: 'upsert',
      version: 1,
      userId: SIBLING,
      data: { name: 'Card', currency: 'USD', openingBalance: 0 },
    },
    {
      seq: 2,
      entity: 'category',
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      action: 'upsert',
      version: 1,
      userId: SIBLING,
      data: { name: 'Groceries', type: 'expense', icon: 'cart', color: '#7c5cff' },
    },
    {
      seq: 3,
      entity: 'transaction',
      id: TX_ID,
      action: 'upsert',
      version: 1,
      userId: SIBLING,
      data: {
        type: 'expense',
        amount: 1234,
        description: 'Weekly groceries',
        occurredAt: '2026-08-20T10:00:00Z',
        accountId: 'aaaaaaaa-0000-4000-8000-000000000001',
        categoryId: 'aaaaaaaa-0000-4000-8000-000000000002',
      },
    },
  ]
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

/**
 * Mocks the control plane the booted app talks to. `withSibling` controls the
 * household fixture (and is re-checkable per request via the getter so a
 * reload can see an updated household).
 */
function mockControlPlane(page: Page, getWithSibling: () => boolean): void {
  void page.route('**/api/auth/me', (route) => fulfillJson(route, 200, meUser()))
  void page.route('**/api/auth/sessions', (route) => fulfillJson(route, 200, []))
  void page.route('**/api/household', (route) =>
    fulfillJson(route, 200, householdFixture(getWithSibling())),
  )
  // The owner-only settings UI also reads the invitations list: mock it or
  // the request leaks to the dev proxy - a live backend's 401 would trip the
  // global unauthorized handler and clear the mocked session mid-test.
  void page.route('**/api/household/invitations', (route) =>
    fulfillJson(route, 200, []),
  )
  // Same class of leak (web-push change): the push-config probe fires on
  // every authenticated boot and an unmocked 401 clears the session.
  void page.route('**/api/config/push', (route) =>
    fulfillJson(route, 200, { enabled: false, vapidPublicKey: '' }),
  )
  void page.route('**/api/sync/push', (route) => fulfillJson(route, 200, { results: [] }))
  void page.route('**/api/sync/pull*', (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor') ?? '0')
    if (cursor === 0) {
      return fulfillJson(route, 200, { changes: firstPullChanges(), nextCursor: 3 })
    }
    return fulfillJson(route, 200, { changes: [], nextCursor: null })
  })
}

test.beforeEach(({ page }) => {
  // The product default locale is RU (web-locales); this suite's copy
  // assertions are English, so pin the stored locale choice to EN.
  page.addInitScript(() => localStorage.setItem('BudgetTracker:locale', 'en'))
})

test('household section renders for a member with owner actions hidden', async ({ page }) => {
  const withSibling = true
  mockControlPlane(page, () => withSibling)

  await page.goto('/settings')
  await expect(page.getByTestId('settings-household-card')).toBeVisible()

  // Display name + members count from the fixture.
  await expect(page.getByTestId('settings-household-name')).toContainText('Family')
  await expect(page.getByTestId('settings-household-name')).toContainText('2 members')

  // Member list: the sibling owner and the own (you) row.
  const siblingRow = page.getByTestId(`settings-household-member-${SIBLING}`)
  await expect(siblingRow).toContainText('Wife')
  await expect(siblingRow).toContainText('Owner')
  const ownRow = page.getByTestId(`settings-household-member-${ME}`)
  await expect(ownRow).toContainText('(you)')

  // Role hiding (household spec): the member sees no owner-only actions,
  // and sees leave + join-by-code.
  await expect(page.getByTestId('settings-household-owner-actions')).toHaveCount(0)
  await expect(page.getByTestId('household-invite-button')).toHaveCount(0)
  await expect(page.getByTestId('household-code-button')).toHaveCount(0)
  await expect(page.getByTestId('household-dissolve-button')).toHaveCount(0)
  await expect(page.getByTestId('household-leave-button')).toBeVisible()
  await expect(page.getByTestId('household-join-code-button')).toBeVisible()

  // The display-name editor card with the email-fallback preview.
  await expect(page.getByTestId('settings-profile-card')).toBeVisible()
  await expect(page.getByTestId('settings-profile-preview')).toContainText('me@example.com')
})

test('authorship markers appear for sibling rows and disappear with member count', async ({
  page,
}) => {
  let withSibling = true
  mockControlPlane(page, () => withSibling)

  // The fixture expense occurred on 2026-08-20 and the dashboard's recent
  // list is month-scoped: pin the clock inside that month so the row renders
  // regardless of the real current date.
  await page.clock.install({ time: new Date('2026-08-25T10:00:00') })

  // The booted engine pulls the fixture: the expense lands locally with the
  // sibling as its author, so the dashboard row carries the marker.
  await page.goto('/')
  const marker = page.getByTestId(`transaction-row-author-${TX_ID}`)
  await expect(marker).toBeVisible()
  await expect(marker).toHaveText('Wife')

  // Same marker on the transactions screen.
  await page.goto('/transactions')
  await expect(page.getByTestId(`transaction-row-author-${TX_ID}`)).toBeVisible()

  // The edit dialog shows the provenance line (detail, not marker).
  // (Row action menus are out of scope here; the detail line is covered by
  // unit tests - this spec pins the list surfaces + role/members fixtures.)

  // Drop to a single-member household and reload: the sibling is no longer
  // resolvable, so no marker renders anywhere.
  withSibling = false
  await page.reload()
  await expect(page.getByTestId(`transaction-row-author-${TX_ID}`)).toHaveCount(0)

  // The sole member is now the owner: owner-only actions are visible again
  // and leave is still offered (solo owner).
  await page.goto('/settings')
  await expect(page.getByTestId('settings-household-owner-actions')).toBeVisible()
  await expect(page.getByTestId('household-invite-button')).toBeVisible()
  await expect(page.getByTestId('household-leave-button')).toBeVisible()
})
