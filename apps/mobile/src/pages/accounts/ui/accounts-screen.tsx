// Accounts tab: the user's accounts with computed balances, a create form
// (name / currency / opening balance), and delete with in-use guard
// messaging surfaced from the repository error codes.

import { useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { formatMoney } from '@trata/money'
import { Screen } from '@/shared/ui/screen'
import { ScreenHeader, ScreenScrollView } from '@/shared/ui/screen-header'
import { Card } from '@/shared/ui/card'
import { Icon } from '@/shared/ui/icon'
import { IconButton } from '@/shared/ui/icon-button'
import { Text } from '@/shared/ui/text'
import { BottomSheetRef } from '@/shared/ui/bottom-sheet'
import { getRepositoryErrorText } from '@/shared/lib/data/repository-errors-ru'
import { useAccounts, useDeleteAccount } from '@/entities/account'
import { NewAccountSheet } from './new-account-sheet'

export function AccountsScreen() {
  const accountsQuery = useAccounts()
  const accounts = accountsQuery.data ?? []
  const deleteAccount = useDeleteAccount()
  const newAccountSheetRef = useRef<BottomSheetRef>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  const handleDelete = (id: string) => {
    setError(undefined)
    deleteAccount.mutate(id, {
      onError: (cause: unknown) => {
        setError(getRepositoryErrorText(cause))
      },
    })
  }

  return (
    <Screen testID="screen-accounts" topInset={false}>
      <ScreenHeader
        title="Счета"
        right={
          <Pressable
            testID="accounts-add"
            accessibilityRole="button"
            accessibilityLabel="Добавить счёт"
            className="active:opacity-70"
            onPress={() => newAccountSheetRef.current?.present()}
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
              <Icon name="add" size={24} colorClassName="accent-primary-foreground" />
            </View>
          </Pressable>
        }
      />

      <ScreenScrollView>
        <View className="px-6 pb-safe gap-6">
          {error ? (
            <Text variant="body-sm" className="text-destructive" testID="accounts-error">
              {error}
            </Text>
          ) : null}

          {accounts.length === 0 ? (
            <Card variant="elevated">
              <Text variant="body" className="text-muted-foreground">
                Нет счетов
              </Text>
              <Text variant="body-sm" className="mt-1 text-muted-foreground">
                Создайте счёт, чтобы начать записывать расходы
              </Text>
            </Card>
          ) : (
            <View className="gap-4">
              {accounts.map((account) => (
                <Card key={account.id} variant="elevated">
                  <View
                    className="flex-row items-center gap-3"
                    testID={`accounts-row-${account.id}`}
                  >
                    <View className="h-11 w-11 items-center justify-center rounded-xl bg-secondary">
                      <Icon name="wallet" size={22} colorClassName="accent-secondary-foreground" />
                    </View>
                    <View className="flex-1 gap-1">
                      <Text variant="body" className="font-medium text-foreground">
                        {account.name}
                      </Text>
                      <Text variant="caption" className="text-muted-foreground">
                        {account.currency}
                      </Text>
                    </View>
                    <Text variant="body" className="font-semibold text-foreground">
                      {formatMoney(account.balance, account.currency, 'ru')}
                    </Text>
                    <IconButton
                      testID={`accounts-delete-${account.id}`}
                      icon="trash-outline"
                      size="sm"
                      accessibilityLabel={`Удалить ${account.name}`}
                      onPress={() => handleDelete(account.id)}
                    />
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScreenScrollView>

      <NewAccountSheet ref={newAccountSheetRef} />
    </Screen>
  )
}
