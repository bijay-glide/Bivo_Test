require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { getOtpForBusinessEmail } = require('../../../utils/otp-helper');
const { generateBuWebTestData } = require('../../../utils/test-data-generator');
const VerificationPage = require('../../../pages/VerificationPage');
const BuWebSignInPage = require('../../../pages/BuWebSignInPage');
const BuWebGetStartedPage = require('../../../pages/BuWebGetStartedPage');
const BuWebBusinessAddressPage = require('../../../pages/BuWebBusinessAddressPage');
const BuWebBusinessVerificationPage = require('../../../pages/BuWebBusinessVerificationPage');
const BuWebBeneficialOwnerPage = require('../../../pages/BuWebBeneficialOwnerPage');
const BuWebAdditionalInfoPage = require('../../../pages/BuWebAdditionalInfoPage');
const BuWebAgreementsPage = require('../../../pages/BuWebAgreementsPage');

const { saveExtendedState } = require('../../../utils/shared-state');

const KEYCLOAK_TOKEN_URL = `${process.env.KEYCLOAK_HOST}/realms/glidecash/protocol/openid-connect/token`;
const APPROVE_URL        = `${process.env.HOST}/clientaccount/v1/internal/business/account/approve`;
const TENANT             = process.env.TENANT_IDENTIFIER;

test.describe('Bu-web business onboarding', () => {
  test('Complete business signup through verification submission', async ({ page, request }) => {
    test.setTimeout(180000);
    const testData = generateBuWebTestData();
    console.log('business email:', testData.email);

    const signInPage          = new BuWebSignInPage(page);
    const verificationPage    = new VerificationPage(page);
    const getStartedPage      = new BuWebGetStartedPage(page);
    const businessAddressPage = new BuWebBusinessAddressPage(page);
    const verificationHubPage = new BuWebBusinessVerificationPage(page);
    const beneficialOwnerPage = new BuWebBeneficialOwnerPage(page);
    const additionalInfoPage  = new BuWebAdditionalInfoPage(page);
    const agreementsPage      = new BuWebAgreementsPage(page);

    // ── Network interceptor — captures account-info GET when dashboard loads ──
    // The dashboard (verification hub) fires a GET to one of the business account
    // endpoints after account creation. We listen broadly and pick the first one
    // that returns a body containing businessId or accountNumber.
    let _dashboardAccountInfo = null;
    page.on('response', async res => {
      if (_dashboardAccountInfo) return;
      const url = res.url();
      if (
        res.request().method() !== 'GET' ||
        !res.ok()
      ) return;
      if (
        url.includes('/clientaccount/v1/business') ||
        url.includes('/business/v1/business/account')
      ) {
        try {
          const body = await res.json();
          if (body && (body.businessId || body.accountNumber || body.clientId)) {
            _dashboardAccountInfo = body;
          }
        } catch { /* non-JSON — skip */ }
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

      const accountRes  = await testData._accountPromise;
      expect(accountRes.status()).toBe(200);

      // ── Extract businessId, clientId, accountNumber from account creation response ──
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

      await expect(page.locator('#root')).toContainText(`Dear ${testData.getStarted.firstName} ${testData.getStarted.lastName},`);
      await expect(page.locator('#root')).toContainText('Business Verification');
    });

    await test.step('Step 5 | Business Registration Document — review content', async () => {
      await verificationHubPage.goto();

      // If account creation didn't return businessId, fall back to the dashboard API response
      if (!testData.businessId && _dashboardAccountInfo) {
        testData.businessId  = _dashboardAccountInfo.businessId  ?? testData.businessId;
        testData.clientId    = _dashboardAccountInfo.clientId    ?? testData.clientId;
        testData.accountNumber = _dashboardAccountInfo.accountNumber ?? testData.accountNumber;
        console.log('── Dashboard API fallback ───────────────────');
        console.log('businessId   :', testData.businessId);
        console.log('clientId     :', testData.clientId);
        console.log('accountNumber:', testData.accountNumber);
        console.log('─────────────────────────────────────────────');
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

    // ── Use the dashboard interceptor as a last fallback ────────────────────
    if (!testData.businessId && _dashboardAccountInfo) {
      testData.businessId    = _dashboardAccountInfo.businessId    ?? testData.businessId;
      testData.clientId      = _dashboardAccountInfo.clientId      ?? testData.clientId;
      testData.accountNumber = _dashboardAccountInfo.accountNumber ?? testData.accountNumber;
    }

    await test.step('Step 9 | Approve business account via internal API', async () => {
      // ── 1. Get Keycloak client_credentials token ──────────────────────────
      const tokenRes = await request.post(KEYCLOAK_TOKEN_URL, {
        headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
        data    : new URLSearchParams({
          client_id    : process.env.TRANSACTION_CLIENT_ID,
          client_secret: process.env.TRANSACTION_CLIENT_SECRET,
          grant_type   : process.env.TRANSACTION_GRANT_TYPE,
          glide_auth_type: process.env.TRANSACTION_GRANT_TYPE,
        }).toString(),
      });
      expect(tokenRes.status(), 'Keycloak token should return 200').toBe(200);
      const { access_token: bearerToken } = await tokenRes.json();
      console.log('Keycloak token obtained ✓');

      // ── 2. Approve the business account ──────────────────────────────────
      console.log('Approving businessId:', testData.businessId);
      const approveRes = await request.post(APPROVE_URL, {
        headers: {
          'Authorization'       : `Bearer ${bearerToken}`,
          'X-Tenant-Identifier' : TENANT,
          'Content-Type'        : 'application/json',
          'client-ip'           : '10.128.90.229',
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

      // Persist to shared state so 1.2 (first login) and 1.3 (payment setup) can load it
      saveExtendedState({
        email      : testData.email,
        firstName  : testData.getStarted.firstName,
        lastName   : testData.getStarted.lastName,
        businessId : testData.businessId,
        clientId   : testData.clientId,
        accountNumber: testData.accountNumber,
      });
    });
  });
});
