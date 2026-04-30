require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const SignInPage = require('../../../pages/SignInPage');
const VerificationPage = require('../../../pages/VerificationPage');
const SetPasswordPage = require('../../../pages/SetPasswordPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { loadSignupData, saveClientData } = require('../../../utils/shared-state');

const FIRST_LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

test.describe('User-web first login', () => {
  test('First-time password for a user created via user-web signup', async ({
    page,
    request,
  }) => {
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const setPasswordPage = new SetPasswordPage(page);

    const userData = loadSignupData();

    await test.step('Step 1 | Open standalone user-web and sign in with phone', async () => {
      await signInPage.goto({ standaloneUserWeb: true });
      await signInPage.signInWithPhoneStandaloneUserWeb(
        userData.phoneNumber,
      );
    });

    await test.step('Step 2 | Retrieve OTP from API', async () => {
      await page.waitForTimeout(2000);
      userData._otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
    });

    await test.step('Step 3 | Verify OTP (Existing User or Next, like user-web signup)', async () => {
      await verificationPage.verifyOtpForUserWebFirstLogin(userData._otp);
    });

    await test.step('Step 4 | Set password and listen for profile + account-info', async () => {
      await expect(page.getByRole('heading', { name: 'Enter Password' })).toBeVisible({
        timeout: 15000,
      });

      // Start listeners before submit so the post–set-password / dashboard calls are not missed.
      userData._profileResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/client/v1/profile') && response.status() === 200,
        { timeout: 60000 },
      );
      userData._accountInfoResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/user/v1/account-info') && response.status() === 200,
        { timeout: 60000 },
      );

      await setPasswordPage.setPassword(FIRST_LOGIN_PASSWORD);
    });

    await test.step('Step 5 | Verify /client/v1/profile, then welcome + account active UI', async () => {
      const profileResponse = await userData._profileResponsePromise;
      const profileData = await profileResponse.json();
      expect(profileData, 'GET /client/v1/profile should include clientId').toMatchObject({
        clientId: expect.anything(),
      });
      userData._profileData = profileData;

      const expectedWelcome = `Dear ${userData.firstName} ${userData.lastName}, Bivo welcomes you!`;
      // Assert separately — .or() fails strict mode when both the heading and copy are present.
      await expect(page.locator('h2.title')).toHaveText(expectedWelcome, { timeout: 15000 });
      await expect(page.getByText(/Your account is now active/)).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step('Step 6 | Persist clientId and account number', async () => {
      const profileData = userData._profileData;
      const accountInfoData = await (await userData._accountInfoResponsePromise).json();
      const accountNumber = accountInfoData[0]?.accountNumber;

      saveClientData({
        clientId: profileData.clientId,
        accountNumber,
      });
    });
  });
});
