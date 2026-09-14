// The «Валюта» settings group (multi-currency 6.1): the per-device display
// currency selector (18-currency catalog; explicit preference, then the
// household base, then RUB - the chain lives in useDisplayCurrency), the
// cached rates' as-of date, and the manual refresh. A failed refresh is
// non-fatal: the previous snapshot stays in effect. The preference is device
// local and never synchronized (exchange-rates capability).

import { useRef, useState } from 'react'
import { View } from 'react-native'
import { currencySymbol } from '@trata/money'
import { Card } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import { Icon } from '@/shared/ui/icon'
import { CurrencyPickerSheet } from '@/shared/ui/currency-picker-sheet'
import type { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { useDisplayCurrencySetting } from '@/shared/lib/db/app-settings'
import { useRates, useRatesRefresher } from '@/shared/lib/db/rates'
import { rateDateLabel } from '@/shared/lib/money/aggregate'
import { useDisplayCurrency, useHousehold } from '@/entities/household'
import { useAuth } from '@/entities/session'

// TODO(i18n): RU strings are hardcoded until react-i18next is wired
// (keys: settings.defaultCurrency, settings.displayCurrencyDescription,
// accounts.rateAsOf).
export function DisplayCurrencySection() {
  const { status } = useAuth()
  const householdQuery = useHousehold({ enabled: status === 'authenticated' })
  const displayCurrency = useDisplayCurrency(householdQuery.data?.currency)
  const { data: explicit, setDisplayCurrency } = useDisplayCurrencySetting()
  const ratesQuery = useRates()
  const refreshRates = useRatesRefresher()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const pickerRef = useRef<BottomSheetRef>(null)

  const handleRefresh = () => {
    setIsRefreshing(true)
    void refreshRates().finally(() => setIsRefreshing(false))
  }

  return (
    <Card variant="elevated" className="gap-3" testID="settings-currency-section">
      <View className="flex-row items-center gap-2">
        <Icon name="swap-horizontal" size={20} colorClassName="accent-primary" />
        <Text variant="h4">Валюта</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Валюта по умолчанию"
        className="flex-row items-center justify-between rounded-2xl bg-secondary px-4 py-3 active:opacity-70"
        onPress={() => pickerRef.current?.present()}
        testID="settings-display-currency"
      >
        <View className="gap-0.5">
          <Text variant="body" className="text-foreground">
            Валюта по умолчанию
          </Text>
          <Text variant="caption" className="text-muted-foreground">
            Какую валюту использовать для итогов и балансов
          </Text>
        </View>
        <Text variant="body" className="font-semibold text-foreground">
          {`${currencySymbol(displayCurrency)} ${displayCurrency}`}
        </Text>
      </Pressable>

      {explicit ? (
        <Button
          variant="ghost"
          text="Сбросить настройку"
          onPress={() => setDisplayCurrency(null)}
          testID="settings-display-currency-reset"
        />
      ) : null}

      <View className="flex-row items-center justify-between" testID="settings-rates-row">
        <Text variant="caption" className="text-muted-foreground" testID="settings-rates-asof">
          {ratesQuery.data
            ? `Курс на ${rateDateLabel(ratesQuery.data.asOf)}`
            : 'Курсы ещё не загружены'}
        </Text>
        <Button
          variant="outline"
          text="Обновить"
          loading={isRefreshing}
          onPress={handleRefresh}
          testID="settings-rates-refresh"
        />
      </View>

      <CurrencyPickerSheet
        ref={pickerRef}
        title="Валюта по умолчанию"
        selectedCode={displayCurrency}
        onSelect={(code) => setDisplayCurrency(code as typeof explicit)}
        testIDPrefix="settings-display-currency"
      />
    </Card>
  )
}
