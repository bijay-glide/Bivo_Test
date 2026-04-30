require('./state-suite-env');
const path = require('path');
const fs = require('fs');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const SignInPage = require('../../../pages/SignInPage');
const VerificationPage = require('../../../pages/VerificationPage');
const UserRegistrationPage = require('../../../pages/UserRegistrationPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { generateUserTestData } = require('../../../utils/test-data-generator');
const { saveSignupData } = require('../../../utils/shared-state');

const HAR_CACHE_PATH = path.join(__dirname, '../../../har/signin-cache.har');

test.describe('User Signup Flow', () => {

  test('Complete user registration from sign-in to submission', async ({ page, request }) => {
    // Use HAR cache for faster load if you've exported it (see har/README.md)
    // if (fs.existsSync(HAR_CACHE_PATH)) {
    //   await page.routeFromHAR(HAR_CACHE_PATH, { update: false });
    // }

    // Initialize page objects
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const registrationPage = new UserRegistrationPage(page);

    // Generate random test data
    const testData = generateUserTestData();

    // Step 1: Navigate to sign-in page and enter phone number
    await signInPage.goto();
    await signInPage.signInWithPhone(testData.phoneNumber);

    // Step 2: Retrieve OTP from API (after UI triggers OTP generation)
    await page.waitForTimeout(2000);
    const otp = await getOtpForPhoneNumber(request, testData.phoneNumber);

    // Step 3: Verify OTP code
    await verificationPage.verifyAndProceedAsNewUser(otp);

    // Step 4: Complete full registration
    await registrationPage.completeFullRegistration(testData);

    // Step 5: Verify welcome message with user's name
    const expectedWelcome = `Dear ${testData.firstName} ${testData.lastName}, Bivo welcomes you!`;
    await expect(page.locator('h2.title')).toHaveText(expectedWelcome);

    // Save phone number + name so the first-login test can reuse this exact user
    saveSignupData({
      phoneNumber: testData.phoneNumber,
      firstName: testData.firstName,
      lastName: testData.lastName
    });

    console.log('\nRegistration completed successfully');
  });

});