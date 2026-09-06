import { createApiClient } from '@expense-tracker/api'

// Request-timeout tiers for the web app (web-offline-resilience design D1):
// on carrier-whitelisted mobile networks a blackholed backend stalls callers
// for the browser's full TCP timeout, so every request is bounded. The main
// client uses the factory default (10s); auth/session roundtrips are small
// and gate the restore, so they get a tighter bound via per-call signals in
// the session API; the sync transport may legitimately carry large first-sync
// pages on slow links, so the worker builds its own 30s client.
export const AUTH_REQUEST_TIMEOUT_MS = 5_000
const SYNC_REQUEST_TIMEOUT_MS = 30_000

// Resolve a base URL the generated client can build absolute Request URLs from.
//
// Default (no env): same-origin via the Vite dev/preview proxy - `/api/*` is
// forwarded to the backend (see vite.config.ts), which keeps the session cookie
// same-origin (no SameSite/Secure friction) and sidesteps CORS preflight so
// PATCH / custom headers (Idempotency-Key) work without extra backend CORS.
//
// Set `VITE_API_BASE_URL` to point the client directly at the backend
// (cross-origin) when not proxying.
function resolveBaseUrl(): string {
  const env = import.meta.env.VITE_API_BASE_URL
  if (env) return env
  return typeof window !== 'undefined' && window.location ? window.location.origin : ''
}

// The shared `createApiClient` factory (framework-agnostic) attaches the error
// middleware that throws a typed RepositoryError on every non-2xx response.
export const apiClient = createApiClient({ baseUrl: resolveBaseUrl() })

// The sync transport's client: same base URL, relaxed single-request bound
// (see the tier comment above). Used by the local-db worker.
export const syncApiClient = createApiClient({
  baseUrl: resolveBaseUrl(),
  timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
})
