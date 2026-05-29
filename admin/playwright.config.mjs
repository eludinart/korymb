/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
};

export default config;
