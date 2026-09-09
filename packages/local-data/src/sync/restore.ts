// Restore-as-new policy (design D2): a single id-based function that
// re-reads a delete-vs-edit conflict, decodes the preserved local state per
// entity through the sync entity catalog's strict decoders (no silent value
// substitution), and creates a fresh record via the entity's local
// repository. The conflict is marked resolved only after a successful
// create.

import type {
  CreateAccountPayload,
  CreateCategoryPayload,
  CreateDebtOperationPayload,
  CreateDebtorPayload,
  CreatePlannedPaymentPayload,
  CreateTransactionPayload,
} from '@trata/api'
import type { LocalDatabase } from '../types'
import { createLocalAccountRepository } from '../repositories/account'
import { createLocalCategoryRepository } from '../repositories/category'
import { createLocalTransactionRepository } from '../repositories/transaction'
import { createLocalDebtorRepository, createLocalDebtOperationRepository } from '../repositories/debt'
import { createLocalPlannedPaymentRepository } from '../repositories/planned-payment'
import type { SyncEntity } from '../schema'
import { getConflictById, markConflictResolved, type LocalSyncConflict } from './conflicts'
import { decodeCatalogRestorePayload } from './sync-entity-catalog.generated'

// ---------------------------------------------------------------------------
// canRestoreAsNew (moved verbatim from the web module)
// ---------------------------------------------------------------------------

/**
 * True when the preserved local state carries the fields a re-create needs:
 * the state must be a non-null object (it may still fail strict validation
 * per entity, which `restoreConflictAsNew` surfaces as `invalid-state`).
 */
export function canRestoreAsNew(conflict: LocalSyncConflict): boolean {
  return typeof conflict.localState === 'object' && conflict.localState !== null
}

// ---------------------------------------------------------------------------
// restoreConflictAsNew
// ---------------------------------------------------------------------------

export type RestoreResult =
  | { ok: true; entity: SyncEntity; createdId: string }
  | {
      ok: false
      reason: 'conflict-missing' | 'no-local-state' | 'invalid-state'
      entity?: SyncEntity
      field?: string
    }

/**
 * Restores a delete-vs-edit conflict as a new record:
 * 1. Re-reads the conflict by id (race-safe: uses the db, not a stale object).
 * 2. Decodes `localState` through the catalog's strict per-entity decoder
 *    (no value substitution; refuses on a missing or invalid required field).
 * 3. Creates the new record via the entity's local repository (which owns
 *    validation, author stamping, versioning, and the atomic row+outbox enqueue).
 * 4. Marks the conflict resolved only after a successful create.
 *
 * Returns a result type - never throws across the seam.
 */
export async function restoreConflictAsNew(
  db: LocalDatabase,
  conflictId: string,
): Promise<RestoreResult> {
  const conflict = getConflictById(db, conflictId)
  if (!conflict) {
    return { ok: false, reason: 'conflict-missing' }
  }

  if (typeof conflict.localState !== 'object' || conflict.localState === null) {
    return { ok: false, reason: 'no-local-state', entity: conflict.entity }
  }

  const state = conflict.localState as Record<string, unknown>
  const decoded = decodeCatalogRestorePayload(conflict.entity, state)

  if (!decoded.ok) {
    return {
      ok: false,
      reason: 'invalid-state',
      entity: conflict.entity,
      field: decoded.field,
    }
  }

  try {
    let createdId: string

    switch (conflict.entity) {
      case 'account': {
        const repo = createLocalAccountRepository(db)
        const created = await repo.create(decoded.payload as CreateAccountPayload)
        createdId = created.id
        break
      }
      case 'category': {
        const repo = createLocalCategoryRepository(db)
        const created = await repo.create(decoded.payload as CreateCategoryPayload)
        createdId = created.id
        break
      }
      case 'transaction': {
        const repo = createLocalTransactionRepository(db)
        const created = await repo.create(decoded.payload as CreateTransactionPayload)
        createdId = created.id
        break
      }
      case 'debtor': {
        const repo = createLocalDebtorRepository(db)
        const created = await repo.create(decoded.payload as CreateDebtorPayload)
        createdId = created.id
        break
      }
      case 'debt_operation': {
        const repo = createLocalDebtOperationRepository(db)
        const created = await repo.create(decoded.payload as CreateDebtOperationPayload)
        createdId = created.id
        break
      }
      case 'planned_payment': {
        const repo = createLocalPlannedPaymentRepository(db)
        const created = await repo.create(decoded.payload as CreatePlannedPaymentPayload)
        createdId = created.id
        break
      }
    }

    markConflictResolved(db, conflict.id)
    return { ok: true, entity: conflict.entity, createdId: createdId! }
  } catch {
    // Repository validation failure (e.g. unknown references, invalid payload):
    // leave the conflict unresolved so the user can retry or dismiss.
    return { ok: false, reason: 'invalid-state', entity: conflict.entity }
  }
}
