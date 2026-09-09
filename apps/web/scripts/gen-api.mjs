// Delegates to the `@trata/api` workspace package, which owns the
// generated OpenAPI types (`src/schema.ts`) and the `openapi-typescript` tool.
// The canonical spec still lives at the repo root: `<repo>/docs/api/openapi.yaml`.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const apiPkg = resolve(here, '..', '..', '..', 'packages', 'api')

// Invoke the api package's generator directly with node (no package-manager
// binary on PATH required), replicating its `gen:api` script (`node
// scripts/gen-api.mjs`) from the workspace root.
console.log('[gen:api] delegating to @trata/api')
execFileSync(
  process.execPath,
  [resolve(apiPkg, 'scripts', 'gen-api.mjs')],
  { stdio: 'inherit', cwd: apiPkg },
)
console.log('[gen:api] done')
