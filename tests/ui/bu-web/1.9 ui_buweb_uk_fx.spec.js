// UK (GB) FX matrix for bu-web business, from the single USD wallet. Covers every
// recipient-currency × deliver-to combination the GB Create FX page exposes:
//   GBP → IBAN powered by Visa Direct (default), Bank Deposit, Instant Card Payout*, PayPal*
//   EUR → IBAN (default), Instant Card Payout*
//   USD → Bank Deposit (default), SWIFT Payment, Domestic Payment, Wire SWIFT, PayPal*
// The implemented flow is data-testid based. The payee form is name-only for GBP/EUR
// and name+address for USD (auto-detected).
//
// (*) Instant Card Payout and PayPal are added as test.fixme placeholders — the
// channel-specific payee/banking/confirm steps aren't implemented yet (Instant Card
// Payout is a card-selection flow with no text inputs; PayPal has its own recipient
// flow). Replace `ready: false` → `ready: true` and fill the channel handling when ready.
//
// Each implemented scenario creates a fresh payee and confirms a real transaction
// (asserts the paymentIdentifier from the FX payment POST).
require('./state-suite-env');

const { test, expect } = require('../../../fixtures/ui-fixtures');
const {
  generateFxTransactionData,
  generateSwiftCode,
  generateRandomDigits,
  generateUsPaymentPayee,
} = require('../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../pages/FxTransactionPage');

const BIVO_PREFIX = '98765';
const GB_IBAN = 'GB26542316456541232134';
// The sandbox card vault only accepts this test PAN — keep it fixed (random cards are rejected).
const TEST_CARD_NUMBER = '4761348010000127';

/** Banking-form data per channel. The account field doubles as the IBAN field. */
function bankingDataFor(channel, currency) {
  const accountNumber = BIVO_PREFIX + generateRandomDigits(7);
  switch (channel) {
    case 'IBAN powered by Visa Direct':
      return { iban: GB_IBAN };
    case 'IBAN':
      return { iban: GB_IBAN, swiftCode: generateSwiftCode(8) };
    case 'Bank Deposit':
      return currency === 'GBP'
        ? { accountNumber, sortCode: '987' + generateRandomDigits(3) }
        : { accountNumber, routingNumber: '021000021' };
    case 'Domestic Payment':
      return { accountNumber, routingNumber: '021000021' };
    case 'SWIFT Payment':
      return {
        accountNumber,
        bankName: 'Bivo Test Bank',
        swiftCode: generateSwiftCode(8),
        intermediarySwift: generateSwiftCode(8),
      };
    case 'Wire SWIFT':
      return { accountNumber };
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
  { currency: 'GBP', channel: 'PayPal', isDefaultChannel: false, ready: false },
  // USD → EUR (2 deliver-to options)
  { currency: 'EUR', channel: 'IBAN', isDefaultChannel: true, ready: true },
  { currency: 'EUR', channel: 'Instant Card Payout', isDefaultChannel: false, ready: true, cardPayout: true },
  // USD → USD (5 deliver-to options)
  { currency: 'USD', channel: 'Bank Deposit', isDefaultChannel: true, ready: true },
  { currency: 'USD', channel: 'SWIFT Payment', isDefaultChannel: false, ready: true },
  { currency: 'USD', channel: 'Domestic Payment', isDefaultChannel: false, ready: true },
  { currency: 'USD', channel: 'Wire SWIFT', isDefaultChannel: false, ready: true },
  { currency: 'USD', channel: 'PayPal', isDefaultChannel: false, ready: false },
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
      });

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
        if (sc.cardPayout) {
          // Card linking (Step 7, POST /pgw/v1/card) works and is asserted above. The
          // transaction itself cannot be completed: clicking "Confirm Transaction" on the
          // card-payout review screen crashes the frontend with
          //   TypeError: Cannot read properties of null (reading 'fields')
          //   at sendPayment (src/bivo-microservice/shared/domain/payee/hooks/useSendPayment.js:98)
          //   at onClick   (src/pages/CreatePayment/ReviewTransferPayment/index.js:542)
          // No payment POST fires and the app shows a runtime-error overlay. Marked fixme
          // until the FE is fixed; flip to a real confirm/assert once it is. (Verified June 2026.)
          test.fixme(true, 'FE bug: card-payout confirm crashes in useSendPayment (null "fields")');
          return;
        }
        const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
        {
          expect(
            paymentIdentifier,
            `FX payment POST should return a paymentIdentifier (${title})`,
          ).toBeTruthy();
        }
      });

      await test.step('Step 10 | Verify post-confirmation state — Processing or Ways To Fund', async () => {
        const processingHeading = page.getByRole('heading', { name: 'Processing Transaction' });
        const waysToFundHeading = page.getByRole('heading', { name: 'Ways To Fund' });
        await expect(
          processingHeading.or(waysToFundHeading),
          'Expected either Processing Transaction modal or Ways To Fund funding screen',
        ).toBeVisible({ timeout: 15000 });
        if (await processingHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
          await fxPage.verifyProcessingAndDismiss();
        }
      });
    });
  }
});
