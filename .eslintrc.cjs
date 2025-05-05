/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:prettier/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks',
    'prettier',
    'unused-imports',
  ],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'off',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'all',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    'prettier/prettier': [
      'error',
      {
        singleQuote: true,
        trailingComma: 'es5',
        tabWidth: 2,
        semi: true,
        printWidth: 80,
      },
    ],
    '@typescript-eslint/ban-ts-comment': 'warn',
    'import/no-unresolved': 'off',
    'no-restricted-properties': [
      'error',
      {
        object: 'window',
        property: 'electron',
        message:
          'Import from @ipc/* instead of using window.electron directly.',
      },
    ],
  },
  overrides: [
    {
      files: ['.eslintrc.js'],
      parser: 'espree',
      parserOptions: {
        ecmaVersion: 2021,
      },
    },
    {
      files: ['packages/renderer/ipc/*.ts'],
      rules: {
        'no-restricted-properties': 'off',
      },
    },
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    '*.js',
    '!.eslintrc.js',
    'bun.lockb',
    'preload.cjs',
    '*.cjs',
    '*.mjs',
  ],
};
