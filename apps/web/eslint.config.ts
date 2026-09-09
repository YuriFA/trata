import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginPlaywright from 'eslint-plugin-playwright'
import pluginVitest from '@vitest/eslint-plugin'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

// Message bundles live in the shared `@trata/i18n` workspace package;
// the i18n lint reads them from there so key usage stays validated.
const i18nSettings = {
  'vue-i18n': {
    localeDir: '../../packages/i18n/src/locales/*.json',
    messageSyntaxVersion: '^11.0.0',
  },
}

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', '.*/**']),

  ...pluginVue.configs['flat/recommended'],
  {
    rules: {
      'vue/no-undef-components': [
        'error',
        {
          ignorePatterns: ['RouterView'],
        },
      ],
    },
  },
  vueTsConfigs.recommended,

  ...(vueI18n.configs['flat/recommended'] as Parameters<typeof defineConfigWithVueTs>),
  {
    rules: {
      '@intlify/vue-i18n/no-dynamic-keys': 'error',
      '@intlify/vue-i18n/no-raw-text': [
        'error',
        {
          attributes: {
            '/.+/': [
              'title',
              'aria-label',
              'aria-placeholder',
              'aria-roledescription',
              'aria-valuetext',
            ],
            input: ['placeholder'],
            img: ['alt'],
          },
          ignoreNodes: ['md-icon', 'v-icon'],
          ignorePattern: '^[-#:()&> ·+]+$',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "VExpressionContainer CallExpression[callee.name='$t']",
          message: 'Use useI18n() and t() instead of $t().',
        },
        {
          selector: "VExpressionContainer CallExpression[callee.name='$d']",
          message: 'Use useI18n() and d() instead of $d().',
        },
        {
          selector: "VExpressionContainer CallExpression[callee.name='$n']",
          message: 'Use useI18n() and n() instead of $n().',
        },
      ],
    },
    settings: i18nSettings,
  },
  {
    name: 'app/i18n-strict',
    files: ['src/**/*.{vue,ts,js}', 'src/shared/i18n/locales/*.json'],
    rules: {
      '@intlify/vue-i18n/no-missing-keys': 'off',
      '@intlify/vue-i18n/no-missing-keys-in-other-locales': 'off',
      '@intlify/vue-i18n/no-unused-keys': 'off',
    },
    settings: i18nSettings,
  },
  {
    name: 'app/i18n-strict-enabled',
    files: ['src/**/*.{vue,ts,js}', 'src/shared/i18n/locales/*.json'],
    ignores: process.env.ESLINT_I18N_STRICT === '1' ? [] : ['**/*'],
    rules: {
      '@intlify/vue-i18n/no-missing-keys': 'error',
      '@intlify/vue-i18n/no-missing-keys-in-other-locales': 'error',
      '@intlify/vue-i18n/no-unused-keys': [
        'error',
        {
          extensions: ['.js', '.ts', '.vue'],
        },
      ],
    },
    settings: i18nSettings,
  },

  {
    ...pluginPlaywright.configs['flat/recommended'],
    files: ['e2e/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
  },

  {
    name: 'app/test-overrides',
    files: ['**/*.{test,spec}.ts'],
    rules: {
      'vue/one-component-per-file': 'off',
    },
  },

  {
    name: 'app/ui-overrides',
    files: ['src/shared/ui/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
)
