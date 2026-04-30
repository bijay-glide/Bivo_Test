require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { saveExtendedState } = require('../../../utils/shared-state');
const { generateFxTransactionData } = require('../../../utils/test-data-generator');
const FxTransactionPage = require('../../../pages/FxTransactionPage');
const UsAchPaymentPage = require('../../../pages/UsAchPaymentPage');

// FX: POST international payment paymentIdentifier matches transactions API correlationId (same idea as US ACH).
test.describe('User-web FX transaction', () => {
  test('Create international FX payment and verify APIs', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const transactionsPage = new UsAchPaymentPage(page);
    const userData = resolveUserDataForLogin();

    const fxData = generateFxTransactionData({
      randomizeSendAmountUsd: true,
      note: 'Sent from Bivo',
    });

    expect(fxData.amountUsd, 'dynamic FX data should include amountUsd').toBeTruthy();

    let bivoAccountNumber = userData.accountNumber || '';
    let paymentIdentifier = null;
    let beneficiaryReferenceId = null;

    await test.step('Step 1 | Login to user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      expect(bivoAccountNumber, 'bivo_account_number from account API').toBeTruthy();
      saveExtendedState({ bivo_account_number: bivoAccountNumber });
    });

    await test.step('Step 2 | Open Create FX Transaction', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
    });

    await test.step('Step 3 | Destination UK + send amount', async () => {
      await fxPage.userWebCompleteCountryAndSendAmountStep(fxData);
    });

    await test.step('Step 4 | Submit payee names and verify personal-info create API', async () => {
      const payeeCreateApi = await fxPage.addPayeeAndCapturePersonalInfoCreateApi({
        firstName: fxData.beneficiaryFirstName,
        lastName: fxData.beneficiaryLastName,
        currencyId: 18,
        beneficiaryType: 'INDIVIDUAL',
        country: 'GB',
      });
      beneficiaryReferenceId = payeeCreateApi.referenceId;
      expect(beneficiaryReferenceId, 'beneficiary referenceId should be captured').toBeTruthy();
    });

    await test.step('Step 5 | Submit IBAN and verify personal-info details API', async () => {
      await fxPage.enterIbanAndCapturePersonalInfoDetailsApi({
        iban: fxData.iban,
        referenceId: beneficiaryReferenceId,
        firstName: fxData.beneficiaryFirstName,
        lastName: fxData.beneficiaryLastName,
        beneficiaryType: 'INDIVIDUAL',
        countryCode: 'GB',
        currencyCode: 'GBP',
      });
    });

    await test.step('Step 6 | Review transfer — send / fees / total consistency', async () => {
      await fxPage.verifyFxReviewTransferScreen(fxData);
    });

    await test.step('Step 7 | Confirm — capture international payment API', async () => {
      await fxPage.fillFxPaymentNote(fxData.note);

      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();

      paymentIdentifier = captured.paymentIdentifier;
      fxPage.assertInternationalPaymentApi({
        paymentRequest: captured.paymentRequest,
        paymentResponseBody: captured.paymentResponseBody,
        paymentIdentifier: captured.paymentIdentifier,
        fxData,
        bivoAccountNumber,
      });
    });

    await test.step('Step 8 | Processing modal', async () => {
      await fxPage.verifyProcessingAndDismiss();
    });

    await test.step('Step 9 | Transactions API — correlationId === paymentIdentifier', async () => {
      const { transactions } = await transactionsPage.openTransactionsAndCaptureApi({
        accountNumber: bivoAccountNumber,
      });

      expect(transactions.length).toBeGreaterThan(0);
      transactionsPage.expectPendingTransactionForPaymentIdentifier(
        transactions,
        paymentIdentifier,
        fxData.amountUsd,
      );
    });
  });
});
