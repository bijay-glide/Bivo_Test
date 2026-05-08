// Tests run serially (fullyParallel: false) so each login happens one at a time — no OTP collisions.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test } = require('@playwright/test');
const { generateFxTransactionData } = require('../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../pages/FxTransactionPage');
const { TOP_FX_COUNTRIES } = require('../../../utils/fx-countries');
const { COUNTRY_BANKING_CONFIGS } = require('../../../utils/fx-country-configs');

test.describe('User-web FX — top destination countries', () => {
  for (const countryCode of TOP_FX_COUNTRIES) {
    test(`FX transaction — ${countryCode}`, async ({ page, request }) => {
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
        const userData = resolveUserDataForLogin();
        await loginUserWebWithPhone({ page, request, userData });
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
        await fxPage.enterBankingDetailsByChannel(config);
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Fill note and confirm transaction', async () => {
        await fxPage.fillFxPaymentNote(fxData.note);
        await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      });

      await test.step('Step 9 | Verify processing modal', async () => {
        await fxPage.verifyProcessingAndDismiss();
      });
    });
  }
});
