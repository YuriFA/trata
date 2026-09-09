import { createContext, useContext, type ReactNode } from 'react'
import type { CategoryRepository } from '@trata/api'

const CategoryRepositoryContext = createContext<CategoryRepository | null>(null)

export interface CategoryRepositoryProviderProps {
  repository: CategoryRepository
  children: ReactNode
}

export function CategoryRepositoryProvider({
  repository,
  children,
}: CategoryRepositoryProviderProps) {
  return (
    <CategoryRepositoryContext.Provider value={repository}>
      {children}
    </CategoryRepositoryContext.Provider>
  )
}

/** Injects the category repository; throws when the provider is missing. */
export function useCategoryRepository(): CategoryRepository {
  const repository = useContext(CategoryRepositoryContext)
  if (!repository) {
    throw new Error('useCategoryRepository requires <CategoryRepositoryProvider> in the tree')
  }
  return repository
}
