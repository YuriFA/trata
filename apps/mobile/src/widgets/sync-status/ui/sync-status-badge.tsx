// Sync status badge (task 4.5): a compact pill surfacing the sync state -
// unresolved conflicts first, then operations the server keeps rejecting, the
// paused (auth expired) state, the in-flight cycle, the pending outbox
// count, and the settled "synced" state. Tapping it opens the conflict
// resolution flow when conflicts exist and otherwise forces a manual sync
// run. Hidden entirely while anonymous: the app is fully usable offline and
// the badge only describes SERVER sync.

import { ActivityIndicator } from 'react-native'
import { Pressable } from '@/shared/ui/pressable'
import { Text } from '@/shared/ui/text'
import { Icon } from '@/shared/ui/icon'
import { useAuth } from '@/entities/session'
import { useLocalDatabase } from '@/shared/lib/db/database-context'
import { readSyncStatus } from '@trata/local-data'
import { useSyncController } from '@/shared/lib/sync/sync-context'
import { useQuery } from '@tanstack/react-query'

export function SyncStatusBadge() {
  const db = useLocalDatabase()
  const { status: authStatus } = useAuth()
  const { engineState, runNow, presentConflicts } = useSyncController()

  const statusQuery = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: async () => readSyncStatus(db),
    enabled: authStatus === 'authenticated',
  })

  if (authStatus !== 'authenticated') return null

  const pending = statusQuery.data?.pendingOperations ?? 0
  // Failing = the server (or local wire validation) rejected the operation's
  // last attempt: waiting will not clear it, so it must not read as plain
  // "waiting to send". A subset of `pending`.
  const failing = statusQuery.data?.failingOperations ?? 0
  const lastError = statusQuery.data?.lastError ?? null
  const conflicts = statusQuery.data?.unresolvedConflicts ?? 0

  let iconName: Parameters<typeof Icon>[0]['name'] = 'checkmark-circle'
  let label = 'Синхронизировано'
  let iconClassName = 'accent-muted-foreground'
  let onPress: () => void = runNow
  // Per-state testID (e.g. `sync-status-synced` / `sync-status-pending`) so
  // e2e flows assert the sync STATE by testID instead of label text.
  let stateTestId = 'sync-status-synced'

  if (conflicts > 0) {
    iconName = 'warning'
    label = `Конфликты: ${conflicts}`
    iconClassName = 'accent-destructive'
    onPress = presentConflicts
    stateTestId = 'sync-status-conflicts'
  } else if (failing > 0) {
    iconName = 'cloud-offline-outline'
    label = `Ошибка отправки: ${failing}`
    iconClassName = 'accent-destructive'
    onPress = runNow
    stateTestId = 'sync-status-failing'
  } else if (engineState.paused) {
    iconName = 'time'
    label = 'Сессия истекла'
    iconClassName = 'accent-destructive'
    onPress = () => undefined
    stateTestId = 'sync-status-paused'
  } else if (engineState.running) {
    label = 'Синхронизация…'
    iconClassName = 'accent-primary'
    stateTestId = 'sync-status-running'
  } else if (pending > 0) {
    iconName = 'cloud-upload-outline'
    label = `${pending} ожидает отправки`
    iconClassName = 'accent-primary'
    stateTestId = 'sync-status-pending'
  }

  return (
    <Pressable
      testID="sync-status-badge"
      accessibilityRole="button"
      accessibilityLabel={
        lastError && stateTestId === 'sync-status-failing' ? `${label}. ${lastError}` : label
      }
      onPress={onPress}
      className="self-start flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"
    >
      {engineState.running ? (
        <ActivityIndicator size="small" />
      ) : (
        <Icon name={iconName} size={14} colorClassName={iconClassName} />
      )}
      <Text variant="caption" className="text-muted-foreground" testID={stateTestId}>
        {label}
      </Text>
    </Pressable>
  )
}
