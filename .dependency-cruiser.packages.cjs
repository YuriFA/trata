/**
 * Architecture rules for packages/* — invariants #12 (platform-agnostic,
 * fetch-family only) and #13 (api→money is the only cross-package edge).
 *
 * Run from the repo root: `pnpm arch:check` (see root package.json).
 * CI: the `arch-check` job in .github/workflows/ci.yml.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'pkg-leaf-purity',
      comment:
        'invariant #13: money/dates/i18n/tokens are leaves — no workspace imports allowed',
      severity: 'error',
      from: { path: '^packages/(money|dates|i18n|tokens)/src/' },
      to: { path: '^@trata/' },
    },
    {
      name: 'api-only-money',
      comment:
        'invariant #13: packages/api may import only @trata/money from the workspace',
      severity: 'error',
      from: { path: '^packages/api/src/' },
      to: { path: '^@trata/(?!money)' },
    },
    {
      name: 'pkg-no-platform-frameworks',
      comment:
        'invariant #12: platform-agnostic packages — no RN/Vue/React imports (fetch-family only)',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/' },
      to: { path: '^(react-native|vue|vue-router|pinia|@vue/.+|react|react-dom)$' },
    },
    {
      name: 'pkg-no-expo',
      comment:
        'invariant #12: expo-* / react-native-* runtime modules are banned in packages — pkg-no-platform-frameworks does not catch them (drizzle-orm/expo-sqlite* subpaths are drizzle code, not expo, and do not match)',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/' },
      to: { path: '^(expo-[^/]+|react-native-[^/]+)$' },
    },
    {
      name: 'pkg-no-date-fns-outside-dates',
      comment: 'invariant #14: date-fns lives only inside packages/dates',
      severity: 'error',
      from: { path: '^packages/(?!dates)[^/]+/src/' },
      to: { path: '^date-fns' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
  },
}
