import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'platforms/switch/romfs/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    // Nintendo Switch shell: nx.js provides web-like globals plus its own.
    files: ['platforms/switch/src/**/*.js', 'platforms/switch/dev/**/*.js'],
    languageOptions: { globals: { ...globals.browser, Switch: 'readonly', fonts: 'readonly', DEBUG_CONTROLLERS: 'readonly' } }
  },
  {
    files: ['platforms/switch/*.mjs', 'platforms/switch/test/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error'
    }
  }
];
