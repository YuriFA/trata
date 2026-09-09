// Runtime wiring of the local database: opens the on-device SQLite file
// (expo-sqlite, JSI) and applies the shared drizzle-kit migrations at app
// start. The schema, migrations, and the generic database types live in
// @trata/local-data; this module only supplies the expo driver
// (the package stays free of expo types — design D2). Unit tests bypass
// this module and use the package's node:sqlite factory instead.

import { drizzle } from 'drizzle-orm/expo-sqlite'
import { migrate } from 'drizzle-orm/expo-sqlite/migrator'
import { openDatabaseSync } from 'expo-sqlite'
import { migrations, schema, type LocalDatabase } from '@trata/local-data'

export type { LocalDatabase } from '@trata/local-data'

const DATABASE_NAME = 'expense-tracker.db'

let databasePromise: Promise<LocalDatabase> | null = null

/**
 * Opens (and migrates) the local database exactly once per process. Safe to
 * call repeatedly; concurrent callers await the same promise so no query can
 * run before migrations have committed.
 */
export function openLocalDatabase(): Promise<LocalDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const sqlite = openDatabaseSync(DATABASE_NAME)
      const db = drizzle(sqlite, { schema })
      await migrate(db, migrations)
      return db
    })()
  }
  return databasePromise
}
