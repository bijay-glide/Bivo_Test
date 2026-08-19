// User-web FX — Philippines. Bank Deposit is the default deliver-to channel selected
// immediately after choosing Philippines as the destination, under PHP — no channel
// switch or recipient-currency change is needed (confirmed via live recording, Aug
// 2026). Structured the same way as 5.7-china-fx: same login/summary/review/confirm/
// ledger validations, just this country's own payee and banking field shapes.
//
// Four channels are covered:
//   1. Bank Deposit (default) — payee-details screen: first name, last name, address
//      only, no city/postal code. Banking screen: bank name, bank code, SWIFT code,
//      account number (see FxTransactionPage.enterPhBankDepositDetails).
//   2. Mobile Wallet — switched to from the Bank Deposit default via the deliver-to
//      dropdown. Same simplified payee form as Bank Deposit; its banking step is a
//      wallet-provider dropdown (bank-code testid, same `option-select` pattern as
//      China's UnionPay identity-type dropdown) followed by a mobile-number field
//      reusing Bank Deposit's account-number testid. All 5 provider options observed
//      in the dropdown (Coins.ph, GCash, GrabPay, PayMaya, StarPay) are each run as
//      their own scenario — same convention as China's 4 UnionPay identity types — with
//      the payee's last name suffixed by provider so each run is identifiable.
//   3. Mobile Wallet -Additional — a second, distinct deliver-to entry from "Mobile
//      Wallet" above, with its own (mostly non-overlapping) 9-provider list. Reuses the
//      same testid shapes as Mobile Wallet, so no separate page-object method was needed.
//   4. Instant Card Payout — switched to from the Bank Deposit default. Same simplified
//      payee form as Bank Deposit; banking step links a card via the PGW vault iframe
//      (FxTransactionPage.linkCardAndCaptureApi), same as every other country's Instant
//      Card Payout channel. Modeled on 5.7-china-fx's Instant Card Payout test per
//      request. Its fee/exchange/rate summary was confirmed live via a standalone probe
//      up to the amount-entry step (identical to Bank Deposit's at this amount) — see
//      verifySendMoneySummary in that test. The test card number reuses 5.3/5.5's shared
//      TEST_CARD_NUMBER rather than a PH-specific one, per request — that part of the
//      flow (card-vault acceptance) was NOT included in the probe, so it's still only an
//      assumption that the vault accepts this PAN for PH the way it does for UK/India.
//
// The wallet number (PH_MOBILE_WALLET_NUMBER below) is a standard-format Philippine
// mobile number (09XXXXXXXXX) — GCash/PayMaya/Coins.ph/GrabPay wallets are all
// identified by one. Inferred, not confirmed via live recording (the recording only
// probed the dropdown and left a placeholder value) — adjust if the sandbox rejects it.
//
// Philippines' remaining delivery channels will be added once they're provided.
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
// live at exactly $25 — same convention as 5.7-china-fx's SEND_AMOUNT_USD.
const SEND_AMOUNT_USD = '25';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as 5.3-uk-fx's BIVO_PREFIX / 5.7-china-fx's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

// Bank of the Philippine Islands — real bank name/SWIFT/bank code, shared across runs
// (same "static real-world identifier" convention as China's CN_SWIFT_CODE etc.) — only
// the payee's name/address and the account number vary per run.
const PH_BANK_NAME = 'Bank of the Philippine Islands';
const PH_BANK_CODE = '010530030';
const PH_SWIFT_CODE = 'PNBMPHMMXXX';

// Standard-format PH mobile number — shared across all 5 Mobile Wallet provider
// scenarios below, same "static real-world identifier, shared across sub-scenarios"
// convention as China's CN_UNIONPAY_CARD_NUMBER.
const PH_MOBILE_WALLET_NUMBER = '09171234567';

// Sandbox card-vault test PAN, shared with 5.3-uk-fx / 5.5-india-fx's Instant Card
// Payout channels — NOT independently confirmed for PH (China needed its own distinct
// card number for the same channel, so this may need to change once run live).
const PH_INSTANT_CARD_PAYOUT_TEST_CARD = '4761348010000127';

const MOBILE_WALLET_PROVIDERS = [
  { label: 'Coins.ph', slug: 'coins', suffix: 'Coins' },
  { label: 'GCash', slug: 'gcash', suffix: 'GCash' },
  { label: 'GrabPay', slug: 'grabpay', suffix: 'GrabPay' },
  { label: 'PayMaya', slug: 'paymaya', suffix: 'PayMaya' },
  { label: 'StarPay', slug: 'starpay', suffix: 'StarPay' },
];

// "Mobile Wallet -Additional" is a second, distinct deliver-to channel from "Mobile
// Wallet" above — its own entry in the deliver-to dropdown, with its own (larger, mostly
// non-overlapping) set of provider options, confirmed via live recording. It reuses the
// exact same testid shapes (bank-code dropdown + account-number field), so no new
// FxTransactionPage method was needed — enterPhMobileWalletDetails covers both channels.
// Labels below are for test-title readability only (not asserted against UI text — same
// caveat as MOBILE_WALLET_PROVIDERS' labels).
const MOBILE_WALLET_ADDITIONAL_PROVIDERS = [
  { label: 'Bayad', slug: 'bayad', suffix: 'Bayad' },
  { label: 'iRemit', slug: 'iremit', suffix: 'IRemit' },
  { label: 'JuanCash', slug: 'juancash', suffix: 'JuanCash' },
  { label: 'LuLu', slug: 'lulu', suffix: 'LuLu' },
  { label: 'Maya', slug: 'maya', suffix: 'Maya' },
  { label: 'PalawanPay', slug: 'palawanpay', suffix: 'PalawanPay' },
  { label: 'ShopeePay', slug: 'shopeepay', suffix: 'ShopeePay' },
  { label: 'TayoCash', slug: 'tayocash', suffix: 'TayoCash' },
  { label: 'USSC', slug: 'ussc', suffix: 'USSC' },
];

test.describe('User-web FX — Philippines', () => {
  test('Sends a new FX transaction to Philippines via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — Bank Deposit test',
      countryCode: 'PH',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });
    const bankingData = {
      bankName: PH_BANK_NAME,
      bankCode: PH_BANK_CODE,
      swiftCode: PH_SWIFT_CODE,
      accountNumber: BIVO_PREFIX + generateRandomDigits(10), // 15 digits, matches the recorded length
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

    await test.step('Step 2 | Open Create FX Transaction, select Philippines, verify default recipient currency', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('PH');
      await fxPage.verifyDestinationCountryHeading('Philippines');
      await fxPage.verifyRecipientCurrencySelected('PHP');
    });

    await test.step('Step 3 | Deliver to Bank Deposit (default channel for Philippines)', async () => {
      await fxPage.verifyDeliverToSelected('Bank Deposit');
    });

    await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: '$25.00', rate: '$1 =58.6382' });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name + address only, no city/postal code)', async () => {
      await fxPage.addPhBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
      });
    });

    await test.step('Step 6 | Enter Bank Deposit banking details (bank name, bank code, SWIFT, account number)', async () => {
      await fxPage.enterPhBankDepositDetails(bankingData);
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
    test(`Sends a new FX transaction to Philippines via Mobile Wallet (${provider.label})`, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: `Sent from Bivo — Mobile Wallet ${provider.label} test`,
        countryCode: 'PH',
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

      await test.step('Step 2 | Open Create FX Transaction, select Philippines, verify default recipient currency', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('PH');
        await fxPage.verifyDestinationCountryHeading('Philippines');
        await fxPage.verifyRecipientCurrencySelected('PHP');
      });

      await test.step('Step 3 | Switch deliver-to from the Bank Deposit default to Mobile Wallet', async () => {
        await fxPage.verifyDeliverToSelected('Bank Deposit');
        await fxPage.selectDeliverToOption('Mobile Wallet');
      });

      await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: '$25.00', rate: '$1 =58.6382' });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add payee (name + address only, no city/postal code)', async () => {
        await fxPage.addPhBankDepositPayeeByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
        });
      });

      await test.step(`Step 6 | Select ${provider.label} and enter the wallet mobile number`, async () => {
        await fxPage.enterPhMobileWalletDetails({
          providerSlug: provider.slug,
          walletNumber: PH_MOBILE_WALLET_NUMBER,
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

  for (const provider of MOBILE_WALLET_ADDITIONAL_PROVIDERS) {
    test(`Sends a new FX transaction to Philippines via Mobile Wallet -Additional (${provider.label})`, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: `Sent from Bivo — Mobile Wallet -Additional ${provider.label} test`,
        countryCode: 'PH',
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

      await test.step('Step 2 | Open Create FX Transaction, select Philippines, verify default recipient currency', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('PH');
        await fxPage.verifyDestinationCountryHeading('Philippines');
        await fxPage.verifyRecipientCurrencySelected('PHP');
      });

      await test.step('Step 3 | Switch deliver-to from the Bank Deposit default to Mobile Wallet -Additional', async () => {
        await fxPage.verifyDeliverToSelected('Bank Deposit');
        await fxPage.selectDeliverToOption('Mobile Wallet -Additional');
      });

      await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: '$25.00', rate: '$1 =58.6382' });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add payee (name + address only, no city/postal code)', async () => {
        await fxPage.addPhBankDepositPayeeByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
        });
      });

      await test.step(`Step 6 | Select ${provider.label} and enter the wallet mobile number`, async () => {
        await fxPage.enterPhMobileWalletDetails({
          providerSlug: provider.slug,
          walletNumber: PH_MOBILE_WALLET_NUMBER,
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

  test('Sends a new FX transaction to Philippines via Instant Card Payout', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo — Instant Card Payout test',
      countryCode: 'PH',
    });
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
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

    await test.step('Step 2 | Open Create FX Transaction, select Philippines, verify default recipient currency', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('PH');
      await fxPage.verifyDestinationCountryHeading('Philippines');
      await fxPage.verifyRecipientCurrencySelected('PHP');
    });

    await test.step('Step 3 | Switch deliver-to from the Bank Deposit default to Instant Card Payout', async () => {
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.selectDeliverToOption('Instant Card Payout');
    });

    await test.step('Step 4 | Enter send amount and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      // Confirmed live: identical to Bank Deposit's summary at this amount.
      await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: '$25.00', rate: '$1 =58.6382' });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name + address only, no city/postal code)', async () => {
      await fxPage.addPhBankDepositPayeeByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
      });
    });

    await test.step('Step 6 | Link card and verify card-vault API', async () => {
      const { identifier } = await fxPage.linkCardAndCaptureApi(PH_INSTANT_CARD_PAYOUT_TEST_CARD);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
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
});
