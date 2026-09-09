export { CategoryRepositoryProvider } from './api/repository'
export { createLocalCategoryRepository } from '@trata/local-data'
export {
  useCategories,
  useCategoriesIncludingArchived,
  useCreateCategory,
  useUpdateCategory,
} from './model/use-categories'
export type { Category } from './model/use-categories'
export {
  categoryIconsForType,
  defaultCategoryIcon,
  pickCategoryColor,
} from './config/category-appearance'
