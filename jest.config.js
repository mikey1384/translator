/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest"],
  },
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  moduleNameMapper: {
    "^electron$": "<rootDir>/src/__mocks__/electron.ts",
    "^electron-log$": "<rootDir>/src/__mocks__/electron-log.ts",
  },
  setupFilesAfterEnv: ["<rootDir>/src/tests/setupJest.ts"],
};
