// Bu-web FX — Philippines (individual payee) lifecycle. Three scenarios exercising
// saved-payee reuse/edit on top of the channel coverage in 1-individual-philipines-fx.spec.js:
//   1. Creates a Philippines payee via Bank Deposit (the default deliver-to channel),
//      then reuses that same payee for a second send via a DIFFERENT channel (Mobile
//      Wallet) — excluding Instant Card Payout, which has no saved-banking-details
//      reuse path. The name auto-fills from the saved payee; the wallet-provider
//      dropdown + mobile number are entered fresh since Mobile Wallet has no saved
//      details for it yet.
//   2. Edits an existing payee's name + Bank Deposit banking details from the
//      standalone Payees list page, then sends to the edited payee.
//   3. Edits an existing payee's name + Bank Deposit banking details from the
//      transaction Review Transfer page itself, then confirms with the edit.
// Every scenario asserts the payment API returns a paymentIdentifier, the review UI
// reflects the correct name, and the account ledger shows the resulting DEBIT.
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { generateFxTransactionData, generateUsPaymentPayee, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

const SEND_AMOUNT_USD = '25';
const BIVO_PREFIX = '98765';
const PH_BANK_NAME = 'Bank of the Philippine Islands';
const PH_BANK_CODE = '010530030';
const PH_SWIFT_CODE = 'PNBMPHMMXXX';
const PH_MOBILE_WALLET_NUMBER = '09171234567';
// Second, distinct bank name — used only as the "edited" value.
const EDITED_BANK_DEPOSIT = { bankName: 'Metropolitan Bank and Trust Company', bankCode: '010270044', swiftCode: 'MBTCPHMMXXX' };

async function loginAndDiscoverAccount(page, fxPage) {
  const userData = resolveBuWebUserDataForLogin();
  const bivoAccountNumber = userData.accountNumber || '';
  await loginBuWebWithEmail({ page, userData });
  const bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
  expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
  expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
  return { bivoAccountNumber, bivoLast4 };
}

/** Creates a fresh Philippines payee via Bank Deposit (default channel) and confirms
 *  the transaction, then verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewPhBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('PH');
  await fxPage.verifyDeliverToSelected('Bank Deposit');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addPhBankDepositPayeeByTestId({ firstName: payee.firstName, lastName: payee.lastName, addressOne: payee.addressOne });
  await fxPage.enterPhBankDepositDetails(bankingData);
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new Philippines Bank Deposit payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

test.describe('Bu-web FX — Philippines payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Reuses a Philippines payee created via Bank Deposit for a second send via Mobile Wallet', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'PH' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { bankName: PH_BANK_NAME, bankCode: PH_BANK_CODE, swiftCode: PH_SWIFT_CODE, accountNumber: BIVO_PREFIX + generateRandomDigits(10) };
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | First transaction — new Philippines payee via Bank Deposit (default channel)', async () => {
      await createAndConfirmNewPhBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Second transaction — same payee, switched to Mobile Wallet (no saved details yet)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('PH');
      await fxPage.selectDeliverToOption('Mobile Wallet');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(payee.firstName, payee.lastName, { expectReviewTransfer: false });
      await expect(
        page.getByRole('heading', { name: 'Edit Beneficiary Details' }),
        'payee has no saved Mobile Wallet details yet — app should prompt to add them',
      ).toBeVisible({ timeout: 15000 });

      const { acctResponse } = await fxPage.fillEditBeneficiaryDetailsAndCaptureApi({
        dropdowns: [{ selectTestId: 'addpayeeaddress-bank-code-select', optionTestId: 'addpayeeaddress-bank-code-select-option-gcash' }],
        fields: [{ testId: 'addpayeeaddress-bank-account-number-input', value: PH_MOBILE_WALLET_NUMBER }],
      });
      expect(acctResponse.ok(), 'account POST (Mobile Wallet channel) should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${payee.firstName} ${payee.lastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'second transaction (Mobile Wallet, reused payee) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });

  test('Edits a saved Philippines payee from the standalone Payees list page, then sends to the edited payee', async ({ page }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'PH' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { bankName: PH_BANK_NAME, bankCode: PH_BANK_CODE, swiftCode: PH_SWIFT_CODE, accountNumber: BIVO_PREFIX + generateRandomDigits(10) };
    const updatedFirstName = `${payee.firstName}X`;
    const updatedLastName = `${payee.lastName}X`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | First transaction — new Philippines payee via Bank Deposit', async () => {
      await createAndConfirmNewPhBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the standalone Payees list page', async () => {
      await addPayeePage.navigateToPayeesBuWeb();
      await addPayeePage.openPayeeDetails(payee.firstName, payee.lastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter bank code', value: EDITED_BANK_DEPOSIT.bankCode },
          { placeholder: 'Enter SWIFT code', value: EDITED_BANK_DEPOSIT.swiftCode },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Send a new transaction to the edited payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('PH');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(updatedFirstName, updatedLastName);
      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction to the list-page-edited payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });

  test('Edits a saved Philippines payee from the transaction Review Transfer page, then confirms with the edit', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'PH' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { bankName: PH_BANK_NAME, bankCode: PH_BANK_CODE, swiftCode: PH_SWIFT_CODE, accountNumber: BIVO_PREFIX + generateRandomDigits(10) };
    const updatedFirstName = `${payee.firstName}Z`;
    const updatedLastName = `${payee.lastName}Z`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, fxPage));
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new Philippines payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('PH');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addPhBankDepositPayeeByTestId({ firstName: payee.firstName, lastName: payee.lastName, addressOne: payee.addressOne });
      await fxPage.enterPhBankDepositDetails(bankingData);
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the Review Transfer page itself', async () => {
      await fxPage.openPayeeDetailsFromReviewTransfer(payee.firstName, payee.lastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter bank code', value: EDITED_BANK_DEPOSIT.bankCode },
          { placeholder: 'Enter SWIFT code', value: EDITED_BANK_DEPOSIT.swiftCode },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();

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
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });
});
