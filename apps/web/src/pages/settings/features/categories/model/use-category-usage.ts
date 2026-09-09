import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useTransactions } from '@/entities/transaction'
import { useAccounts } from '@/entities/account'
import { usePlannedPayments } from '@/entities/planned-payment'
import type { Category, PlannedPayment } from '@trata/api'

/** Local-mirror usage facts for one category (management screen). */
export interface CategoryUsage {
  /** Live transactions referencing the category. */
  transactionCount: number
  /** Sum of those transactions' minor-unit amounts (positive magnitude). */
  totalMinorUnits: number
  /** Live planned payments referencing the category (block delete/archive). */
  livePlanCount: number
  /** Blocking live plans, for the blocked dialog copy. */
  blockingPlans: PlannedPayment[]
  /** Per-account balance impact of a cascade, keyed by account id. */
  impactByAccount: { accountId: string; amountMinorUnits: number }[]
}

export interface CategoryUsageIndex {
  byCategory: Record<string, CategoryUsage>
  planNames: (plans: PlannedPayment[]) => string[]
}

/**
 * Counts and impact for the category management screen, computed from the
 * local mirror (spec: management counts are local reads, never an API call).
 */
export function useCategoryUsage(): {
  usage: ComputedRef<CategoryUsageIndex | null>
  isPending: ComputedRef<boolean>
} {
  const transactionsQuery = useTransactions({})
  const accountsQuery = useAccounts()
  const plansQuery = usePlannedPayments({})

  // "No data yet" only: background refetches keep rendered data in place.
  const isPending = computed(
    () =>
      transactionsQuery.isPending.value ||
      accountsQuery.isPending.value ||
      plansQuery.isPending.value,
  )

  const usage = computed<CategoryUsageIndex | null>(() => {
    const transactions = transactionsQuery.data.value
    const accounts = accountsQuery.data.value
    const plans = plansQuery.data.value
    if (!transactions || !accounts || !plans) return null

    const byCategory: Record<string, CategoryUsage> = {}
    const ensure = (id: string): CategoryUsage => {
      return (byCategory[id] ??= {
        transactionCount: 0,
        totalMinorUnits: 0,
        livePlanCount: 0,
        blockingPlans: [],
        impactByAccount: [],
      })
    }

    for (const plan of plans) {
      const entry = ensure(plan.categoryId)
      entry.livePlanCount += 1
      entry.blockingPlans.push(plan)
    }

    const impactIndex: Record<string, Record<string, number>> = {}
    for (const transaction of transactions) {
      if (transaction.type !== 'expense' && transaction.type !== 'income') continue
      const entry = ensure(transaction.categoryId)
      entry.transactionCount += 1
      entry.totalMinorUnits += transaction.amount
      // «Без счета» rows touch no account balance, so they carry no
      // per-account impact in the cascade-preview dialog.
      if (transaction.accountId === null) continue
      const byAccount = (impactIndex[transaction.categoryId] ??= {})
      byAccount[transaction.accountId] =
        (byAccount[transaction.accountId] ?? 0) + transaction.amount
    }
    for (const [categoryId, byAccount] of Object.entries(impactIndex)) {
      byCategory[categoryId]!.impactByAccount = Object.entries(byAccount).map(
        ([accountId, amountMinorUnits]) => ({ accountId, amountMinorUnits }),
      )
    }

    return {
      byCategory,
      planNames: (blocking) => blocking.map((plan) => planName(plan, accounts)),
    }
  })

  return { usage, isPending }
}

function planName(plan: PlannedPayment, accounts: { id: string; name: string }[]): string {
  const account = accounts.find((candidate) => candidate.id === plan.accountId)
  return plan.name || account?.name || ''
}

/** Grouping for the management list: active by type, archived separately. */
export function groupCategories(categories: MaybeRefOrGetter<Category[] | undefined>): {
  expense: ComputedRef<Category[]>
  income: ComputedRef<Category[]>
  archived: ComputedRef<Category[]>
} {
  const list = computed(() => toValue(categories) ?? [])
  const active = computed(() => list.value.filter((category) => category.archivedAt === null))
  return {
    expense: computed(() => active.value.filter((category) => category.type === 'expense')),
    income: computed(() => active.value.filter((category) => category.type === 'income')),
    archived: computed(() => list.value.filter((category) => category.archivedAt !== null)),
  }
}
