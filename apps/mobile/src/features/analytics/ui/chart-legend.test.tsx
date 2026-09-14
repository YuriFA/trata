import { describe, expect, it } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'
import type { ChartEntry } from '../model/selectors'
import { ChartLegend } from './chart-legend'

const entries: ChartEntry[] = [
  { id: 'taxi', label: 'Такси', color: '#6366f1', totalMinor: 20113, amountText: '20 113 ₽' },
  { id: 'cafe', label: 'Кафе', color: '#f97316', totalMinor: 3000, amountText: '30,00 ₽' },
  { id: 'other', label: 'Прочие', color: '#6e6b7c', totalMinor: 300, amountText: '3,00 ₽' },
]

describe('ChartLegend', () => {
  it('renders one label-only row per entry, in order, with stable testIDs', () => {
    render(<ChartLegend entries={entries} />)
    expect(screen.getByTestId('analytics-legend-taxi')).toBeTruthy()
    expect(screen.getByTestId('analytics-legend-cafe')).toBeTruthy()
    expect(screen.getByTestId('analytics-legend-other')).toBeTruthy()
    expect(screen.getByText('Такси')).toBeTruthy()
    expect(screen.getByText('Прочие')).toBeTruthy()
    // Labels only - amounts/percentages live in the detail breakdown.
    expect(screen.queryByText('20 113 ₽')).toBeNull()
  })

  it('renders nothing for an empty entry list', () => {
    render(<ChartLegend entries={[]} />)
    expect(screen.queryByTestId(/analytics-legend-/)).toBeNull()
  })
})
