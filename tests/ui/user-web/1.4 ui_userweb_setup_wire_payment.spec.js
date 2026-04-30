require('./state-suite-env');
const { test } = require('../../../fixtures/ui-fixtures');
const WirePaymentPage = require('../../../pages/WirePaymentPage');
const { generateWireFormData, generateWirePaymentSchedule } = require('../../../utils/test-data-generator');
const { depositFundsViaWire } = require('../../../utils/transaction-helper');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');

test.describe('User-web Wire Payment Setup', () => {
  test('Setup wire payment and verify transaction', async ({ page, request }) => {
    const wirePage = new WirePaymentPage(page);

    const userData = resolveUserDataForLogin();
    const wireDetails = generateWireFormData();
    const paymentSchedule = generateWirePaymentSchedule();
    const lastFourDigits = wireDetails.accountNumber.slice(-4);

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Pre-fund account via API', async () => {
      if (userData.accountNumber) {
        await depositFundsViaWire(request, userData.accountNumber);
      } else {
        console.warn(
          '⚠️  No accountNumber available — skipping pre-fund step. Set STANDALONE_ACCOUNT env var to enable.',
        );
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 2-5 | Login to standalone user-web', async () => {
      await loginUserWebWithPhone({ page, request, userData });
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 6 | Navigate to Wire section', async () => {
      await wirePage.navigateToWireSection();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 7 | Fill wire beneficiary details', async () => {
      await wirePage.fillWireDetailsForm(wireDetails);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 8 | Configure payment schedule and amount', async () => {
      await wirePage.fillPaymentSchedule(paymentSchedule);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 9 | Verify review screen details', async () => {
      await wirePage.verifyReviewScreen(wireDetails, paymentSchedule);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 10 | Submit the wire transfer', async () => {
      await wirePage.submitTransfer(wireDetails.firstName, {
        accountId: userData.accountNumber,
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 11 | Verify transaction appears in history', async () => {
      await wirePage.verifyTransactionHistory(wireDetails.firstName, paymentSchedule.amount);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 12 | Verify added account in wire accounts list', async () => {
      await wirePage.verifyAddedAccount(wireDetails.nickname, lastFourDigits);
    });
  });
});
