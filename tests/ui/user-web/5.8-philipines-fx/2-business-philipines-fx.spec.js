// User-web FX — Philippines, business payee. Only one extra step versus the individual-
// payee flow in 1-individual-philipines-fx.spec.js: switching to the "Business" tab on
// the Create FX Transaction screen before selecting the destination country (same tab
// switch already used by 5.7-china-fx's business-payee file). Everything else — amount
// entry, review, confirm, ledger verification — reuses the same FxTransactionPage
// methods as the individual-payee file.
//
// Explored live (no recording was provided for this section, per request to model it on
// China's business file): the Business tab only exposes 2 deliver-to channels for the
// Philippines — Bank Deposit (default) and Instant Card Payout — unlike the individual
// flow's 4 (Bank Deposit, Mobile Wallet, Mobile Wallet -Additional, Instant Card
// Payout). No Mobile Wallet option appears for business payees, matching China's
// business flow also dropping channels the individual flow has.
//
// The business payee-details form (addBusinessPayee, placeholder-based — already
// generic, no new page-object method needed) has MORE fields than the individual
// payee-details form: business name + street address + city + postal code (individual
// PH has no city/postal). The Bank Deposit banking form, however, is the identical
// 4-field shape as individual's (bank name, bank code, account number, SWIFT code) —
// enterPhBankDepositDetails is reused as-is.
//
// Like China's business file, no verifySendMoneySummary assertion is made here — the
// same precedent that file already established for business-payee tests.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateBusinessPayeeExtraFields,
  generateRandomDigits,
} = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

// Pinned send amount — matches the individual-payee file so the two suites' summaries
// (where asserted) are directly comparable.
const SEND_AMOUNT_USD = '25';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as the individual-payee file's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

// Same static real-world bank identifiers as the individual-payee file's Bank Deposit
// scenario — only the payee's business name/address and the account number vary per run.
const PH_BANK_NAME = 'Bank of the Philippine Islands';
const PH_BANK_CODE = '010530030';
const PH_SWIFT_CODE = 'PNBMPHMMXXX';

// Same shared sandbox card-vault test PAN used by the individual-payee file's Instant
// Card Payout test (see that file's header comment for the caveat on this value).
const PH_INSTANT_CARD_PAYOUT_TEST_CARD = '4761348010000127';

test.describe('User-web FX — Philippines, business payee', () => {
  test('Sends a new FX transaction to a Philippines business payee via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — business payee Bank Deposit test',
      countryCode: 'PH',
    });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('PH');
    const bankingData = {
      bankName: PH_BANK_NAME,
      bankCode: PH_BANK_CODE,
      swiftCode: PH_SWIFT_CODE,
      accountNumber: BIVO_PREFIX + generateRandomDigits(10), // 15 digits, same shape as individual-payee's Bank Deposit scenario
    };

    let bivoAccountNumber = '';
    let bivoLast4 = '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || userData.accountNumber || '';
      const bivoDda = loginResult?.bivo_dda_number || userData.ddaNumber || '';
      bivoLast4 = String(bivoDda).slice(-4);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Open Create FX Transaction and switch to the Business tab (the one extra step)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
    });

    await test.step('Step 3 | Select Philippines, verify default recipient currency and deliver-to channel', async () => {
      await fxPage.selectBusinessDestinationCountryByTestId('PH');
      await fxPage.verifyDestinationCountryHeading('Philippines');
      await fxPage.verifyRecipientCurrencySelected('PHP');
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

    await test.step('Step 6 | Enter Bank Deposit banking details (bank name, bank code, account number, SWIFT)', async () => {
      await fxPage.enterPhBankDepositDetails(bankingData);
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number', async () => {
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

  test('Sends a new FX transaction to a Philippines business payee via Instant Card Payout', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — business payee Instant Card Payout test',
      countryCode: 'PH',
    });
    const businessName = `${fxData.beneficiaryFirstName} Corp`;
    const businessExtraFields = generateBusinessPayeeExtraFields('PH');

    let bivoAccountNumber = '';
    let bivoLast4 = '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || userData.accountNumber || '';
      const bivoDda = loginResult?.bivo_dda_number || userData.ddaNumber || '';
      bivoLast4 = String(bivoDda).slice(-4);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Open Create FX Transaction and switch to the Business tab (the one extra step)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.switchToBusinessTab();
    });

    await test.step('Step 3 | Select Philippines, verify default recipient currency, switch deliver-to to Instant Card Payout', async () => {
      await fxPage.selectBusinessDestinationCountryByTestId('PH');
      await fxPage.verifyDestinationCountryHeading('Philippines');
      await fxPage.verifyRecipientCurrencySelected('PHP');
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
      const { identifier } = await fxPage.linkCardAndCaptureApi(PH_INSTANT_CARD_PAYOUT_TEST_CARD);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number', async () => {
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
});
