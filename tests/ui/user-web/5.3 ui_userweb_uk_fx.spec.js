// UK FX full-matrix suite — every From-account × recipient-currency × deliver-to
// combination discovered on the GB Create FX page, EXCEPT Instant Card Payout
// (card flows are out of scope). Each scenario creates a fresh payee and confirms
// a real transaction (asserts paymentIdentifier from POST /international/payment).
//
// Matrix (identical for both From accounts — USD and GBP wallets):
//   → GBP: IBAN powered by Visa Direct (default), Bank Deposit, PayPal     [Instant Card Payout skipped]
//   → EUR: IBAN (default)                                                  [Instant Card Payout skipped]
//   → USD: Bank Deposit (default), SWIFT Payment, Domestic Payment, PayPal
//
// Banking forms (probed June 2026):
//   IBAN powered by Visa Direct → IBAN number
//   Bank Deposit (→GBP)         → account number + sort code
//   IBAN (→EUR)                 → IBAN + SWIFT Code
//   Bank Deposit/Domestic (→USD)→ account number + routing number
//   SWIFT Payment (→USD)        → account number + bank name + SWIFT code (+ optional intermediary)
//   PayPal (→GBP)               → recipient type "Email" + PayPal account ID (email) + wallet
//   PayPal (→USD)               → recipient type "PayPal ID" + bank account number + wallet
//                                 (type "Email" enables Continue but the submit is a silent
//                                  no-op — suspected FE validation mismatch)
//
// Run: npm run test:ui:userweb:uk-fx   (LOGIN_PHONE_RAW selects the user)
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateSwiftCode,
  generateRandomDigits,
  generateUsPaymentPayee,
} = require('../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../pages/FxTransactionPage');

// Static prefix keeps generated banking fields recognisable as automated test data.
const BIVO_PREFIX = '98765';
// IBAN check digits are validated — keep the known-good static value (same as 1.8).
const GB_IBAN = 'GB26542316456541232134';

/** Channel-specific banking-details data. Keyed by channel + recipient currency. */
function bankingDataFor(channel, currency) {
  if (channel === 'IBAN powered by Visa Direct') {
    return { iban: GB_IBAN };
  }
  if (channel === 'IBAN') {
    return { iban: GB_IBAN, swiftCode: generateSwiftCode(8) };
  }
  if (channel === 'Bank Deposit' && currency === 'GBP') {
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7), // 12 digits
      sortCode: '987' + generateRandomDigits(3),            // 6 digits
    };
  }
  if ((channel === 'Bank Deposit' || channel === 'Domestic Payment') && currency === 'USD') {
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7),
      routingNumber: '021000021', // valid ABA routing — same as wire specs
    };
  }
  if (channel === 'SWIFT Payment') {
    return {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7),
      bankName: 'Bivo Test Bank',
      swiftCode: generateSwiftCode(8),
      intermediarySwift: generateSwiftCode(8), // optional intermediary-bank SWIFT field
    };
  }
  if (channel === 'PayPal' && currency === 'GBP') {
    // GBP form: "PayPal account ID" — email matches the Recipient type "Email".
    return { paypalId: `automation.fx.${generateRandomDigits(6)}@example.com` };
  }
  if (channel === 'PayPal' && currency === 'USD') {
    // USD form: literal bank "Account Number" field with numeric validation.
    return { accountNumber: BIVO_PREFIX + generateRandomDigits(7) };
  }
  throw new Error(`bankingDataFor: no data shape for "${channel}" → ${currency}`);
}

/** Fills the channel's banking form (screen after the payee step) and continues. */
async function fillBankingDetails(page, fxPage, channel, currency, data) {
  // Non-PayPal channels share the data-testid banking form (addpayeeaddress-*), the same
  // one bu-web fills via fillFxBankingByTestId. Using testids keeps it robust against the
  // label/placeholder drift that previously left fields unfilled and Continue disabled.
  if (channel !== 'PayPal') {
    await fxPage.fillFxBankingByTestId({ channel, currency, data });
    return;
  }
  if (channel === 'PayPal') {
    // Two dropdowns + one value field. Options render as <a> in a dropdown menu.
    // GBP: "PayPal account ID" (email).  USD: "Enter account number" (numeric bank account).
    // Dropdowns FIRST, value field LAST — filling before the dropdowns leaves the
    // field validation stale and Continue can stay disabled past the assert timeout.
    // GBP uses "Email"; USD uses "PayPal ID" — with type=Email the USD form enables
    // Continue but the click never submits (suspected FE validation mismatch).
    const recipientType = currency === 'GBP' ? /^Email$/ : /^PayPal ID$/;
    await page.getByRole('button', { name: 'PayPal recipient type' }).click();
    await page.locator('a').filter({ hasText: recipientType }).first().click();
    await page.getByRole('button', { name: 'PayPal or Venmo' }).click();
    await page.locator('a').filter({ hasText: /^PayPal$/ }).first().click();

    const idInput = currency === 'GBP'
      ? page.getByRole('textbox', { name: 'PayPal account ID' })
      : page.getByRole('textbox', { name: 'Enter account number' });
    const idValue = currency === 'GBP' ? data.paypalId : data.accountNumber;
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    for (let i = 0; i < 3; i++) {
      await idInput.fill(idValue);
      if (await continueBtn.isEnabled({ timeout: 4000 }).catch(() => false)) break;
      await idInput.fill('');
      await page.waitForTimeout(400);
    }
    // The first Continue click can be swallowed by a re-render after wallet
    // selection — click until the form actually leaves the screen.
    for (let i = 0; i < 3; i++) {
      await fxPage.continue();
      const left = await idInput
        .waitFor({ state: 'hidden', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (left) break;
    }
    return;
  }
  throw new Error(`fillBankingDetails: unsupported "${channel}" → ${currency}`);
}

/**
 * The 16 scenarios: 2 From accounts × 8 non-card channel combos.
 * isDefaultChannel=true → only verify the pre-selected deliver-to button;
 * false → open the dropdown and pick via deliver-to-option-{label}.
 */
const CHANNEL_COMBOS = [
  { currency: 'GBP', channel: 'IBAN powered by Visa Direct', isDefaultChannel: true },
  { currency: 'GBP', channel: 'Bank Deposit', isDefaultChannel: false },
  { currency: 'GBP', channel: 'PayPal', isDefaultChannel: false },
  { currency: 'EUR', channel: 'IBAN', isDefaultChannel: true },
  { currency: 'USD', channel: 'Bank Deposit', isDefaultChannel: true },
  { currency: 'USD', channel: 'SWIFT Payment', isDefaultChannel: false },
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
        await fillBankingDetails(page, fxPage, sc.channel, sc.currency, bankingData);
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
});
