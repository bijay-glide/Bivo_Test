// User-web FX — Vietnam payee lifecycle. Three scenarios exercising saved-payee
// reuse/edit on top of the channel coverage in 1-individual-vietnam-fx.spec.js:
//   1. Creates a Vietnam payee via Bank Deposit (the default deliver-to channel), then
//      reuses that same payee for a second send via a DIFFERENT channel (Mobile
//      Wallet) — excluding Instant Card Payout (not yet implemented for this country
//      anyway). The name auto-fills from the saved payee; the mobile number + wallet
//      provider are entered fresh since Mobile Wallet has no saved details for it yet.
//   2. Edits an existing payee's name + Bank Deposit banking details from the
//      standalone Payees list page, then sends to the edited payee.
//   3. Edits an existing payee's name + Bank Deposit banking details from the
//      transaction Review Transfer page itself, then confirms with the edit.
// Every scenario asserts the payment API returns a paymentIdentifier, the review UI
// reflects the correct name, and the account ledger shows the resulting DEBIT.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const { generateFxTransactionData, generateUsPaymentPayee, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

const SEND_AMOUNT_USD = '25';
const BIVO_PREFIX = '98765';
const VN_BANK_NAME = 'Vietcombank';
const VN_BANK_CODE = 'BFTVVNVX';
const VN_MOBILE_WALLET_PHONE = '+84912345678';
// Second, distinct bank name/code — used only as the "edited" value.
const EDITED_BANK_DEPOSIT = { bankName: 'BIDV', bankCode: 'BFTVVNVX' };

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

/** Creates a fresh Vietnam payee via Bank Deposit (default channel) and confirms the
 *  transaction, then verifies the resulting DEBIT in the Bivo account ledger. */
async function createAndConfirmNewVnBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('VN');
  await fxPage.verifyDeliverToSelected('Bank Deposit');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addVnPayeeByTestId({ firstName: payee.firstName, lastName: payee.lastName, addressOne: payee.addressOne });
  await fxPage.enterVnBankDepositDetails(bankingData);
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
  await fxPage.fillFxPaymentNote(fxData.note);
  await fxPage.fillFxInvoiceNumberIfPresent();
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new Vietnam Bank Deposit payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber });
  await fxPage.assertFxDebitTransaction({ initialTransactions: transactions, bivoAccountNumber, paymentIdentifier, amountUsd: SEND_AMOUNT_USD });
}

test.describe('User-web FX — Vietnam payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Reuses a Vietnam payee created via Bank Deposit for a second send via Mobile Wallet', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'VN' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { bankName: VN_BANK_NAME, bankCode: VN_BANK_CODE, accountNumber: BIVO_PREFIX + generateRandomDigits(8) };
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | First transaction — new Vietnam payee via Bank Deposit (default channel)', async () => {
      await createAndConfirmNewVnBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Second transaction — same payee, switched to Mobile Wallet (no saved details yet)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('VN');
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
        fields: [{ placeholder: 'Enter your mobile number', value: VN_MOBILE_WALLET_PHONE }],
        dropdowns: [{ selectTestId: 'addpayeeaddress-bank-code-select', optionTestId: 'addpayeeaddress-bank-code-select-option-momo' }],
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

  test('Edits a saved Vietnam payee from the standalone Payees list page, then sends to the edited payee', async ({ page, request }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'VN' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { bankName: VN_BANK_NAME, bankCode: VN_BANK_CODE, accountNumber: BIVO_PREFIX + generateRandomDigits(8) };
    const updatedFirstName = `${payee.firstName}X`;
    const updatedLastName = `${payee.lastName}X`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | First transaction — new Vietnam payee via Bank Deposit', async () => {
      await createAndConfirmNewVnBankDepositPayee(fxPage, fxData, payee, bankingData, bivoAccountNumber, bivoLast4);
    });

    await test.step('Step 3 | Edit the payee (name + Bank Deposit details) from the standalone Payees list page', async () => {
      await addPayeePage.navigateToPayees();
      await addPayeePage.openPayeeDetails(payee.firstName, payee.lastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      const { updateResponse } = await fxPage.editPayeeAccountFieldsAndCaptureApi({
        fields: [
          { placeholder: 'Enter bank name', value: EDITED_BANK_DEPOSIT.bankName },
          { placeholder: 'Enter bank code', value: EDITED_BANK_DEPOSIT.bankCode },
        ],
      });
      expect(updateResponse.ok(), 'Bank Deposit details update should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Send a new transaction to the edited payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('VN');
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

  test('Edits a saved Vietnam payee from the transaction Review Transfer page, then confirms with the edit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ amountUsd: SEND_AMOUNT_USD, note: 'Sent from Bivo', countryCode: 'VN' });
    const payee = generateUsPaymentPayee({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
    const bankingData = { bankName: VN_BANK_NAME, bankCode: VN_BANK_CODE, accountNumber: BIVO_PREFIX + generateRandomDigits(8) };
    const updatedFirstName = `${payee.firstName}Z`;
    const updatedLastName = `${payee.lastName}Z`;
    let bivoAccountNumber = '';
    let bivoLast4 = '';

    await test.step('Step 1 | Login', async () => {
      ({ bivoAccountNumber, bivoLast4 } = await loginAndDiscoverAccount(page, request, fxPage));
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new Vietnam payee via Bank Deposit', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('VN');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addVnPayeeByTestId({ firstName: payee.firstName, lastName: payee.lastName, addressOne: payee.addressOne });
      await fxPage.enterVnBankDepositDetails(bankingData);
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
