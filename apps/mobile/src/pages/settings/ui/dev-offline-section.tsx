// Dev-build-only e2e gate (add-debts 7.3): blocks the sync transport so
// Maestro flows can exercise offline behavior mid-flow. Never rendered in
// production builds. Owns its toggle state; turning the gate back off
// triggers a manual run (components-and-state.md §5: own interaction model).

import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Text } from '@/shared/ui/text'
import { useLocalDatabase } from '@/shared/lib/db/database-context'
import { isOfflineGateEnabled, setOfflineGate } from '@trata/local-data'
import { useSyncController } from '@/shared/lib/sync/sync-context'
import { Card } from '@/shared/ui/card'

export function DevOfflineSection() {
  const db = useLocalDatabase()
  const { runNow } = useSyncController()
  const [devOffline, setDevOffline] = useState(() => isOfflineGateEnabled(db))

  const handleToggleOfflineGate = () => {
    const next = !devOffline
    setOfflineGate(db, next)
    setDevOffline(next)
    if (!next) runNow()
  }

  if (!__DEV__) return null

  return (
    <Card variant="elevated" className="gap-3" testID="settings-dev-section">
      <Text variant="h4">Разработка</Text>
      <Text variant="body-sm" className="text-muted-foreground">
        Симуляция офлайна для e2e-тестов: синхронизация не выполняется, пока переключатель включён.
      </Text>
      <Button
        variant="outline"
        text={devOffline ? 'Офлайн-режим: вкл' : 'Офлайн-режим: выкл'}
        onPress={handleToggleOfflineGate}
        testID="settings-dev-offline-toggle"
      />
    </Card>
  )
}
