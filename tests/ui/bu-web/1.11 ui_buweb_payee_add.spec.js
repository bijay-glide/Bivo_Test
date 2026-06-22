require('./state-suite-env');

const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../utils/ui-login-helper');
const { generateFxTransactionData, generateBankingDetails } = require('../../../utils/test-data-generator');
const AddPayeePage = require('../../../pages/AddPayeePage');
const { COUNTRY_BANKING_CONFIGS } = require('../../../utils/fx-country-configs');

// Countries covered by the payee-add sidebar flow.
// Excludes SV (BCR-Pay only) and CN — on bu-web the CN (Alipay) banking-details
// screen renders no input fields (empty "Account Details" card with only Continue),
// so the individual payee flow can't be completed for CN here. Verified June 2026.
const PAYEE_COUNTRIES = ['GB', 'AU', 'IN', 'JP', 'HK', 'MX'];

test.describe('Bu-web — Add Payee (multi-country)', () => {
  // Multi-country loop on a shared persistent context is occasionally flaky
  // (slow channels API re-render, context reuse) — re-run a flaked country once.
  test.describe.configure({ retries: 1 });

  for (const countryCode of PAYEE_COUNTRIES) {
    test(`Add payee — ${countryCode}`, async ({ page }) => {
      test.setTimeout(120000);

      const config = COUNTRY_BANKING_CONFIGS[countryCode];
      if (!config) {
        throw new Error(`No banking config for "${countryCode}" — add it to utils/fx-country-configs.js`);
      }

      const payeePage = new AddPayeePage(page);
      const txData = generateFxTransactionData({ countryCode });
      const bankingDetails = generateBankingDetails(countryCode);

      await test.step('Step 1 | Login', async () => {
        const userData = resolveBuWebUserDataForLogin();
        await loginBuWebWithEmail({ page, userData });
      });

      await test.step('Step 2 | Navigate to Payees', async () => {
        await payeePage.navigateToPayeesBuWeb();
      });

      await test.step(`Step 3 | Open Add Payee — select ${countryCode}`, async () => {
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
