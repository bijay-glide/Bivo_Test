require('../state-suite-env');
const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { authenticator } = require('otplib');
const { getOtpForBusinessEmail } = require('../../../../utils/otp-helper');
const { generateBuWebTestData } = require('../../../../utils/test-data-generator');
const { loadSignupData, saveExtendedState } = require('../../../../utils/shared-state');
const { depositFundsViaWire } = require('../../../../utils/transaction-helper');
const VerificationPage = require('../../../../pages/VerificationPage');
const BuWebSignInPage = require('../../../../pages/BuWebSignInPage');
const BuWebGetStartedPage = require('../../../../pages/BuWebGetStartedPage');
const BuWebBusinessAddressPage = require('../../../../pages/BuWebBusinessAddressPage');
const BuWebBusinessVerificationPage = require('../../../../pages/BuWebBusinessVerificationPage');
const BuWebBeneficialOwnerPage = require('../../../../pages/BuWebBeneficialOwnerPage');
const BuWebAdditionalInfoPage = require('../../../../pages/BuWebAdditionalInfoPage');
const BuWebAgreementsPage = require('../../../../pages/BuWebAgreementsPage');
const AchLinkPage = require('../../../../pages/AchLinkPage');
const AddFundsPage = require('../../../../pages/AddFundsPage');

const KEYCLOAK_TOKEN_URL = `${process.env.KEYCLOAK_HOST}/realms/glidecash/protocol/openid-connect/token`;
const APPROVE_URL        = `${process.env.HOST}/clientaccount/v1/internal/business/account/approve`;
const TENANT             = process.env.TENANT_IDENTIFIER;
const FIRST_LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';
const DEPOSIT_AMOUNT     = '$90.00';
const PREFUND_AMOUNT     = 50000; // $500

test.describe.configure({ mode: 'serial' });

test.describe('Bu-web onboarding', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1.1 — Business signup
  // ─────────────────────────────────────────────────────────────────────────
  test('1.1 — Complete business signup', async ({ page, request }) => {
    test.setTimeout(180000);
    const testData = generateBuWebTestData();
    console.log('business email:', testData.email);

    // Fresh business user: clear downstream flags a previous run may have left behind,
    // so 9.1/9.2/10 can't mistake a prior user's completed state for this one's.
    saveExtendedState({ secondaryUsdAccountCreated: false, multicurrencyAccountsCreated: false });

    const signInPage          = new BuWebSignInPage(page);
    const verificationPage    = new VerificationPage(page);
    const getStartedPage      = new BuWebGetStartedPage(page);
    const businessAddressPage = new BuWebBusinessAddressPage(page);
    const verificationHubPage = new BuWebBusinessVerificationPage(page);
    const beneficialOwnerPage = new BuWebBeneficialOwnerPage(page);
    const additionalInfoPage  = new BuWebAdditionalInfoPage(page);
    const agreementsPage      = new BuWebAgreementsPage(page);

    let _dashboardAccountInfo = null;
    page.on('response', async res => {
      if (_dashboardAccountInfo) return;
      const url = res.url();
      if (res.request().method() !== 'GET' || !res.ok()) return;
      if (url.includes('/clientaccount/v1/business') || url.includes('/business/v1/business/account')) {
        try {
          const body = await res.json();
          if (body && (body.businessId || body.accountNumber || body.clientId)) {
            _dashboardAccountInfo = body;
          }
        } catch { /* non-JSON */ }
      }
    });

    await test.step('Step 1 | Sign in with business email', async () => {
      await signInPage.goto();
      await signInPage.enterEmail(testData.email);
    });

    await test.step('Step 2 | Retrieve OTP and complete verification', async () => {
      await verificationPage.digit1Input.waitFor({ state: 'visible' });
      testData._otp = await getOtpForBusinessEmail(request, testData.email);
      await verificationPage.verifyAndProceedAsNewUser(testData._otp);
    });

    await test.step('Step 3 | Get started form — create prospect', async () => {
      await getStartedPage.fill(testData.getStarted);
      testData._prospectsPromise = page.waitForResponse(
        res => res.url().includes('/prospect/v1/business/prospects') && res.request().method() === 'POST'
      );
      await getStartedPage.clickContinue();
      const prospectsRes = await testData._prospectsPromise;
      expect(prospectsRes.status()).toBe(202);
      testData.prospectId = await prospectsRes.text();
      await expect(page.getByRole('heading')).toContainText('Business Address');
      await expect(page.locator('#root')).toContainText('United States of America');
    });

    await test.step('Step 4 | Business address — create account', async () => {
      await businessAddressPage.fill(testData.bizAddress);
      testData._addressPromise = page.waitForResponse(
        res => res.url().includes(`/prospect/v1/business/prospects/${testData.prospectId}/address`) && res.request().method() === 'PUT'
      );
      testData._accountPromise = page.waitForResponse(
        res => res.url().includes(`/clientaccount/v1/business/account/${testData.prospectId}`) && res.request().method() === 'POST'
      );
      await businessAddressPage.clickContinue();
      expect((await testData._addressPromise).status()).toBe(202);

      const accountRes = await testData._accountPromise;
      expect(accountRes.status()).toBe(200);

      try {
        const accountBody    = await accountRes.json();
        testData.businessId  = accountBody.businessId  ?? accountBody.id    ?? null;
        testData.clientId    = accountBody.clientId                          ?? null;
        testData.accountNumber = accountBody.accountIdentifier ?? accountBody.accountNumber ?? null;
        console.log('── Account created ──────────────────────────');
        console.log('email        :', testData.email);
        console.log('businessId   :', testData.businessId);
        console.log('clientId     :', testData.clientId);
        console.log('accountNumber:', testData.accountNumber);
        console.log('─────────────────────────────────────────────');
      } catch (e) {
        console.warn('Could not parse account creation body:', e.message);
      }

      await expect(page.getByTestId('welcome-card-title')).toHaveText(`Dear ${testData.getStarted.firstName} ${testData.getStarted.lastName},`);
      await expect(page.getByTestId('welcome-card-description')).toContainText('Business Verification');
    });

    await test.step('Step 5 | Business Registration Document — review content', async () => {
      await verificationHubPage.goto();

      if (!testData.businessId && _dashboardAccountInfo) {
        testData.businessId    = _dashboardAccountInfo.businessId    ?? testData.businessId;
        testData.clientId      = _dashboardAccountInfo.clientId      ?? testData.clientId;
        testData.accountNumber = _dashboardAccountInfo.accountNumber ?? testData.accountNumber;
      }

      await verificationHubPage.openBusinessRegistrationDoc();
      await expect(page.locator('#root')).toContainText('Please email the document to support@bivocash.com');
      await expect(page.getByRole('list')).toContainText('If LLC, provide Article of Organization');
      await expect(page.getByRole('list')).toContainText('If Corporation, provide Certificate of Incorporation');
      await expect(page.getByRole('list')).toContainText('If Sole Proprietorship, provide one of the following: Business License, Permit or Brand Name Registration');
      await expect(page.getByRole('list')).toContainText('If outside the US, provide the applicable business registration or formation document issued by the local government authority.');
      await verificationHubPage.closeBusinessRegistrationDoc();
    });

    await test.step('Step 6 | Beneficial owner + owners list + Key Person Details', async () => {
      await verificationHubPage.openBeneficialOwnerSection();
      testData._ownerPostPromise = page.waitForResponse(
        res => res.url().includes('/prospect/v1/business/prospects/owners') && res.request().method() === 'POST'
      );
      testData._ownerGetPromise = page.waitForResponse(
        res => res.url().includes('/prospect/v1/business/prospects/owners') && res.request().method() === 'GET'
      );
      await beneficialOwnerPage.fillAndSubmitOwnerForm(testData.owner);
      expect((await testData._ownerPostPromise).status()).toBe(202);
      expect((await testData._ownerGetPromise).status()).toBe(200);
      await beneficialOwnerPage.confirmNoOtherOwnersAndContinue();
      await beneficialOwnerPage.confirmAsKeyPerson();
      await expect(page.getByRole('heading')).toContainText('Key Person Details');
      await beneficialOwnerPage.fillAndSubmitKeyPersonDetails(testData.keyPerson);
      await expect(page.locator('#root')).toContainText('Beneficiary Details / Key PersonPending');
    });

    await test.step('Step 7 | Additional Information', async () => {
      await verificationHubPage.openAdditionalInfoSection();
      await additionalInfoPage.fillDateEstablished();
      await additionalInfoPage.fillCompanyDetailsAndContinue(testData.additionalInfo);
      testData._additionalInfoPromise = page.waitForResponse(
        res => res.url().includes('/business/v1/business/account/verification/additional/info') && res.request().method() === 'POST'
      );
      await additionalInfoPage.fillFundingDescriptionAndContinue(testData.additionalInfo);
      expect((await testData._additionalInfoPromise).status()).toBe(200);
      await expect(page.locator('#root')).toContainText('Additional InformationPending');
    });

    await test.step('Step 8 | Agreements & Certifications', async () => {
      await verificationHubPage.openAgreementsSection();
      testData._agreementPromise = page.waitForResponse(
        res => res.url().includes('/business/v1/business/account/verification/agreement/accepted') && res.request().method() === 'PUT'
      );
      await agreementsPage.acceptAgreementsAndContinue();
      expect((await testData._agreementPromise).status()).toBe(200);
      testData._docSubmittedPromise = page.waitForResponse(
        res => res.url().includes('/business/v1/business/account/verification/document/submitted') && res.request().method() === 'PUT'
      );
      await agreementsPage.acceptFinalCertificationAndContinue();
      expect((await testData._docSubmittedPromise).status()).toBe(200);
      await verificationHubPage.goto();
      await expect(page.locator('#root')).toContainText('Agreements & CertificationsPending');
    });

    if (!testData.businessId && _dashboardAccountInfo) {
      testData.businessId    = _dashboardAccountInfo.businessId    ?? testData.businessId;
      testData.clientId      = _dashboardAccountInfo.clientId      ?? testData.clientId;
      testData.accountNumber = _dashboardAccountInfo.accountNumber ?? testData.accountNumber;
    }

    await test.step('Step 9 | Approve business account via internal API', async () => {
      const tokenRes = await request.post(KEYCLOAK_TOKEN_URL, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          client_id      : process.env.TRANSACTION_CLIENT_ID,
          client_secret  : process.env.TRANSACTION_CLIENT_SECRET,
          grant_type     : process.env.TRANSACTION_GRANT_TYPE,
          glide_auth_type: process.env.TRANSACTION_GRANT_TYPE,
        }).toString(),
      });
      expect(tokenRes.status(), 'Keycloak token should return 200').toBe(200);
      const { access_token: bearerToken } = await tokenRes.json();
      console.log('Keycloak token obtained ✓');

      console.log('Approving businessId:', testData.businessId);
      const approveRes = await request.post(APPROVE_URL, {
        headers: {
          'Authorization'      : `Bearer ${bearerToken}`,
          'X-Tenant-Identifier': TENANT,
          'Content-Type'       : 'application/json',
          'client-ip'          : '10.128.90.229',
        },
        data: {
          businessId     : testData.businessId,
          ignoreAllChecks: true,
          provider       : null,
          approverId     : -1,
          groupIds       : [-2, -3],
        },
      });

      console.log('── Business User Approved ───────────────────');
      console.log('Approve status :', approveRes.status());
      console.log('email          :', testData.email);
      console.log('businessId     :', testData.businessId);
      console.log('clientId       :', testData.clientId);
      console.log('accountNumber  :', testData.accountNumber);
      console.log('─────────────────────────────────────────────');

      expect(approveRes.status(), 'Business account approve should return 200').toBe(200);

      saveExtendedState({
        email        : testData.email,
        firstName    : testData.getStarted.firstName,
        lastName     : testData.getStarted.lastName,
        businessId   : testData.businessId,
        clientId     : testData.clientId,
        accountNumber: testData.accountNumber,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.2 — First login: set password. After Continue, the app redirects back
  // to sign-in instead of proceeding straight into 2FA setup — the account
  // still has no password-based session, so 2FA setup now happens on the next
  // real login instead (see 1.3, Step 3).
  // ─────────────────────────────────────────────────────────────────────────
  test('1.2 — Set password', async ({ page, request }) => {
    test.setTimeout(120000);

    const state = loadSignupData();
    const { email } = state;

    const signInPage       = new BuWebSignInPage(page);
    const verificationPage = new VerificationPage(page);

    await test.step('Step 1 | Navigate to sign-in and enter email', async () => {
      await signInPage.goto();
      await signInPage.enterEmail(email);
    });

    await test.step('Step 2 | Retrieve email OTP and verify', async () => {
      await verificationPage.digit1Input.waitFor({ state: 'visible' });
      const otp = await getOtpForBusinessEmail(request, email);
      await verificationPage.verifyAndProceedAsNewUser(otp);
    });

    await test.step('Step 3 | Set new password and verify the password API', async () => {
      await page.getByRole('textbox', { name: 'Enter new password' }).waitFor({ state: 'visible' });

      const passwordPromise = page.waitForResponse(
        res => res.url().includes('/identity/v1/business/user/password') && res.request().method() === 'PUT',
        { timeout: 30000 },
      );

      await page.getByRole('textbox', { name: 'Enter new password' }).fill(FIRST_LOGIN_PASSWORD);
      await page.getByRole('textbox', { name: 'Confirm your password' }).fill(FIRST_LOGIN_PASSWORD);
      await page.getByRole('button', { name: 'Continue' }).click();

      const passwordRes = await passwordPromise;
      expect(passwordRes.status(), 'business/user/password PUT should return 202').toBe(202);
    });

    await test.step('Step 4 | Verify redirected to forgot-password success screen (2FA setup now happens on next login)', async () => {
      await expect(page).toHaveURL(/bu-web\/auth\/forgot-success/, { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Your password was updated!' })).toBeVisible({ timeout: 10000 });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1.3 — Link bank account, add funds, pre-fund via wire API
  // ─────────────────────────────────────────────────────────────────────────
  test('1.3 — Link bank account, add funds, and pre-fund via wire API', async ({ page, request }) => {
    test.setTimeout(180000);

    const state = loadSignupData();
    const { email, firstName, lastName, businessId, clientId, accountNumber, encodedTotpSecret } = state;

    console.log('══════════════════════════════════════════════');
    console.log('  1.3 Payment Setup — loaded state');
    console.log('══════════════════════════════════════════════');
    console.log('  email             :', email);
    console.log('  name              :', firstName, lastName);
    console.log('  businessId        :', businessId);
    console.log('  clientId          :', clientId);
    console.log('  accountNumber     :', accountNumber);
    console.log('  encodedTotpSecret :', encodedTotpSecret);
    console.log('══════════════════════════════════════════════');

    const signInPage       = new BuWebSignInPage(page);
    const verificationPage = new VerificationPage(page);
    const achLinkPage      = new AchLinkPage(page);
    const addFundsPage     = new AddFundsPage(page);
    let profileResponsePromise;
    let accountInfoResponsePromise;
    let totpSecretPromise;

    await test.step('Step 1 | Sign in with email', async () => {
      await signInPage.goto();
      await signInPage.enterEmail(email);
    });

    await test.step('Step 2 | Enter password', async () => {
      await signInPage.loginWithPassword(FIRST_LOGIN_PASSWORD);
    });

    await test.step('Step 3 | Retrieve OTP from API and verify', async () => {
      await verificationPage.digit1Input.waitFor({ state: 'visible', timeout: 15000 });

      // Registered before submitting the OTP — verifying it is what redirects into 2FA
      // setup, where generate-code fires immediately. Profile/account-info are also
      // registered here (not in Step 4) since they can fire as soon as the OTP is
      // verified, before 2FA setup/entry even completes.
      totpSecretPromise = page.waitForResponse(
        res => res.url().includes('/identity/v1/2fa/generate-code') && res.request().method() === 'GET',
        { timeout: 30000 },
      ).catch(() => null);
      profileResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/clientaccount/v1/business/account/info') && response.status() === 200,
        { timeout: 60000 },
      );
      accountInfoResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/business/v1/account-info') && response.status() === 200,
        { timeout: 60000 },
      );

      const otp = await getOtpForBusinessEmail(request, email);
      await verificationPage.verifyAndProceedAsNewUser(otp);
    });

    await test.step('Step 4 | Complete 2FA setup (extract secret from API, generate and submit code)', async () => {
      // First time through, generate-code fires and hands us a fresh secret; on a
      // re-run against an already-configured account it won't fire, so fall back to
      // whatever secret is already in shared state.
      let totpSecret = encodedTotpSecret;
      const totpSecretRes = await totpSecretPromise;
      if (totpSecretRes) {
        expect(totpSecretRes.status(), '2fa/generate-code should return 200').toBe(200);
        const body = await totpSecretRes.json();
        totpSecret = body.encodedTotpSecret;
        expect(totpSecret, 'encodedTotpSecret must be present').toBeTruthy();
        saveExtendedState({ encodedTotpSecret: totpSecret });
        console.log('[1.3] 2FA set up on this login — encodedTotpSecret saved to shared state.');

        // First-time setup shows a QR-code screen ("Please use Google authenticator to
        // proceed") before the code-entry screen appears — dismiss it to continue.
        await page.getByRole('button', { name: 'Next' }).click();
      }

      await verificationPage.digit1Input.waitFor({ state: 'visible', timeout: 15000 });
      const isMultiDigit = await page.getByRole('textbox', { name: 'Digit 2' }).isVisible();

      const enterAndSubmitTotp = async () => {
        const totpCode = authenticator.generate(totpSecret);
        if (isMultiDigit) {
          await verificationPage.enterVerificationCode(totpCode);
        } else {
          await verificationPage.digit1Input.fill(totpCode);
        }
        await page.getByRole('button', { name: 'Next' }).click();
      };

      await enterAndSubmitTotp();
      const navigated = await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 10000 })
        .then(() => true).catch(() => false);

      if (!navigated) {
        const msToNextWindow = 30000 - (Date.now() % 30000);
        console.log('[Step 4] TOTP not accepted — waiting', Math.ceil((msToNextWindow + 1000) / 1000), 's for next window');
        await page.waitForTimeout(msToNextWindow + 1000);
        await enterAndSubmitTotp();
        await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 35000 });
      }

      await page.waitForTimeout(1000);
    });

    await test.step('Step 5 | Verify business account-info APIs, then welcome UI', async () => {
      const profileResponse = await profileResponsePromise;
      const profileData = await profileResponse.json();
      expect(profileData, 'GET /clientaccount/v1/business/account/info should include clientId').toMatchObject({
        clientId: expect.anything(),
      });

      const accountInfoData = await (await accountInfoResponsePromise).json();
      expect(
        accountInfoData[0]?.accountNumber,
        'GET /business/v1/account-info should include accountNumber',
      ).toBeDefined();

      // Bu-web's welcome banner splits the name and the welcome copy across two lines
      // (no single "Dear X, Bivo welcomes you!" string, and no "account is now active" text).
      await expect(page.getByTestId('welcome-card-title')).toHaveText(`Dear ${firstName} ${lastName},`, { timeout: 15000 });
      await expect(page.getByTestId('welcome-card-description')).toContainText('Bivo welcomes you!', { timeout: 15000 });
    });

    await test.step('Step 6 | Pre-fund account via incoming wire API', async () => {
      await depositFundsViaWire(request, accountNumber, { amount: PREFUND_AMOUNT });
    });

    await test.step('Step 7 | Refresh dashboard and verify balance reflects the pre-fund top-up', async () => {
      // Bu-web's balance endpoint is /business/v1/balance (not user-web's
      // /transactions/v1/transactions/accountbalance), though the response shape
      // (including availableToSpend) is identical. We're already on the dashboard
      // from Step 5, so a plain reload is enough to trigger a fresh fetch.
      const balancePromise = page.waitForResponse(
        (r) =>
          r.url().includes('/business/v1/balance') &&
          r.request().method() === 'GET' &&
          r.ok(),
        { timeout: 30000 },
      );

      await page.reload({ waitUntil: 'networkidle' });

      const balance = await (await balancePromise).json();
      expect(
        balance.availableToSpend,
        'available balance should reflect the wire top-up',
      ).toBeGreaterThanOrEqual(PREFUND_AMOUNT);
    });

    let bankAlreadyLinked = false;

    await test.step('Step 8 | Navigate to Link Bank Account', async () => {
      await page.getByRole('link', { name: 'Move Money' }).click();
      await page.getByRole('link', { name: 'Link Account' }).click();

      bankAlreadyLinked = await page.getByRole('heading', { name: 'Linked Accounts' })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true).catch(() => false);

      if (!bankAlreadyLinked) {
        await page.getByText('Link instantly').click();
      }
    });

    await test.step('Step 9 | Complete Plaid / Chase sandbox flow', async () => {
      if (bankAlreadyLinked) return;
      const chasePopup = await achLinkPage.startPlaidChaseFlow();
      await achLinkPage.completeChaseLogin(chasePopup);
    });

    await test.step('Step 10 | Dismiss Plaid save-credentials prompt', async () => {
      if (bankAlreadyLinked) return;
      await achLinkPage.dismissSaveCredentials();
    });

    await test.step('Step 11 | Confirm Chase account linked', async () => {
      if (bankAlreadyLinked) return;
      await achLinkPage.doneButton.waitFor({ state: 'visible', timeout: 15000 });
      await achLinkPage.doneButton.click();
      await expect(page.locator('#root')).toContainText('Chase************0000', { timeout: 15000 });
    });

    await test.step('Step 12 | Navigate to Add Funds', async () => {
      await page.getByRole('link', { name: 'Add Funds' }).waitFor({ state: 'visible', timeout: 5000 });
      await page.getByRole('link', { name: 'Add Funds' }).click();
    });

    await test.step('Step 13 | Select Chase account and enter amount', async () => {
      await addFundsPage.selectChaseAccount();
      await addFundsPage.enterAmountAndProceed(DEPOSIT_AMOUNT);
    });

    await test.step('Step 14 | Review and confirm transfer', async () => {
      await addFundsPage.reviewAndConfirmTransfer();
    });

    await test.step('Step 15 | Verify success banner', async () => {
      await addFundsPage.confirmTransferSuccess(DEPOSIT_AMOUNT);
    });

    await test.step('Step 16 | Verify pending transaction in wallet ledger', async () => {
      await page.getByRole('link', { name: 'Business Accounts' }).click();
      await addFundsPage.verifyPendingTransaction(DEPOSIT_AMOUNT);
    });
  });

});
