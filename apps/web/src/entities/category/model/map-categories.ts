import i18n from '@/shared/i18n'
import {
  mapCategory as mapCategoryBase,
  mapCategories as mapCategoriesBase,
  type Translator,
} from '@trata/i18n'
import type { Category } from './types'

// Adapt vue-i18n's keyed `t` to the package's plain `(key: string) => string`
// translator contract. The dynamic key resolution happens inside the shared
// package (seed slug -> `seeds.categories.*` key), so this stays free of
// dynamic-key calls.
const t = i18n.global.t as unknown as Translator

export const mapCategory = (category: Category): Category => mapCategoryBase(category, t)

export const mapCategories = (categories: Category[]): Category[] =>
  mapCategoriesBase(categories, t)
