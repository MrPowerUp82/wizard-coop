import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'platforms/switch/romfs/', 'platforms/vita/build/', 'platforms/vita/runtime/upstream/', 'platforms/vita/runtime/build/'] },
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
    languageOptions: { globals: { ...globals.browser, Switch: 'readonly', fonts: 'readonly', DEBUG_CONTROLLERS: 'readonly', INTER_SYMBOLS: 'readonly' } }
  },
  {
    files: ['platforms/switch/*.mjs', 'platforms/switch/test/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    // VitaJS examples kept for reference, separate from the game entrypoint.
    files: ['assets/*.js', 'platforms/vita/assets/*.js'],
    languageOptions: { globals: { Audio: 'readonly', Font: 'readonly', Pads: 'readonly', Screen: 'readonly', Power: 'readonly', Dialog: 'readonly', App: 'readonly', os: 'readonly' } }
  },
  {
    // PlayStation Vita shell: QuickJS + NanoVG/SceCtrl runtime globals.
    files: ['platforms/vita/src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, Vita: 'readonly', Screen: 'readonly', Pads: 'readonly', Font: 'readonly', Audio: 'readonly', fonts: 'readonly', DEBUG_CONTROLLERS: 'readonly', INTER_SYMBOLS: 'readonly' } }
  },
  {
    files: ['platforms/vita/*.mjs', 'platforms/vita/scripts/**/*.mjs', 'platforms/vita/test/**/*.mjs'],
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
