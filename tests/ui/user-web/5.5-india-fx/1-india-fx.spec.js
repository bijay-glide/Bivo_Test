// India FX — dedicated coverage beyond the generic 5.1-fx-multicountry loop, the same
// way 5.3-uk-fx gives the UK its own scenario suite. Five delivery channels for the same
// India destination: four via the default INR recipient currency, each with a
// brand-new payee — Bank Deposit (IFSC), UPI, Instant Card Payout, and Cash Pickup —
// plus a USD-recipient scenario (International - SWIFT), mirroring 5.3-uk-fx's
// GB->USD/Wire-SWIFT scenario. Further India-specific scenarios (saved payee reuse,
// invoice-number handling, etc.) belong alongside these as the suite grows.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateBankingDetails,
  generateUsPaymentPayee,
  generateRandomDigits,
} = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

const SEND_AMOUNT_USD = '50';

// USD->INR sandbox rate for a $50 send is pinned, not live-market — confirmed identical
// across three separately recorded sessions (IFSC, UPI, Instant Card Payout channels).
const SEND_AMOUNT_SUMMARY = { fee: '$0.99', exchangeAmount: '$49.01', rate: '$1 =89.8' };

// Razorpay UPI sandbox "always succeeds" test ID — must stay static like the IFSC
// code above, not faker-generated (it's a fixed sandbox value, not a real account).
const IN_TEST_UPI_ID = 'success@razorpay';

// Visa sandbox test card (BIN 476134) for the card-vault tokenization flow — a fixed
// sandbox value, not a real card, so it stays static rather than faker-generated.
const IN_TEST_CARD_NUMBER = '4761348010000127';

// Label/testid for the USD-recipient SWIFT channel — double space is the FE's actual
// rendered testid ("International  - SWIFT"), confirmed via live recording, not a typo.
const IN_SWIFT_CHANNEL = 'International  - SWIFT';

// State Bank of India — real bank name + real SWIFT/BIC code, same "static real-world
// identifier" convention as the IFSC code, UPI ID, and test card number above.
const IN_SWIFT_BANK_NAME = 'State Bank of India';
const IN_SWIFT_CODE = 'SBININBBXXX';
const IN_SWIFT_COUNTRY_CODE = 'IN';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as 5.3-uk-fx's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

// US Payment - Wire / US Payment - ACH (India, USD recipient currency) share the same
// banking-form shape: account number + bank name + routing number. Bank identity matches
// the one already used for UK's SWIFT Payment channel (JPMorgan Chase, real ABA routing).
const US_PAYMENT_BANK_NAME = 'JPMorgan Chase Bank';
const US_PAYMENT_ROUTING_NUMBER = '021000021';

test.describe('User-web FX — India', () => {
  test('Sends a new FX transaction to a new India payee via Bank Deposit (IFSC)', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'IN',
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

    await test.step('Step 2 | Open Create FX Transaction and select India', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.verifyFromCurrencySelected('USD');
      await fxPage.verifyRecipientCurrencySelected('INR');
    });

    await test.step('Step 3 | Enter send amount, verify summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(SEND_AMOUNT_SUMMARY);
      await fxPage.verifyDeliverToSelected('Bank Deposit');
      await fxPage.continue();
    });

    await test.step('Step 4 | Add payee', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
    });

    await test.step('Step 5 | Enter IFSC banking details', async () => {
      const bankingDetails = generateBankingDetails('IN');
      await fxPage.enterBankingDetailsByChannel({ channel: 'ifsc', bankingDetails });
    });

    await test.step('Step 6 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 7 | Review screen and note', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
      await fxPage.verifyFxReviewTransferScreen(fxData);
      await fxPage.fillFxPaymentNote(fxData.note);
    });

    await test.step('Step 8 | Confirm transaction — asserts POST /international/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 9 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      // The dashboard's "Account Transactions" widget only shows the ~2 most recent
      // items, which races against the other channels' parallel sends and can evict
      // this one before we check — not just delayed, genuinely gone. Step 10's ledger
      // check queries the full transactions API (uncapped), so that's the real
      // verification; this step only confirms the payment was accepted.
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

  test('Sends a new FX transaction to a new India payee via UPI', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'IN',
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

    await test.step('Step 2 | Open Create FX Transaction and select India', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.verifyFromCurrencySelected('USD');
      await fxPage.verifyRecipientCurrencySelected('INR');
    });

    await test.step('Step 3 | Switch delivery channel to UPI, enter send amount, verify summary, and continue', async () => {
      await fxPage.selectDeliverToOption('UPI');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(SEND_AMOUNT_SUMMARY);
      await fxPage.continue();
    });

    await test.step('Step 4 | Add payee', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
    });

    await test.step('Step 5 | Enter UPI ID', async () => {
      await fxPage.enterBankingDetailsByChannel({ channel: 'upi', bankingDetails: { upiId: IN_TEST_UPI_ID } });
    });

    await test.step('Step 6 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 7 | Review screen and note', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
      await fxPage.verifyFxReviewTransferScreen(fxData);
      await fxPage.fillFxPaymentNote(fxData.note);
    });

    await test.step('Step 8 | Confirm transaction — asserts POST /international/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 9 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      // The dashboard's "Account Transactions" widget only shows the ~2 most recent
      // items, which races against the other channels' parallel sends and can evict
      // this one before we check — not just delayed, genuinely gone. Step 10's ledger
      // check queries the full transactions API (uncapped), so that's the real
      // verification; this step only confirms the payment was accepted.
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

  test('Sends a new FX transaction to a new India payee via Instant Card Payout', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'IN',
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

    await test.step('Step 2 | Open Create FX Transaction and select India', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.verifyFromCurrencySelected('USD');
      await fxPage.verifyRecipientCurrencySelected('INR');
    });

    await test.step('Step 3 | Switch delivery channel to Instant Card Payout, enter send amount, verify summary, and continue', async () => {
      await fxPage.selectDeliverToOption('Instant Card Payout');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(SEND_AMOUNT_SUMMARY);
      await fxPage.continue();
    });

    await test.step('Step 4 | Add payee', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
    });

    await test.step('Step 5 | Link card and verify card-vault API', async () => {
      const { identifier } = await fxPage.linkCardAndCaptureApi(IN_TEST_CARD_NUMBER);
      expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
    });

    await test.step('Step 6 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 7 | Review screen and note', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
      await fxPage.verifyFxReviewTransferScreen(fxData);
      await fxPage.fillFxPaymentNote(fxData.note);
    });

    await test.step('Step 8 | Confirm transaction — asserts POST /international/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 9 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      // The dashboard's "Account Transactions" widget only shows the ~2 most recent
      // items, which races against the other channels' parallel sends and can evict
      // this one before we check — not just delayed, genuinely gone. Step 10's ledger
      // check queries the full transactions API (uncapped), so that's the real
      // verification; this step only confirms the payment was accepted.
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

  test('Sends a new FX transaction to a new India payee via Cash Pickup', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'IN',
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

    await test.step('Step 2 | Open Create FX Transaction and select India', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
      await fxPage.verifyFromCurrencySelected('USD');
      await fxPage.verifyRecipientCurrencySelected('INR');
    });

    await test.step('Step 3 | Switch delivery channel to Cash Pickup, enter send amount, verify summary, and continue', async () => {
      await fxPage.selectDeliverToOption('Cash Pickup');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary(SEND_AMOUNT_SUMMARY);
      await fxPage.continue();
    });

    await test.step('Step 4 | Add payee', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
    });

    await test.step('Step 5 | Enter Cash Pickup pickup mobile number', async () => {
      await fxPage.enterBankingDetailsByChannel({
        channel: 'cash_pickup',
        bankingDetails: { phone: fxData.payeeExtraFields.phone },
      });
    });

    await test.step('Step 6 | Identity verification if present', async () => {
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
    });

    await test.step('Step 7 | Review screen and note', async () => {
      await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
      await fxPage.verifyFxReviewTransferScreen(fxData);
      await fxPage.fillFxPaymentNote(fxData.note);
    });

    await test.step('Step 8 | Confirm transaction — asserts POST /international/payment', async () => {
      const captured = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      paymentIdentifier = captured.paymentIdentifier;
      expect(paymentIdentifier, 'transaction should return a paymentIdentifier').toBeTruthy();
    });

    await test.step('Step 9 | Verify processing modal or Ways To Fund, then dismiss', async () => {
      // The dashboard's "Account Transactions" widget only shows the ~2 most recent
      // items, which races against the other channels' parallel sends and can evict
      // this one before we check — not just delayed, genuinely gone. Step 10's ledger
      // check queries the full transactions API (uncapped), so that's the real
      // verification; this step only confirms the payment was accepted.
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

  test('Sends a new FX transaction to India via International - SWIFT (USD recipient currency)', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({
      amountUsd: SEND_AMOUNT_USD,
      note: 'Sent from Bivo',
      countryCode: 'IN',
    });
    // Extended payee form (name + address + city + state + postal code) — same shape as
    // 5.3-uk-fx's USD-recipient channels, filled via addPayeeAutoByTestId.
    const payee = generateUsPaymentPayee({
      firstName: fxData.beneficiaryFirstName,
      lastName: fxData.beneficiaryLastName,
    });
    const bankingData = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(8), // 13 digits, matches the recorded value's length
      bankName: IN_SWIFT_BANK_NAME,
      swiftCode: IN_SWIFT_CODE,
      bankCountryCode: IN_SWIFT_COUNTRY_CODE,
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

    await test.step('Step 2 | Open Create FX Transaction and select India', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('IN');
    });

    await test.step('Step 3 | Switch recipient currency to USD (defaults to International - SWIFT)', async () => {
      await fxPage.selectRecipientCurrency('USD');
      await fxPage.verifyDeliverToSelected(IN_SWIFT_CHANNEL);
    });

    await test.step('Step 4 | Enter send amount, verify 1:1 USD->USD summary, and continue', async () => {
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: fxData.amount, rate: '$1 =1' });
      await fxPage.continue();
    });

    await test.step('Step 5 | Add payee (extended: name + address + city + state + postal code)', async () => {
      await fxPage.addPayeeAutoByTestId({
        firstName: payee.firstName,
        lastName: payee.lastName,
        addressOne: payee.addressOne,
        city: payee.city,
        state: payee.state,
        postalCode: payee.postalCode,
      });
    });

    await test.step('Step 6 | Enter SWIFT banking details', async () => {
      await fxPage.fillFxBankingByTestId({ channel: IN_SWIFT_CHANNEL, currency: 'USD', data: bankingData });
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

  // US Payment - Wire / US Payment - ACH / PayPal — the 3 other deliver-to options
  // available under India's USD recipient currency, alongside International - SWIFT
  // (confirmed via a live probe of the deliver-to dropdown). Same overall structure as
  // the SWIFT scenario above: extended payee form, channel-specific banking details,
  // payment-API capture, and the account-ledger DEBIT check.
  const USD_CHANNELS = [
    {
      channel: 'US Payment - Wire',
      bankingData: () => ({
        accountNumber: BIVO_PREFIX + generateRandomDigits(8),
        bankName: US_PAYMENT_BANK_NAME,
        routingNumber: US_PAYMENT_ROUTING_NUMBER,
      }),
    },
    {
      channel: 'US Payment - ACH',
      // Duplicated in the deliver-to dropdown (a real FE bug) — selected via
      // fxPage.selectDuplicatedDeliverToOption instead of fxPage.selectDeliverToOption.
      duplicatedInDropdown: true,
      bankingData: () => ({
        accountNumber: BIVO_PREFIX + generateRandomDigits(8),
        bankName: US_PAYMENT_BANK_NAME,
        routingNumber: US_PAYMENT_ROUTING_NUMBER,
      }),
    },
    {
      channel: 'PayPal',
      bankingData: () => ({ walletId: `bivo-test-${generateRandomDigits(8)}` }),
    },
  ];

  for (const { channel, bankingData, duplicatedInDropdown } of USD_CHANNELS) {
    test(`Sends a new FX transaction to India via ${channel} (USD recipient currency)`, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: 'Sent from Bivo',
        countryCode: 'IN',
      });
      const payee = generateUsPaymentPayee({
        firstName: fxData.beneficiaryFirstName,
        lastName: fxData.beneficiaryLastName,
      });
      const data = bankingData();

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

      await test.step('Step 2 | Open Create FX Transaction and select India', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('IN');
      });

      await test.step(`Step 3 | Switch recipient currency to USD, select ${channel}`, async () => {
        await fxPage.selectRecipientCurrency('USD');
        if (duplicatedInDropdown) {
          await fxPage.selectDuplicatedDeliverToOption(channel);
        } else {
          await fxPage.selectDeliverToOption(channel);
        }
      });

      await test.step('Step 4 | Enter send amount, verify 1:1 USD->USD summary, and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: fxData.amount, rate: '$1 =1' });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add payee (extended: name + address + city + state + postal code)', async () => {
        await fxPage.addPayeeAutoByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
          city: payee.city,
          state: payee.state,
          postalCode: payee.postalCode,
        });
      });

      await test.step(`Step 6 | Enter ${channel} banking details`, async () => {
        await fxPage.fillFxBankingByTestId({ channel, currency: 'USD', data });
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
  }
});
