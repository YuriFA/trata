// Conflict resolution UI (spec: "Conflict resolution flows"). Renders nothing
// by default - conflicts surface as dialogs driven by the persistent
// `sync_conflicts` table, so they survive restarts and re-prompt until
// resolved. Edit-vs-edit offers both outcomes ("keep mine" re-pushes on the
// current server version, "take theirs" applies the server state and drops
// the pending operations). Delete-vs-edit notifications carry the
// delete-wins default (already applied by the engine) plus
// restore-as-new-record. No path silently discards local changes.

import { useCallback, useEffect, useRef } from 'react'
import { Alert } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  canRestoreAsNew,
  conflictSubject,
  listUnresolvedConflicts,
  markConflictResolved,
  resolveConflictKeepLocal,
  resolveConflictTakeServer,
  restoreConflictAsNew,
  type LocalSyncConflict,
} from '@trata/local-data'
import { catalogConflictEntityLabel } from '../model/sync-entity-catalog.generated'
import { useLocalDatabase } from '@/shared/lib/db/database-context'
import { useSyncController } from '@/shared/lib/sync/sync-context'

/**
 * Global conflict host: mounted once in the root layout. Tracks unresolved
 * conflicts, prompts for every new one (and re-prompts after a restart - the
 * prompted set is intentionally in-memory only), and executes resolutions.
 */
export function ConflictCenter() {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  const { engine, registerConflictPresenter } = useSyncController()
  const promptedRef = useRef<Set<string>>(new Set())

  const conflictsQuery = useQuery({
    queryKey: ['sync', 'conflicts'],
    queryFn: async () => listUnresolvedConflicts(db),
  })
  const conflicts = conflictsQuery.data ?? []

  const afterResolution = useCallback(() => {
    void queryClient.invalidateQueries()
    void engine.run()
  }, [engine, queryClient])

  const restoreAsNew = useCallback(
    async (conflict: LocalSyncConflict) => {
      const result = await restoreConflictAsNew(db, conflict.id)
      if (!result.ok) {
        Alert.alert(
          'Восстановление не удалось',
          result.reason === 'conflict-missing'
            ? 'Конфликт не найден - возможно, он уже был разрешён.'
            : 'Сохранённое состояние записи не может быть использовано для создания новой.',
        )
        return
      }
      afterResolution()
    },
    [afterResolution, db],
  )

  const resolve = useCallback(
    (action: 'keep-local' | 'take-server' | 'dismiss', conflict: LocalSyncConflict) => {
      if (action === 'keep-local') resolveConflictKeepLocal(db, conflict.id)
      else if (action === 'take-server') resolveConflictTakeServer(db, conflict.id)
      else markConflictResolved(db, conflict.id)
      afterResolution()
    },
    [afterResolution, db],
  )

  const prompt = useCallback(
    (conflict: LocalSyncConflict) => {
      const entityName = catalogConflictEntityLabel(conflict.entity)
      const subject = conflictSubject(conflict)

      if (conflict.kind === 'deleted') {
        // Direction of the delete-vs-edit conflict: a live serverState means
        // the record was deleted HERE and edited elsewhere (delete-wins
        // re-pushes the tombstone); a tombstoned serverState means it was
        // deleted elsewhere and edited here.
        const deletedLocally = conflict.serverState?.deleted === false
        const message = deletedLocally
          ? `${entityName}${subject ? ` «${subject}»` : ''} удалён на этом устройстве и изменён на другом. ` +
            'Удаление применено; изменение можно восстановить как новую запись.'
          : `${entityName}${subject ? ` «${subject}»` : ''} удалён на другом устройстве, ` +
            'поэтому локальное изменение отменено. Его можно восстановить как новую запись.'
        Alert.alert(
          'Запись удалена',
          message,
          [
            ...(canRestoreAsNew(conflict)
              ? [
                  {
                    text: 'Восстановить как новую',
                    onPress: () => {
                      void restoreAsNew(conflict)
                    },
                  },
                ]
              : []),
            { text: 'Понятно', onPress: () => resolve('dismiss', conflict) },
          ],
          { cancelable: false },
        )
        return
      }

      Alert.alert(
        'Конфликт изменений',
        `${entityName}${subject ? ` «${subject}»` : ''} изменён на другом устройстве. ` +
          'Выберите, какую версию сохранить.',
        [
          { text: 'Оставить мою', onPress: () => resolve('keep-local', conflict) },
          { text: 'Принять серверную', onPress: () => resolve('take-server', conflict) },
          { text: 'Позже', style: 'cancel' },
        ],
        { cancelable: true },
      )
    },
    [resolve, restoreAsNew],
  )

  // Prompt for conflicts that appeared since the last look (and for all of
  // them right after a restart - the prompted set never persists). The effect
  // keys on the joined id list: the query result is a fresh array per poll,
  // and re-prompting on an unchanged set would loop. The list itself is read
  // through a ref so the unstable array stays out of the dependency set.
  const conflictsRef = useRef(conflicts)
  conflictsRef.current = conflicts
  const conflictSignature = conflicts.map((conflict) => conflict.id).join(',')
  useEffect(() => {
    for (const conflict of conflictsRef.current) {
      if (promptedRef.current.has(conflict.id)) continue
      promptedRef.current.add(conflict.id)
      prompt(conflict)
    }
  }, [conflictSignature, prompt])

  // The sync badge asks us to re-surface whatever is still unresolved.
  useEffect(() => {
    registerConflictPresenter(() => {
      const next = listUnresolvedConflicts(db).at(0)
      if (next) prompt(next)
    })
    return () => registerConflictPresenter(null)
  }, [db, prompt, registerConflictPresenter])

  return null
}
