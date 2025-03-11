module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:prettier/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: "latest",
    sourceType: "module",
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint", "react", "react-hooks", "prettier"],
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    "react/react-in-jsx-scope": "off", // Not needed in React 17+
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "prettier/prettier": [
      "error",
      {
        singleQuote: true,
        trailingComma: "es5",
        tabWidth: 2,
        semi: true,
        printWidth: 80,
      },
    ],
    "@typescript-eslint/ban-ts-comment": "warn", // Bun sometimes needs ts-ignore
    "import/no-unresolved": "off", // Bun handles imports differently
  },
  ignorePatterns: ["dist", "node_modules", "*.js", "!.eslintrc.js", "bun.lockb"],
};
