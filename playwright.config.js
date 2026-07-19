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

// Merged serial spec: 1.1 → 1.2 → 1.3 run in order on one worker via test.describe.configure({ mode: 'serial' }).
// Originals backed up at tests/ui/user-web/legacy/*.spec.js.bak — restore them if you need to revert.
const userWebOnboardingFiles = ['ui/user-web/1 ui_userweb_onboarding.spec.js'];

const userWebLinkCardOnlyFile = 'ui/user-web/4 ui_userweb_link_card.spec.js';

/** FX suite — individual (5.1), business (5.2), and UK matrix (5.3) run together. */
const userWebFxMultiCountryFiles = [
  'ui/user-web/5.1 ui_userweb_fx_multicountry.spec.js',
  'ui/user-web/5.2 ui_userweb_fx_multicountry_business.spec.js',
  'ui/user-web/5.3 ui_userweb_uk_fx.spec.js',
];

const buWebOnboardingFiles = ['ui/bu-web/1 ui_buweb_onboarding.spec.js'];

const buWebParallelFiles = [
  'ui/bu-web/2 *',   // wire payment
  'ui/bu-web/3 *',   // us ach
  'ui/bu-web/4 *',   // link card
  'ui/bu-web/5.1*',  // fx multicountry
  'ui/bu-web/5.2*',  // fx multicountry business
  'ui/bu-web/5.3*',  // uk fx
  'ui/bu-web/6 *',   // move money
  'ui/bu-web/7 *',   // add payee
  'ui/bu-web/8 *',   // settings auth
  'ui/bu-web/9.1*',  // add account
  'ui/bu-web/9.2*',  // multicurrency account
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
      testMatch: [
        'ui/user-web/2 *',   // wire payment
        'ui/user-web/3 *',   // us ach
        'ui/user-web/6 *',   // move money
        'ui/user-web/7 *',   // add payee
        'ui/user-web/8 *',   // settings auth
        'ui/user-web/9.1*',  // add account
        'ui/user-web/9.2*',  // multicurrency account
      ],
      fullyParallel: true,
      dependencies: ['UI user-web onboarding'],
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web link card only',
      testMatch: userWebLinkCardOnlyFile,
      fullyParallel: true,
      dependencies: ['UI user-web onboarding'],
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web FX multi-country',
      testMatch: userWebFxMultiCountryFiles,
      fullyParallel: true,
      dependencies: ['UI user-web onboarding'],
      use: { ...uiServerUse }
    },
    {
      name: 'UI bu-web onboarding',
      testMatch: buWebOnboardingFiles,
      fullyParallel: false,
      use: { ...uiServerUse }
    },
    {
      name: 'UI bu-web parallel',
      testMatch: buWebParallelFiles,
      fullyParallel: true,
      dependencies: ['UI bu-web onboarding'],
      use: { ...uiServerUse }
    },
    {
      name: 'UI user-web exploratory',
      testMatch: 'ui/user-web/exploratory.spec.js',
      fullyParallel: true,
      use: { ...uiServerUse }
    }
  ]
});
