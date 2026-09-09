import { vi, type MockedFunction } from 'vitest'
import type {
  AccountRepository,
  CategoryRepository,
  TransactionRepository,
  DebtorRepository,
  DebtOperationRepository,
} from '@trata/api'
import type { LocalPlannedPaymentRepository } from '@trata/local-data'

export type MockedAccountRepository = {
  [K in keyof AccountRepository]: MockedFunction<AccountRepository[K]>
}
export type MockedCategoryRepository = {
  [K in keyof CategoryRepository]: MockedFunction<CategoryRepository[K]>
}
export type MockedTransactionRepository = {
  [K in keyof TransactionRepository]: MockedFunction<TransactionRepository[K]>
}
export type MockedDebtorRepository = {
  [K in keyof DebtorRepository]: MockedFunction<DebtorRepository[K]>
}
export type MockedDebtOperationRepository = {
  [K in keyof DebtOperationRepository]: MockedFunction<DebtOperationRepository[K]>
}
export type MockedPlannedPaymentRepository = {
  [K in keyof LocalPlannedPaymentRepository]: MockedFunction<LocalPlannedPaymentRepository[K]>
}

export function createMockAccountRepository(
  overrides: Partial<MockedAccountRepository> = {},
): MockedAccountRepository {
  return {
    getAll: vi.fn<AccountRepository['getAll']>(),
    getById: vi.fn<AccountRepository['getById']>(),
    create: vi.fn<AccountRepository['create']>(),
    update: vi.fn<AccountRepository['update']>(),
    remove: vi.fn<AccountRepository['remove']>(),
    ...overrides,
  }
}

export function createMockCategoryRepository(
  overrides: Partial<MockedCategoryRepository> = {},
): MockedCategoryRepository {
  const repo = {
    getAll: vi.fn<CategoryRepository['getAll']>(),
    getAllIncludingArchived: vi.fn<CategoryRepository['getAllIncludingArchived']>(),
    getById: vi.fn<CategoryRepository['getById']>(),
    create: vi.fn<CategoryRepository['create']>(),
    update: vi.fn<CategoryRepository['update']>(),
    remove: vi.fn<CategoryRepository['remove']>(),
    ...overrides,
  } as MockedCategoryRepository
  // Default: the archived-inclusive listing mirrors `getAll` so test
  // fixtures (active-only) stay valid for both query surfaces; override
  // explicitly where the split matters.
  if (!overrides.getAllIncludingArchived) {
    repo.getAllIncludingArchived.mockImplementation(async () => repo.getAll())
  }
  return repo
}

export function createMockTransactionRepository(
  overrides: Partial<MockedTransactionRepository> = {},
): MockedTransactionRepository {
  return {
    getAll: vi.fn<TransactionRepository['getAll']>(),
    getById: vi.fn<TransactionRepository['getById']>(),
    query: vi.fn<TransactionRepository['query']>(),
    listPage: vi.fn<TransactionRepository['listPage']>(),
    create: vi.fn<TransactionRepository['create']>(),
    update: vi.fn<TransactionRepository['update']>(),
    remove: vi.fn<TransactionRepository['remove']>(),
    ...overrides,
  }
}

export function createMockDebtorRepository(
  overrides: Partial<MockedDebtorRepository> = {},
): MockedDebtorRepository {
  return {
    getAll: vi.fn<DebtorRepository['getAll']>(),
    getById: vi.fn<DebtorRepository['getById']>(),
    create: vi.fn<DebtorRepository['create']>(),
    update: vi.fn<DebtorRepository['update']>(),
    remove: vi.fn<DebtorRepository['remove']>(),
    ...overrides,
  }
}

export function createMockDebtOperationRepository(
  overrides: Partial<MockedDebtOperationRepository> = {},
): MockedDebtOperationRepository {
  return {
    getAll: vi.fn<DebtOperationRepository['getAll']>(),
    getById: vi.fn<DebtOperationRepository['getById']>(),
    query: vi.fn<DebtOperationRepository['query']>(),
    create: vi.fn<DebtOperationRepository['create']>(),
    update: vi.fn<DebtOperationRepository['update']>(),
    remove: vi.fn<DebtOperationRepository['remove']>(),
    ...overrides,
  }
}

export function createMockPlannedPaymentRepository(
  overrides: Partial<MockedPlannedPaymentRepository> = {},
): MockedPlannedPaymentRepository {
  return {
    getAll: vi.fn<LocalPlannedPaymentRepository['getAll']>(),
    getById: vi.fn<LocalPlannedPaymentRepository['getById']>(),
    query: vi.fn<LocalPlannedPaymentRepository['query']>(),
    create: vi.fn<LocalPlannedPaymentRepository['create']>(),
    update: vi.fn<LocalPlannedPaymentRepository['update']>(),
    remove: vi.fn<LocalPlannedPaymentRepository['remove']>(),
    confirmPlannedPayment: vi.fn<LocalPlannedPaymentRepository['confirmPlannedPayment']>(),
    ...overrides,
  }
}

export function createMockRepositoryBundle() {
  return {
    accounts: createMockAccountRepository(),
    categories: createMockCategoryRepository(),
    transactions: createMockTransactionRepository(),
    debtors: createMockDebtorRepository(),
    debtOperations: createMockDebtOperationRepository(),
    plannedPayments: createMockPlannedPaymentRepository(),
  }
}
