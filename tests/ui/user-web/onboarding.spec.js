require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const SignInPage = require('../../../pages/SignInPage');
const VerificationPage = require('../../../pages/VerificationPage');
const UserRegistrationPage = require('../../../pages/UserRegistrationPage');
const SetPasswordPage = require('../../../pages/SetPasswordPage');
const DashboardPage = require('../../../pages/DashboardPage');
const AchLinkPage = require('../../../pages/AchLinkPage');
const AddFundsPage = require('../../../pages/AddFundsPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { generateUserTestData } = require('../../../utils/test-data-generator');
const { saveSignupData, loadSignupData, loadClientId, saveClientData } = require('../../../utils/shared-state');
const { grantAchLinkingPermission } = require('../../../utils/helpers');

const FIRST_LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';
const DEPOSIT_AMOUNT = '$90.00';

// serial: 1.1 → 1.2 → 1.3 run on the same worker in order, regardless of --workers count.
// If 1.1 fails, 1.2 and 1.3 are automatically skipped.
test.describe.configure({ mode: 'serial' });

test.describe('User-web onboarding', () => {

  // ─── 1.1 | Signup ──────────────────────────────────────────────────────────
  test('1.1 | Signup — complete registration from standalone sign-in through welcome', async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const registrationPage = new UserRegistrationPage(page);

    const testData = generateUserTestData();

    await test.step('Step 1 | Open standalone user-web and sign in with phone', async () => {
      await signInPage.goto({ standaloneUserWeb: true });
      await signInPage.signInWithPhoneStandaloneUserWeb(testData.phoneNumber);
    });

    await test.step('Step 2 | Retrieve OTP from API', async () => {
      await page.waitForTimeout(2000);
      testData._otp = await getOtpForPhoneNumber(request, testData.phoneNumber);
    });

    await test.step('Step 3 | Enter OTP and continue', async () => {
      await verificationPage.verifyAndProceedAsNewUser(testData._otp);
    });

    await test.step('Step 4 | Full registration (calendar DOB, extra Next after SSN, disclosure copy)', async () => {
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
      const accountNumber = accountInfoData[0]?.accountNumber;
      expect(accountNumber, 'GET /user/v1/account-info should include accountNumber').toBeDefined();

      const clientId = profile.clientId;
      saveSignupData({
        phoneNumber: testData.phoneNumber,
        firstName: testData.firstName,
        lastName: testData.lastName,
        clientId,
        accountNumber,
      });

      const expectedWelcome = `Dear ${testData.firstName} ${testData.lastName}, Bivo welcomes you!`;
      await expect(page.locator('h2.title')).toHaveText(expectedWelcome);
    });
  });

  // ─── 1.2 | First login ─────────────────────────────────────────────────────
  test('1.2 | First login — set password and verify account active', async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const setPasswordPage = new SetPasswordPage(page);

    const userData = loadSignupData();

    await test.step('Step 1 | Open standalone user-web and sign in with phone', async () => {
      await signInPage.goto({ standaloneUserWeb: true });
      await signInPage.signInWithPhoneStandaloneUserWeb(userData.phoneNumber);
    });

    await test.step('Step 2 | Retrieve OTP from API', async () => {
      await page.waitForTimeout(2000);
      userData._otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
    });

    await test.step('Step 3 | Verify OTP', async () => {
      await verificationPage.verifyOtpForUserWebFirstLogin(userData._otp);
    });

    await test.step('Step 4 | Set password and listen for profile + account-info', async () => {
      await expect(page.getByRole('heading', { name: 'Enter Password' })).toBeVisible({
        timeout: 15000,
      });

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
      await expect(page.locator('h2.title')).toHaveText(expectedWelcome, { timeout: 15000 });
      await expect(page.getByText(/Your account is now active/)).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 6 | Persist clientId and account number', async () => {
      const profileData = userData._profileData;
      const accountInfoData = await (await userData._accountInfoResponsePromise).json();
      const accountNumber = accountInfoData[0]?.accountNumber;
      saveClientData({ clientId: profileData.clientId, accountNumber });
    });
  });

  // ─── 1.3 | ACH link and fund ───────────────────────────────────────────────
  test('1.3 | Payment setup — grant ACH permission, link Chase, and deposit funds', async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const dashboardPage = new DashboardPage(page);
    const achLinkPage = new AchLinkPage(page);
    const addFundsPage = new AddFundsPage(page);

    const userData = loadSignupData();
    let dashboardProfileResponse;

    await test.step('Step 1 | Grant ACH linking permission via API (before login)', async () => {
      const clientId = loadClientId();
      await grantAchLinkingPermission(request, clientId);
    });

    await test.step('Step 2 | Open standalone user-web and enter phone number', async () => {
      await signInPage.goto({ standaloneUserWeb: true });
      await signInPage.signInWithPhoneStandaloneUserWeb(userData.phoneNumber);
    });

    await test.step('Step 3 | Enter password and submit', async () => {
      await signInPage.loginWithPassword(FIRST_LOGIN_PASSWORD);
    });

    await test.step('Step 4 | OTP verification (if required)', async () => {
      await signInPage.waitForPasswordScreenToLeave();
      if (await verificationPage.isOtpInputVisible()) {
        await page.waitForTimeout(2000);
        const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
        await verificationPage.verifyOtpForUserWebFirstLogin(otp);
      }
    });

    await test.step('Step 5 | Confirm successful login', async () => {
      await signInPage.verifyLoginSuccessful();
    });

    await test.step('Step 6 | Navigate to ACH link flow', async () => {
      await dashboardPage.goToMoveMoneyUserWeb();
      await achLinkPage.clickLinkAccountUserWeb();
      await achLinkPage.selectLinkAchInstantlyUserWeb();
    });

    await test.step('Step 7 | Complete Plaid iframe flow and Chase popup login', async () => {
      const chasePopup = await achLinkPage.startPlaidChaseFlow();
      await achLinkPage.completeChaseLogin(chasePopup);
    });

    await test.step('Step 8 | Dismiss Plaid save-credentials prompt', async () => {
      await achLinkPage.dismissSaveCredentials();
    });

    await test.step('Step 9 | Confirm ACH account linked successfully', async () => {
      dashboardProfileResponse = await achLinkPage.confirmLinkSuccessAndCaptureDashboardProfile({
        timeout: 12000,
      });
    });

    await test.step('Step 10 | Add funds via linked Chase account', async () => {
      if (dashboardProfileResponse) {
        const profileData = await dashboardProfileResponse.json();
        expect(profileData, 'GET /client/v1/profile should include clientId').toMatchObject({
          clientId: expect.anything(),
        });
      } else {
        console.warn('[1.3] /client/v1/profile did not fire after ACH Done; continuing once dashboard is stable.');
      }

      await dashboardPage.goToAddFunds();
      await addFundsPage.selectChaseAccount();
      await addFundsPage.enterAmountAndProceed(DEPOSIT_AMOUNT);
    });

    await test.step('Step 11 | Review and confirm the transfer', async () => {
      await addFundsPage.reviewAndConfirmTransfer();
    });

    await test.step('Step 12 | Verify success banner', async () => {
      await addFundsPage.confirmTransferSuccess(DEPOSIT_AMOUNT);
    });

    await test.step('Step 13 | Verify pending transaction in wallet ledger', async () => {
      await dashboardPage.goToAccountsTransactions();
      await addFundsPage.verifyPendingTransaction(DEPOSIT_AMOUNT);
    });
  });

});
