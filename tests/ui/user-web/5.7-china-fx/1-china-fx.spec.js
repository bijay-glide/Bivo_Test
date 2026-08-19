// China FX — dedicated coverage beyond the generic 5.1-fx-multicountry loop, same pattern
// as 5.5-india-fx / 5.6-mexico-fx. Six delivery-channel scenarios across both recipient
// currencies (confirmed via live probe of the deliver-to dropdown for each currency):
//   CNH (default channel: Instant Card Payout): Instant Card Payout, Bank Deposit.
//   CNY (default channel: Alipay): Alipay, UnionPay, Bank Deposit, Instant Card Payout.
// Bank Deposit renders the identical 3-field form (bank name + account number + SWIFT)
// under both currencies. UnionPay is the odd one out: its payee-details screen collects
// an extra identity type + number (not the later "your identity type" step
// handleIdentityStepIfPresent covers), and its banking form's "bank name" is a searchable
// dropdown with a single fixed option ("UnionPay" itself, not an actual bank).
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateBankingDetails,
  generateRandomDigits,
} = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

const SEND_AMOUNT_USD = '50';

// Visa sandbox test card (BIN 476134) for the card-vault tokenization flow — the only
// number the sandbox vault accepts, same constant used by 5.5-india-fx.
const CN_TEST_CARD_NUMBER = '4761348010000127';

// Bank of China — real bank name + real SWIFT/BIC code, same "static real-world
// identifier" convention used throughout this suite. Reused for both Bank Deposit
// (as the actual bank name) and UnionPay (as a format-valid SWIFT code — UnionPay
// itself isn't SWIFT-network based, so there's no "real" UnionPay SWIFT to use).
const CN_BANK_NAME = 'Bank of China';
const CN_SWIFT_CODE = 'BKCHCNBJ';

const CN_UNIONPAY_IDENTITY_TYPE = 'Passport';

const SCENARIOS = [
  { currency: 'CNH', channel: 'Instant Card Payout', type: 'card' },
  { currency: 'CNH', channel: 'Bank Deposit', type: 'bank_deposit' },
  { currency: 'CNY', channel: 'Alipay', type: 'alipay' },
  { currency: 'CNY', channel: 'UnionPay', type: 'unionpay' },
  { currency: 'CNY', channel: 'Bank Deposit', type: 'bank_deposit' },
  { currency: 'CNY', channel: 'Instant Card Payout', type: 'card' },
];

// The 3 UnionPay identity-type scenarios bu-web's individual-payee file covers that the
// SCENARIOS loop above doesn't: the CNY/UnionPay entry above already exercises identity
// type Passport (via CN_UNIONPAY_IDENTITY_TYPE) — these 3 add the remaining options from
// the same dropdown (see the comment on addPayee's identityType handling in
// FxTransactionPage.js): Driver's License, National ID, Other. Each payee's last name is
// suffixed with the identity type purely so each run is identifiable in the test report /
// sandbox data, not a UI requirement — same convention as bu-web's file.
const ADDITIONAL_UNIONPAY_IDENTITY_TYPES = [
  { label: "Driver's License", suffix: 'DriverLicense' },
  { label: 'National ID', suffix: 'NationalID' },
  { label: 'Other', suffix: 'Other' },
];

test.describe('User-web FX — China', () => {
  for (const sc of SCENARIOS) {
    test(`Sends a new FX transaction to China via ${sc.channel} (${sc.currency} recipient currency)`, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: 'Sent from Bivo',
        countryCode: 'CN',
      });
      const payeeExtraFields =
        sc.type === 'unionpay'
          ? {
              ...fxData.payeeExtraFields,
              identityType: CN_UNIONPAY_IDENTITY_TYPE,
              identityNumber: `E${generateRandomDigits(8)}`,
            }
          : fxData.payeeExtraFields;

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

      await test.step('Step 2 | Open Create FX Transaction and select China', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('CN');
      });

      await test.step(`Step 3 | Recipient currency ${sc.currency}, deliver to ${sc.channel}`, async () => {
        await fxPage.selectRecipientCurrency(sc.currency);
        await fxPage.ensureDeliverToSelected(sc.channel);
      });

      await test.step('Step 4 | Enter send amount and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add payee', async () => {
        await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, payeeExtraFields);
      });

      await test.step(`Step 6 | Enter ${sc.channel} banking details`, async () => {
        if (sc.type === 'card') {
          const { identifier } = await fxPage.linkCardAndCaptureApi(CN_TEST_CARD_NUMBER);
          expect(identifier, 'card-vault POST should return an identifier').toBeTruthy();
        } else if (sc.type === 'bank_deposit') {
          await fxPage.enterBankingDetailsByChannel({
            channel: 'cn_bank_deposit',
            bankingDetails: {
              bankName: CN_BANK_NAME,
              accountNumber: generateRandomDigits(12),
              swiftCode: CN_SWIFT_CODE,
            },
          });
        } else if (sc.type === 'alipay') {
          await fxPage.enterBankingDetailsByChannel({ channel: 'alipay', bankingDetails: generateBankingDetails('CN') });
        } else if (sc.type === 'unionpay') {
          await fxPage.enterBankingDetailsByChannel({
            channel: 'unionpay',
            bankingDetails: { cardNumber: generateRandomDigits(16), swiftCode: CN_SWIFT_CODE },
          });
        }
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Review screen and note', async () => {
        await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);
        await fxPage.fillFxPaymentNote(fxData.note);
      });

      await test.step('Step 9 | Confirm transaction — asserts POST /international/payment', async () => {
        await fxPage.fillFxInvoiceNumberIfPresent();
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

  // 3 additional UnionPay identity-type scenarios — Passport is already covered by the
  // CNY/UnionPay entry in the SCENARIOS loop above; these cover the 3 remaining options.
  for (const idType of ADDITIONAL_UNIONPAY_IDENTITY_TYPES) {
    test(`Sends a new FX transaction to China via UnionPay with identity type: ${idType.label} (CNY recipient currency)`, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        amountUsd: SEND_AMOUNT_USD,
        note: `Sent from Bivo — UnionPay ${idType.label} test`,
        countryCode: 'CN',
      });
      const payeeExtraFields = {
        ...fxData.payeeExtraFields,
        identityType: idType.label,
        identityNumber: `E${generateRandomDigits(8)}`,
      };
      const lastName = `${fxData.beneficiaryLastName}${idType.suffix}`;

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

      await test.step('Step 2 | Open Create FX Transaction and select China', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('CN');
      });

      await test.step('Step 3 | Recipient currency CNY, deliver to UnionPay', async () => {
        await fxPage.selectRecipientCurrency('CNY');
        await fxPage.ensureDeliverToSelected('UnionPay');
      });

      await test.step('Step 4 | Enter send amount and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.continue();
      });

      await test.step(`Step 5 | Add payee with identity type: ${idType.label}`, async () => {
        await fxPage.addPayee(fxData.beneficiaryFirstName, lastName, payeeExtraFields);
      });

      await test.step('Step 6 | Enter UnionPay banking details', async () => {
        await fxPage.enterBankingDetailsByChannel({
          channel: 'unionpay',
          bankingDetails: { cardNumber: generateRandomDigits(16), swiftCode: CN_SWIFT_CODE },
        });
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Review screen and note', async () => {
        await fxPage.verifyReviewTransferScreenShowsName(`${fxData.beneficiaryFirstName} ${lastName}`);
        await fxPage.fillFxPaymentNote(fxData.note);
      });

      await test.step('Step 9 | Confirm transaction — asserts POST /international/payment', async () => {
        await fxPage.fillFxInvoiceNumberIfPresent();
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
});
