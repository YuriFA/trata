import '../../global.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useQueryClient } from '@tanstack/react-query'
import NetInfo from '@react-native-community/netinfo'
import { AppState, type AppStateStatus, View } from 'react-native'
import { QueryClientProvider } from '@tanstack/react-query'
import { Uniwind } from 'uniwind'
import { ThemeProvider } from '@/shared/config/theme'
import { BottomSheetProvider } from '@/shared/ui/bottom-sheet/bottom-sheet-provider'
import { Text } from '@/shared/ui/text'
import { DatabaseProvider, useLocalDatabase } from '@/shared/lib/db/database-context'
import { openLocalDatabase } from '@/shared/lib/db/database'
import { connectQueryFocusManager, createQueryClient } from '@/shared/lib/query/query-client'
import { AuthProvider, useAuth } from '@/entities/session'
import { AccountRepositoryProvider, createLocalAccountRepository } from '@/entities/account'
import { CategoryRepositoryProvider, createLocalCategoryRepository } from '@/entities/category'
import {
  TransactionRepositoryProvider,
  createLocalTransactionRepository,
} from '@/entities/transaction'
import {
  DebtRepositoryProvider,
  createLocalDebtOperationRepository,
  createLocalDebtorRepository,
} from '@/entities/debt'
import {
  PlannedPaymentRepositoryProvider,
  createLocalPlannedPaymentRepository,
} from '@/entities/planned-payment'
import { registerBackgroundSync } from '@/shared/lib/sync/background-sync'
import { createLocalSyncTransport } from '@/shared/lib/sync/transport'
import { APP_VERSION } from '@/shared/config/app-version'
import { API_BASE_URL } from '@/shared/config/api'
import {
  configureIdFactory,
  createSyncEngine,
  createSyncRunPolicy,
  type SyncEngineState,
} from '@trata/local-data'
import { randomUUID } from 'expo-crypto'
import { refreshRates } from '@/shared/lib/db/rates'
import { SyncContext, type SyncController } from '@/shared/lib/sync/sync-context'
import { ConflictCenter } from '@/features/sync-conflicts'
import { useEnsureCurrentHousehold } from '@/features/household-join'

// Hermes has no WebCrypto: bind the shared id factory to expo-crypto before
// any database work (ids are minted inside @trata/local-data).
configureIdFactory(randomUUID)

// Boot version line (spec: `app-version`): one console.info identifying the
// running build, so "is the app on the right version?" is answered without
// server access and mobile/api drift is visible. The API part is
// fire-and-forget and bypasses the API client (no session semantics): an
// offline start logs the mobile-only line and never blocks boot.
async function logBuildVersions(): Promise<void> {
  const parts = [`mobile ${APP_VERSION}`]
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`)
    if (res.ok) {
      const health = (await res.json()) as { version?: string }
      if (health.version) parts.push(`api ${health.version}`)
    }
  } catch {
    // API unreachable: keep the mobile-only line.
  }
  console.info(`[expense-tracker] ${parts.join(' · ')}`)
}
void logBuildVersions()

/**
 * Feeds safe-area insets into Uniwind so `*-safe` utilities (e.g. Screen's
 * `p-safe`) resolve with real values. react-native-safe-area-context@5.6 has
 * no SafeAreaListener yet, so bridge from useSafeAreaInsets instead - the
 * SafeAreaProvider itself is mounted by expo-router's ExpoRoot above us.
 */
function UniwindInsetsBridge() {
  const insets = useSafeAreaInsets()

  useEffect(() => {
    Uniwind.updateInsets(insets)
  }, [insets])

  return null
}

/**
 * App-level data wiring: opens (and migrates) the local SQLite database,
 * exposes it and the three repositories through their contexts, and mounts
 * the TanStack Query client plus the offline-first plumbing: the auth/session
 * provider (with the ownership gate), the sync engine with its opportunistic
 * triggers, and the global conflict-resolution host. Children render only
 * after the database is ready; until then the screen stays empty for the
 * brief local open (~ms).
 */
function AppDataProviders({ children }: { children: React.ReactNode }) {
  const [database, setDatabase] = useState<Awaited<ReturnType<typeof openLocalDatabase>> | null>(
    null,
  )
  const [error, setError] = useState<Error | null>(null)
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    let cancelled = false
    openLocalDatabase()
      .then((db) => {
        if (!cancelled) setDatabase(db)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => connectQueryFocusManager(), [])

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text variant="h4" className="text-center text-foreground">
          Не удалось открыть локальную базу данных
        </Text>
        <Text variant="body" className="mt-2 text-center text-muted-foreground">
          {error.message}
        </Text>
      </View>
    )
  }

  if (!database) return null

  return (
    <DatabaseProvider database={database}>
      <QueryClientProvider client={queryClient}>
        <AccountRepositoryProvider repository={createLocalAccountRepository(database)}>
          <CategoryRepositoryProvider repository={createLocalCategoryRepository(database)}>
            <TransactionRepositoryProvider repository={createLocalTransactionRepository(database)}>
              <DebtRepositoryProvider
                debtorRepository={createLocalDebtorRepository(database)}
                debtOperationRepository={createLocalDebtOperationRepository(database)}
              >
                <PlannedPaymentRepositoryProvider
                  repository={createLocalPlannedPaymentRepository(database)}
                >
                  <AuthProvider>
                    <SyncProvider>
                      <ConflictCenter />
                      {children}
                    </SyncProvider>
                  </AuthProvider>
                </PlannedPaymentRepositoryProvider>
              </DebtRepositoryProvider>
            </TransactionRepositoryProvider>
          </CategoryRepositoryProvider>
        </AccountRepositoryProvider>
      </QueryClientProvider>
    </DatabaseProvider>
  )
}

/**
 * Sync engine + run-policy composition root (design D7): creates the engine
 * once over the local database and the shared API client, then hands the
 * opportunistic triggers to the shared run-policy (@trata/local-data
 * owns the debounce, the auth/household gate order, and the invalidation
 * rule). The household gate comes from `useEnsureCurrentHousehold` (the
 * absorbed HouseholdRebaseGuard: its Alert flow lives in the household-join
 * feature); this provider adapts the platform sources - auth status,
 * AppState/NetInfo, the mutation cache. Lives at the app layer - the FSD
 * composition root - because it composes entity state (auth, household) with
 * shared infrastructure; lower layers read it via useSyncController from
 * shared/lib/sync/sync-context.
 */
function SyncProvider({ children }: { children: React.ReactNode }) {
  const db = useLocalDatabase()
  const queryClient = useQueryClient()
  const { status: authStatus } = useAuth()
  const ensureCurrentHousehold = useEnsureCurrentHousehold()

  // The engine's completion signal fans out to the run-policy's listener
  // (the policy owns the invalidation rule); the set is the handoff point
  // between the engine constructor and the policy created below.
  const [runCompleteListeners] = useState(
    () => new Set<(result: { wroteLocalData: boolean }) => void>(),
  )
  const [engine] = useState(() =>
    createSyncEngine({
      db,
      transport: createLocalSyncTransport(db),
      onRunComplete: (result) => {
        for (const listener of runCompleteListeners) listener(result)
      },
    }),
  )

  // Latest-only refs: the policy is created once and must not be rebuilt on
  // auth/user changes - its debounce timer and gate state would be lost.
  const authStatusRef = useRef(authStatus)
  const ensureRef = useRef(ensureCurrentHousehold)
  const [policy] = useState(() =>
    createSyncRunPolicy({
      engine: {
        run: (runOptions) => engine.run(runOptions),
        resume: () => engine.resume(),
      },
      isAuthenticated: () => authStatusRef.current === 'authenticated',
      // Until the effect below registers the gate (first render only), a
      // check rejects: the run is skipped, never executed un-gated.
      ensureHouseholdCurrent: () =>
        ensureRef.current
          ? ensureRef.current()
          : Promise.reject(new Error('household gate not registered')),
      invalidateKeys: (keys) => {
        for (const key of keys) {
          void queryClient.invalidateQueries({ queryKey: [...key] })
        }
      },
      onRunComplete: (cb) => {
        runCompleteListeners.add(cb)
        return () => runCompleteListeners.delete(cb)
      },
    }),
  )

  const [engineState, setEngineState] = useState<SyncEngineState>(() => engine.getState())
  useEffect(() => engine.subscribe(() => setEngineState(engine.getState())), [engine])

  // OS-scheduled background-fetch trigger (dev build only): best-effort
  // catch-up while the app sits in the background; correctness never
  // depends on it (the triggers below stay primary). Idempotent, fire-and-forget.
  useEffect(() => {
    registerBackgroundSync()
  }, [])

  // Exchange-rates refresh at session boundaries (multi-currency design D5):
  // app start here, foreground and regained connectivity below. Non-fatal
  // by contract - a failed refresh keeps the cached snapshot in effect.
  useEffect(() => {
    void refreshRates(db)
  }, [db])

  // The gate registers before any auth flip is carried into the policy (the
  // effect order is deliberate); auth flips resume the engine and kick a
  // gated cycle - on mount this is also the initial sync right after the
  // ownership check passes.
  useEffect(() => {
    ensureRef.current = ensureCurrentHousehold
  }, [ensureCurrentHousehold])
  useEffect(() => {
    authStatusRef.current = authStatus
    policy.notifyAuthChange(authStatus === 'authenticated')
  }, [authStatus, policy])

  // Reconnect / foreground session boundaries + the post-mutation source.
  useEffect(() => {
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        policy.notifySessionBoundary()
        void refreshRates(db)
      }
    })
    const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        policy.notifySessionBoundary()
        void refreshRates(db)
      }
    })
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      const action = (event as { action?: { type?: string } }).action
      if (event.type === 'updated' && action?.type === 'success') {
        policy.notifyLocalMutation()
      }
    })
    return () => {
      unsubscribeNetInfo()
      appStateSubscription.remove()
      unsubscribeMutations()
    }
  }, [policy, queryClient, db])

  useEffect(() => () => policy.dispose(), [policy])

  const conflictPresenterRef = useRef<(() => void) | null>(null)
  const registerConflictPresenter = useCallback((presenter: (() => void) | null) => {
    conflictPresenterRef.current = presenter
  }, [])
  const presentConflicts = useCallback(() => {
    conflictPresenterRef.current?.()
  }, [])

  const value = useMemo<SyncController>(
    () => ({
      engine,
      engineState,
      runNow: async () => {
        await engine.run({ force: true })
      },
      presentConflicts,
      registerConflictPresenter,
    }),
    [engine, engineState, presentConflicts, registerConflictPresenter],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

/**
 * The @gorhom modal host must sit INSIDE the data providers: a sheet's form
 * component mounts under this host (not under the screen that opened it), so
 * placing `BottomSheetProvider` above the repositories would cut portaled
 * forms off from their repository/query contexts (conventions forms.md §3).
 */
function AppShellProviders({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProviders>
      <StatusBar style="auto" />
      <UniwindInsetsBridge />
      <BottomSheetProvider>{children}</BottomSheetProvider>
    </AppDataProviders>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AppShellProviders>
          <Stack screenOptions={{ headerShown: false, gestureEnabled: true }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            {/* Stack destinations for the Home quick actions. */}
            <Stack.Screen name="income" />
            <Stack.Screen name="debts" />
            {/* Analytics tab detail screens (expense/income breakdown). */}
            <Stack.Screen name="analytics-detail" />
            {/* Invitation accept deep link (household-join design D6). */}
            <Stack.Screen name="invite/[token]" />
          </Stack>
        </AppShellProviders>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
