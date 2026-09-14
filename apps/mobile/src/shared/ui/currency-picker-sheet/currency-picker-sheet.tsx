// Catalog currency picker presented as a sheet stacked above the caller's
// sheet/screen (the AccountPickerSheet pattern): the full 18-currency
// catalog with RU names and symbols, checkmark on the current selection.
// Selecting reports the code up and dismisses only this sheet.

import { Pressable, View } from 'react-native'
import { currencySymbol } from '@trata/money'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetRef,
  BottomSheetScrollView,
} from '@/shared/ui/bottom-sheet'
import { CURRENCY_OPTIONS } from '@/shared/lib/money/currency-names'

export function CurrencyPickerSheet({
  ref,
  title,
  selectedCode,
  onSelect,
  testIDPrefix,
}: {
  ref: React.Ref<BottomSheetRef>
  title: string
  selectedCode: string
  onSelect: (code: string) => void
  /** e.g. `accounts-create-currency` / `settings-display-currency` */
  testIDPrefix: string
}) {
  const handleSelect = (code: string) => {
    onSelect(code)
    if (ref && typeof ref !== 'function') ref.current?.dismiss()
  }

  return (
    <BottomSheet
      ref={ref}
      snapPoints={['60%']}
      testID={`${testIDPrefix}-picker`}
      stackBehavior="push"
    >
      <BottomSheetHeader title={title} />
      <BottomSheetScrollView testID={`${testIDPrefix}-picker-list`}>
        <View className="gap-1 px-4 pb-4">
          {CURRENCY_OPTIONS.map((option) => {
            const selected = option.code === selectedCode
            return (
              <Pressable
                key={option.code}
                testID={`${testIDPrefix}-option-${option.code}`}
                accessibilityRole="button"
                accessibilityLabel={option.name}
                accessibilityState={{ selected }}
                className="flex-row items-center gap-3 py-3"
                onPress={() => handleSelect(option.code)}
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Text variant="caption" className="font-semibold text-foreground">
                    {currencySymbol(option.code)}
                  </Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text variant="body" className="text-foreground" numberOfLines={1}>
                    {option.name}
                  </Text>
                  <Text variant="caption" className="text-muted-foreground">
                    {option.code}
                  </Text>
                </View>
                {selected ? (
                  <Icon name="checkmark" size={20} colorClassName="accent-primary" />
                ) : null}
              </Pressable>
            )
          })}
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  )
}
