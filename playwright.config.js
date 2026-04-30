const { defineConfig } = require('@playwright/test');
require('dotenv').config();

const uiServerUse = {
  baseURL: process.env.HOST || 'https://bivo-dev.bivotech.co',
  ignoreHTTPSErrors: true
};

const bcrOnboardingFiles = [
  'ui/bcr/1.1 ui_bcr_signup.spec.js',
  'ui/bcr/1.2 ui_bcr_first_login.spec.js',
  'ui/bcr/1.3 ui_bcr_first_login_setup_payment.spec.js'
];

const userWebOnboardingFiles = [
  'ui/user-web/1.1 ui_userweb_signup.spec.js',
  'ui/user-web/1.2 ui_userweb_first_login.spec.js',
  'ui/user-web/1.3 ui_userweb_first_login_setup_payment.spec.js'
];

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000, // Global test timeout: 1 minute
  expect: {
    timeout: 10000 // Assertion timeout: 10 seconds
  },
  // Default: conservative. Per-project overrides enable parallel UI after onboarding.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html'],
    ['list'],
    ['junit', { outputFile: 'test-results/junit.xml' }]
  ],
  use: {
    actionTimeout: 15000, // Timeout for each action: 15 seconds
    navigationTimeout: 30000, // Timeout for navigation: 30 seconds
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'API Tests',
      testMatch: '**/api/**/*.spec.js',
      use: {
        baseURL: process.env.API_BASE_URL || 'https://devapi.bivotech.co',
        extraHTTPHeaders: {
          'Content-Type': 'application/json',
          'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER || ''
        }
      }
    },
    {
      name: 'UI BCR onboarding',
      testMatch: bcrOnboardingFiles,
      fullyParallel: false,
      workers: 1,
      use: { ...uiServerUse }
    },
    {
      name: 'UI BCR parallel',
      dependencies: ['UI BCR onboarding'],
      testMatch: 'ui/bcr/*.spec.js',
      testIgnore: bcrOnboardingFiles,
      fullyParallel: true,
      workers: process.env.CI ? 2 : 4,
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web onboarding',
      testMatch: userWebOnboardingFiles,
      fullyParallel: false,
      workers: 1,
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web parallel',
      dependencies: ['UI user-web onboarding'],
      testMatch: 'ui/user-web/*.spec.js',
      testIgnore: userWebOnboardingFiles,
      fullyParallel: true,
      workers: process.env.CI ? 2 : 4,
      use: { ...uiServerUse }
    }
  ]
});
