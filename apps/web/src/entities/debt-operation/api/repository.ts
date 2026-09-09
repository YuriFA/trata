import { inject, type InjectionKey } from 'vue'
import type {
  CreateDebtOperationPayload,
  DebtOperationRepository,
  DebtOperationQuery,
  UpdateDebtOperationPayload,
} from '@trata/api'

export type {
  CreateDebtOperationPayload,
  DebtOperationRepository,
  DebtOperationQuery,
  UpdateDebtOperationPayload,
} from '@trata/api'

export const DEBT_OPERATION_REPOSITORY_KEY: InjectionKey<DebtOperationRepository> = Symbol(
  'debt-operation-repository',
)

export function useDebtOperationRepository(): DebtOperationRepository {
  const repo = inject(DEBT_OPERATION_REPOSITORY_KEY)
  if (!repo) {
    throw new Error(
      'DebtOperationRepository not provided. Call provideRepositories(app) in main.ts.',
    )
  }
  return repo
}
