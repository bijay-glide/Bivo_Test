require('./state-suite-env');
const { test, expect }                      = require('../../../fixtures/ui-fixtures');
const SignInPage                             = require('../../../pages/SignInPage');
const VerificationPage                       = require('../../../pages/VerificationPage');
const WirePaymentPage                        = require('../../../pages/WirePaymentPage');
const { getOtpForPhoneNumber }               = require('../../../utils/otp-helper');
const { tryLoadSignupData }                  = require('../../../utils/shared-state');
const { generateWireFormData,
        generateWirePaymentSchedule }        = require('../../../utils/test-data-generator');
const { depositFundsViaWire }                = require('../../../utils/transaction-helper');

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'Test12345.';

// Standalone fallback — used when shared state doesn't exist or is stale.
// Override any field via env vars when running this test in isolation.
const STANDALONE_CREDENTIALS = {
  phoneNumber: process.env.LOGIN_PHONE_RAW || '4155560020',
  accountNumber: process.env.STANDALONE_ACCOUNT || '',
};

test.describe('Wire Payment Setup', () => {

  test('Setup wire payment and verify transaction', async ({ page, request }) => {
    test.setTimeout(180000);
    const signInPage       = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const wirePage         = new WirePaymentPage(page);

    const userData        = tryLoadSignupData() ?? STANDALONE_CREDENTIALS;
    const wireDetails     = generateWireFormData();
    const paymentSchedule = generateWirePaymentSchedule();
    const lastFourDigits  = wireDetails.accountNumber.slice(-4);

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Pre-fund account via API', async () => {
      // Ensures sufficient balance before the UI wire payment flow.
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
    await test.step('Step 5 | Navigate to Wire section', async () => {
      await wirePage.navigateToWireSection();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 6 | Fill wire beneficiary details', async () => {
      await wirePage.fillWireDetailsForm(wireDetails);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 7 | Configure payment schedule and amount', async () => {
      await wirePage.fillPaymentSchedule(paymentSchedule);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 8 | Verify review screen details', async () => {
      await wirePage.verifyReviewScreen(wireDetails, paymentSchedule);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 9 | Submit the wire transfer', async () => {
      await wirePage.submitTransfer(wireDetails.firstName, {
        accountId: userData.accountNumber,
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 10 | Verify transaction appears in history', async () => {
      await wirePage.verifyTransactionHistory(wireDetails.firstName, paymentSchedule.amount);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 11 | Verify added account in wire accounts list', async () => {
      await wirePage.verifyAddedAccount(wireDetails.nickname, lastFourDigits);
    });

  });

});
