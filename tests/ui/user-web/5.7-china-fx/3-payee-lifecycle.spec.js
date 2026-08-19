// User-web FX — China (individual payee) lifecycle. Three scenarios exercising
// saved-payee reuse/edit on top of the channel coverage in 1-china-fx.spec.js:
//   1. Creates a China payee via UnionPay (the default deliver-to channel), then reuses
//      that same payee for a second send via a DIFFERENT channel (Bank Deposit) —
//      excluding Instant Card Payout, which has no saved-banking-details reuse path.
//      The name auto-fills from the saved payee; the Bank Deposit banking fields are
//      entered fresh since that channel has no saved details for it yet.
//   2. Edits an existing payee's name + Bank Deposit banking details from the
//      standalone Payees list page, then sends to the edited payee.
//   3. Edits an existing payee's name + Bank Deposit banking details from the
//      transaction Review Transfer page itself, then confirms with the edit.
// Scenarios 2/3 use Bank Deposit (plain text fields) rather than UnionPay for the payee
// being edited — UnionPay's banking form has a fixed-option dropdown ("Enter bank name")
// that isn't part of the edited value, so Bank Deposit keeps the edit assertions focused
// on values that actually change. Every scenario asserts the payment API returns a
// paymentIdentifier, the review UI reflects the correct name, and the account ledger
// shows the resulting DEBIT.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const { generateFxTransactionData, generateUsPaymentPayee, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

const SEND_AMOUNT_USD = '25';
const BIVO_PREFIX = '98765';
const CN_SWIFT_CODE = 'BKCHCNBJXXX';
const CN_UNIONPAY_CARD_NUMBER = '1986723547681512';
const CN_UNIONPAY_IDENTITY_NUMBER = 'PA9817623';
const CN_BANK_DEPOSIT_BANK_NAME = 'Industrial and Commercial Bank of China';
// Second, distinct bank name — used only as the "edited" value.
const EDITED_BANK_DEPOSIT = { bankName: 'China Construction Bank', swiftCode: 'PCBCCNBJXXX' };

async function loginAndDiscoverAccount(page, request, fxPage) {
  const userData = resolveUserDataForLogin();
  const loginResult = await loginUserWebWithPhone({ page, request, userData });
  const bivoAccountNumber = loginResult?.bivo_account_number || userData.accountNumber || '';
  const bivoDda = loginResult?.bivo_dda_number || userData.ddaNumber || '';
  const bivoLast4 = String(bivoDda).slice(-4);
  expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
  expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
  return { bivoAccountNumber, bivoLast4 };
}

/** Creates a fresh China payee via UnionPay (the default channel) and confirms the
 *  transaction, then verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewCnUnionPayPayee(fxPage, fxData, payee, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('CN');
  await fxPage.verifyDeliverToSelected('UnionPay');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addCnUnionPayPayeeByTestId({
    firstName: payee.firstName,
    lastName: payee.lastName,
    addressOne: payee.addressOne,
    city: payee.city,
    identitySlug: 'passport',
    postalCode: payee.postalCode,
    identityNumber: CN_UNIONPAY_IDENTITY_NUMBER,
  });
  await fxPage.enterUnionPayDetails({ cardNumber: CN_UNIONPAY_CARD_NUMBER, swiftCode: CN_SWIFT_CODE });
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new China UnionPay payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

/** Creates a fresh China payee via Bank Deposit and confirms the transaction, then
 *  verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewCnBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('CN');
  await fxPage.selectDeliverToOption('Bank Deposit');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addCnBankDepositPayeeByTestId({
    firstName: payee.firstName,
    lastName: payee.lastName,
    addressOne: payee.addressOne,
    city: payee.city,
    postalCode: payee.postalCode,
  });
  await fxPage.enterCnBusinessBankDetails(bankingData);
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new China Bank Deposit payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

test.describe('User-web FX — China payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Reuses a China payee created via UnionPay for a second send via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'CN' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(9),
      swiftCode: CN_SWIFT_CODE,
      bankName: CN_BANK_DEPOSIT_BANK_NAME,
    };
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | First transaction — new China payee via UnionPay (default channel)', async () => {
      await createAndConfirmNewCnUnionPayPayee(fxPage, fxData, payee, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Second transaction — same payee, switched to Bank Deposit (no saved details yet)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.selectDeliverToOption('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(payee.firstName, payee.lastName, { expectReviewTransfer: false });
      await expect(
        page.getByRole('heading', { name: 'Edit Beneficiary Details' }),
        'payee has no saved Bank Deposit details yet — app should prompt to add them',
      ).toBeVisible({ timeout: 15000 });

      const { acctResponse } = await fxPage.fillEditBeneficiaryDetailsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: bankingData.bankName },
          { placeholder: 'Enter account number', value: bankingData.accountNumber },
          { placeholder: 'Enter SWIFT code', value: bankingData.swiftCode },
        ],
      });
      expect(acctResponse.ok(), 'account POST (Bank Deposit channel) should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${payee.firstName} ${payee.lastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'second transaction (Bank Deposit, reused payee) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });

  test('Edits a saved China payee from the standalone Payees list page, then sends to the edited payee', async ({ page, request }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'CN' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { accountNumber: BIVO_PREFIX + generateRandomDigits(9), swiftCode: CN_SWIFT_CODE, bankName: CN_BANK_DEPOSIT_BANK_NAME };
    const updatedFirstName = `${payee.firstName}X`;
    const updatedLastName = `${payee.lastName}X`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | First transaction — new China payee via Bank Deposit', async () => {
      await createAndConfirmNewCnBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the standalone Payees list page', async () => {
      await addPayeePage.navigateToPayees();
      await addPayeePage.openPayeeDetails(payee.firstName, payee.lastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter SWIFT code', value: EDITED_BANK_DEPOSIT.swiftCode },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Send a new transaction to the edited payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.selectDeliverToOption('Bank Deposit');
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

  test('Edits a saved China payee from the transaction Review Transfer page, then confirms with the edit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'CN' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { accountNumber: BIVO_PREFIX + generateRandomDigits(9), swiftCode: CN_SWIFT_CODE, bankName: CN_BANK_DEPOSIT_BANK_NAME };
    const updatedFirstName = `${payee.firstName}Z`;
    const updatedLastName = `${payee.lastName}Z`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new China payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.selectDeliverToOption('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addCnBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
        city: payee.city,
        postalCode: payee.postalCode,
      });
      await fxPage.enterCnBusinessBankDetails(bankingData);
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the Review Transfer page itself', async () => {
      await fxPage.openPayeeDetailsFromReviewTransfer(payee.firstName, payee.lastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
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
