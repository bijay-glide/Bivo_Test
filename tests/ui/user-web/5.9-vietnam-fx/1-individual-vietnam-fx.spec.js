// User-web FX — Vietnam. Bank Deposit is the default deliver-to channel selected
// immediately after choosing Vietnam as the destination, under VND. Structured the same
// way as the Philippines FX suite: same login/summary/review/confirm/ledger validations,
// just this country's own payee and banking field shapes.
//
// Two channels are covered:
//   1. Bank Deposit (default) — payee-details screen: first name, last name, address
//      only, no city/postal code. Banking screen: bank name, bank code (holds a
//      SWIFT/BIC-format value — there's no separate SWIFT code field for this country),
//      account number (see FxTransactionPage.enterVnBankDepositDetails).
//   2. Mobile Wallet — switched to from the Bank Deposit default via the deliver-to
//      dropdown. Same simplified payee form as Bank Deposit; its banking step collects a
//      mobile number first (unlike Philippines' Mobile Wallet, which has no separate
//      phone field), then a wallet-provider dropdown (bank-code testid, same
//      `option-select` pattern as Philippines'/China's equivalents). All 4 provider
//      options observed in the dropdown (VNPT, MoMo, ZaloPay, VNPay) are each run as
//      their own scenario — same convention as Philippines' Mobile Wallet providers —
//      with the payee's last name suffixed by provider so each run is identifiable.
//      Provider display labels below are inferred (title-cased from the option slugs),
//      not confirmed against on-screen text — only the slugs themselves were probed.
//
// Instant Card Payout has not been recorded yet — left as a test.fixme placeholder with
// just the shared lead-in wired up (same convention already used by 5.3-uk-fx's matrix).
// The Business tab (Bank Deposit + Instant Card Payout, per a live probe) belongs in
// 2-business-vietnam-fx.spec.js once recorded.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateUsPaymentPayee,
  generateRandomDigits,
} = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

// Pinned send amount — the summary assertions below (fee/exchange/rate) were confirmed
// live at exactly $25 — same convention as the Philippines suite's SEND_AMOUNT_USD.
const SEND_AMOUNT_USD = '25';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as the Philippines suite's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

// Vietcombank — real bank name/bank-code, shared across runs (same "static real-world
// identifier" convention as Philippines' PH_BANK_NAME etc.) — only the payee's
// name/address and the account number vary per run.
const VN_BANK_NAME = 'Vietcombank';
const VN_BANK_CODE = 'BFTVVNVX';

// Standard-format VN mobile number — shared across all 4 Mobile Wallet provider
// scenarios below, same "static real-world identifier, shared across sub-scenarios"
// convention as Philippines' PH_MOBILE_WALLET_NUMBER.
const VN_MOBILE_WALLET_PHONE = '+84912345678';

const MOBILE_WALLET_PROVIDERS = [
  { label: 'VNPT', slug: 'vnpt', suffix: 'VNPT' },
  { label: 'MoMo', slug: 'momo', suffix: 'MoMo' },
  { label: 'ZaloPay', slug: 'zalopay', suffix: 'ZaloPay' },
  { label: 'VNPay', slug: 'vnpay', suffix: 'VNPay' },
];

test.describe('User-web FX — Vietnam', () => {
  test('Sends a new FX transaction to Vietnam via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — Bank Deposit test',
      countryCode: 'VN',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });
    const bankingData = {
      bankName: VN_BANK_NAME,
      bankCode: VN_BANK_CODE,
      accountNumber: BIVO_PREFIX + generateRandomDigits(8), // 13 digits, matches the recorded length
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

    await test.step('Step 2 | Open Create FX Transaction, select Vietnam, verify default recipient currency', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('VN');
      await fxPage.verifyDestinationCountryHeading('Vietnam');
      await fxPage.verifyRecipientCurrencySelected('VND');
    });

    await test.step('Step 3 | Deliver to Bank Deposit (default channel for Vietnam)', async () => {
      await fxPage.verifyDeliverToSelected('Bank Deposit');
    });

    await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary({ fee: '$0.99', exchangeAmount: '$24.01', rate: '$1 =26216.12' });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name + address only, no city/postal code)', async () => {
      await fxPage.addVnPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
      });
    });

    await test.step('Step 6 | Enter Bank Deposit banking details (bank name, bank code, account number)', async () => {
      await fxPage.enterVnBankDepositDetails(bankingData);
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
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

  for (const provider of MOBILE_WALLET_PROVIDERS) {
    test(`Sends a new FX transaction to Vietnam via Mobile Wallet (${provider.label})`, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: `Sent from Bivo — Mobile Wallet ${provider.label} test`,
        countryCode: 'VN',
      });
      const payee = generateUsPaymentPayee({
        firstName: fxData.beneficiaryFirstName,
        lastName: `${fxData.beneficiaryLastName}${provider.suffix}`,
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

      await test.step('Step 2 | Open Create FX Transaction, select Vietnam, verify default recipient currency', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('VN');
        await fxPage.verifyDestinationCountryHeading('Vietnam');
        await fxPage.verifyRecipientCurrencySelected('VND');
      });

      await test.step('Step 3 | Switch deliver-to from the Bank Deposit default to Mobile Wallet', async () => {
        await fxPage.verifyDeliverToSelected('Bank Deposit');
        await fxPage.selectDeliverToOption('Mobile Wallet');
      });

      await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.verifySendMoneySummary({ fee: '$0.99', exchangeAmount: '$24.01', rate: '$1 =26216.12' });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add payee (name + address only, no city/postal code)', async () => {
        await fxPage.addVnPayeeByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
        });
      });

      await test.step(`Step 6 | Enter mobile number and select ${provider.label}`, async () => {
        await fxPage.enterVnMobileWalletDetails({
          phone: VN_MOBILE_WALLET_PHONE,
          providerSlug: provider.slug,
        });
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Review screen, note, and invoice number', async () => {
        await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
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
  }

  // Not yet recorded — placeholder kept in the matrix/report without running. To
  // implement: remove `.fixme`, record the card-vault step (see other countries'
  // linkCardAndCaptureApi usage) and the rest of the flow, matching the pattern above.
  test.fixme('Sends a new FX transaction to Vietnam via Instant Card Payout', async ({ page, request }) => {
    const fxPage = new FxTransactionPage(page);
    const userData = resolveUserDataForLogin();
    await loginUserWebWithPhone({ page, request, userData });
    await fxPage.navigateToCreateFxTransactionUserWeb();
    await fxPage.selectDestinationCountryByTestId('VN');
    await fxPage.verifyDeliverToSelected('Bank Deposit');
    await fxPage.selectDeliverToOption('Instant Card Payout');
    // TODO(fill later): enter amount → continue → add payee → link card
    // (fxPage.linkCardAndCaptureApi) → confirm → assert paymentIdentifier → verify
    // Processing → ledger check.
  });
});
