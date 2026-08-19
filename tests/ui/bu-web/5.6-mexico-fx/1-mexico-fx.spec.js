// Bu-web FX — Mexico. Ported from user-web's 5.6-mexico-fx. See
// tests/ui/user-web/5.6-mexico-fx/1-mexico-fx.spec.js for the original — this file
// swaps only the login helper (loginBuWebWithEmail instead of loginUserWebWithPhone)
// and how the primary account's last4 is resolved (via
// FxTransactionPage.discoverBivoPrimaryLast4, since loginBuWebWithEmail doesn't capture
// the account-info API response the way loginUserWebWithPhone does); all
// FxTransactionPage methods used are already shared cross-surface.
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { generateFxTransactionData, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

const SEND_AMOUNT_USD = '50';

// USD->MXN sandbox rate for a $50 send is pinned, not live-market — same convention as
// 5.5-india-fx's SEND_AMOUNT_SUMMARY, confirmed via the recorded session.
const SEND_AMOUNT_SUMMARY = { fee: '$0.49', exchangeAmount: '$49.51', rate: '$1 =17.7692' };

const RTP_CHANNEL = 'Bank Deposit - RTP';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as 5.4-uk-fx's BIVO_PREFIX / 5.5-india-fx's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

test.describe('Bu-web FX — Mexico', () => {
  test('Sends a new FX transaction to Mexico via Bank Deposit - RTP (USD funded)', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'MX',
    });
    const bankingData = { accountNumber: BIVO_PREFIX + generateRandomDigits(9) }; // 14 digits, matches recorded length

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

    await test.step('Step 2 | Open Create FX Transaction and select Mexico', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('MX');
      await fxPage.verifyDestinationCountryHeading('Mexico');
      await fxPage.verifyFromCurrencySelected('USD');
    });

    await test.step('Step 3 | Recipient currency MXN, verify recipient currency and deliver-to channel', async () => {
      await fxPage.selectRecipientCurrency('MXN');
      await fxPage.verifyRecipientCurrencySelected('MXN');
      await fxPage.verifyDeliverToSelected(RTP_CHANNEL);
    });

    await test.step('Step 4 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(SEND_AMOUNT_SUMMARY);
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (name-only)', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
    });

    await test.step('Step 6 | Enter RTP banking details', async () => {
      await fxPage.enterBankingDetailsByChannel({ channel: 'rtp', bankingDetails: bankingData });
    });

    await test.step('Step 7 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 8 | Fill note and confirm — asserts POST /international/payment', async () => {
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
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

  test('Sends a new FX transaction to Mexico via Bank Deposit - RTP (MXN funded from secondary wallet)', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    // amountUsd here just drives the typed digits (toCentsInput) — the FROM wallet is MXN
    // for this scenario, so the amount entered/debited is actually MXN, not USD.
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'MX',
    });
    const bankingData = { accountNumber: BIVO_PREFIX + generateRandomDigits(9) };

    let mxnWallet = null;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Discover the secondary MXN wallet', async () => {
      mxnWallet = await fxPage.discoverWalletByCurrency('MXN');
      console.log(`[mexico-fx] MXN wallet: "${mxnWallet.accountName}" (${mxnWallet.accountNumber}), last4: ${mxnWallet.last4}`);
    });

    await test.step('Step 3 | Open Create FX Transaction and select Mexico', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('MX');
      await fxPage.verifyDestinationCountryHeading('Mexico');
    });

    await test.step('Step 4 | Switch the "You send" FROM account to the MXN wallet', async () => {
      await fxPage.selectFromAccountByDdaLast4(mxnWallet.last4);
    });

    await test.step('Step 5 | Recipient currency MXN, verify recipient currency and deliver-to channel', async () => {
      await fxPage.selectRecipientCurrency('MXN');
      await fxPage.verifyRecipientCurrencySelected('MXN');
      await fxPage.verifyDeliverToSelected(RTP_CHANNEL);
    });

    await test.step('Step 6 | Enter send amount and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.continue();
    });

    await test.step('Step 7 | Add payee (name-only)', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
    });

    await test.step('Step 8 | Enter RTP banking details', async () => {
      await fxPage.enterBankingDetailsByChannel({ channel: 'rtp', bankingDetails: bankingData });
    });

    await test.step('Step 9 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    let paymentIdentifier = null;
    await test.step('Step 10 | Fill note and confirm — asserts POST /international/payment', async () => {
      await fxPage.fillFxPaymentNote(fxData.note);
      await fxPage.fillFxInvoiceNumberIfPresent();
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 11 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 12 | Navigate to the MXN wallet and verify the DEBIT transaction in the ledger', async () => {
      const { transactions } = await fxPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4: mxnWallet.last4,
        bivoAccountNumber: mxnWallet.accountNumber,
      });
      await fxPage.assertFxDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber: mxnWallet.accountNumber,
        paymentIdentifier,
        amountUsd: SEND_AMOUNT_USD,
        currencyCode: 'MXN',
      });
    });
  });
});
