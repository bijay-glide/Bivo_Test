// User-web FX — El Salvador payee lifecycle. Three scenarios exercising saved-payee
// reuse/edit on top of the channel coverage in 1-elsalvador-individualpayee-fx.spec.js:
//   1. Creates an El Salvador payee via BCR Pay (the default deliver-to channel), then
//      reuses that same payee for a second send via a DIFFERENT channel (Bank Deposit)
//      — excluding Instant Card Payout (not yet implemented for this country anyway).
//      The name auto-fills from the saved payee; the Bank Deposit fields (bank name,
//      bank code, mobile number) are entered fresh since that channel has no saved
//      details for it yet.
//   2. Edits an existing payee's name + Bank Deposit banking details from the
//      standalone Payees list page, then sends to the edited payee.
//   3. Edits an existing payee's name + Bank Deposit banking details from the
//      transaction Review Transfer page itself, then confirms with the edit.
// Every scenario asserts the payment API returns a paymentIdentifier, the review UI
// reflects the correct name, and the account ledger shows the resulting DEBIT.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const { generateFxTransactionData } = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

const SEND_AMOUNT_USD = '25';
const BANK_DEPOSIT_SUMMARY = { fee: '$3.49', exchangeAmount: '$21.51', rate: '$1 =1' };
const SV_DUI = '012345678';
const SV_BANK_NAME = 'Banco Agricola SA';
const SV_BANK_CODE = 'CAGRSVSS';
const SV_MOBILE_NUMBER = '+50371234567';
// Second, distinct bank name/code/phone — used only as the "edited" value.
const EDITED_BANK_DEPOSIT = { bankName: 'Banco Cuscatlan', bankCode: 'CUSCSVSS', phone: '+50378765432' };

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

/** Creates a fresh El Salvador payee via BCR Pay (default channel) and confirms the
 *  transaction, then verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewSvBcrPayPayee(fxPage, fxData, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('SV');
  await fxPage.verifyDeliverToSelected('BCR Pay');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
  await fxPage.enterSvBcrPayDetailsByTestId({ dui: SV_DUI });
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new El Salvador BCR Pay payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

/** Creates a fresh El Salvador payee via Bank Deposit and confirms the transaction,
 *  then verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewSvBankDepositPayee(fxPage, fxData, bankingData, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('SV');
  await fxPage.selectDeliverToOption('Bank Deposit');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.verifySendMoneySummary(BANK_DEPOSIT_SUMMARY);
  await fxPage.continue();

  await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
  await fxPage.enterSvBankDepositDetails(bankingData);
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new El Salvador Bank Deposit payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

test.describe('User-web FX — El Salvador payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Reuses an El Salvador payee created via BCR Pay for a second send via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'SV' });
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | First transaction — new El Salvador payee via BCR Pay (default channel)', async () => {
      await createAndConfirmNewSvBcrPayPayee(fxPage, fxData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Second transaction — same payee, switched to Bank Deposit (no saved details yet)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('SV');
      await fxPage.selectDeliverToOption('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, { expectReviewTransfer: false });
      await expect(
        page.getByRole('heading', { name: 'Edit Beneficiary Details' }),
        'payee has no saved Bank Deposit details yet — app should prompt to add them',
      ).toBeVisible({ timeout: 15000 });

      const { acctResponse } = await fxPage.fillEditBeneficiaryDetailsAndCaptureApi({
        fields: [
          { testId: 'addpayeeaddress-bank-name-input', value: SV_BANK_NAME },
          { testId: 'addpayeeaddress-bank-code-input', value: SV_BANK_CODE },
          { placeholder: 'Enter your mobile number', value: SV_MOBILE_NUMBER },
        ],
      });
      expect(acctResponse.ok(), 'account POST (Bank Deposit channel) should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'second transaction (Bank Deposit, reused payee) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();

      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
      await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
    });
  });

  test('Edits a saved El Salvador payee from the standalone Payees list page, then sends to the edited payee', async ({ page, request }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'SV' });
    const bankingData = { bankName: SV_BANK_NAME, bankCode: SV_BANK_CODE, phone: SV_MOBILE_NUMBER };
    const updatedFirstName = `${fxData.beneficiaryFirstName}X`;
    const updatedLastName = `${fxData.beneficiaryLastName}X`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | First transaction — new El Salvador payee via Bank Deposit', async () => {
      await createAndConfirmNewSvBankDepositPayee(fxPage, fxData, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the standalone Payees list page', async () => {
      await addPayeePage.navigateToPayees();
      await addPayeePage.openPayeeDetails(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter sort code', value: EDITED_BANK_DEPOSIT.bankCode },
          { placeholder: 'Enter your mobile number', value: EDITED_BANK_DEPOSIT.phone },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Send a new transaction to the edited payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('SV');
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

  test('Edits a saved El Salvador payee from the transaction Review Transfer page, then confirms with the edit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'SV' });
    const bankingData = { bankName: SV_BANK_NAME, bankCode: SV_BANK_CODE, phone: SV_MOBILE_NUMBER };
    const updatedFirstName = `${fxData.beneficiaryFirstName}Z`;
    const updatedLastName = `${fxData.beneficiaryLastName}Z`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new El Salvador payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('SV');
      await fxPage.selectDeliverToOption('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.enterSvBankDepositDetails(bankingData);
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the Review Transfer page itself', async () => {
      await fxPage.openPayeeDetailsFromReviewTransfer(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter sort code', value: EDITED_BANK_DEPOSIT.bankCode },
          { placeholder: 'Enter your mobile number', value: EDITED_BANK_DEPOSIT.phone },
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
