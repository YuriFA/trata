// Mapping between local records/payloads and the sync wire shapes.
//
// The outbox stores mutations as full DOMAIN payloads (the same shape the
// repositories return); the wire `data` of an operation/change carries a
// subset (no id/version/updatedAt/slug - those live in the envelope or are
// local-only). The structural knowledge lives in the sync entity catalog
// (`tools/sync-catalog/manifest.json`, ADR-0004); this module is the seam
// the engine and conflict bookkeeping call through.

import type { SyncOperationData } from '@trata/api'
import type { LocalDatabase, LocalTransaction } from '../types'
import type {
  AccountRow,
  CategoryRow,
  DebtOperationRow,
  DebtorRow,
  PlannedPaymentRow,
  SyncEntity,
  TransactionRow,
} from '../schema'
import {
  catalogSyncDataToRowPatch,
  payloadToCatalogSyncData,
  readCatalogEntityRow,
  rowToCatalogPayload,
} from './sync-entity-catalog.generated'

/** Either the raw db handle or a transaction over it (same select surface). */
export type DbLike = LocalDatabase | LocalTransaction

/** A row of any syncable entity table (tombstones included). */
export type EntityRow =
  | AccountRow
  | CategoryRow
  | TransactionRow
  | DebtorRow
  | DebtOperationRow
  | PlannedPaymentRow

/** Reads the raw row of any syncable entity (tombstones included). */
export function readEntityRow(db: DbLike, entity: SyncEntity, id: string): EntityRow | undefined {
  return readCatalogEntityRow(db, entity, id)
}

/** Domain payload of a row (the same shape the repositories return and the
 * outbox stores) - used for coalescing and conflict local states. */
export function rowToPayload(entity: SyncEntity, row: EntityRow): Record<string, unknown> {
  return rowToCatalogPayload(entity, row)
}

/** True when the row is tombstoned (or treated as such). */
export function isRowDeleted(row: EntityRow): boolean {
  return row.deletedAt !== null
}

/**
 * Converts a stored domain payload (outbox `payload_json`, conflict
 * `local_state_json`) into the wire `data` of an upsert operation. Returns
 * `null` when the payload does not carry the required fields - the caller
 * records the op as a local error instead of pushing garbage.
 */
export function payloadToSyncData(entity: SyncEntity, payload: unknown): SyncOperationData | null {
  if (typeof payload !== 'object' || payload === null) return null
  return payloadToCatalogSyncData(entity, payload as Record<string, unknown>)
}

/** Complete entity-column sets for applying a wire upsert to a local row. */
export type SyncRowPatch =
  | Pick<AccountRow, 'name' | 'currency' | 'openingBalance'>
  | Pick<CategoryRow, 'name' | 'type' | 'icon' | 'color' | 'archivedAt' | 'slug'>
  | Pick<
      TransactionRow,
      | 'type'
      | 'amount'
      | 'description'
      | 'occurredAt'
      | 'accountId'
      | 'categoryId'
      | 'fromAccountId'
      | 'toAccountId'
      | 'destinationAmount'
    >
  | Pick<DebtorRow, 'name'>
  | Pick<DebtOperationRow, 'debtorId' | 'direction' | 'kind' | 'amount' | 'occurredAt'>
  | Pick<
      PlannedPaymentRow,
      | 'type'
      | 'amount'
      | 'name'
      | 'accountId'
      | 'categoryId'
      | 'nextDue'
      | 'anchorDate'
      | 'regularity'
      | 'confirmMode'
      | 'reminder'
      | 'note'
    >

/**
 * Row patch (entity columns only) for a wire upsert - used by pull applies
 * and take-server conflict resolution. Assumes the wire shape is valid
 * (server-produced); returns `null` on a malformed payload all the same.
 */
export function syncDataToRowPatch(
  entity: SyncEntity,
  data: SyncOperationData,
): SyncRowPatch | null {
  if (typeof data !== 'object' || data === null) return null
  return catalogSyncDataToRowPatch(entity, data as Record<string, unknown>)
}
