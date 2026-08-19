require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const UserWebMultiCurrencyAccountPage = require('../../../../pages/UserWebMultiCurrencyAccountPage');
const { saveExtendedState } = require('../../../../utils/shared-state');

// Currencies we never open an account for. CHF is offered in the dropdown but
// POSTs 400 "Product not found", so it is excluded.
const EXCLUDED_FIAT = ['CHF'];

// Generic account name with the currency/coin code at the end, so the accounts
// are easy to segregate later (e.g. "QA Wallet CAD", "QA Wallet USDC").
const accountNameFor = (code) => `QA Wallet ${code}`;

test.describe('User-web — Multicurrency accounts (fiat + stablecoin)', () => {
  // The modal lives behind dashboard XHRs that can re-render mid-flow; retry once.
  test.describe.configure({ retries: 1 });

  test('Open an account for every available currency except CHF', async ({ page, request }) => {
    test.setTimeout(240000);

    const accountsPage = new UserWebMultiCurrencyAccountPage(page);

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      await loginUserWebWithPhone({ page, request, userData });
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

    // Each account is named "QA Wallet <CODE>" so its currency is at the end of
    // the label (e.g. "QA Wallet CAD", "QA Wallet USDC") and easy to tell apart.
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
