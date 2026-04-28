import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },

  // Block 1: all TypeScript source files across all packages
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      curly: ['error', 'all'],
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Block 2: React files (web package only)
  ...tseslint.config({
    files: ['packages/web/src/**/*.{ts,tsx}'],
    extends: [reactPlugin.configs.flat.recommended, reactPlugin.configs.flat['jsx-runtime']],
    plugins: { 'react-hooks': reactHooksPlugin },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: '18.3.1' } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/prop-types': 'off',
    },
  }),

  // Block 3: config and test files — relax no-console
  {
    files: ['**/*.config.{ts,mjs,js}', '**/*.test.{ts,tsx}', '**/test-setup.ts'],
    rules: { 'no-console': 'off' },
  },

  // Prettier last — disables ESLint rules that conflict with Prettier formatting
  prettierConfig,
);
