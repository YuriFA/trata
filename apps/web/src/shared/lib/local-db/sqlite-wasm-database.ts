// Web wiring for @trata/local-data over the official SQLite WASM
// build. Mirrors apps/mobile's database.ts - the platform driver lives in the
// app, the package stays untouched. The adapter implements the same
// `prepareSync` surface drizzle's expo driver consumes (the pattern proven by
// the package's node:sqlite test factory; see docs/spikes/web-sqlite-wasm-driver.md).

import { drizzle } from 'drizzle-orm/expo-sqlite/driver'
import initSqlite3Module, {
  type BindingSpec,
  type Database,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'
import { migrations, schema, type LocalDatabase } from '@trata/local-data'

let sqlite3Promise: Promise<Sqlite3Static> | undefined

function loadSqlite3(): Promise<Sqlite3Static> {
  sqlite3Promise ??= (async () => {
    const wasmBinary = await fetch(wasmUrl).then((response) => response.arrayBuffer())
    // The typings omit the emscripten config bag; `wasmBinary` is supported at
    // runtime by the bundler-friendly build.
    const init = initSqlite3Module as unknown as (config: {
      wasmBinary: ArrayBuffer
    }) => Promise<Sqlite3Static>
    const sqlite3 = await init({ wasmBinary })
    // OPFS persistence (single-tab - the Web Locks guard in the worker entry
    // enforces it): registers the 'opfs-sahpool' VFS.
    await sqlite3.installOpfsSAHPoolVfs({})
    return sqlite3
  })()
  return sqlite3Promise
}

/** The expo-driver client surface over the sqlite-wasm OO1 API. */
function createSqliteWasmClient(sqlite3: Sqlite3Static, raw: Database) {
  // OO1 bind() rejects statements with no bindable parameters, while drizzle
  // passes an empty param list for plain DDL/no-param queries - skip binding
  // in that case (node:sqlite's run() never binds).
  const bindParams = (stmt: { bind(binding: BindingSpec): unknown }, params: unknown[]) => {
    if (params.length > 0) stmt.bind(params as BindingSpec)
  }
  const rows = (sql: string, params: unknown[], rowMode: 'object' | 'array') =>
    raw.exec({
      sql,
      ...(params.length > 0 ? { bind: params as BindingSpec } : {}),
      rowMode,
      returnValue: 'resultRows',
    })

  return {
    prepareSync(source: string) {
      return {
        executeSync(params: unknown[]) {
          const stmt = raw.prepare(source)
          try {
            bindParams(stmt, params)
            while (stmt.step()) {
              // Run to completion; rows, if any, are fetched lazily below.
            }
          } finally {
            stmt.finalize()
          }
          return {
            changes: Number(raw.changes()),
            lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(raw.pointer ?? 0)),
            getAllSync: () => rows(source, params, 'object'),
            getFirstSync: () => rows(source, params, 'object')[0] ?? null,
          }
        },
        executeForRawResultSync(params: unknown[]) {
          return { getAllSync: () => rows(source, params, 'array') }
        },
      }
    },
  }
}

/**
 * drizzle's expo migrator imports react (hooks) at module level - unusable in
 * a web bundle. Replicate its two steps directly against the package's inline
 * migrations bundle.
 */
async function migrateLocalDatabase(db: LocalDatabase): Promise<void> {
  // Shape mirrors what drizzle's expo migrator expects:
  // { journal: { entries }, migrations: { m0000: 'sql…', … } }.
  const files = migrations.journal.entries.map((entry) => {
    const sql = (migrations.migrations as Record<string, string>)[
      `m${String(entry.idx).padStart(4, '0')}`
    ]
    if (!sql) {
      throw new Error(`Missing migration: ${entry.tag}`)
    }
    return {
      sql: sql.split('--> statement-breakpoint'),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: '',
    }
  })
  // dialect/session exist at runtime but are not part of the public
  // BaseSQLiteDatabase type; the expo migrator reaches them the same way.
  const { dialect, session } = db as unknown as {
    dialect: { migrate: (files: unknown, session: unknown) => Promise<void> }
    session: unknown
  }
  await dialect.migrate(files, session)
}

export interface WebLocalDatabase {
  db: LocalDatabase
  raw: Database
}

export async function openLocalDatabase(): Promise<WebLocalDatabase> {
  const sqlite3 = await loadSqlite3()
  const raw = new sqlite3.oo1.DB({
    filename: 'expense-tracker-local.sqlite3',
    flags: 'ct',
    vfs: 'opfs-sahpool',
  })
  // The adapter implements the driver's runtime surface; the type satisfies
  // the generic LocalDatabase only through this cast (as in the package's
  // test factory).
  const client = createSqliteWasmClient(sqlite3, raw) as unknown as Parameters<typeof drizzle>[0]
  const db = drizzle(client, { schema }) as unknown as LocalDatabase
  await migrateLocalDatabase(db)
  return { db, raw }
}
