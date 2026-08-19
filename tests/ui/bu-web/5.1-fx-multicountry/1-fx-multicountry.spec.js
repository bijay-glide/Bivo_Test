require('./state-suite-env');

const { test } = require('../../../fixtures/ui-fixtures');
const { generateFxTransactionData, generateBankingDetails } = require('../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../pages/FxTransactionPage');
const { COUNTRY_BANKING_CONFIGS } = require('../../../utils/fx-country-configs');

// Representative subset of FX destinations for bu-web (individual payee).
// Expand once the flow is proven green; the FX UI is shared with user-web.
const FX_COUNTRIES = ['GB', 'IN', 'AU'];

test.describe('Bu-web FX — top destination countries', () => {
  for (const countryCode of FX_COUNTRIES) {
    test(`FX transaction — ${countryCode}`, async ({ page }) => {
      test.setTimeout(180000);

      const config = COUNTRY_BANKING_CONFIGS[countryCode];
      if (!config) throw new Error(`No banking config found for country "${countryCode}" — add it to utils/fx-country-configs.js`);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        randomizeSendAmountUsd: true,
        note: 'Sent from Bivo',
        countryCode,
      });

      await test.step('Step 1 | Login', async () => {
        const userData = resolveBuWebUserDataForLogin();
        await loginBuWebWithEmail({ page, userData });
      });

      await test.step('Step 2 | Open Create FX Transaction', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
      });

      await test.step(`Step 3 | Select ${countryCode} as destination`, async () => {
        await fxPage.selectDestinationCountryByTestId(countryCode);
      });

      await test.step('Step 4 | Enter send amount and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountWithData({ amountInput: fxData.amountInput });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add payee', async () => {
        await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, fxData.payeeExtraFields);
      });

      await test.step('Step 6 | Enter banking details', async () => {
        const bankingDetails = generateBankingDetails(countryCode);
        await fxPage.enterBankingDetailsByChannel({ channel: config.channel, bankingDetails });
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Fill note and confirm transaction', async () => {
        await fxPage.fillFxPaymentNote(fxData.note);
        await fxPage.fillFxInvoiceNumberIfPresent();
        await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      });

      await test.step('Step 9 | Verify processing modal', async () => {
        await fxPage.verifyProcessingAndDismiss();
      });
    });
  }
});
