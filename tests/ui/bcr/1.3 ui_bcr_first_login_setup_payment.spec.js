require('./state-suite-env');
const { test }           = require('../../../fixtures/ui-fixtures');
const SignInPage          = require('../../../pages/SignInPage');
const VerificationPage    = require('../../../pages/VerificationPage');
const DashboardPage       = require('../../../pages/DashboardPage');
const AchLinkPage         = require('../../../pages/AchLinkPage');
const AddFundsPage        = require('../../../pages/AddFundsPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { loadSignupData, loadClientId } = require('../../../utils/shared-state');
const { grantAchLinkingPermission } = require('../../../utils/helpers');

const LOGIN_PASSWORD  = process.env.LOGIN_PASSWORD || 'Test12345.';
const DEPOSIT_AMOUNT  = '$90.00';

test.describe('Payment Setup - ACH Link and Fund', () => {

  test('Link ACH account and initiate deposit for newly created user', async ({ page, request }) => {
    const signInPage       = new SignInPage(page);
    const verificationPage = new VerificationPage(page);
    const dashboardPage    = new DashboardPage(page);
    const achLinkPage      = new AchLinkPage(page);
    const addFundsPage     = new AddFundsPage(page);
    const userData         = loadSignupData();

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 1 | Grant ACH linking permission via API (before login)', async () => {
      // Load the clientId saved by test 2, obtain a short-lived service-account
      // token, and add the user to groups [-2, -3] so the "Link ACH" option
      // is available the moment they land on the dashboard.
      const clientId = loadClientId();

      await grantAchLinkingPermission(request, clientId);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 2 | Navigate and enter phone number', async () => {
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
        // Small pause to give the backend time to store the OTP before fetching
        await page.waitForTimeout(2000);
        const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
        await verificationPage.verifyAndProceedAsExistingUser(otp);
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 5 | Confirm successful login', async () => {
      await signInPage.verifyLoginSuccessful();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 6 | Navigate to ACH link flow', async () => {
      // waitForDashboardReady() (inside goToDepositFunds) blocks until the
      // dashboard's initial API calls settle, keeping the sidebar stable.
      await dashboardPage.goToDepositFunds();
      await achLinkPage.clickLinkAccount();
      await achLinkPage.selectLinkAchInstantly();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 7 | Complete Plaid iframe flow and Chase popup login', async () => {
      const chasePopup = await achLinkPage.startPlaidChaseFlow();
      await achLinkPage.completeChaseLogin(chasePopup);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 8 | Dismiss Plaid save-credentials prompt', async () => {
      await achLinkPage.dismissSaveCredentials();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 9 | Confirm ACH account linked successfully', async () => {
      await achLinkPage.confirmLinkSuccess();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 10 | Add funds via linked Chase account', async () => {
      // goToAddFunds() calls waitForDashboardReady() so the nav is stable
      // after the Done button returns us to the dashboard.
      await dashboardPage.goToAddFunds();
      await addFundsPage.selectChaseAccount();
      await addFundsPage.enterAmountAndProceed(DEPOSIT_AMOUNT);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 11 | Review and confirm the transfer', async () => {
      await addFundsPage.reviewAndConfirmTransfer();
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 12 | Verify success banner', async () => {
      await addFundsPage.confirmTransferSuccess(DEPOSIT_AMOUNT);
    });

    // ─────────────────────────────────────────────────────────────────────────
    await test.step('Step 13 | Verify pending transaction in wallet ledger', async () => {
      await dashboardPage.goToAccountsTransactions();
      await addFundsPage.verifyPendingTransaction(DEPOSIT_AMOUNT);
    });

  });

});
