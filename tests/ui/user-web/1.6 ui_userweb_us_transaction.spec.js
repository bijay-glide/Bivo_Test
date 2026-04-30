require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { saveExtendedState } = require('../../../utils/shared-state');
const { toCentsInput } = require('../../../utils/amount-input');
const UsAchPaymentPage = require('../../../pages/UsAchPaymentPage');

const US_PAYMENT_DATA = {
  firstName: 'First Name',
  lastName: 'Last Name',
  accountNumber: '1000098444',
  routingNumber: '0001',
  amountUsd: '60.33',
  message: 'message: this is transactionn',
};

test.describe('User-web US Payment', () => {
  test('Create US ACH transaction and verify transactions API', async ({ page, request }) => {
    test.setTimeout(120000);

    const usPaymentPage = new UsAchPaymentPage(page);
    const userData = resolveUserDataForLogin();
    const expectedToday = UsAchPaymentPage.formatReviewDate();
    const amountInputValue = toCentsInput(US_PAYMENT_DATA.amountUsd);
    const amountDisplay = `$${Number(US_PAYMENT_DATA.amountUsd).toFixed(2)}`;

    let bivoAccountNumber = userData.accountNumber || '';
    let bivoDdaNumber = userData.ddaNumber || '';
    let usAchAccountNumber = US_PAYMENT_DATA.accountNumber;
    let transferFundRequest = null;
    let transferCorrelationId = null;

    await test.step('Step 1 | Login to standalone user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      bivoDdaNumber = loginResult?.bivo_dda_number || bivoDdaNumber;
      expect(bivoAccountNumber, 'bivo_account_number should be available from account API').toBeTruthy();
      expect(bivoDdaNumber, 'bivo_dda_number (ddaNumber) should be available from account API').toBeTruthy();
      saveExtendedState({
        bivo_account_number: bivoAccountNumber,
        bivo_dda_number: bivoDdaNumber,
      });
    });

    await test.step('Step 2 | Navigate to Create US Payment', async () => {
      await usPaymentPage.navigateToCreateUsPayment();
    });

    await test.step('Step 3 | Add payee and bank details + verify beneficiary account API', async () => {
      await usPaymentPage.addPayee(US_PAYMENT_DATA.firstName, US_PAYMENT_DATA.lastName);
      const beneficiaryApi = await usPaymentPage.addBankDetailsAndCaptureBeneficiaryApi({
        accountNumber: US_PAYMENT_DATA.accountNumber,
        routingNumber: US_PAYMENT_DATA.routingNumber,
      });
      usAchAccountNumber = beneficiaryApi.bankAchAccountNumber || usAchAccountNumber;
      saveExtendedState({ us_ach_accountNumber: usAchAccountNumber });
    });

    await test.step('Step 4 | Verify vendor details and choose ACH', async () => {
      await usPaymentPage.verifyVendorDetailsAndSelectAch({
        usAchAccountLast4: usAchAccountNumber.slice(-4),
      });
    });

    await test.step('Step 5 | Fill transfer details and continue', async () => {
      await usPaymentPage.fillTransferDetailsAndContinue({
        amountInputValue,
        message: US_PAYMENT_DATA.message,
        bivoAccountLast4: bivoDdaNumber?.slice(-4),
      });
    });

    await test.step('Step 6 | Verify transaction details screen', async () => {
      await usPaymentPage.verifyReviewDetails({
        firstName: US_PAYMENT_DATA.firstName,
        lastName: US_PAYMENT_DATA.lastName,
        routingNumber: US_PAYMENT_DATA.routingNumber,
        accountNumber: usAchAccountNumber,
        amountDisplay,
        expectedToday,
      });
    });

    await test.step('Step 7 | Submit transfer and verify transfer-fund API', async () => {
      const captured = await usPaymentPage.submitTransferAndCaptureTransferFundApi();
      transferFundRequest = captured.transferFundRequest;
      transferCorrelationId = captured.correlationId;
      usPaymentPage.assertTransferFundAchCaptured(captured, {
        bivoAccountNumber,
        amountUsd: US_PAYMENT_DATA.amountUsd,
      });
    });

    await test.step('Step 8 | Transactions API — row matches ACH transfer', async () => {
      await usPaymentPage.assertTransactionsApiAchDebitRow({
        accountNumber: bivoAccountNumber,
        correlationId: transferCorrelationId,
        bivoAccountNumber,
        amountUsd: US_PAYMENT_DATA.amountUsd,
        payeeFirstName: US_PAYMENT_DATA.firstName,
        payeeLastName: US_PAYMENT_DATA.lastName,
        transferFundRequest,
      });
    });
  });
});
