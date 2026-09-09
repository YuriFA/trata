// Public surface of @trata/local-data — the platform-neutral
// local-first data layer shared by the mobile (and, from roadmap stage 4,
// web) clients: schema, outbox, sync engine with conflict records, local
// repositories, and the migrations journal. App-side wiring (drivers,
// React contexts, transport binding, background sync) stays in the apps.

export * from './types'
export * from './id-factory'
export * from './schema'
export * as schema from './schema'
export * from './outbox'
export { migrations } from './migrations.generated'
export * from './recurrence'
export * from './balances'
export * from './repositories/account'
export * from './repositories/category'
export * from './repositories/transaction'
export * from './repositories/debt'
export * from './repositories/planned-payment'
export * from './sync/sync-engine'
export * from './sync/run-policy'
export * from './sync/rebase'
export * from './sync/conflicts'
export * from './sync/ownership'
export * from './sync/restore'
export * from './sync/sync-data'
export * from './sync/sync-meta'
export * from './sync/offline-gate'
export * from './sync/sync-status'
