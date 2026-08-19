// UK FX full-matrix suite — every From-account × recipient-currency × deliver-to
// combination discovered on the GB Create FX page, including Instant Card Payout
// for GBP/EUR (see the two dedicated test() blocks below the matrix loop). Each
// scenario creates a fresh payee and confirms a real transaction (asserts
// paymentIdentifier from POST /international/payment).
//
// Matrix (identical for both From accounts — USD and GBP wallets):
//   → GBP: IBAN powered by Visa Direct (default), Bank Deposit, Instant Card Payout
//   → EUR: IBAN (default), Instant Card Payout
//   → USD: Bank Deposit - ACH, SWIFT Payment, Domestic Payment, PayPal
//
// PayPal → GBP is no longer a valid deliver-to option (removed from the app) and has been
// dropped from the matrix.
//
// Banking forms (probed June 2026):
//   IBAN powered by Visa Direct → IBAN number
//   Bank Deposit (→GBP)         → account number + sort code
//   IBAN (→EUR)                 → IBAN + SWIFT Code
//   Bank Deposit/Domestic (→USD)→ account number + routing number
//   SWIFT Payment (→USD)        → account number + bank name + SWIFT code (+ optional intermediary)
//   PayPal (→USD)               → recipient type "PayPal ID" + bank account number + wallet
//                                 (type "Email" enables Continue but the submit is a silent
//                                  no-op — suspected FE validation mismatch)
//
// Run: npm run test:ui:userweb:uk-fx   (LOGIN_PHONE_RAW selects the user)
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateRandomDigits,
  generateUsPaymentPayee,
} = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

// Static prefix keeps generated banking fields recognisable as automated test data.
const BIVO_PREFIX = '98765';
// Real, checksum-valid IBAN (NatWest, mod-97 verified) — the previous static value
// actually failed the mod-97 check despite the "known-good" comment; only passed
// because the server doesn't enforce the full IBAN checksum.
const GB_IBAN = 'GB29NWBK60161331926819';

/** Channel-specific banking-details data. Keyed by channel + recipient currency. */
function bankingDataFor(channel, currency) {
  if (channel === 'IBAN powered by Visa Direct') {
    return { iban: GB_IBAN };
  }
  if (channel === 'IBAN') {
    return { iban: GB_IBAN, swiftCode: 'NWBKGB2L' }; // NatWest — same bank identity as GB_IBAN
  }
  if (channel === 'Bank Deposit' && currency === 'GBP') {
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7), // 12 digits
      sortCode: '601613', // NatWest real sort code — same bank identity as GB_IBAN
    };
  }
  if ((channel === 'Bank Deposit' || channel === 'Bank Deposit - ACH' || channel === 'Domestic Payment') && currency === 'USD') {
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7),
      routingNumber: '021000021', // valid ABA routing — same as wire specs
    };
  }
  if (channel === 'SWIFT Payment') {
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7),
      bankName: 'JPMorgan Chase Bank', // matches the routingNumber used elsewhere in this suite
      swiftCode: 'CHASUS33',
      intermediarySwift: 'BOFAUS3N', // Bank of America — distinct real correspondent bank
    };
  }
  if (channel === 'PayPal' && currency === 'USD') {
    // USD form: literal bank "Account Number" field with numeric validation.
    return { accountNumber: BIVO_PREFIX + generateRandomDigits(7) };
  }
  if (channel === 'Wire - SWIFT') {
    // Confirmed via live recording (Aug 2026) — ClearBank Limited, same bank identity
    // for the bank code / SWIFT code / country fields this corridor's form renders.
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7),
      bankName: 'ClearBank Limited',
      bankCode: 'CLBKGBL1XXX',
      swiftCode: 'CLRBGB22XXX',
      bankCountryCode: 'GB',
    };
  }
  throw new Error(`bankingDataFor: no data shape for "${channel}" → ${currency}`);
}

/**
 * The 14 scenarios: 2 From accounts × 7 non-card channel combos.
 * isDefaultChannel=true → only verify the pre-selected deliver-to button;
 * false → open the dropdown and pick via deliver-to-option-{label}.
 */
const CHANNEL_COMBOS = [
  { currency: 'GBP', channel: 'IBAN powered by Visa Direct', isDefaultChannel: true },
  { currency: 'GBP', channel: 'Bank Deposit', isDefaultChannel: false },
  { currency: 'EUR', channel: 'IBAN', isDefaultChannel: true },
  { currency: 'USD', channel: 'Bank Deposit - ACH', isDefaultChannel: false },
  { currency: 'USD', channel: 'Wire - SWIFT', isDefaultChannel: false },
  { currency: 'USD', channel: 'Domestic Payment', isDefaultChannel: false },
  { currency: 'USD', channel: 'PayPal', isDefaultChannel: false },
];

// Send only from the USD wallet (mirrors bu-web 1.9), covering every recipient-currency ×
// deliver-to combination. The onboarded user holds only a USD wallet; GBP/EUR-source
// coverage would require provisioning extra wallets and is intentionally out of scope.
const SCENARIOS = CHANNEL_COMBOS.map((combo) => ({ fromCurrency: 'USD', ...combo }));

test.describe('User-web FX — United Kingdom (GB) full matrix', () => {
  // Default mode (not serial): a transient failure (e.g. login flake) doesn't skip
  // the rest of the matrix. retries:1 re-runs only the flaked test.
  test.describe.configure({ retries: 1 });

  for (const sc of SCENARIOS) {
    const title = `UK FX — ${sc.fromCurrency} → ${sc.currency} via ${sc.channel}`;
    test(title, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        randomizeSendAmountUsd: true,
        note: 'Sent from Bivo',
        countryCode: 'GB',
      });
      // Address fields used when the payee form is the extended (name+address) variant,
      // e.g. USD-recipient channels. addPayeeAutoByTestId fills them only if present.
      const payee = generateUsPaymentPayee({
        firstName: fxData.beneficiaryFirstName,
        lastName: fxData.beneficiaryLastName,
      });
      const bankingData = bankingDataFor(sc.channel, sc.currency);

      await test.step('Step 1 | Login', async () => {
        const userData = resolveUserDataForLogin();
        await loginUserWebWithPhone({ page, request, userData });
      });

      await test.step('Step 2 | Open Create FX Transaction and select GB', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('GB');
      });

      // From account is always the default USD wallet (USD-source matrix), so no switch needed.

      await test.step(`Step 3 | Recipient currency: ${sc.currency}`, async () => {
        await fxPage.selectRecipientCurrency(sc.currency);
      });

      await test.step(`Step 4 | Deliver to: ${sc.channel}`, async () => {
        if (sc.isDefaultChannel) {
          await fxPage.verifyDeliverToSelected(sc.channel);
        } else {
          await fxPage.selectDeliverToOption(sc.channel);
        }
      });

      await test.step('Step 5 | Enter send amount and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        if (sc.channel === 'Wire - SWIFT') {
          // USD → USD is a 1:1 corridor: no fee, exchange amount matches the sent amount.
          await fxPage.verifySendMoneySummary({ fee: '$0.00', exchangeAmount: fxData.amount, rate: '$1 =1' });
        }
        await fxPage.continue();
      });

      await test.step('Step 6 | Add payee (name-only for GBP/EUR, name+address for USD)', async () => {
        await fxPage.addPayeeAutoByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
          city: payee.city,
          state: payee.state,
          postalCode: payee.postalCode,
        });
      });

      await test.step('Step 7 | Enter banking details', async () => {
        if (sc.channel === 'PayPal') {
          await fxPage.fillPayPalBankingDetails({ currency: sc.currency, data: bankingData });
        } else {
          await fxPage.fillFxBankingByTestId({ channel: sc.channel, currency: sc.currency, data: bankingData });
        }
      });

      await test.step('Step 8 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 9 | Fill note and confirm — assert paymentIdentifier returned', async () => {
        await fxPage.fillFxPaymentNote(fxData.note);
        await fxPage.fillFxInvoiceNumberIfPresent();
        const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
        expect(
          paymentIdentifier,
          `POST /remittance/v1/international/payment should return a paymentIdentifier (${title})`,
        ).toBeTruthy();
      });

      await test.step('Step 10 | Verify post-confirmation state — Processing or Ways To Fund', async () => {
        // Shows either "Processing Transaction" (wallet has sufficient balance) or "Ways To
        // Fund" (balance low — app asks for a funding source). Both confirm the transaction
        // was accepted; the paymentIdentifier assertion in step 9 is the definitive check.
        await fxPage.verifyProcessingOrWaysToFundAndDismiss();
      });
    });
  }

  // Instant Card Payout — confirmed as a real, wanted addition (previously out of scope).
  // Unlike the channel matrix above, this deliver-to option links a test card (in the PGW
  // iframe) instead of filling banking-details fields, so it's kept as its own test() rather
  // than folded into CHANNEL_COMBOS / bankingDataFor.
  // The sandbox card vault only accepts this test PAN — keep it fixed (random cards are rejected).
  const TEST_CARD_NUMBER = '4761348010000127';

  for (const cardCurrency of ['GBP', 'EUR']) {
    const cardTitle = `UK FX — USD → ${cardCurrency} via Instant Card Payout`;
    test(cardTitle, async ({ page, request }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        randomizeSendAmountUsd: true,
        note: 'Sent from Bivo',
        countryCode: 'GB',
      });
      const payee = generateUsPaymentPayee({
        firstName: fxData.beneficiaryFirstName,
        lastName: fxData.beneficiaryLastName,
      });

      await test.step('Step 1 | Login', async () => {
        const userData = resolveUserDataForLogin();
        await loginUserWebWithPhone({ page, request, userData });
      });

      await test.step('Step 2 | Open Create FX Transaction and select GB', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('GB');
      });

      await test.step(`Step 3 | Recipient currency: ${cardCurrency}`, async () => {
        await fxPage.selectRecipientCurrency(cardCurrency);
      });

      await test.step('Step 4 | Deliver to: Instant Card Payout', async () => {
        await fxPage.selectDeliverToOption('Instant Card Payout');
      });

      await test.step('Step 5 | Enter send amount and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.continue();
      });

      await test.step('Step 6 | Add payee (name-only)', async () => {
        await fxPage.addPayeeAutoByTestId({
          firstName: payee.firstName,
          lastName: payee.lastName,
          addressOne: payee.addressOne,
          city: payee.city,
          state: payee.state,
          postalCode: payee.postalCode,
        });
      });

      await test.step('Step 7 | Link card details', async () => {
        const { identifier } = await fxPage.linkCardAndCaptureApi(TEST_CARD_NUMBER);
        expect(identifier, `POST /pgw/v1/card should return an identifier (${cardTitle})`).toBeTruthy();
      });

      await test.step('Step 8 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 9 | Fill note and confirm — assert paymentIdentifier returned', async () => {
        await fxPage.fillFxPaymentNote(fxData.note);
        await fxPage.fillFxInvoiceNumberIfPresent();
        const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
        expect(
          paymentIdentifier,
          `POST /remittance/v1/international/payment should return a paymentIdentifier (${cardTitle})`,
        ).toBeTruthy();
      });

      await test.step('Step 10 | Verify post-confirmation state — Processing or Ways To Fund', async () => {
        await fxPage.verifyProcessingOrWaysToFundAndDismiss();
      });
    });
  }
});
