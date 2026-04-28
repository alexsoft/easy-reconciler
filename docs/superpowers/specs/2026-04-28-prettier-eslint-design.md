# Prettier + ESLint Setup

**Date:** 2026-04-28

## Overview

Add Prettier and ESLint to the pnpm monorepo with a single root config covering all three packages (`api`, `web`, `shared`). CLI-only (no editor config). Opinionated but practical rule set.

## Files

```
easy-reconciler/
├── eslint.config.ts          # single flat config (ESLint 9), all packages
├── .prettierrc               # prettier config
├── .prettierignore           # excludes build artifacts and generated files
└── package.json              # add format script; lint script already present
    packages/
    ├── api/package.json      # add lint script
    ├── web/package.json      # add lint script
    └── shared/package.json   # add lint script
```

## Prettier Config

`.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 120,
  "tabWidth": 2
}
```

`.prettierignore` excludes: `node_modules`, `dist`, `pnpm-lock.yaml`.

## ESLint Config

`eslint.config.ts` — ESLint 9 flat config format. Three rule blocks:

### Block 1 — All TypeScript files (`packages/*/src/**/*.{ts,tsx}`)
- `@typescript-eslint/recommended`
- `curly: ["error", "all"]` — always require braces on control flow
- `no-console: "warn"`
- `prefer-const: "error"`
- `no-unused-vars: "off"`, `@typescript-eslint/no-unused-vars: "error"`

### Block 2 — React files (`packages/web/src/**/*.{ts,tsx}`)
Extends block 1 plus:
- `eslint-plugin-react` recommended
- `eslint-plugin-react-hooks` recommended
- `react/react-in-jsx-scope: "off"` (React 17+ JSX transform)

### Block 3 — Config and test files (`**/*.config.ts`, `**/*.test.{ts,tsx}`)
Relaxed override:
- `no-console: "off"`

## npm Scripts

Root `package.json`:
- `"lint": "pnpm -r lint"` — already present, kept as-is
- `"format": "prettier --write ."` — new

Each package `package.json`:
- `"lint": "eslint src"` — new

## Dependencies (root devDependencies)

- `eslint`
- `typescript-eslint` (unified package, replaces the separate `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`)
- `eslint-plugin-react`
- `eslint-plugin-react-hooks`
- `eslint-config-prettier`
- `prettier`
