require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { depositFundsViaWire } = require('../../../utils/transaction-helper');
const WirePaymentPage = require('../../../pages/WirePaymentPage');
const { generateWireFormData, generateWirePaymentSchedule } = require('../../../utils/test-data-generator');

test.describe('User-web Wire Payment', () => {
  test('Add wire details and execute wire transfer', async ({ page, request }) => {
    test.setTimeout(180000);

    const wireFormData = generateWireFormData();
    const paymentSchedule = generateWirePaymentSchedule();
    const wirePage = new WirePaymentPage(page);
    const userData = resolveUserDataForLogin();

    let bivoAccountNumber = userData.accountNumber || '';

    await test.step('Step 1 | Login to standalone user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      expect(bivoAccountNumber, 'bivo_account_number should be available from account API').toBeTruthy();
    });

    await test.step('Step 2 | Pre-fund account via API', async () => {
      await depositFundsViaWire(request, bivoAccountNumber, { amount: 50000 }); // $500
    });

    await test.step('Step 3 | Navigate to Wire section', async () => {
      await wirePage.navigateToWireSection();
    });

    await test.step('Step 4 | Fill wire recipient details form', async () => {
      await wirePage.fillWireDetailsForm(wireFormData);
    });

    await test.step('Step 5 | Fill payment schedule (amount, frequency, message)', async () => {
      await wirePage.fillPaymentSchedule(paymentSchedule);
    });

    await test.step('Step 6 | Verify review screen shows all submitted values', async () => {
      await wirePage.verifyReviewScreen(wireFormData, paymentSchedule);
    });

    await test.step('Step 7 | Submit transfer and verify transactions API response', async () => {
      await wirePage.submitTransfer(wireFormData.firstName, {
        accountId: bivoAccountNumber,
      });
    });

    await test.step('Step 8 | Verify transaction appears in ledger history', async () => {
      await wirePage.verifyTransactionHistory(wireFormData.firstName, paymentSchedule.amount);
    });
  });
});
