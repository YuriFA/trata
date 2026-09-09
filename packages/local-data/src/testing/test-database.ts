// Test-only database factory: builds a real SQLite database over Node's
// built-in SQLite (`node:sqlite`) instead of the native expo module, so the
// package's unit tests run against a real SQLite engine under vitest (real
// transactions, real rollbacks).
//
// The adapter implements exactly the `SQLiteDatabase` surface the drizzle
// expo driver touches: `prepareSync(sql)` returning statements with
// `executeSync` / `executeForRawResultSync`. Importing the driver through
// its `driver` subpath keeps `expo-sqlite` (native) out of the test runtime;
// the mobile app's `database.ts` keeps using the full entry. (drizzle-orm
// 0.45.2 has no `node-sqlite` driver — this adapter is the proven path.)
//
// NEVER import this from app code - it exists for `*.test.ts` files only
// (through the `@trata/local-data/testing` entry).

import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/expo-sqlite/driver'
import { migrate } from 'drizzle-orm/expo-sqlite/migrator'
import type { LocalDatabase } from '../types'
import { migrations } from '../migrations.generated'
import * as schema from '../schema'

/** The expo-sqlite client subset consumed by drizzle's expo driver. */
function createNodeSqliteClient(raw: DatabaseSync) {
  const statements = new Map<
    string,
    { object: ReturnType<DatabaseSync['prepare']>; arrays: ReturnType<DatabaseSync['prepare']> }
  >()

  const prepare = (source: string) => {
    let pair = statements.get(source)
    if (!pair) {
      const object = raw.prepare(source)
      const arrays = raw.prepare(source)
      arrays.setReturnArrays(true)
      pair = { object, arrays }
      statements.set(source, pair)
    }
    return pair
  }

  const client = {
    prepareSync(source: string) {
      const { object, arrays } = prepare(source)
      return {
        executeSync(params: unknown[]) {
          const result = object.run(...(params as never[]))
          return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid ?? 0),
            getAllSync: () => object.all(...(params as never[])),
            getFirstSync: () => object.get(...(params as never[])) ?? null,
          }
        },
        executeForRawResultSync(params: unknown[]) {
          return { getAllSync: () => arrays.all(...(params as never[])) }
        },
      }
    },
  }
  return client
}

/**
 * Opens a database with the package schema migrated. Defaults to in-memory;
 * pass a file path for restart-persistence scenarios (engine reopen etc.).
 */
export async function createTestDatabase(path = ':memory:'): Promise<LocalDatabase> {
  const raw = new DatabaseSync(path)
  // The adapter implements the driver's runtime surface; the type satisfies
  // the package's generic LocalDatabase only through this cast.
  const client = createNodeSqliteClient(raw) as unknown as Parameters<typeof drizzle>[0]
  const db = drizzle(client, { schema })
  await migrate(db, migrations)
  return db as unknown as LocalDatabase
}
