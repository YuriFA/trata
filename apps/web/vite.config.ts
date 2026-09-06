import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080'

// Build version (spec: app-version): the image tag (sha-<short>) baked in
// at build time via apps/web/Dockerfile (ARG VERSION -> ENV VITE_APP_VERSION),
// `dev` for local/vitest builds. Consumed through shared/config/app-version.ts.
const APP_VERSION = process.env.VITE_APP_VERSION ?? 'dev'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    // App-shell-only PWA (capability `web-pwa`): a CUSTOM worker
    // (src/sw.ts, injectManifest) precaches the built shell incl. the
    // SQLite-WASM binary and the local-db worker chunk so a cold start works
    // offline; there is NO runtime caching, so API requests always hit the
    // network (never a stale cached response) and offline behavior comes from
    // the local-first data layer instead. The custom source additionally
    // carries the prompted-update handshake and the reminder push handlers
    // (web-push change, ADR-0007).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // The manifest stays hand-maintained at public/site.webmanifest
      // (linked from index.html); the plugin must not generate its own.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,webmanifest,png,svg,ico}'],
        // The emscripten bundle ships worker1/opfs-proxy side files that the
        // app never fetches (spike: web-sqlite-wasm-driver) - keep the ~1 MB
        // of dead assets out of the precache.
        globIgnores: ['**/sqlite3-worker1*', '**/sqlite3-opfs-async-proxy*'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Same-origin proxy for `/api/*`: the browser talks to the dev/preview server
  // origin, which forwards to the backend. This keeps the session cookie
  // same-origin (no SameSite/Secure friction) and sidesteps CORS preflight
  // entirely, so PATCH / custom headers (Idempotency-Key) work without extra
  // backend CORS configuration.
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
