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
const userWebOnboardingFiles = ['ui/user-web/1-onboarding/1-onboarding.spec.js'];

const userWebLinkCardOnlyFile = 'ui/user-web/4-link-card/1-link-card.spec.js';

/** FX suite — individual (5.1), business (5.2), UK matrix (5.3), payee FX (5.4), India (5.5), Mexico
 *  (5.6), China (5.7), Philippines (5.8), Vietnam (5.9), and El Salvador (5.10) run together. */
const userWebFxMultiCountryFiles = [
  'ui/user-web/5.1-fx-multicountry/1-fx-multicountry.spec.js',
  'ui/user-web/5.2-fx-multicountry-business/1-fx-multicountry-business.spec.js',
  'ui/user-web/5.3-uk-fx/1-uk-fx.spec.js',
  'ui/user-web/5.3-uk-fx/2-payee-lifecycle.spec.js',
  'ui/user-web/5.4-payee-fx/1-payee-fx.spec.js',
  'ui/user-web/5.5-india-fx/1-india-fx.spec.js',
  'ui/user-web/5.5-india-fx/2-payee-lifecycle.spec.js',
  'ui/user-web/5.6-mexico-fx/1-mexico-fx.spec.js',
  'ui/user-web/5.7-china-fx/1-china-fx.spec.js',
  'ui/user-web/5.7-china-fx/2-china-businesspayee-fx.spec.js',
  'ui/user-web/5.7-china-fx/3-payee-lifecycle.spec.js',
  'ui/user-web/5.7-china-fx/4-payee-lifecycle-business.spec.js',
  'ui/user-web/5.8-philipines-fx/1-individual-philipines-fx.spec.js',
  'ui/user-web/5.8-philipines-fx/2-business-philipines-fx.spec.js',
  'ui/user-web/5.8-philipines-fx/3-payee-lifecycle.spec.js',
  'ui/user-web/5.8-philipines-fx/4-payee-lifecycle-business.spec.js',
  'ui/user-web/5.9-vietnam-fx/1-individual-vietnam-fx.spec.js',
  'ui/user-web/5.9-vietnam-fx/2-business-vietnam-fx.spec.js',
  'ui/user-web/5.9-vietnam-fx/2-payee-lifecycle.spec.js',
  'ui/user-web/5.10-elsalvador-fx/1-elsalvador-individualpayee-fx.spec.js',
  'ui/user-web/5.10-elsalvador-fx/2-business-elsalvador-fx.spec.js',
  'ui/user-web/5.10-elsalvador-fx/2-payee-lifecycle.spec.js',
];

const buWebOnboardingFiles = ['ui/bu-web/1-onboarding/1-onboarding.spec.js'];

const buWebParallelFiles = [
  'ui/bu-web/2-wire-payment/*.spec.js',                // wire payment
  'ui/bu-web/2.1-withdraw-funds/*.spec.js',             // withdraw funds
  'ui/bu-web/3-us-ach/*.spec.js',                       // us ach
  'ui/bu-web/4-link-card/*.spec.js',                    // link card
  'ui/bu-web/5.1-fx-multicountry/*.spec.js',            // fx multicountry
  'ui/bu-web/5.2-fx-multicountry-business/*.spec.js',   // fx multicountry business
  'ui/bu-web/5.3-payee-fx/*.spec.js',                   // payee fx
  'ui/bu-web/5.4-uk-fx/*.spec.js',                      // uk fx
  'ui/bu-web/5.5-india-fx/*.spec.js',                    // india fx
  'ui/bu-web/5.6-mexico-fx/*.spec.js',                   // mexico fx
  'ui/bu-web/5.7-china-fx/*.spec.js',                    // china fx
  'ui/bu-web/5.8-philipines-fx/*.spec.js',                // philippines fx
  'ui/bu-web/5.9-vietnam-fx/*.spec.js',                   // vietnam fx
  'ui/bu-web/5.10-elsalvador-fx/*.spec.js',               // el salvador fx
  'ui/bu-web/6-move-money/*.spec.js',                   // move money
  'ui/bu-web/7-add-payee/*.spec.js',                    // add payee
  'ui/bu-web/8-settings-auth/*.spec.js',                // settings auth
];

// 10 (internal transfer to a secondary/multicurrency account) reads accounts that
// 9.1/9.2 create, so it must run only once both have actually finished — not just
// raced against them in the same fullyParallel bucket. These two are their own
// project so the ":full" npm script can run them, then unconditionally run the
// "UI bu-web sec-account" project next regardless of pass/fail (see package.json).
// Playwright's own `dependencies` field isn't used for this because it SKIPS the
// dependent project entirely if the dependency has any failure — the opposite of
// what's needed here.
const buWebAccountsFiles = [
  'ui/bu-web/9.1-add-account/*.spec.js',                // add account
  'ui/bu-web/9.2-multicurrency-account/*.spec.js',      // multicurrency account
];

const buWebSecAccountFiles = ['ui/bu-web/10-add-money-to-sec-account/*.spec.js'];

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
        'ui/user-web/2-wire-payment/*.spec.js',              // wire payment
        'ui/user-web/2-withdraw-funds/*.spec.js',             // withdraw funds
        'ui/user-web/3-us-ach/*.spec.js',                     // us ach
        'ui/user-web/6-move-money/*.spec.js',                 // move money
        'ui/user-web/7-add-payee/*.spec.js',                  // add payee
        'ui/user-web/8-settings-auth/*.spec.js',              // settings auth
        'ui/user-web/9.1-add-account/*.spec.js',              // add account
        'ui/user-web/9.2-multicurrency-account/*.spec.js',    // multicurrency account
        'ui/user-web/10-add-money-to-sec-account/*.spec.js',  // add money to secondary account
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
      // 9.1 + 9.2 — run in their own project so the ":full" script can wait for both
      // to finish before running "UI bu-web sec-account" next, regardless of result.
      name: 'UI bu-web accounts',
      testMatch: buWebAccountsFiles,
      fullyParallel: true,
      dependencies: ['UI bu-web onboarding'],
      use: { ...uiServerUse }
    },
    {
      // No `dependencies` here on purpose — see comment on buWebAccountsFiles above.
      // Ordering against "UI bu-web accounts" is enforced by the npm script sequencing
      // (test:ui:buweb:full), not by Playwright's project-dependency mechanism.
      name: 'UI bu-web sec-account',
      testMatch: buWebSecAccountFiles,
      fullyParallel: true,
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
