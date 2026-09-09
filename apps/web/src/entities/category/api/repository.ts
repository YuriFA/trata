import { inject, type InjectionKey } from 'vue'
import type { CategoryRepository, CreateCategoryPayload, UpdateCategoryPayload } from '@trata/api'

export type { CategoryRepository, CreateCategoryPayload, UpdateCategoryPayload } from '@trata/api'

export const CATEGORY_REPOSITORY_KEY: InjectionKey<CategoryRepository> =
  Symbol('category-repository')

export function useCategoryRepository(): CategoryRepository {
  const repo = inject(CATEGORY_REPOSITORY_KEY)
  if (!repo) {
    throw new Error('CategoryRepository not provided. Call provideRepositories(app) in main.ts.')
  }
  return repo
}
