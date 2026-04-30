require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const SignInPage = require('../../../pages/SignInPage');
const VerificationPage = require('../../../pages/VerificationPage');
const UserRegistrationPage = require('../../../pages/UserRegistrationPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { generateUserTestData } = require('../../../utils/test-data-generator');
const { saveSignupData } = require('../../../utils/shared-state');

test.describe('User-web standalone signup', () => {
  test('Complete registration from standalone sign-in through welcome', async ({
    page,
    request,
  }) => {
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const registrationPage = new UserRegistrationPage(page);

    const testData = generateUserTestData();

    await test.step('Step 1 | Open standalone user-web and sign in with phone', async () => {
      await signInPage.goto({ standaloneUserWeb: true });
      await signInPage.signInWithPhoneStandaloneUserWeb(
        testData.phoneNumber,
      );
    });

    await test.step('Step 2 | Retrieve OTP from API', async () => {
      await page.waitForTimeout(2000);
      testData._otp = await getOtpForPhoneNumber(request, testData.phoneNumber);
    });

    await test.step('Step 3 | Enter OTP and continue (Next — same as BCR; not “New User”)', async () => {
      await verificationPage.verifyAndProceedAsNewUser(testData._otp);
    });

    await test.step('Step 4 | Full registration (user-web: calendar DOB, extra Next after SSN, disclosure copy)', async () => {
      // Register before the shell loads so we do not miss /client/v1/profile or
      // /user/v1/account-info (the latter is requested alongside profile).
      testData._profileResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/client/v1/profile') && response.status() === 200,
        { timeout: 60000 },
      );
      testData._accountInfoResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/user/v1/account-info') && response.status() === 200,
        { timeout: 60000 },
      );
      await registrationPage.completeFullRegistration(testData, {
        extraNextAfterSsn: true,
        assertConsentDisclosureCopy: true,
      });
    });

    await test.step('Step 5 | Profile + account-info APIs, shared state, and welcome', async () => {
      const profileResponse = await testData._profileResponsePromise;
      const profile = await profileResponse.json();
      expect(profile, 'GET /client/v1/profile should include clientId').toMatchObject({
        clientId: expect.anything(),
      });

      const accountInfoData = await (await testData._accountInfoResponsePromise).json();
      // account-info returns an array — take the first (primary) account.
      const accountNumber = accountInfoData[0]?.accountNumber;
      expect(accountNumber, 'GET /user/v1/account-info should include accountNumber').toBeDefined();

      const expectedWelcome = `Dear ${testData.firstName} ${testData.lastName}, Bivo welcomes you!`;
      const clientId = profile.clientId;

      saveSignupData({
        phoneNumber: testData.phoneNumber,
        firstName: testData.firstName,
        lastName: testData.lastName,
        clientId,
        accountNumber,
      });

      await expect(page.locator('h2.title')).toHaveText(expectedWelcome);
    });
  });
});
