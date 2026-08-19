require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const MultiCurrencyAccountPage = require('../../../../pages/MultiCurrencyAccountPage');
const { saveExtendedState } = require('../../../../utils/shared-state');

// Currencies we never open an account for. CHF is excluded by request.
const EXCLUDED_FIAT = ['CHF'];

// Generic account name with the currency/coin code at the end, so the accounts
// are easy to segregate later (e.g. "QA Account CAD", "QA Account USDC").
const accountNameFor = (code) => `QA Account ${code}`;

test.describe('Bu-web — Multicurrency accounts (fiat + stablecoin)', () => {
  // The modal lives behind dashboard XHRs that can re-render mid-flow; retry once.
  test.describe.configure({ retries: 1 });

  test('Open an account for every available currency except CHF', async ({ page }) => {
    test.setTimeout(240000);

    const accountsPage = new MultiCurrencyAccountPage(page);

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    // Already-owned currencies are absent from the dropdowns, so discover what is
    // actually available at runtime — this keeps the test idempotent across re-runs.
    let fiat = [];
    let stablecoins = [];
    await test.step('Step 2 | Discover available currencies', async () => {
      const available = await accountsPage.getAvailableCurrencies();
      fiat = available.fiat.filter((c) => !EXCLUDED_FIAT.includes(c));
      stablecoins = available.stablecoins;
      console.log('[multicurrency] fiat to create:', JSON.stringify(fiat));
      console.log('[multicurrency] stablecoins to create:', JSON.stringify(stablecoins));
    });

    await test.step(`Step 3 | Create fiat accounts (${fiat.join(', ') || 'none'})`, async () => {
      for (const code of fiat) {
        await test.step(`Fiat — ${code}`, async () => {
          const response = await accountsPage.createFiatAccount(code, accountNameFor(code));
          expect(response.ok(), `wallet-account POST should succeed for ${code}`).toBeTruthy();
        });
      }
    });

    await test.step(`Step 4 | Create stablecoin accounts (${stablecoins.join(', ') || 'none'})`, async () => {
      for (const code of stablecoins) {
        await test.step(`Stablecoin — ${code}`, async () => {
          const response = await accountsPage.createStablecoinAccount(code, accountNameFor(code));
          expect(response.ok(), `coin/accounts POST should succeed for ${code}`).toBeTruthy();
        });
      }
    });

    await test.step('Step 5 | Persist multicurrency-accounts flag to shared state', async () => {
      saveExtendedState({ multicurrencyAccountsCreated: true });
    });
  });
});
