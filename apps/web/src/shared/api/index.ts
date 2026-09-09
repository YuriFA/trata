// Re-exported from `@trata/api`; the local `client.ts` only adds the
// web-specific base-URL resolution (Vite env / `window.location`).
export { apiClient, syncApiClient, AUTH_REQUEST_TIMEOUT_MS } from './client'
export type { components } from '@trata/api'
export { setUnauthorizedHandler } from '@trata/api'
