// Mobile API client over the shared factory. The base URL points at the
// backend directly - there is no same-origin proxy on React Native. Override
// with EXPO_PUBLIC_API_URL (e.g. 10.0.2.2:8080 for an Android emulator); the
// default http://localhost:8080 works from the iOS simulator, which shares
// the host network. The session cookie is managed by RN's shared cookie
// store (sent automatically with credentials: 'include').
//
// NOTE: EXPO_PUBLIC_* vars are inlined by Metro at bundle time - restart the
// dev server (and reinstall the Expo Go bundle) after changing them.

import { createApiClient } from '@trata/api'
import { API_BASE_URL } from '@/shared/config/api'

export const apiClient = createApiClient({
  baseUrl: API_BASE_URL,
})
