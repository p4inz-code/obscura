// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./packages/core/tsconfig.eslint.json', './packages/cli/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Codebase convention: unused params/vars prefixed with _ are intentional
      // (e.g. TransformContext callbacks that don't need every arg).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `any` shows up deliberately in a few documented spots (PipelineStep.options,
      // plugin-api generics). Warn, don't block — CONTRIBUTING.md requires a comment
      // justifying each one, this just surfaces new undocumented uses for review.
      '@typescript-eslint/no-explicit-any': 'warn',

      // The AST walker functions (binder.ts, generator.ts, string-transform.ts, etc.)
      // are long exhaustive switch statements over ~20 node types by design — that's
      // the correct shape for a visitor, not a complexity smell to refactor away.
      'complexity': 'off',

      // Deep-clone-and-return transform functions intentionally return `expr`/`stat`
      // unchanged in default/passthrough branches — not a style issue.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // Test files: relax type-checked strictness that fights against deliberate
    // patterns here — dynamic require() to dodge module-init ordering in a few
    // combined tests, and loosely-typed fixture/test-double construction.
    // Structural rules (no-unused-vars, etc.) stay on — dead test scaffolding
    // is still worth catching.
    files: ['**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/luau/**', '**/*.d.ts'],
  },
);
