/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts'],
  // Mirror the tsconfig "@/*" path alias for imports inside tests.
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
