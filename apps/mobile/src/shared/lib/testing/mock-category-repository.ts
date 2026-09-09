import {
  NotFoundError,
  VersionConflictError,
  type Category,
  type CategoryRepository,
  type CreateCategoryPayload,
  type UpdateCategoryPayload,
} from '@trata/api'

export interface MockCategoryRepository extends CategoryRepository {
  snapshot(): Category[]
  calls: { getAll: number; create: number; update: number; remove: number }
}

export function createMockCategoryRepository(initial: Category[] = []): MockCategoryRepository {
  let items = [...initial]
  const calls = { getAll: 0, create: 0, update: 0, remove: 0 }
  let nextId = 1

  return {
    calls,
    snapshot: () => [...items],
    async getAll() {
      calls.getAll += 1
      return items.filter((category) => category.archivedAt === null)
    },
    async getAllIncludingArchived() {
      calls.getAll += 1
      return [...items]
    },
    async getById(id) {
      return items.find((category) => category.id === id) ?? null
    },
    async create(payload: CreateCategoryPayload) {
      calls.create += 1
      const category: Category = {
        ...payload,
        archivedAt: null,
        id: payload.id ?? `cat-${nextId++}`,
        version: 1,
      }
      items.push(category)
      return { ...category }
    },
    async update(id, payload: UpdateCategoryPayload) {
      calls.update += 1
      const index = items.findIndex((category) => category.id === id)
      if (index === -1) throw new NotFoundError('Category not found')
      if (payload.version !== items[index].version) {
        throw new VersionConflictError('Category was modified concurrently', {
          apiCode: 'CATEGORY_VERSION_CONFLICT',
        })
      }
      const { version: _cas, archived, ...fields } = payload
      items[index] = {
        ...items[index],
        ...fields,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? '2026-09-01T00:00:00.000Z' : null }),
        version: items[index].version + 1,
      }
      return { ...items[index] }
    },
    async remove(id) {
      calls.remove += 1
      const next = items.filter((category) => category.id !== id)
      if (next.length === items.length) throw new NotFoundError('Category not found')
      items = next
    },
  }
}
