import { inject, type InjectionKey } from 'vue'
import type { CreateDebtorPayload, DebtorRepository, UpdateDebtorPayload } from '@trata/api'

export type { CreateDebtorPayload, DebtorRepository, UpdateDebtorPayload } from '@trata/api'

export const DEBTOR_REPOSITORY_KEY: InjectionKey<DebtorRepository> = Symbol('debtor-repository')

export function useDebtorRepository(): DebtorRepository {
  const repo = inject(DEBTOR_REPOSITORY_KEY)
  if (!repo) {
    throw new Error('DebtorRepository not provided. Call provideRepositories(app) in main.ts.')
  }
  return repo
}
