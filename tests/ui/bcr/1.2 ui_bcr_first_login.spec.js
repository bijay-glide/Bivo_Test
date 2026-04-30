require('./state-suite-env');
const { test, expect }         = require('../../../fixtures/ui-fixtures');
const SignInPage                = require('../../../pages/SignInPage');
const VerificationPage          = require('../../../pages/VerificationPage');
const SetPasswordPage           = require('../../../pages/SetPasswordPage');
const { getOtpForPhoneNumber }  = require('../../../utils/otp-helper');
const { loadSignupData, saveClientData } = require('../../../utils/shared-state');

const FIRST_LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

test.describe('First Login Flow', () => {

  test('First-time login for a newly signed-up user', async ({ page, request }) => {
    const signInPage       = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const setPasswordPage  = new SetPasswordPage(page);

    const userData = loadSignupData();

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Navigate to sign-in page and enter phone number', async () => {
      await signInPage.goto();
      await signInPage.signInWithPhone(userData.phoneNumber);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 2 | Retrieve OTP from API', async () => {
      // Small pause to give the backend time to store the OTP before fetching.
      await page.waitForTimeout(2000);
      userData._otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 3 | Verify OTP and proceed as existing user', async () => {
      await verificationPage.verifyAndProceedAsExistingUser(userData._otp);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 4 | Set password and capture profile responses', async () => {
      // Register both network listeners BEFORE setPassword triggers the dashboard
      // redirect — this guarantees we never miss either response.
      userData._profileResponsePromise     = page.waitForResponse(
        response => response.url().includes('/client/v1/profile') && response.status() === 200,
        { timeout: 30000 }
      );
      userData._accountInfoResponsePromise = page.waitForResponse(
        response => response.url().includes('/user/v1/account-info') && response.status() === 200,
        { timeout: 30000 }
      );

      await setPasswordPage.setPassword(FIRST_LOGIN_PASSWORD);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 5 | Verify account is now active', async () => {
      await expect(page.locator('#root')).toContainText('Your account is now active.', { timeout: 10000 });
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 6 | Extract clientId + accountNumber and persist to shared state', async () => {
      // account-info returns an array — take the first (primary) account.
      const profileData     = await (await userData._profileResponsePromise).json();
      const accountInfoData = await (await userData._accountInfoResponsePromise).json();
      const accountNumber   = accountInfoData[0]?.accountNumber;

      saveClientData({
        clientId: profileData.clientId,
        accountNumber,
      });

      console.log('\nFirst login completed successfully');
      console.log(`clientId      : ${profileData.clientId}`);
      console.log(`accountNumber : ${accountNumber}`);
    });

  });

});
