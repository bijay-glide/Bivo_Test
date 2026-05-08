require('./state-suite-env');
const { test } = require('../../../fixtures/ui-fixtures');
const WirePaymentPage = require('../../../pages/WirePaymentPage');
const { generateWireFormData, generateWirePaymentSchedule } = require('../../../utils/test-data-generator');
const { depositFundsViaWire } = require('../../../utils/transaction-helper');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');

test.describe('User-web Wire Payment Setup', () => {
  test('Setup wire payment and verify transaction', async ({ page, request }) => {
    test.setTimeout(180000);
    const wirePage = new WirePaymentPage(page);

    const userData = resolveUserDataForLogin();
    const wireDetails = generateWireFormData();
    const paymentSchedule = generateWirePaymentSchedule();
    const lastFourDigits = wireDetails.accountNumber.slice(-4);

    let bivoAccountNumber = '';

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Login to standalone user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || '';
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 2 | Pre-fund account via API', async () => {
      if (bivoAccountNumber) {
        await depositFundsViaWire(request, bivoAccountNumber, { amount: 500000 }); // $5000
      } else {
        console.warn('⚠️  No bivo_account_number resolved — skipping pre-fund step.');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 3 | Navigate to Wire section', async () => {
      await wirePage.navigateToWireSection();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 4 | Fill wire beneficiary details', async () => {
      await wirePage.fillWireDetailsForm(wireDetails);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 5 | Configure payment schedule and amount', async () => {
      await wirePage.fillPaymentSchedule(paymentSchedule);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 6 | Verify review screen details', async () => {
      await wirePage.verifyReviewScreen(wireDetails, paymentSchedule);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 7 | Submit the wire transfer', async () => {
      await wirePage.submitTransfer(wireDetails.firstName, {
        accountId: bivoAccountNumber,
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 8 | Verify transaction appears in history', async () => {
      await wirePage.verifyTransactionHistory(wireDetails.firstName, paymentSchedule.amount);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 9 | Verify added account in wire accounts list', async () => {
      await wirePage.verifyAddedAccount(wireDetails.nickname, lastFourDigits);
    });
  });
});
