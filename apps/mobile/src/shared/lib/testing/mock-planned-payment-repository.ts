// Test-only planned-payment repository mock (the mock-debt-repositories
// pattern): in-memory state plus per-method call counters and a log of
// manual-confirmation inputs, so screen tests can assert the D6 composite's
// input. The structural type matches the entity's
// LocalPlannedPaymentRepository without importing it (shared never imports
// entities); the composite's advancement semantics are pinned by the real
// repository suite (local-repository.test.ts), not replayed here.
//
// NEVER import this from app code - it exists for `*.test.ts(x)` files only.

import {
  AlreadyExistsError,
  InvalidPayloadError,
  NotFoundError,
  VersionConflictError,
  type CreatePlannedPaymentPayload,
  type PlannedPayment,
  type PlannedPaymentQuery,
  type PlannedPaymentRepository,
  type UpdatePlannedPaymentPayload,
} from '@trata/api'

/** The manual-confirmation input as recorded by the mock. */
interface ConfirmInputRecord {
  planId: string
  amount?: number
  occurredAt?: string
  note?: string
}

export interface MockPlannedPaymentRepository extends PlannedPaymentRepository {
  /** The client-only confirmation composite (structural twin of the entity's). */
  confirmPlannedPayment(input: ConfirmInputRecord): Promise<void>
  /** Copy of the current in-memory rows. */
  snapshot(): PlannedPayment[]
  /** Inputs the confirm sheet submitted, in order. */
  confirmations: ConfirmInputRecord[]
  calls: {
    getAll: number
    create: number
    update: number
    remove: number
    confirm: number
  }
}

export function createMockPlannedPaymentRepository(
  initial: PlannedPayment[] = [],
): MockPlannedPaymentRepository {
  let items = [...initial]
  const confirmations: ConfirmInputRecord[] = []
  const calls = { getAll: 0, create: 0, update: 0, remove: 0, confirm: 0 }
  let nextId = 1

  return {
    calls,
    confirmations,
    snapshot: () => [...items],
    async getAll() {
      calls.getAll += 1
      return [...items]
    },
    async getById(id) {
      return items.find((plan) => plan.id === id) ?? null
    },
    async query(options: PlannedPaymentQuery = {}) {
      calls.getAll += 1
      const rows = options.type ? items.filter((plan) => plan.type === options.type) : [...items]
      return [...rows]
    },
    async create(payload: CreatePlannedPaymentPayload) {
      calls.create += 1
      const id = payload.id ?? `plan-${nextId++}`
      if (items.some((plan) => plan.id === id)) {
        throw new AlreadyExistsError('Planned payment already exists', {
          apiCode: 'PLANNED_PAYMENT_ALREADY_EXISTS',
        })
      }
      const plan: PlannedPayment = {
        id,
        type: payload.type,
        amount: payload.amount,
        name: payload.name ?? '',
        accountId: payload.accountId,
        categoryId: payload.categoryId,
        nextDue: payload.nextDue,
        anchorDate: payload.nextDue,
        regularity: payload.regularity,
        confirmMode: payload.confirmMode,
        reminder: payload.reminder,
        note: payload.note ?? '',
        version: 1,
      }
      items.push(plan)
      return { ...plan }
    },
    async update(id, payload: UpdatePlannedPaymentPayload) {
      calls.update += 1
      const index = items.findIndex((plan) => plan.id === id)
      if (index === -1) {
        throw new NotFoundError('Planned payment not found', {
          apiCode: 'PLANNED_PAYMENT_NOT_FOUND',
        })
      }
      if (payload.version !== items[index].version) {
        throw new VersionConflictError('Planned payment was modified concurrently', {
          apiCode: 'PLANNED_PAYMENT_VERSION_CONFLICT',
        })
      }
      const { version: _cas, ...fields } = payload
      if (Object.keys(fields).length === 0) {
        throw new InvalidPayloadError('No fields to update')
      }
      items[index] = {
        ...items[index],
        ...fields,
        version: items[index].version + 1,
      }
      return { ...items[index] }
    },
    async remove(id) {
      calls.remove += 1
      const next = items.filter((plan) => plan.id !== id)
      if (next.length === items.length) {
        throw new NotFoundError('Planned payment not found', {
          apiCode: 'PLANNED_PAYMENT_NOT_FOUND',
        })
      }
      items = next
    },
    async confirmPlannedPayment(input: ConfirmInputRecord) {
      calls.confirm += 1
      confirmations.push({ ...input })
      if (!items.some((plan) => plan.id === input.planId)) {
        throw new NotFoundError('Planned payment not found', {
          apiCode: 'PLANNED_PAYMENT_NOT_FOUND',
        })
      }
    },
  }
}
