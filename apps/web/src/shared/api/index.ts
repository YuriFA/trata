// Re-exported from `@expense-tracker/api`; the local `client.ts` only adds the
// web-specific base-URL resolution (Vite env / `window.location`).
export { apiClient, syncApiClient, AUTH_REQUEST_TIMEOUT_MS } from './client'
export type { components } from '@expense-tracker/api'
export { setUnauthorizedHandler } from '@expense-tracker/api'
