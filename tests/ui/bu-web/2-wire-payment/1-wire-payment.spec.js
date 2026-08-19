require('../state-suite-env');
const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const { depositFundsViaWire } = require('../../../../utils/transaction-helper');
const WirePaymentPage = require('../../../../pages/WirePaymentPage');
const { generateWireFormData, generateWirePaymentSchedule } = require('../../../../utils/test-data-generator');

test.describe('Bu-web Wire Payment', () => {
  test('Add wire details and execute wire transfer', async ({ page, request }) => {
    test.setTimeout(180000);

    const userData = resolveBuWebUserDataForLogin();
    // Bu-web wire form pre-fills state as AK (from business address) — match it to avoid dropdown interaction
    const wireFormData = generateWireFormData({ state: 'AK' });
    const paymentSchedule = generateWirePaymentSchedule();
    const wirePage = new WirePaymentPage(page);

    // Bu-web uses "Company name" — combine first+last as the company identifier
    const companyName = `${wireFormData.firstName} ${wireFormData.lastName}`;

    console.log('══════════════════════════════════════════════');
    console.log('  1.4 Wire Payment — loaded state');
    console.log('══════════════════════════════════════════════');
    console.log('  email             :', userData.email);
    console.log('  accountNumber     :', userData.accountNumber);
    console.log('  encodedTotpSecret :', userData.encodedTotpSecret);
    console.log('══════════════════════════════════════════════');

    await test.step('Step 1 | Sign in to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Pre-fund account via wire API', async () => {
      await depositFundsViaWire(request, userData.accountNumber, { amount: 50000 }); // $500
    });

    await test.step('Step 3 | Navigate to Wire section', async () => {
      await wirePage.navigateToWireSection();
    });

    await test.step('Step 4 | Fill wire recipient details form', async () => {
      // Bu-web wire form uses Company name instead of First/Last name
      await page.getByRole('button', { name: 'Add Wire Details' }).click();

      await page.getByRole('textbox', { name: 'Company name' }).fill(companyName);
      await page.getByRole('textbox', { name: 'Account nickname' }).fill(wireFormData.nickname);
      await page.getByRole('textbox', { name: 'Street address' }).fill(wireFormData.streetAddress);
      await page.getByRole('textbox', { name: 'City' }).fill(wireFormData.city);
      await page.getByRole('textbox', { name: 'Zip code' }).fill(wireFormData.zipCode);
      // State is pre-filled as AK (matches wireFormData.state) — no dropdown interaction needed

      await page.getByRole('textbox', { name: 'Account number' }).fill(wireFormData.accountNumber);
      await page.getByRole('textbox', { name: 'Routing number' }).fill(wireFormData.routingNumber);

      await page.getByRole('button', { name: 'Continue' }).click();
    });

    await test.step('Step 5 | Fill payment schedule (amount, frequency, message)', async () => {
      await wirePage.fillPaymentSchedule(paymentSchedule);
    });

    await test.step('Step 6 | Verify review screen shows all submitted values', async () => {
      await wirePage.verifyReviewScreen(wireFormData, paymentSchedule);
    });

    await test.step('Step 7 | Submit transfer and verify transactions API response', async () => {
      await wirePage.submitTransfer(companyName, {
        accountId: userData.accountNumber,
      });
    });

    await test.step('Step 8 | Verify transaction appears in ledger history', async () => {
      await wirePage.verifyTransactionHistory(companyName, paymentSchedule.amount, { transactionType: 'Withdrawal' });
    });
  });
});
