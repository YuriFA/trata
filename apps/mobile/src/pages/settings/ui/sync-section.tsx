// Sync card: last-synced time, pending outbox and unresolved-conflict
// counts, and the manual run button. Owns its status query — the section is
// its only consumer (components-and-state.md §5: own subscription) — and
// renders nothing until the user is authenticated.

import { useQuery } from '@tanstack/react-query'
import { dateTimeLabel } from '@trata/dates'
import { View } from 'react-native'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { Text } from '@/shared/ui/text'
import { useAuth } from '@/entities/session'
import { useLocalDatabase } from '@/shared/lib/db/database-context'
import { readSyncStatus } from '@trata/local-data'
import { useSyncController } from '@/shared/lib/sync/sync-context'
import { Card } from '@/shared/ui/card'

function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'ещё не выполнялась'
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return 'ещё не выполнялась'
  return dateTimeLabel(new Date(time))
}

export function SyncSection() {
  const { status } = useAuth()
  const db = useLocalDatabase()
  const { runNow } = useSyncController()

  const syncStatusQuery = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: async () => readSyncStatus(db),
    enabled: status === 'authenticated',
  })

  if (status !== 'authenticated') return null

  return (
    <Card variant="elevated" className="gap-3" testID="settings-sync-section">
      <View className="flex-row items-center gap-2">
        <Icon name="cloud-outline" size={20} colorClassName="accent-primary" />
        <Text variant="h4">Синхронизация</Text>
      </View>
      <Text variant="body-sm" className="text-muted-foreground" testID="settings-sync-last">
        {`Последняя синхронизация: ${formatSyncedAt(syncStatusQuery.data?.lastSyncedAt ?? null)}`}
      </Text>
      {syncStatusQuery.data && syncStatusQuery.data.pendingOperations > 0 ? (
        <Text variant="body-sm" className="text-muted-foreground">
          {`Ожидают отправки: ${syncStatusQuery.data.pendingOperations}`}
        </Text>
      ) : null}
      {syncStatusQuery.data && syncStatusQuery.data.failingOperations > 0 ? (
        <>
          <Text variant="body-sm" className="text-destructive" testID="settings-sync-failing">
            {`Ошибок отправки: ${syncStatusQuery.data.failingOperations}`}
          </Text>
          {syncStatusQuery.data.lastError ? (
            <Text
              variant="body-sm"
              className="text-muted-foreground"
              testID="settings-sync-last-error"
            >
              {syncStatusQuery.data.lastError}
            </Text>
          ) : null}
        </>
      ) : null}
      {syncStatusQuery.data && syncStatusQuery.data.unresolvedConflicts > 0 ? (
        <Text variant="body-sm" className="text-destructive">
          {`Неразрешённых конфликтов: ${syncStatusQuery.data.unresolvedConflicts}`}
        </Text>
      ) : null}
      <Button
        variant="outline"
        text="Синхронизировать сейчас"
        onPress={runNow}
        testID="settings-sync-now-button"
      />
    </Card>
  )
}
