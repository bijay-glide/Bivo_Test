require('../state-suite-env');
const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const { depositFundsViaWire } = require('../../../../utils/transaction-helper');
const { toCentsInput } = require('../../../../utils/amount-input');

// Bu-web move-money analog: "Withdraw Funds" (ACH withdrawal from the Bivo wallet
// to the linked external Chase account). Internal Transfer is unavailable here —
// it requires 2+ Bivo accounts and this business has one.
const WITHDRAW_AMOUNT_USD = '10.00';

test.describe('Bu-web Move Money — Withdraw Funds', () => {
  test('Withdraw funds to linked bank and verify the transfer is accepted', async ({ page, request }) => {
    test.setTimeout(150000);

    const userData = resolveBuWebUserDataForLogin();
    const amountInput = toCentsInput(WITHDRAW_AMOUNT_USD);

    await test.step('Step 1 | Sign in to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Pre-fund account via wire API', async () => {
      await depositFundsViaWire(request, userData.accountNumber, { amount: 50000 }); // $500
    });

    await test.step('Step 3 | Navigate to Move Money — Withdraw Funds', async () => {
      await page.getByRole('link', { name: 'Move Money' }).click();
      const withdraw = page.getByRole('link', { name: 'Withdraw Funds' });
      const appeared = await withdraw.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      if (!appeared) await page.getByRole('link', { name: 'Move Money' }).click();
      await withdraw.click();
      await expect(page.getByRole('heading', { name: 'Withdraw Funds' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 4 | Choose ACH, enter amount, and continue', async () => {
      // ACH tab is the default; click it defensively if present.
      const achTab = page.getByTestId('tab_ach');
      if (await achTab.isVisible({ timeout: 3000 }).catch(() => false)) await achTab.click();

      const amount = page.getByTestId('amount-input-ui');
      await amount.click();
      await amount.pressSequentially(amountInput, { delay: 50 });
      await page.getByRole('button', { name: 'Next' }).click();
    });

    await test.step('Step 5 | Review screen shows the withdrawal', async () => {
      await expect(page.getByRole('heading', { name: /Let.?s Review/i })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 6 | Submit transfer and verify it is accepted', async () => {
      // Bu-web withdrawal posts to /business/v1/transaction/move-fund.
      const transferPromise = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.ok() && r.url().includes('/transaction/move-fund'),
        { timeout: 30000 },
      ).catch(() => null);

      await page.getByRole('button', { name: 'Transfer' }).click();

      const transferResponse = await transferPromise;
      expect(transferResponse, 'a move-fund POST should fire on Transfer').toBeTruthy();
      expect(transferResponse.ok(), 'withdraw transfer POST should succeed').toBeTruthy();

      // UI confirmation: we leave the review screen (success modal or navigation).
      await expect(page.getByRole('heading', { name: /Let.?s Review/i })).toBeHidden({ timeout: 20000 });
    });
  });
});
