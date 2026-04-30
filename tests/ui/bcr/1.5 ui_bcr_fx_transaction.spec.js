require('./state-suite-env');
const { test, expect }               = require('../../../fixtures/ui-fixtures');
const SignInPage                      = require('../../../pages/SignInPage');
const VerificationPage                = require('../../../pages/VerificationPage');
const FxTransactionPage               = require('../../../pages/FxTransactionPage');
const { getOtpForPhoneNumber }        = require('../../../utils/otp-helper');
const { tryLoadSignupData }           = require('../../../utils/shared-state');
const { generateFxTransactionData }   = require('../../../utils/test-data-generator');
const { depositFundsViaWire }         = require('../../../utils/transaction-helper');

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'Test12345.';

// Standalone fallback — override via env vars when running without the full suite.
const STANDALONE_CREDENTIALS = {
  phoneNumber: process.env.LOGIN_PHONE_RAW,
  accountNumber: process.env.STANDALONE_ACCOUNT,
};

test.describe('FX Transaction', () => {

  test.beforeEach(async ({ context, page }) => {
    // Clear any leftover session from a previous test so this test
    // always starts from a clean, logged-out state.
    await context.clearCookies();
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('Create FX payment and verify transaction', async ({ page, request }) => {
    const signInPage       = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const fxPage           = new FxTransactionPage(page);

    const userData = tryLoadSignupData() ?? STANDALONE_CREDENTIALS;
    const fxData   = generateFxTransactionData();

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Pre-fund account via API', async () => {
      // Ensures sufficient balance before the UI FX flow.
      // Skipped gracefully when no accountNumber is available.
      if (userData.accountNumber) {
        await depositFundsViaWire(request, userData.accountNumber);
      } else {
        console.warn('⚠️  No accountNumber available — skipping pre-fund step. Set STANDALONE_ACCOUNT env var to enable.');
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 2 | Navigate to sign-in page and enter phone number', async () => {
      await signInPage.goto();
      await signInPage.signInWithPhone(userData.phoneNumber);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 3 | Enter password and submit', async () => {
      await signInPage.loginWithPassword(LOGIN_PASSWORD);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 4 | OTP verification (if required)', async () => {
      // Wait for the password screen to fully leave, then check whether
      // the app requires OTP before proceeding to the dashboard.
      await signInPage.waitForPasswordScreenToLeave();

      if (await verificationPage.isOtpScreenVisible()) {
        // Small pause to give the backend time to store the OTP before fetching.
        await page.waitForTimeout(2000);
        const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
        await verificationPage.verifyAndProceedAsExistingUser(otp);
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 5 | Navigate to Create Payment', async () => {
      await fxPage.navigateToCreatePayment();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 6 | Select destination country and verify currency rate API', async () => {
      // Selecting the country triggers the currency rate API call — we intercept
      // the response here to confirm it returns 200 before proceeding.
      await fxPage.selectDestinationCountry(fxData.country);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 7 | Enter send amount and verify currency shown', async () => {
      // Amount is entered in cents-based format — appending "00" converts the
      // integer to the correct decimal value (e.g. "55" → $55.00).
      await fxPage.enterAmount('55');
      await fxPage.verifyCurrencyShown('GBP');
      await fxPage.continue();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 8 | Add payee details', async () => {
      await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 9 | Enter IBAN', async () => {
      await fxPage.enterIban(fxData.iban);
      // await fxPage.fillIdentityDetails(fxData.identityType, fxData.identityNumber);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 10 | Verify review screen and confirm payment', async () => {
      await fxPage.verifyAmountOnReview(fxData.amount);
      await fxPage.enterNoteAndConfirm(fxData.note);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 11 | Verify processing screen and dismiss', async () => {
      await fxPage.verifyProcessingAndDismiss();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 12 | Verify transaction appears in list', async () => {
      await fxPage.verifyTransactionInList(fxData.beneficiaryFirstName, fxData.amount);
    });

  });

});
