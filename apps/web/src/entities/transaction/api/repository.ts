import { inject, type InjectionKey } from 'vue'
import type {
  CreateTransactionPayload,
  TransactionQuery,
  TransactionRepository,
  UpdateTransactionPayload,
} from '@trata/api'

export type {
  CreateTransactionPayload,
  TransactionQuery,
  TransactionRepository,
  UpdateTransactionPayload,
} from '@trata/api'

export const TRANSACTION_REPOSITORY_KEY: InjectionKey<TransactionRepository> =
  Symbol('transaction-repository')

export function useTransactionRepository(): TransactionRepository {
  const repo = inject(TRANSACTION_REPOSITORY_KEY)
  if (!repo) {
    throw new Error('TransactionRepository not provided. Call provideRepositories(app) in main.ts.')
  }
  return repo
}
