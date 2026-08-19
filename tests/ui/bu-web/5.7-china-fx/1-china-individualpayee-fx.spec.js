// Bu-web FX — China. UnionPay (CNY) is the default deliver-to channel selected
// immediately after choosing China as the destination — no separate recipient-currency
// step is needed here (confirmed via live recording, Aug 2026; see DRAFT_NOTES.md in
// this directory for the full step-by-step this file was built from).
//
// Three channels are covered, all under CNY (confirmed via the recipient-currency chip
// testid — see verifyRecipientCurrencySelected):
//   1. UnionPay — the payee-details screen collects an identity type + number, offering
//      4 options: Driver's License, Passport, National ID, Other. Each is run as its own
//      scenario so all 4 are covered — the payee's last name is suffixed with the
//      identity type (e.g. "Doe DriverLicense") purely so each of the 4 runs is
//      identifiable in the test report / sandbox data, not a UI requirement.
//   2. Bank Deposit — switched to from the UnionPay default via the deliver-to dropdown.
//      Its payee-details screen has no identity-type step (name + address + city +
//      postal code only); its banking form collects account number + SWIFT + bank name.
//   3. Instant Card Payout — also switched to from the UnionPay default. Same simplified
//      payee form as Bank Deposit; banking step links a card via the PGW vault iframe
//      and asserts POST /pgw/v1/card returns an identifier.
//
// Every scenario verifies, right after country selection: the "You're sending to China"
// heading, the CNY recipient-currency chip, and the current deliver-to channel (UnionPay
// by default, or the channel just switched to) — before touching the amount field.
//
// UnionPay's payee-details screen uses a different control pattern than the
// identity-type handling already coded in FxTransactionPage.addPayee (role-based
// "Select beneficiary's identity type" button): it's a generic `option-select` /
// `option-select-option-{slug}` testid — see addCnUnionPayPayeeByTestId in
// FxTransactionPage. UnionPay's own banking form, however, is the pre-existing
// role-based "Enter bank name" dropdown (enterUnionPayDetails) — `option-select` does
// NOT apply there (confirmed live: an earlier draft assumed it did and failed at that
// step). Bank Deposit's (and Instant Card Payout's) banking/payee forms reuse
// enterCnBusinessBankDetails / addCnBankDepositPayeeByTestId, since those forms render
// the identical testid shapes those methods already fill.
//
// The $25 send amount is pinned (not live-market) — the fee/exchange/rate summary for
// each channel was confirmed via live recording at that exact amount. Card number(s),
// SWIFT code, and identity number are fixed sandbox values (same "static real-world
// identifier" convention as 5.3/5.5/5.6's bank names/SWIFT codes) — only the payee's
// name/address and identity type vary per run. China's remaining channel (CNH via
// Instant Card Payout/Bank Deposit, already covered on user-web's
// tests/ui/user-web/5.7-china-fx) has not been ported to bu-web yet.
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const {
  generateFxTransactionData,
  generateUsPaymentPayee,
  generateRandomDigits,
} = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

// Pinned send amount — the summary assertions below (fee/exchange/rate) were confirmed
// live at exactly $25 for both channels; a different amount would need re-confirming.
const SEND_AMOUNT_USD = '25';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as 5.4-uk-fx's BIVO_PREFIX / 5.5-india-fx's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

// Bank of China — real SWIFT/BIC, shared by both channels below (UnionPay's banking form
// and Bank Deposit's, confirmed identical via live recording).
const CN_SWIFT_CODE = 'BKCHCNBJXXX';

// UnionPay card — fixed sandbox value, shared across all 4 identity-type scenarios below.
const CN_UNIONPAY_CARD_NUMBER = '1986723547681512';

// Fixed sandbox-format identity number, reused across all 4 identity-type scenarios —
// same "static real-world identifier" convention as the card/SWIFT constants above.
const CN_UNIONPAY_IDENTITY_NUMBER = 'PA9817623';

// Industrial and Commercial Bank of China — real bank name, Bank Deposit channel only.
const CN_BANK_DEPOSIT_BANK_NAME = 'Industrial and Commercial Bank of China';

// Sandbox card-vault test PAN for the CN Instant Card Payout channel — confirmed via live
// recording. Distinct from TEST_CARD_NUMBER (4761348010000127) used by 5.3/5.5's Instant
// Card Payout channels; the vault apparently accepts more than one fixed test PAN.
const CN_INSTANT_CARD_PAYOUT_TEST_CARD = '4300008010000125';

// Switching recipient currency to CNH resets deliver-to to Instant Card Payout by
// default; Bank Deposit is the only other option under CNH (confirmed via live
// recording). Only fee + rate were confirmed for CNH's Instant Card Payout summary — no
// exchange-amount value was given, so that field isn't asserted for this channel.
const CNH_INSTANT_CARD_PAYOUT_SUMMARY = { fee: '$5.98', rate: '$1 =7.145' };

const IDENTITY_TYPES = [
  { label: "Driver's License", slug: 'driver-s-license', suffix: 'DriverLicense' },
  { label: 'Passport', slug: 'passport', suffix: 'Passport' },
  { label: 'National ID', slug: 'national-id', suffix: 'NationalID' },
  { label: 'Other', slug: 'other', suffix: 'Other' },
];

test.describe('Bu-web FX — China', () => {
  for (const idType of IDENTITY_TYPES) {
    test(`Sends a new FX transaction to China via UnionPay with identity type: ${idType.label}`, async ({ page }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: `Sent from Bivo — UnionPay ${idType.label} test`,
        countryCode: 'CN',
      });
      const payee = generateUsPaymentPayee({
        firstName: fxData.beneficiaryFirstName,
        lastName: `${fxData.beneficiaryLastName}${idType.suffix}`,
      });

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

      await test.step('Step 2 | Open Create FX Transaction, select China, verify default recipient currency', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('CN');
        await fxPage.verifyDestinationCountryHeading('China');
        await fxPage.verifyRecipientCurrencySelected('CNY');
      });

      await test.step('Step 3 | Deliver to UnionPay (default channel for China)', async () => {
        await fxPage.verifyDeliverToSelected('UnionPay');
      });

      await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.verifySendMoneySummary({ fee: '$3.99', exchangeAmount: '$21.01', rate: '$1 =6.9616' });
        await fxPage.continue();
      });

      await test.step(`Step 5 | Add payee with identity type: ${idType.label}`, async () => {
        await fxPage.addCnUnionPayPayeeByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
          city: payee.city,
          identitySlug: idType.slug,
          postalCode: payee.postalCode,
          identityNumber: CN_UNIONPAY_IDENTITY_NUMBER,
        });
      });

      await test.step('Step 6 | Enter UnionPay banking details', async () => {
        // The banking form's "bank name" field is the pre-existing role-based dropdown
        // (label "Enter bank name" -> single fixed "UnionPay" option) already handled by
        // enterUnionPayDetails — confirmed via a live run: the draft recording's
        // `option-select` testid does NOT apply here (that testid is only the
        // payee-details identity-type dropdown used in Step 5 above).
        await fxPage.enterUnionPayDetails({
          cardNumber: CN_UNIONPAY_CARD_NUMBER,
          swiftCode: CN_SWIFT_CODE,
        });
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        // UnionPay collects identity type/number on the payee-details screen itself
        // (Step 5 above) — this later screen isn't expected to appear for this channel,
        // but the check is kept as a defensive no-op, same as every other FX spec.
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Review screen, note, and invoice number (bu-web only)', async () => {
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

  test('Sends a new FX transaction to China via Bank Deposit', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — Bank Deposit test',
      countryCode: 'CN',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });
    const bankingData = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(9), // 14 digits, matches the recorded length
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

    await test.step('Step 2 | Open Create FX Transaction and select China', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
    });

    await test.step('Step 3 | Switch deliver-to from the UnionPay default to Bank Deposit', async () => {
      await fxPage.verifyDeliverToSelected('UnionPay');
      await fxPage.selectDeliverToOption('Bank Deposit');
    });

    await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary({ fee: '$0.99', exchangeAmount: '$24.01', rate: '$1 =6.9588' });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name + address + city + postal code, no identity type)', async () => {
      await fxPage.addCnBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
        city: payee.city,
        postalCode: payee.postalCode,
      });
    });

    await test.step('Step 6 | Enter Bank Deposit banking details (account number, SWIFT, bank name)', async () => {
      // Reuses enterCnBusinessBankDetails — the individual Bank Deposit form here renders
      // the identical account-number/swift/bank-name testid shape that method already
      // fills for the CN business flow (confirmed via live recording).
      await fxPage.enterCnBusinessBankDetails(bankingData);
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number (bu-web only)', async () => {
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

  test('Sends a new FX transaction to China via Instant Card Payout', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — Instant Card Payout test',
      countryCode: 'CN',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });

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

    await test.step('Step 2 | Open Create FX Transaction, select China, verify default recipient currency', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
    });

    await test.step('Step 3 | Switch deliver-to from the UnionPay default to Instant Card Payout', async () => {
      await fxPage.verifyDeliverToSelected('UnionPay');
      await fxPage.selectDeliverToOption('Instant Card Payout');
    });

    await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary({ fee: '$3.99', exchangeAmount: '$21.01', rate: '$1 =6.9616' });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name + address + city + postal code, no identity type)', async () => {
      // Same testid shape as Bank Deposit's payee form — addCnBankDepositPayeeByTestId
      // reused here too (confirmed identical via live recording).
      await fxPage.addCnBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
        city: payee.city,
        postalCode: payee.postalCode,
      });
    });

    await test.step('Step 6 | Link card and verify card-vault API', async () => {
      const { identifier } = await fxPage.linkCardAndCaptureApi(CN_INSTANT_CARD_PAYOUT_TEST_CARD);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Review screen, note, and invoice number (bu-web only)', async () => {
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

  test('Sends a new FX transaction to China (CNH) via Instant Card Payout', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — CNH Instant Card Payout test',
      countryCode: 'CN',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });

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

    await test.step('Step 2 | Open Create FX Transaction, select China, verify default recipient currency', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
    });

    await test.step('Step 3 | Verify default deliver-to (UnionPay) before switching currency', async () => {
      await fxPage.verifyDeliverToSelected('UnionPay');
    });

    await test.step('Step 4 | Switch recipient currency to CNH, verify deliver-to resets to Instant Card Payout', async () => {
      await fxPage.selectRecipientCurrency('CNH');
      await fxPage.verifyDeliverToSelected('Instant Card Payout');
    });

    await test.step('Step 5 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(CNH_INSTANT_CARD_PAYOUT_SUMMARY);
      await fxPage.continue();
    });

    await test.step('Step 6 | Add payee (name + address + city + postal code, no identity type)', async () => {
      await fxPage.addCnBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
        city: payee.city,
        postalCode: payee.postalCode,
      });
    });

    await test.step('Step 7 | Link card and verify card-vault API', async () => {
      const { identifier } = await fxPage.linkCardAndCaptureApi(CN_INSTANT_CARD_PAYOUT_TEST_CARD);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
    });

    await test.step('Step 8 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 9 | Review screen, note, and invoice number (bu-web only)', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
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

  test('Sends a new FX transaction to China (CNH) via Bank Deposit', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — CNH Bank Deposit test',
      countryCode: 'CN',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });
    const bankingData = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(9), // 14 digits, same shape as the CNY Bank Deposit scenario
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

    await test.step('Step 2 | Open Create FX Transaction, select China, verify default recipient currency', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('CN');
      await fxPage.verifyDestinationCountryHeading('China');
      await fxPage.verifyRecipientCurrencySelected('CNY');
    });

    await test.step('Step 3 | Verify default deliver-to (UnionPay) before switching currency', async () => {
      await fxPage.verifyDeliverToSelected('UnionPay');
    });

    await test.step('Step 4 | Switch recipient currency to CNH, verify deliver-to resets to Instant Card Payout, then switch to Bank Deposit', async () => {
      await fxPage.selectRecipientCurrency('CNH');
      await fxPage.verifyDeliverToSelected('Instant Card Payout');
      await fxPage.selectDeliverToOption('Bank Deposit');
    });

    await test.step('Step 5 | Enter send amount and continue', async () => {
      // No confirmed fee/exchange/rate summary for CNH's Bank Deposit channel (only
      // CNH's Instant Card Payout default was recorded) — so no summary is asserted here.
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 6 | Add payee (name + address + city + postal code, no identity type)', async () => {
      await fxPage.addCnBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
        city: payee.city,
        postalCode: payee.postalCode,
      });
    });

    await test.step('Step 7 | Enter Bank Deposit banking details (account number, SWIFT, bank name)', async () => {
      await fxPage.enterCnBusinessBankDetails(bankingData);
    });

    await test.step('Step 8 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 9 | Review screen, note, and invoice number (bu-web only)', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${payee.firstName} ${payee.lastName}`);
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
