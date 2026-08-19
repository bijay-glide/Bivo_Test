// Bu-web FX — China, business-payee lifecycle. Two scenarios exercising saved
// business-payee edit on top of the channel coverage in 2-china-businesspayee-fx.spec.js:
//   1. Edits an existing business payee's name + Bank Deposit banking details from the
//      standalone Payees list page (Business tab), then sends to the edited payee.
//   2. Edits an existing business payee's name + Bank Deposit banking details from the
//      transaction Review Transfer page itself, then confirms with the edit.
// No "reuse across a different channel" scenario here: China's business tab only
// exposes 2 deliver-to channels (Bank Deposit, Instant Card Payout), and Instant Card
// Payout is excluded from that pattern (no saved-banking-details reuse path), leaving no
// second non-card channel to reuse across — same gap as Mexico, which is skipped
// entirely for the same reason.
// Every scenario asserts the payment API returns a paymentIdentifier, the review UI
// reflects the correct business name, and the account ledger shows the resulting DEBIT.
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { generateFxTransactionData, generateBusinessPayeeExtraFields, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

const SEND_AMOUNT_USD = '25';
const BIVO_PREFIX = '98765';
const CN_SWIFT_CODE = 'BKCHCNBJXXX';
const CN_BANK_DEPOSIT_BANK_NAME = 'Industrial and Commercial Bank of China';
// Second, distinct bank name — used only as the "edited" value.
const EDITED_BANK_DEPOSIT = { bankName: 'China Construction Bank', swiftCode: 'PCBCCNBJXXX' };

async function loginAndDiscoverAccount(page, fxPage) {
  const userData = resolveBuWebUserDataForLogin();
  const bivoAccountNumber = userData.accountNumber || '';
  await loginBuWebWithEmail({ page, userData });
  const bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
  expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
  expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
  return { bivoAccountNumber, bivoLast4 };
}

/** Creates a fresh China business payee via Bank Deposit and confirms the transaction,
 *  then verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewCnBusinessPayee(fxPage, fxData, businessName, businessExtraFields, bankingData, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.switchToBusinessTab();
  await fxPage.selectBusinessDestinationCountryByTestId('CN');
  await fxPage.verifyDeliverToSelected('Bank Deposit');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addBusinessPayee(businessName, businessExtraFields);
  await fxPage.enterCnBusinessBankDetails(bankingData);
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(businessName);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new China business payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

test.describe('Bu-web FX — China business-payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Edits a saved China business payee from the standalone Payees list page, then sends to the edited payee', async ({ page }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'CN' });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('CN');
    const bankingData = { accountNumber: BIVO_PREFIX + generateRandomDigits(9), swiftCode: CN_SWIFT_CODE, bankName: CN_BANK_DEPOSIT_BANK_NAME };
    const updatedBusinessName = `${businessName}X`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | First transaction — new China business payee via Bank Deposit', async () => {
      await createAndConfirmNewCnBusinessPayee(fxPage, fxData, businessName, businessExtraFields, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Edit the payee (business name + Bank Deposit details) from the standalone Payees list page (Business tab)', async () => {
      await addPayeePage.navigateToPayeesBuWeb();
      await addPayeePage.switchToBusinessPayeesTab();
      await addPayeePage.openBusinessPayeeDetails(businessName);
      await fxPage.editBusinessPayeeNameAndCaptureApi({ businessName: updatedBusinessName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter SWIFT code', value: EDITED_BANK_DEPOSIT.swiftCode },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Send a new transaction to the edited business payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
      await fxPage.selectBusinessDestinationCountryByTestId('CN');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingBusinessPayeeByName(updatedBusinessName);
      await expect(page.locator('#root')).toContainText(updatedBusinessName);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction to the list-page-edited business payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });

  test('Edits a saved China business payee from the transaction Review Transfer page, then confirms with the edit', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'CN' });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('CN');
    const bankingData = { accountNumber: BIVO_PREFIX + generateRandomDigits(9), swiftCode: CN_SWIFT_CODE, bankName: CN_BANK_DEPOSIT_BANK_NAME };
    const updatedBusinessName = `${businessName}Z`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new China business payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
      await fxPage.selectBusinessDestinationCountryByTestId('CN');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addBusinessPayee(businessName, businessExtraFields);
      await fxPage.enterCnBusinessBankDetails(bankingData);
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 3 | Edit the payee (business name + Bank Deposit details) from the Review Transfer page itself', async () => {
      await fxPage.openBusinessPayeeDetailsFromReviewTransfer(businessName);
      await fxPage.editBusinessPayeeNameAndCaptureApi({ businessName: updatedBusinessName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter SWIFT code', value: EDITED_BANK_DEPOSIT.swiftCode },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(updatedBusinessName);
    });

    await test.step('Step 4 | Confirm the transaction with the edited business payee', async () => {
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction confirmed with review-page-edited business payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });
});
