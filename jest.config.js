export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/__tests__/**/*.test.js"],
  collectCoverageFrom: [
    "routes/**/*.js",
    "middleware/**/*.js",
    "utils/**/*.js",
    "!**/__tests__/**",
    "!**/node_modules/**",
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  testTimeout: 10000,
  verbose: true,
};
