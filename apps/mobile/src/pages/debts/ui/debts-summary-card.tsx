import { View } from 'react-native'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import {
  aggregateDetailText,
  aggregateHeroText,
  rateDateLabel,
  type CurrencyAggregate,
} from '@/shared/lib/money/aggregate'
import { DEBT_DIRECTION_VIEWS } from '../model/kind'
import { Card } from '@/shared/ui/card'

/**
 * Dual-total summary card: both direction totals as separate rows («Мне
 * должны» / «Я должен»). Unlike the cashflow SummaryCard there is no period
 * navigation - debts are not month-scoped. Multi-currency (6.4): each
 * direction total is a per-currency aggregate over the debtors' own
 * currencies - exact single-currency figures, «≈» converted heroes with the
 * per-currency line and rate date, and the exact per-currency join when no
 * rates are cached.
 */
export interface DebtsSummaryCardProps {
  receivable: CurrencyAggregate
  payable: CurrencyAggregate
  /** The cached snapshot's as-of date for the «Курс на …» footnote. */
  ratesAsOf?: string
}

export function DebtsSummaryCard({ receivable, payable, ratesAsOf }: DebtsSummaryCardProps) {
  return (
    <Card variant="elevated" className="bg-accent" testID="debts-summary">
      <SummaryRow
        testID="debts-total-receivable"
        label={DEBT_DIRECTION_VIEWS.receivable.summaryLabel}
        icon="arrow-down"
        aggregate={receivable}
        ratesAsOf={ratesAsOf}
      />
      <SummaryRow
        testID="debts-total-payable"
        label={DEBT_DIRECTION_VIEWS.payable.summaryLabel}
        icon="arrow-up"
        aggregate={payable}
        ratesAsOf={ratesAsOf}
      />
    </Card>
  )
}

function SummaryRow({
  testID,
  label,
  icon,
  aggregate,
  ratesAsOf,
}: {
  testID: string
  label: string
  icon: 'arrow-down' | 'arrow-up'
  aggregate: CurrencyAggregate
  ratesAsOf?: string
}) {
  const detailText = aggregateDetailText(aggregate)
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        <Icon name={icon} size={16} colorClassName="accent-muted-foreground" />
        <Text variant="body-sm" className="text-muted-foreground">
          {label}
        </Text>
      </View>
      <View className="items-end gap-0.5">
        {/* The testID sits on the amount itself so flows assert the figure. */}
        <Text variant="h3" className="text-foreground" testID={testID}>
          {aggregateHeroText(aggregate)}
        </Text>
        {detailText ? (
          <Text variant="caption" className="text-muted-foreground" testID={`${testID}-detail`}>
            {detailText}
          </Text>
        ) : null}
        {aggregate.converted ? (
          <Text variant="caption" className="text-muted-foreground" testID={`${testID}-footnote`}>
            {`Курс на ${rateDateLabel(ratesAsOf ?? '')}`}
          </Text>
        ) : null}
      </View>
    </View>
  )
}
