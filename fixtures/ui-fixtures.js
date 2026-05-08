const path = require('path');
const { test: baseTest, expect, chromium } = require('@playwright/test');

/**
 * UI test fixtures that use a persistent browser context.
 * Cache (and cookies/storage) are kept in .playwright-ui-cache between runs,
 * so the site can load faster after the first run.
 */
const test = baseTest.extend({
  context: async ({}, use) => {
    const userDataDir = path.join(process.cwd(), '.playwright-ui-cache');
    const context = await chromium.launchPersistentContext(userDataDir, {
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      navigationTimeout: 120000,
      actionTimeout: 15000,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    });
    await use(context);
    await context.close().catch(() => {});
  },
});

module.exports = { test, expect };
