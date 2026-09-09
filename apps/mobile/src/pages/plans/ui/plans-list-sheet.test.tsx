// Plans list sheet behavior: rows sorted by next-due ascending with the
// overdue plan first and badged, unnamed plans titled by their category, the
// row-level confirm affordance on manual plans only, and the footer «Добавить
// расход/доход» CTA reporting the sheet's type up to the page.

import { describe, expect, it, jest } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Category, PlannedPayment } from '@trata/api'
import { ThemeProvider } from '@/shared/config/theme'
import { createQueryClient } from '@/shared/lib/query/query-client'
import { calendarDayKey } from '@trata/dates'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { PlansListSheet } from './plans-list-sheet'

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

const CATEGORIES: Category[] = [
  {
    id: 'cat-fun',
    name: 'Развлечения',
    type: 'expense',
    icon: 'film',
    color: '#7c5cff',
    archivedAt: null,
    version: 1,
  },
  {
    id: 'cat-loan',
    name: 'Кредит',
    type: 'expense',
    icon: 'card',
    color: '#a78bfa',
    archivedAt: null,
    version: 1,
  },
]

function plan(overrides: Partial<PlannedPayment>): PlannedPayment {
  return {
    id: 'plan-x',
    type: 'expense',
    amount: 59_900,
    name: '',
    accountId: 'acc-main',
    categoryId: 'cat-fun',
    nextDue: '2099-01-05',
    anchorDate: '2099-01-05',
    regularity: 'monthly',
    confirmMode: 'manual',
    reminder: 'off',
    note: '',
    version: 1,
    ...overrides,
  }
}

// Input order is deliberately NOT the expected order: the overdue plan (a
// past next-due) must come first despite being listed last.
const PLANS: PlannedPayment[] = [
  plan({ id: 'plan-future', nextDue: '2099-06-01', name: 'Страховка' }),
  plan({ id: 'plan-today', nextDue: calendarDayKey(new Date()), name: 'Аренда' }),
  plan({ id: 'plan-overdue', nextDue: '2020-01-31', name: 'Гимназия' }),
  plan({ id: 'plan-auto', nextDue: '2099-02-10', name: 'Кредит', confirmMode: 'auto' }),
]

function renderSheet({
  plans = PLANS,
  type = 'expense',
}: { plans?: PlannedPayment[]; type?: 'expense' | 'income' } = {}) {
  const onAdd = jest.fn()
  const onEdit = jest.fn()
  const onConfirm = jest.fn()
  const sheetRef = { current: null } as { current: BottomSheetRef | null }
  render(
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: ZERO_INSETS }}
    >
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          <BottomSheetProvider>
            <PlansListSheet
              ref={sheetRef}
              type={type}
              plans={plans}
              categories={CATEGORIES}
              onAdd={onAdd}
              onEdit={onEdit}
              onConfirm={onConfirm}
            />
          </BottomSheetProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  )
  // The @gorhom mock mounts sheet children only while presented.
  act(() => sheetRef.current?.present())
  return { onAdd, onEdit, onConfirm }
}

/** Row testIDs in document order (badges/confirm buttons excluded). */
function rowIds() {
  return screen
    .getAllByTestId(/^plans-row-(plan-future|plan-today|plan-overdue|plan-auto)$/)
    .map((element) => element.props.testID)
}

describe('PlansListSheet', () => {
  it('sorts rows by next-due ascending with the overdue plan first and badged', () => {
    renderSheet()

    expect(rowIds()).toEqual([
      'plans-row-plan-overdue',
      'plans-row-plan-today',
      'plans-row-plan-auto',
      'plans-row-plan-future',
    ])
    expect(screen.getByTestId('plans-row-plan-overdue-overdue')).toBeTruthy()
    expect(screen.queryByTestId('plans-row-plan-future-overdue')).toBeNull()
    // A due-today occurrence is overdue per the spec's semantics.
    expect(screen.getByTestId('plans-row-plan-today-overdue')).toBeTruthy()
  })

  it('titles unnamed plans by their category and shows regularity with the amount', () => {
    renderSheet({
      plans: [plan({ id: 'plan-unnamed', name: '', categoryId: 'cat-loan', regularity: 'weekly' })],
    })

    expect(screen.getByText('Кредит')).toBeTruthy()
    expect(screen.getByText(/каждую неделю/)).toBeTruthy()
  })

  it('offers the row-level confirm affordance on manual plans only', () => {
    renderSheet()

    expect(screen.getByTestId('plans-row-plan-overdue-confirm')).toBeTruthy()
    expect(screen.getByTestId('plans-row-plan-future-confirm')).toBeTruthy()
    // The auto plan is executed by the server job — no confirm affordance.
    expect(screen.queryByTestId('plans-row-plan-auto-confirm')).toBeNull()
  })

  it('reports row taps, confirm taps, and the footer CTA up to the page', () => {
    const { onAdd, onEdit, onConfirm } = renderSheet()

    fireEvent.press(screen.getByTestId('plans-row-plan-future'))
    expect(onEdit).toHaveBeenCalledWith(PLANS[0])

    fireEvent.press(screen.getByTestId('plans-row-plan-overdue-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(PLANS[2])

    fireEvent.press(screen.getByTestId('plans-list-add'))
    expect(onAdd).toHaveBeenCalledWith('expense')
  })
})
