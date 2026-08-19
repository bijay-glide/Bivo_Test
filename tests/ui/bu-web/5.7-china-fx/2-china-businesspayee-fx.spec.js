// Bu-web FX — China, business payee. Only one extra step versus the individual-payee
// flow in 1-china-individualpayee-fx.spec.js: switching to the "Business" tab on the
// Create FX Transaction screen before selecting the destination country (same tab
// switch already used by 5.2-fx-multicountry-business). Everything else — amount entry,
// banking, review, confirm, ledger verification — reuses the same FxTransactionPage
// methods as the individual-payee file.
//
// China's business-payee flow only exposes 2 deliver-to channels (no UnionPay, no
// Alipay): Instant Card Payout and Bank Deposit. Defaults differ from the individual
// flow too — CNY defaults to Bank Deposit here (individual defaults to UnionPay).
// Switching to CNH resets the default to Instant Card Payout, the same rule confirmed
// for the individual flow's CNH scenarios.
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const {
  generateFxTransactionData,
  generateBusinessPayeeExtraFields,
  generateRandomDigits,
} = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

// Pinned send amount — matches the individual-payee file so the two suites' summaries
// are directly comparable.
const SEND_AMOUNT_USD = '25';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as the individual-payee file's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

// Bank of China — real SWIFT/BIC, same constant used by the individual-payee file's
// Bank Deposit scenarios.
const CN_SWIFT_CODE = 'BKCHCNBJXXX';

// Industrial and Commercial Bank of China — same bank name used by the individual-payee
// file's Bank Deposit scenarios.
const CN_BANK_DEPOSIT_BANK_NAME = 'Industrial and Commercial Bank of China';

// Sandbox card-vault test PAN for the CN Instant Card Payout channel — same constant
// used by the individual-payee file.
const CN_INSTANT_CARD_PAYOUT_TEST_CARD = '4300008010000125';

test.describe('Bu-web FX — China, business payee', () => {
  test('Sends a new FX transaction to a China business payee via Bank Deposit (CNY default)', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — business payee Bank Deposit test',
      countryCode: 'CN',
    });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('CN');
    const bankingData = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(9), // 14 digits, same shape as the individual-payee Bank Deposit scenario
      swiftCode: CN_SWIFT_CODE,
      bankName: CN_BANK_DEPOSIT_BANK_NAME,
    };

    let bivoAccountNumber = '';
    let bivoLast4 = '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      bivoAccountNumber = userData.accountNumber || '';
      await loginBuWebWithEmail({ page, userData });
      bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Open Create FX Transaction and switch to the Business tab (the one extra step)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
    });

    await test.step('Step 3 | Select China, verify default recipient currency and deliver-to channel', async () => {
      await fxPage.selectBusinessDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
    });

    await test.step('Step 4 | Enter send amount and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add business payee', async () => {
      await fxPage.addBusinessPayee(businessName, businessExtraFields);
    });

    await test.step('Step 6 | Enter Bank Deposit banking details (account number, SWIFT, bank name)', async () => {
      await fxPage.enterCnBusinessBankDetails(bankingData);
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number (bu-web only)', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(businessName);
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
    });

    await test.step('Step 9 | Confirm transaction — asserts POST /business/v1/remittance/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 10 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 11 | Navigate to the Bivo account and verify the DEBIT transaction in the ledger', async () => {
      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4,
        bivoAccountNumber,
      });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });

  test('Sends a new FX transaction to a China business payee via Instant Card Payout (CNY)', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — business payee Instant Card Payout test',
      countryCode: 'CN',
    });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('CN');

    let bivoAccountNumber = '';
    let bivoLast4 = '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      bivoAccountNumber = userData.accountNumber || '';
      await loginBuWebWithEmail({ page, userData });
      bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Open Create FX Transaction and switch to the Business tab (the one extra step)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
    });

    await test.step('Step 3 | Select China, verify default recipient currency, switch deliver-to to Instant Card Payout', async () => {
      await fxPage.selectBusinessDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.selectDeliverToOption('Instant Card Payout');
    });

    await test.step('Step 4 | Enter send amount and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add business payee', async () => {
      await fxPage.addBusinessPayee(businessName, businessExtraFields);
    });

    await test.step('Step 6 | Link card and verify card-vault API', async () => {
      const { identifier } = await fxPage.linkCardAndCaptureApi(CN_INSTANT_CARD_PAYOUT_TEST_CARD);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number (bu-web only)', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(businessName);
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
    });

    await test.step('Step 9 | Confirm transaction — asserts POST /business/v1/remittance/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 10 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 11 | Navigate to the Bivo account and verify the DEBIT transaction in the ledger', async () => {
      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4,
        bivoAccountNumber,
      });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });

  test('Sends a new FX transaction to a China business payee via Instant Card Payout (CNH default)', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — business payee CNH Instant Card Payout test',
      countryCode: 'CN',
    });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('CN');

    let bivoAccountNumber = '';
    let bivoLast4 = '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      bivoAccountNumber = userData.accountNumber || '';
      await loginBuWebWithEmail({ page, userData });
      bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Open Create FX Transaction and switch to the Business tab (the one extra step)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
    });

    await test.step('Step 3 | Select China, verify default recipient currency and deliver-to channel', async () => {
      await fxPage.selectBusinessDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
    });

    await test.step('Step 4 | Switch recipient currency to CNH, verify deliver-to resets to Instant Card Payout', async () => {
      await fxPage.selectRecipientCurrency('CNH');
      await fxPage.verifyDeliverToSelected('Instant Card Payout');
    });

    await test.step('Step 5 | Enter send amount and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 6 | Add business payee', async () => {
      await fxPage.addBusinessPayee(businessName, businessExtraFields);
    });

    await test.step('Step 7 | Link card and verify card-vault API', async () => {
      const { identifier } = await fxPage.linkCardAndCaptureApi(CN_INSTANT_CARD_PAYOUT_TEST_CARD);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
    });

    await test.step('Step 8 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 9 | Review screen, note, and invoice number (bu-web only)', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(businessName);
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
    });

    await test.step('Step 10 | Confirm transaction — asserts POST /business/v1/remittance/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 11 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 12 | Navigate to the Bivo account and verify the DEBIT transaction in the ledger', async () => {
      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4,
        bivoAccountNumber,
      });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });

  test('Sends a new FX transaction to a China business payee via Bank Deposit (CNH)', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — business payee CNH Bank Deposit test',
      countryCode: 'CN',
    });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('CN');
    const bankingData = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(9),
      swiftCode: CN_SWIFT_CODE,
      bankName: CN_BANK_DEPOSIT_BANK_NAME,
    };

    let bivoAccountNumber = '';
    let bivoLast4 = '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      bivoAccountNumber = userData.accountNumber || '';
      await loginBuWebWithEmail({ page, userData });
      bivoLast4 = await fxPage.discoverBivoPrimaryLast4(bivoAccountNumber);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Open Create FX Transaction and switch to the Business tab (the one extra step)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
    });

    await test.step('Step 3 | Select China, verify default recipient currency and deliver-to channel', async () => {
      await fxPage.selectBusinessDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
      await fxPage.verifyDeliverToSelected('Bank Deposit');
    });

    await test.step('Step 4 | Switch recipient currency to CNH, verify deliver-to resets to Instant Card Payout, then switch to Bank Deposit', async () => {
      await fxPage.selectRecipientCurrency('CNH');
      await fxPage.verifyDeliverToSelected('Instant Card Payout');
      await fxPage.selectDeliverToOption('Bank Deposit');
    });

    await test.step('Step 5 | Enter send amount and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 6 | Add business payee', async () => {
      await fxPage.addBusinessPayee(businessName, businessExtraFields);
    });

    await test.step('Step 7 | Enter Bank Deposit banking details (account number, SWIFT, bank name)', async () => {
      await fxPage.enterCnBusinessBankDetails(bankingData);
    });

    await test.step('Step 8 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 9 | Review screen, note, and invoice number (bu-web only)', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(businessName);
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
    });

    await test.step('Step 10 | Confirm transaction — asserts POST /business/v1/remittance/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 11 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 12 | Navigate to the Bivo account and verify the DEBIT transaction in the ledger', async () => {
      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4,
        bivoAccountNumber,
      });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
      });
    });
  });
});
