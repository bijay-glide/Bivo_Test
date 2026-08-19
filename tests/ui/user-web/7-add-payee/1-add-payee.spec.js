process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { generateFxTransactionData, generateBankingDetails } = require('../../../utils/test-data-generator');
const AddPayeePage = require('../../../pages/AddPayeePage');
const { COUNTRY_BANKING_CONFIGS } = require('../../../utils/fx-country-configs');

// Countries covered by the payee-add sidebar flow (excludes SV which is BCR-Pay only).
const PAYEE_COUNTRIES = ['GB', 'AU', 'IN', 'JP', 'HK', 'CN', 'MX'];

test.describe('User-web — Add Payee (multi-country)', () => {
  for (const countryCode of PAYEE_COUNTRIES) {
    test(`Add payee — ${countryCode}`, async ({ page, request }) => {
      test.setTimeout(120000);

      const config = COUNTRY_BANKING_CONFIGS[countryCode];
      if (!config) {
        throw new Error(`No banking config for "${countryCode}" — add it to utils/fx-country-configs.js`);
      }

      const payeePage = new AddPayeePage(page);
      const txData = generateFxTransactionData({ countryCode });
      const bankingDetails = generateBankingDetails(countryCode);

      // Registered before login so the listener is in place regardless of when the app first calls this endpoint.
      const accountsListResponsePromise = page.waitForResponse(
        res => res.url().includes('/remittance/v1/beneficiary/accounts') && res.request().method() === 'GET',
        { timeout: 30000 },
      ).catch(() => null);

      await test.step('Step 1 | Login', async () => {
        const userData = resolveUserDataForLogin();
        await loginUserWebWithPhone({ page, request, userData });
      });

      await test.step('Step 2 | Navigate to Payees', async () => {
        await payeePage.navigateToPayees();
      });

      await test.step(`Step 3 | Open Add Payee — select ${countryCode}`, async () => {
        const accountsListResponse = await accountsListResponsePromise;
        if (accountsListResponse) {
          expect(
            accountsListResponse.status(),
            'GET /remittance/v1/beneficiary/accounts should return 200',
          ).toBe(200);
        }
        await payeePage.clickAddPayee();
        await payeePage.selectCountry(countryCode);
      });

      await test.step('Step 4 | Fill personal info', async () => {
        const { responseBody } = await payeePage.fillPersonalInfoAndCaptureApi(
          txData.beneficiaryFirstName,
          txData.beneficiaryLastName,
          txData.payeeExtraFields,
        );
        expect(responseBody.referenceId, 'personal-info POST should return referenceId').toBeTruthy();
      });

      await test.step('Step 5 | Fill banking details', async () => {
        const { acctResponse } = await payeePage.fillBankingDetailsByChannelAndCaptureApi(
          config.channel,
          bankingDetails,
        );
        expect(acctResponse.ok(), `account POST should succeed for ${countryCode}`).toBeTruthy();
      });

      await test.step('Step 6 | Verify payee visible in list', async () => {
        await payeePage.verifyPayeeInList(
          txData.beneficiaryFirstName,
          txData.beneficiaryLastName,
        );
      });
    });
  }
});
