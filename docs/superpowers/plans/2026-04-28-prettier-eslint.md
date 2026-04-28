# Prettier + ESLint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Prettier and ESLint across the pnpm monorepo with a single root flat config covering all three packages.

**Architecture:** Single `eslint.config.mjs` at the repo root with three glob-scoped rule blocks (all TS, React-only, relaxed for tests/config). Prettier config in `.prettierrc`. Config files committed first, then a one-time formatting pass, then lint violation fixes — three clean commits. All commands use `bin/pnpm` (host has no Node/pnpm; project wraps everything through Docker).

**Tech Stack:** ESLint 9 (flat config, `.mjs`), typescript-eslint v8 unified package, eslint-plugin-react, eslint-plugin-react-hooks, eslint-config-prettier, Prettier 3.

---

## File Map

| Action | Path                           | Purpose                                       |
| ------ | ------------------------------ | --------------------------------------------- |
| Create | `eslint.config.mjs`            | Root ESLint flat config covering all packages |
| Create | `.prettierrc`                  | Prettier formatting rules                     |
| Create | `.prettierignore`              | Paths Prettier skips                          |
| Modify | `package.json`                 | Add `format` and `format:check` scripts       |
| Modify | `packages/api/package.json`    | Add `lint` script                             |
| Modify | `packages/web/package.json`    | Add `lint` script                             |
| Modify | `packages/shared/package.json` | Add `lint` script                             |

---

### Task 1: Install dependencies and create config files

**Files:**

- Modify: `package.json` (root)
- Modify: `pnpm-lock.yaml`
- Create: `eslint.config.mjs`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Modify: `packages/api/package.json`
- Modify: `packages/web/package.json`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Install all dependencies at workspace root**

```bash
bin/pnpm add -w -D eslint @eslint/js typescript-eslint eslint-plugin-react eslint-plugin-react-hooks eslint-config-prettier prettier
```

Expected: packages installed, `pnpm-lock.yaml` updated, no errors.

- [ ] **Step 2: Verify tools are available**

```bash
bin/pnpm exec eslint --version && bin/pnpm exec prettier --version
```

Expected output (exact versions may differ):

```
v9.x.x
3.x.x
```

- [ ] **Step 3: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 120,
  "tabWidth": 2
}
```

- [ ] **Step 4: Create `.prettierignore`**

```
node_modules
dist
pnpm-lock.yaml
```

- [ ] **Step 5: Create `eslint.config.mjs` at repo root**

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**'] },

  // Block 1: all TypeScript source files across all packages
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      curly: ['error', 'all'],
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },

  // Block 2: React files (web package only)
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
    },
  },

  // Block 3: config and test files — relax no-console
  {
    files: ['**/*.config.{ts,mjs,js}', '**/*.test.{ts,tsx}', '**/test-setup.ts'],
    rules: { 'no-console': 'off' },
  },

  // Prettier last — disables ESLint rules that conflict with Prettier formatting
  prettierConfig,
);
```

- [ ] **Step 6: Add `format` and `format:check` scripts to root `package.json`**

The current `scripts` block in `package.json`:

```json
"scripts": {
  "dev": "docker compose up",
  "build": "pnpm -r build",
  "test": "pnpm -r test",
  "lint": "pnpm -r lint"
}
```

Updated `scripts` block:

```json
"scripts": {
  "dev": "docker compose up",
  "build": "pnpm -r build",
  "test": "pnpm -r test",
  "lint": "pnpm -r lint",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

- [ ] **Step 7: Add `lint` script to `packages/api/package.json`**

Add to `scripts`:

```json
"lint": "eslint src"
```

- [ ] **Step 8: Add `lint` script to `packages/web/package.json`**

Add to `scripts`:

```json
"lint": "eslint src"
```

- [ ] **Step 9: Add `lint` script to `packages/shared/package.json`**

Add to `scripts`:

```json
"lint": "eslint src"
```

- [ ] **Step 10: Commit all config files**

```bash
git add eslint.config.mjs .prettierrc .prettierignore package.json packages/api/package.json packages/web/package.json packages/shared/package.json pnpm-lock.yaml
git commit -m "chore: add prettier and eslint with flat config"
```

---

### Task 2: Format existing code with Prettier

**Files:**

- All source files (reformatted in place)

- [ ] **Step 1: Run Prettier across the entire repo**

```bash
bin/pnpm format
```

Expected: Prettier rewrites any files that don't already match the config. A list of modified files is printed. This is expected — it is a one-time normalisation pass.

- [ ] **Step 2: Confirm Prettier is now satisfied**

```bash
bin/pnpm format:check
```

Expected: exits 0, no output.

- [ ] **Step 3: Commit formatting changes**

```bash
git add -A
git commit -m "style: apply prettier formatting to existing code"
```

---

### Task 3: Fix ESLint violations

**Files:**

- Any source files with lint violations

- [ ] **Step 1: Run auto-fix pass across all packages**

```bash
bin/pnpm exec eslint --fix packages/api/src packages/web/src packages/shared/src
```

Expected: ESLint rewrites files to fix `prefer-const` and other auto-fixable rules.

- [ ] **Step 2: Run full lint to see remaining violations**

```bash
bin/pnpm lint
```

Expected: a list of remaining violations. Common patterns and their fixes:

- `@typescript-eslint/no-unused-vars` on a variable `foo` — either remove it or rename to `_foo` if intentionally unused
- `curly` on a one-liner `if (x) return y;` — add braces:
  ```typescript
  if (x) {
    return y;
  }
  ```
- `no-console` warnings — these are `warn` level and will not block the exit code; leave them or remove console calls as appropriate

Errors (not warnings) must all be resolved before proceeding.

- [ ] **Step 3: Re-run lint to confirm no errors remain**

```bash
bin/pnpm lint
```

Expected: exits 0. Warnings are acceptable; errors are not.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve eslint violations in existing code"
```
