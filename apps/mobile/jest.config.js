/** @type {import('jest').Config} */

// The jest-expo preset's transformIgnorePatterns allowlists the packages
// babel must transform. Extend that allowlist instead of copying it, so the
// preset stays the single source of truth.
const preset = require('jest-expo/jest-preset')
const transformIgnorePatterns = preset.transformIgnorePatterns.map((pattern) =>
  typeof pattern === 'string' && pattern.includes('node_modules/(?!(')
    ? // dinero.js ships ESM-only; uniwind resolves to TS source under the
      // `react-native` export condition (culori is its ESM-only dependency);
      // without transforming them, jest cannot require them.
      pattern.replace('node_modules/(?!(', 'node_modules/(?!(dinero\\.js|uniwind|culori|')
    : pattern,
)

module.exports = {
  preset: "jest-expo",
  rootDir: ".",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  testPathIgnorePatterns: ["/node_modules/", "/.maestro/", "/e2e/"],
  transformIgnorePatterns,
  // Workspace TS packages are consumed from source; map them out of
  // node_modules so babel transforms them (node_modules is ignored by
  // the transform allowlist).
  moduleNameMapper: {
    "^@trata/money$": "<rootDir>/../../packages/money/src/index.ts",
    "^@trata/api$": "<rootDir>/../../packages/api/src/index.ts",
    "^@trata/dates$": "<rootDir>/../../packages/dates/src/index.ts",
    "^@trata/local-data$": "<rootDir>/../../packages/local-data/src/index.ts",
    "^@trata/local-data/testing$": "<rootDir>/../../packages/local-data/src/testing/index.ts",
  },
  maxWorkers: "50%",
}
