const { defineConfig } = require('@playwright/test');
require('dotenv').config();
const { getUiBaseUrl } = require('./utils/env');

const uiServerUse = {
  baseURL: getUiBaseUrl(),
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

/** No dependency on onboarding — use with LOGIN_PHONE_RAW (and optional STANDALONE_*) in .env. */
const userWebLinkCardOnlyFile = 'ui/user-web/1.7 ui_userweb_linkcard.spec.js';

/** Multi-country FX suite — auth.setup primes OTP once; 8 tests then login in parallel (no OTP needed). */
const userWebFxMultiCountryFile = 'ui/user-web/1.8 ui_userweb_fx_multicountry.spec.js';
const userWebAuthSetupFile = 'ui/user-web/auth.setup.js';

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
  // UI_WORKERS in .env controls parallel worker count; onboarding phases override with --workers=1.
  workers: process.env.UI_WORKERS ? parseInt(process.env.UI_WORKERS, 10) : 1,
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
      use: { ...uiServerUse }
    },
    {
      name: 'UI BCR parallel',
      testMatch: 'ui/bcr/*.spec.js',
      testIgnore: bcrOnboardingFiles,
      fullyParallel: true,
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web onboarding',
      testMatch: userWebOnboardingFiles,
      fullyParallel: false,
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web parallel',
      testMatch: 'ui/user-web/*.spec.js',
      testIgnore: [...userWebOnboardingFiles, userWebLinkCardOnlyFile, userWebFxMultiCountryFile],
      fullyParallel: true,
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web link card only',
      testMatch: userWebLinkCardOnlyFile,
      fullyParallel: true,
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web auth setup',
      testMatch: userWebAuthSetupFile,
      use: { ...uiServerUse, trace: 'off', video: 'off' }
    },
    {
      name: 'UI user-web FX multi-country',
      testMatch: userWebFxMultiCountryFile,
      fullyParallel: true,
      dependencies: ['UI user-web auth setup'],
      use: { ...uiServerUse }
    }
  ]
});
