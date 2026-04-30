require('./state-suite-env');
const { test, expect }         = require('../../../fixtures/ui-fixtures');
const SignInPage                = require('../../../pages/SignInPage');
const VerificationPage          = require('../../../pages/VerificationPage');
const UserRegistrationPage      = require('../../../pages/UserRegistrationPage');
const { getOtpForPhoneNumber }  = require('../../../utils/otp-helper');
const { generateUserTestData }  = require('../../../utils/test-data-generator');
const { saveSignupData }        = require('../../../utils/shared-state');

test.describe('User Signup Flow', () => {

  test('Complete user registration from sign-in to submission', async ({ page, request }) => {
    const signInPage       = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const registrationPage = new UserRegistrationPage(page);

    const testData = generateUserTestData();

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Navigate to sign-in page and enter phone number', async () => {
      await signInPage.goto();
      await signInPage.signInWithPhone(testData.phoneNumber);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 2 | Retrieve OTP from API', async () => {
      // Small pause to give the backend time to store the OTP before fetching.
      await page.waitForTimeout(2000);
      testData._otp = await getOtpForPhoneNumber(request, testData.phoneNumber);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 3 | Verify OTP and proceed as new user', async () => {
      await verificationPage.verifyAndProceedAsNewUser(testData._otp);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 4 | Complete full registration form', async () => {
      await registrationPage.completeFullRegistration(testData);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 5 | Verify welcome message and save signup data', async () => {
      const expectedWelcome = `Dear ${testData.firstName} ${testData.lastName}, Bivo welcomes you!`;
      await expect(page.locator('h2.title')).toHaveText(expectedWelcome);

      // Persist phone number + name so the first-login test can reuse this exact user.
      saveSignupData({
        phoneNumber: testData.phoneNumber,
        firstName: testData.firstName,
        lastName: testData.lastName,
      });

      console.log('\nRegistration completed successfully');
      console.log(`Phone : ${testData.phoneNumber}`);
    });

  });

});
