import { View } from 'react-native'
import { formatMoney } from '@trata/money'
import type { AccountWithBalance } from '@trata/api'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { Pressable } from '@/shared/ui/pressable'
import {
  BottomSheet,
  BottomSheetHeader,
  BottomSheetRef,
  BottomSheetScrollView,
} from '@/shared/ui/bottom-sheet'

/**
 * Account picker presented as a sheet stacked above the transaction sheet.
 * Selecting an account reports it up and dismisses only this sheet - the
 * transaction form and everything already entered stay untouched.
 */
export function AccountPickerSheet({
  ref,
  title,
  accounts,
  selectedId,
  onSelect,
  testIDPrefix,
}: {
  ref: React.Ref<BottomSheetRef>
  title: string
  accounts: AccountWithBalance[]
  selectedId: string
  onSelect: (id: string) => void
  /** e.g. `new-transaction-account` / `new-transaction-from` / `new-transaction-to` */
  testIDPrefix: string
}) {
  const handleSelect = (id: string) => {
    onSelect(id)
    if (ref && typeof ref !== 'function') ref.current?.dismiss()
  }

  return (
    <BottomSheet
      ref={ref}
      snapPoints={['60%']}
      testID={`${testIDPrefix}-picker`}
      // 'push' stacks this sheet fully on top of the transaction sheet; the
      // default 'switch' would minimize the transaction sheet, unmounting its
      // content - and this picker renders inside that content.
      stackBehavior="push"
    >
      <BottomSheetHeader title={title} />
      <BottomSheetScrollView testID={`${testIDPrefix}-picker-list`}>
        <View className="gap-1 px-4 pb-4">
          {accounts.length === 0 ? (
            <Text variant="body-sm" className="text-muted-foreground">
              Нет доступных счетов
            </Text>
          ) : (
            accounts.map((account) => {
              const selected = account.id === selectedId
              return (
                <Pressable
                  key={account.id}
                  testID={`${testIDPrefix}-option-${account.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={account.name}
                  accessibilityState={{ selected }}
                  className="flex-row items-center gap-3 py-3"
                  onPress={() => handleSelect(account.id)}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Icon
                      name="wallet-outline"
                      size={20}
                      colorClassName="accent-muted-foreground"
                    />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text variant="body" className="text-foreground" numberOfLines={1}>
                      {account.name}
                    </Text>
                    <Text variant="caption" className="text-muted-foreground">
                      {formatMoney(account.balance, account.currency, 'ru')}
                    </Text>
                  </View>
                  {selected ? (
                    <Icon name="checkmark" size={20} colorClassName="accent-primary" />
                  ) : null}
                </Pressable>
              )
            })
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  )
}
