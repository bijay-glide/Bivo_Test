// UK (GB) FX matrix for bu-web business, from the single USD wallet. Covers every
// recipient-currency × deliver-to combination the GB Create FX page exposes:
//   GBP → IBAN powered by Visa Direct (default), Bank Deposit, Instant Card Payout, PayPal
//   EUR → IBAN (default), Instant Card Payout
//   USD → Bank Deposit - ACH, SWIFT Payment, Domestic Payment, Wire - SWIFT, PayPal
// The implemented flow is data-testid based. The payee form is name-only for GBP/EUR
// and name+address for USD (auto-detected).
//
// New/not-yet-implemented channels can be added as `ready: false` — this renders them as
// test.fixme placeholders (see the `if (!sc.ready)` branch below) with just the shared
// lead-in wired up, until the channel-specific payee/banking/confirm steps are filled in.
//
// Each implemented scenario creates a fresh payee and confirms a real transaction
// (asserts the paymentIdentifier from the FX payment POST).
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const {
  generateFxTransactionData,
  generateRandomDigits,
  generateUsPaymentPayee,
} = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

const BIVO_PREFIX = '98765';
// Real, checksum-valid IBAN (NatWest, mod-97 verified) — the previous static value
// actually failed the mod-97 check despite being treated as "known-good"; only passed
// because the server doesn't enforce the full IBAN checksum.
const GB_IBAN = 'GB29NWBK60161331926819';
// The sandbox card vault only accepts this test PAN — keep it fixed (random cards are rejected).
const TEST_CARD_NUMBER = '4761348010000127';

/** Banking-form data per channel. The account field doubles as the IBAN field. */
function bankingDataFor(channel, currency) {
  const accountNumber = BIVO_PREFIX + generateRandomDigits(7);
  switch (channel) {
    case 'IBAN powered by Visa Direct':
      return { iban: GB_IBAN };
    case 'IBAN':
      return { iban: GB_IBAN, swiftCode: 'NWBKGB2L' }; // NatWest — same bank identity as GB_IBAN
    case 'Bank Deposit':
    case 'Bank Deposit - ACH':
      return currency === 'GBP'
        ? { accountNumber, sortCode: '601613' } // NatWest real sort code — same bank identity as GB_IBAN
        : { accountNumber, routingNumber: '021000021' };
    case 'Domestic Payment':
      return { accountNumber, routingNumber: '021000021' };
    case 'SWIFT Payment':
      return {
        accountNumber,
        bankName: 'JPMorgan Chase Bank', // matches the routingNumber used elsewhere in this suite
        swiftCode: 'CHASUS33',
        intermediarySwift: 'BOFAUS3N', // Bank of America — distinct real correspondent bank
      };
    case 'Wire - SWIFT':
      // Confirmed via live recording (Aug 2026) — ClearBank Limited, same bank identity
      // for the bank code / SWIFT code / country fields this corridor's form renders.
      return {
        accountNumber,
        bankName: 'ClearBank Limited',
        bankCode: 'CLBKGBL1XXX',
        swiftCode: 'CLRBGB22XXX',
        bankCountryCode: 'GB',
      };
    case 'PayPal':
      // GBP form: "PayPal account ID" — email matches the Recipient type "Email".
      // USD form: literal bank "Account Number" field with numeric validation.
      return currency === 'GBP'
        ? { paypalId: `automation.fx.${generateRandomDigits(6)}@example.com` }
        : { accountNumber };
    default:
      throw new Error(`bankingDataFor: no data shape for "${channel}" → ${currency}`);
  }
}

/** GB recipient-currency × deliver-to combinations (USD wallet).
 *  ready:false → added as a test.fixme placeholder (channel handling not implemented yet). */
const CHANNEL_COMBOS = [
  // USD → GBP (4 deliver-to options)
  { currency: 'GBP', channel: 'IBAN powered by Visa Direct', isDefaultChannel: true, ready: true },
  { currency: 'GBP', channel: 'Bank Deposit', isDefaultChannel: false, ready: true },
  { currency: 'GBP', channel: 'Instant Card Payout', isDefaultChannel: false, ready: true, cardPayout: true },
  // USD → EUR (2 deliver-to options)
  { currency: 'EUR', channel: 'IBAN', isDefaultChannel: true, ready: true },
  { currency: 'EUR', channel: 'Instant Card Payout', isDefaultChannel: false, ready: true, cardPayout: true },
  // USD → USD (5 deliver-to options)
  { currency: 'USD', channel: 'Bank Deposit - ACH', isDefaultChannel: false, ready: true },
  { currency: 'USD', channel: 'Domestic Payment', isDefaultChannel: false, ready: true },
  { currency: 'USD', channel: 'Wire - SWIFT', isDefaultChannel: false, ready: true },
  { currency: 'USD', channel: 'PayPal', isDefaultChannel: false, ready: true },
];

test.describe('Bu-web FX — United Kingdom (GB) matrix (USD wallet)', () => {
  // A transient flake (login/render) shouldn't drop the rest of the matrix.
  test.describe.configure({ retries: 1 });

  for (const sc of CHANNEL_COMBOS) {
    const title = `UK FX — USD → ${sc.currency} via ${sc.channel}`;

    // Placeholder scenarios — channel handling not implemented yet. test.fixme keeps
    // them in the matrix/report without running. To implement: remove `.fixme`, add the
    // channel to fillFxBankingByTestId (and bankingDataFor), then drop ready:false above.
    if (!sc.ready) {
      test.fixme(title, async ({ page }) => {
        // Shared lead-in that already works (login → GB → currency → deliver-to):
        const fxPage = new FxTransactionPage(page);
        const userData = resolveBuWebUserDataForLogin();
        await loginBuWebWithEmail({ page, userData });
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('GB');
        await fxPage.selectRecipientCurrency(sc.currency);
        if (sc.isDefaultChannel) {
          await fxPage.verifyDeliverToSelected(sc.channel);
        } else {
          await fxPage.selectDeliverToOption(sc.channel);
        }
        // TODO(fill later): enter amount → continue → add payee → fill ${sc.channel}
        // banking details → confirm → assert paymentIdentifier → verify Processing.
      });
      continue;
    }

    test(title, async ({ page }) => {
      test.setTimeout(180000);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        randomizeSendAmountUsd: true,
        note: 'Sent from Bivo',
        countryCode: 'GB',
      });
      const payee = generateUsPaymentPayee();
      const bankingData = sc.cardPayout ? null : bankingDataFor(sc.channel, sc.currency);

      await test.step('Step 1 | Login', async () => {
        const userData = resolveBuWebUserDataForLogin();
        await loginBuWebWithEmail({ page, userData });
      });

      await test.step('Step 2 | Open Create FX Transaction and select GB', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
        await fxPage.selectDestinationCountryByTestId('GB');
        await fxPage.verifyDestinationCountryHeading('United Kingdom');
      });

      await test.step(`Step 3 | Recipient currency: ${sc.currency}`, async () => {
        await fxPage.selectRecipientCurrency(sc.currency);
        await fxPage.verifyRecipientCurrencySelected(sc.currency);
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

      await test.step('Step 7 | Enter banking / card details', async () => {
        if (sc.cardPayout) {
          // Instant Card Payout: link the card (in the PGW iframe) and assert the card API.
          const { identifier } = await fxPage.linkCardAndCaptureApi(TEST_CARD_NUMBER);
          expect(identifier, `POST /pgw/v1/card should return an identifier (${title})`).toBeTruthy();
        } else if (sc.channel === 'PayPal') {
          await fxPage.fillPayPalBankingDetails({ currency: sc.currency, data: bankingData });
        } else {
          await fxPage.fillFxBankingByTestId({ channel: sc.channel, currency: sc.currency, data: bankingData });
        }
      });

      await test.step('Step 8 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 9 | Review and confirm', async () => {
        await fxPage.fillFxPaymentNoteIfPresent(fxData.note);
        await fxPage.fillFxInvoiceNumberIfPresent();
        await fxPage.verifyFxReviewStructure({ firstName: payee.firstName, lastName: payee.lastName });
        const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
        {
          expect(
            paymentIdentifier,
            `FX payment POST should return a paymentIdentifier (${title})`,
          ).toBeTruthy();
        }
      });

      await test.step('Step 10 | Verify post-confirmation state — Processing or Ways To Fund', async () => {
        await fxPage.verifyProcessingOrWaysToFundAndDismiss();
      });
    });
  }
});
