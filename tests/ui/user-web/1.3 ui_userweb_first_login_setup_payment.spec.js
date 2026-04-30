require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const SignInPage = require('../../../pages/SignInPage');
const VerificationPage = require('../../../pages/VerificationPage');
const DashboardPage = require('../../../pages/DashboardPage');
const AchLinkPage = require('../../../pages/AchLinkPage');
const AddFundsPage = require('../../../pages/AddFundsPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { loadSignupData, loadClientId } = require('../../../utils/shared-state');
const { grantAchLinkingPermission } = require('../../../utils/helpers');

const LOGIN_PASSWORD =
  process.env.LOGIN_PASSWORD || process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';
const DEPOSIT_AMOUNT = '$90.00';

test.describe('User-web Payment Setup - ACH Link and Fund', () => {
  test('Grant permission, login, link Chase ACH, and deposit funds', async ({
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

    await test.step(
      'Step 1 | Grant ACH linking permission via API (before login)',
      async () => {
        const clientId = loadClientId();

        await grantAchLinkingPermission(request, clientId);
      },
    );

    await test.step(
      'Step 2 | Open standalone user-web and enter phone number',
      async () => {
        await signInPage.goto({ standaloneUserWeb: true });
        await signInPage.signInWithPhoneStandaloneUserWeb(
          userData.phoneNumber,
        );
      },
    );

    await test.step('Step 3 | Enter password and submit', async () => {
      await signInPage.loginWithPassword(LOGIN_PASSWORD);
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

    await test.step(
      'Step 7 | Complete Plaid iframe flow and Chase popup login',
      async () => {
        const chasePopup = await achLinkPage.startPlaidChaseFlow();
        await achLinkPage.completeChaseLogin(chasePopup);
      },
    );

    await test.step('Step 8 | Dismiss Plaid save-credentials prompt', async () => {
      await achLinkPage.dismissSaveCredentials();
    });

    await test.step('Step 9 | Confirm ACH account linked successfully', async () => {
      dashboardProfileResponse =
        await achLinkPage.confirmLinkSuccessAndCaptureDashboardProfile({
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
        console.warn(
          '[1.3] /client/v1/profile did not fire after ACH Done; continuing once dashboard is stable.',
        );
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
