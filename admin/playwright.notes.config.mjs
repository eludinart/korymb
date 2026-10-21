/** @type {import("@playwright/test").PlaywrightTestConfig} */
const config = {
  testDir: "./e2e",
  testMatch: "task-notes.spec.ts",
  timeout: 30_000,
};

export default config;
