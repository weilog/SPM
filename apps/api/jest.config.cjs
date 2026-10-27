module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/test/disable-paid-ai.cjs"],
  testMatch: ["**/test/**/*.spec.ts"],
  testTimeout: 30000,
  detectOpenHandles: true,
};
