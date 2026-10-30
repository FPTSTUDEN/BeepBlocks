import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Builds a no-restricted-imports rule forbidding the given sibling modules (design.md §3). */
function forbid(modules, reason) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: modules.map((m) => ({
          group: [`**/${m}`, `**/${m}/**`],
          message: `Module boundary (design.md §3): ${reason}`,
        })),
      },
    ],
  };
}

const ALL = ['sim', 'export', 'composites', 'editor', 'playground', 'app'];
const without = (...keep) => ALL.filter((m) => !keep.includes(m));

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.conformance-tmp'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  // ---- Module boundaries ----
  {
    files: ['src/ir/**'],
    rules: forbid([...ALL, 'domains'], 'ir/ is the contract and imports nothing from the app.'),
  },
  {
    files: ['src/domains/**'],
    rules: forbid(ALL, 'domains/ may only import ir/.'),
  },
  {
    files: ['src/sim/**'],
    rules: forbid(without(), 'sim/ may only import ir/ and domains/.'),
  },
  {
    files: ['src/export/**'],
    rules: forbid(without(), 'export/ may only import ir/ and domains/; desugaring is injected.'),
  },
  {
    files: ['src/composites/**'],
    rules: forbid(without(), 'composites/ may only import ir/ and domains/.'),
  },
  {
    files: ['src/editor/**'],
    rules: forbid(without('composites'), 'editor/ may import ir/, domains/, composites/.'),
  },
  {
    files: ['src/playground/**'],
    rules: forbid(without(), 'playground/ may only import ir/, domains/ and sim/types.'),
  },
);
