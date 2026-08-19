// User-web FX — El Salvador. BCR Pay is the default deliver-to channel selected
// immediately after choosing El Salvador as the destination. El Salvador uses USD (a
// same-currency, 1:1 corridor — no recipient-currency selector to switch), same as the
// USD-recipient channels already covered elsewhere (e.g. 5.5-india-fx's SWIFT scenario).
// Structured the same way as 5.9-vietnam-fx: same login/confirm/ledger validations, just
// this country's own payee and banking field shapes.
//
// Two channels are covered:
//   1. BCR Pay (default) — payee-details screen: first name, last name only (no
//      address). Banking screen: a single field carrying the DUI (Documento Único de
//      Identidad), entered via the generic account-number testid rather than a
//      DUI-labeled one (see FxTransactionPage.enterSvBcrPayDetailsByTestId — distinct
//      from the older role-based enterBcrPayDetails used by the generic multicountry
//      suite, since it's unconfirmed whether both selectors hit the same field). No
//      fee/exchange/rate summary was captured for this channel, so it isn't asserted.
//   2. Bank Deposit — switched to from the BCR Pay default via the deliver-to dropdown.
//      Same simplified (name-only) payee form; its banking step is bank name + bank code
//      (SWIFT/BIC-format, no separate SWIFT field) + a mobile number in place of a
//      traditional account number (see FxTransactionPage.enterSvBankDepositDetails).
//
// Instant Card Payout has not been recorded yet — left as a test.fixme placeholder with
// just the shared lead-in wired up (same pattern as 5.9-vietnam-fx's placeholder). The
// Business tab has not been recorded at all — see 2-business-elsalvador-fx.spec.js.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const { generateFxTransactionData, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

// Pinned send amount — Bank Deposit's summary below (fee $3.49 + exchange $21.51 = $25)
// confirms this same amount, matching the convention used by every sibling country file.
const SEND_AMOUNT_USD = '25';

// Bank Deposit's fee/exchange/rate summary was confirmed live at exactly $25 — BCR Pay's
// was not captured (see header comment), so it isn't asserted for that channel.
const BANK_DEPOSIT_SUMMARY = { fee: '$3.49', exchangeAmount: '$21.51', rate: '$1 =1' };

// Sandbox-format DUI (Documento Único de Identidad) — a fixed sandbox value, not a real
// ID, so it stays static rather than faker-generated, same "static real-world
// identifier" convention as other countries' fixed SWIFT codes / test cards.
const SV_DUI = '012345678';

// Banco Agrícola — real bank name + SWIFT/BIC code, same "static real-world identifier"
// convention as other countries' bank name/SWIFT constants.
const SV_BANK_NAME = 'Banco Agricola SA';
const SV_BANK_CODE = 'CAGRSVSS';

// Standard-format SV mobile number — fixed sandbox value, same convention as Vietnam's
// VN_MOBILE_WALLET_PHONE / Philippines' PH_MOBILE_WALLET_NUMBER.
const SV_MOBILE_NUMBER = '+50371234567';

test.describe('User-web FX — El Salvador', () => {
  test('Sends a new FX transaction to El Salvador via BCR Pay', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — BCR Pay test',
      countryCode: 'SV',
    });

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

    await test.step('Step 2 | Open Create FX Transaction, select El Salvador, verify default currency and deliver-to channel', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('SV');
      await fxPage.verifyDestinationCountryHeading('El Salvador');
      await fxPage.verifyFromCurrencySelected('USD');
      await fxPage.verifyDeliverToSelected('BCR Pay');
    });

    await test.step('Step 3 | Enter send amount and continue', async () => {
      // No confirmed fee/exchange/rate summary for BCR Pay (only Bank Deposit's was
      // recorded — see header comment), so no summary is asserted here.
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 4 | Add payee (name-only)', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
    });

    await test.step('Step 5 | Enter BCR Pay DUI details', async () => {
      await fxPage.enterSvBcrPayDetailsByTestId({ dui: SV_DUI });
    });

    await test.step('Step 6 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 7 | Review screen, note, and invoice number', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
    });

    await test.step('Step 8 | Confirm transaction — asserts POST /business/v1/remittance/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 9 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 10 | Navigate to the Bivo account and verify the DEBIT transaction in the ledger', async () => {
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

  test('Sends a new FX transaction to El Salvador via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — Bank Deposit test',
      countryCode: 'SV',
    });
    const bankingData = {
      bankName: SV_BANK_NAME,
      bankCode: SV_BANK_CODE,
      phone: SV_MOBILE_NUMBER,
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

    await test.step('Step 2 | Open Create FX Transaction and select El Salvador', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('SV');
      await fxPage.verifyDestinationCountryHeading('El Salvador');
    });

    await test.step('Step 3 | Switch deliver-to from the BCR Pay default to Bank Deposit', async () => {
      await fxPage.verifyDeliverToSelected('BCR Pay');
      await fxPage.selectDeliverToOption('Bank Deposit');
    });

    await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(BANK_DEPOSIT_SUMMARY);
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name-only)', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
    });

    await test.step('Step 6 | Enter Bank Deposit banking details (bank name, bank code, mobile number)', async () => {
      await fxPage.enterSvBankDepositDetails(bankingData);
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
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

  // Not yet recorded — placeholder kept in the matrix/report without running. To
  // implement: remove `.fixme`, record the card-vault step (see other countries'
  // linkCardAndCaptureApi usage) and the rest of the flow, matching the pattern above.
  test.fixme('Sends a new FX transaction to El Salvador via Instant Card Payout', async ({ page, request }) => {
    const fxPage = new FxTransactionPage(page);
    const userData = resolveUserDataForLogin();
    await loginUserWebWithPhone({ page, request, userData });
    await fxPage.navigateToCreateFxTransactionUserWeb();
    await fxPage.selectDestinationCountryByTestId('SV');
    await fxPage.verifyDeliverToSelected('BCR Pay');
    await fxPage.selectDeliverToOption('Instant Card Payout');
    // TODO(fill later): enter amount → continue → add payee → link card
    // (fxPage.linkCardAndCaptureApi) → confirm → assert paymentIdentifier → verify
    // Processing → ledger check.
  });
});
