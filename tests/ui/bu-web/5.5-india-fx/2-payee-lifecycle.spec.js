// Bu-web FX — India payee lifecycle. Three scenarios exercising saved-payee reuse/edit
// on top of the channel coverage in 1-india-fx.spec.js:
//   1. Creates an India payee via Bank Deposit (IFSC), then reuses that same payee for a
//      second send via a DIFFERENT channel (UPI) — excluding Instant Card Payout, which
//      has no saved-banking-details reuse path. The name auto-fills from the saved
//      payee; the UPI ID is entered fresh since UPI has no saved details for it yet.
//   2. Edits an existing payee's name + IFSC details from the standalone Payees list
//      page, then sends to the edited payee via IFSC.
//   3. Edits an existing payee's name + IFSC details from the transaction Review
//      Transfer page itself, then confirms with the edit.
// Every scenario asserts the payment API returns a paymentIdentifier, the review UI
// reflects the correct name, and the account ledger shows the resulting DEBIT.
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { generateFxTransactionData, generateBankingDetails } = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

const SEND_AMOUNT_USD = '50';
const SEND_AMOUNT_SUMMARY = { fee: '$0.99', exchangeAmount: '$49.01', rate: '$1 =89.8' };
const IN_TEST_UPI_ID = 'success@razorpay';
const UPI_TESTID = 'addpayeeaddress-bank-account-number-input';
// Second, distinct IFSC-format account/branch code — used only as the "edited" value.
const EDITED_IFSC = { accountNumber: '9876500000123', ifscCode: 'SBIN0001234' };

/** Creates a fresh India payee via Bank Deposit (IFSC), confirms the transaction, and
 *  verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewInPayee(fxPage, fxData, ifscDetails, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('IN');
  await fxPage.verifyDeliverToSelected('Bank Deposit');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
  await fxPage.verifySendMoneySummary(SEND_AMOUNT_SUMMARY);
  await fxPage.continue();

  await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
  await fxPage.enterBankingDetailsByChannel({ channel: 'ifsc', bankingDetails: ifscDetails });
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
  await fxPage.verifyFxReviewTransferScreen(fxData);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new India IFSC payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({
    initialTransactions: transactions,
    bivoAccountNumber,
    paymentIdentifier,
    amountUsd: SEND_AMOUNT_USD,
  });
}

async function loginAndDiscoverAccount(page, fxPage) {
  const userData = resolveBuWebUserDataForLogin();
  const bivoAccountNumber = userData.accountNumber || '';
  await loginBuWebWithEmail({ page, userData });
  const bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
  expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
  expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
  return { bivoAccountNumber, bivoLast4 };
}

test.describe('Bu-web FX — India payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Reuses an India payee created via IFSC for a second send via UPI', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'IN' });
    const ifscDetails = generateBankingDetails('IN');
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | First transaction — new India payee via Bank Deposit (IFSC)', async () => {
      await createAndConfirmNewInPayee(fxPage, fxData, ifscDetails, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Second transaction — same payee, switched to UPI (no saved details yet)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.selectDeliverToOption('UPI');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, {
        expectReviewTransfer: false,
      });
      await expect(
        page.getByRole('heading', { name: 'Edit Beneficiary Details' }),
        'payee has no saved UPI details yet — app should prompt to add them',
      ).toBeVisible({ timeout: 15000 });

      const { acctResponse } = await fxPage.fillEditBeneficiaryDetailsAndCaptureApi({
        fields: [{ testId: UPI_TESTID, value: IN_TEST_UPI_ID }],
      });
      expect(acctResponse.ok(), 'account POST (UPI channel) should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'second transaction (UPI, reused payee) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });

  test('Edits a saved India payee from the standalone Payees list page, then sends to the edited payee', async ({ page }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'IN' });
    const ifscDetails = generateBankingDetails('IN');
    const updatedFirstName = `${fxData.beneficiaryFirstName}X`;
    const updatedLastName = `${fxData.beneficiaryLastName}X`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | First transaction — new India payee via Bank Deposit (IFSC)', async () => {
      await createAndConfirmNewInPayee(fxPage, fxData, ifscDetails, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Edit the payee (name + IFSC details) from the standalone Payees list page', async () => {
      await addPayeePage.navigateToPayeesBuWeb();
      await addPayeePage.openPayeeDetails(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter account number', value: EDITED_IFSC.accountNumber },
          { placeholder: 'Enter IFSC code', value: EDITED_IFSC.ifscCode },
        ],
      });
      expect(updateResponse.ok(), 'IFSC account-details update should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Send a new transaction to the edited payee via IFSC', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(updatedFirstName, updatedLastName);
      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction to the list-page-edited payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });

  test('Edits a saved India payee from the transaction Review Transfer page, then confirms with the edit', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'IN' });
    const ifscDetails = generateBankingDetails('IN');
    const updatedFirstName = `${fxData.beneficiaryFirstName}Z`;
    const updatedLastName = `${fxData.beneficiaryLastName}Z`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new India payee via Bank Deposit (IFSC)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
      await fxPage.enterBankingDetailsByChannel({ channel: 'ifsc', bankingDetails: ifscDetails });
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 3 | Edit the payee (name + IFSC details) from the Review Transfer page itself', async () => {
      await fxPage.openPayeeDetailsFromReviewTransfer(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter account number', value: EDITED_IFSC.accountNumber },
          { placeholder: 'Enter IFSC code', value: EDITED_IFSC.ifscCode },
        ],
      });
      expect(updateResponse.ok(), 'IFSC account-details update should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);
    });

    await test.step('Step 4 | Confirm the transaction with the edited payee', async () => {
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction confirmed with review-page-edited payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });
});
