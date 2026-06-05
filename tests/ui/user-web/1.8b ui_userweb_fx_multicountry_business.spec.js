// Business-payee counterpart to 1.8 ui_userweb_fx_multicountry.spec.js.
// Runs the same TOP_FX_COUNTRIES loop but selects the Business tab on the
// country picker and asserts that POST /remittance/v1/international/payment
// returns a paymentIdentifier (transaction was successfully initiated).
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const {
  generateFxTransactionData,
  generateBankingDetailsForBusiness,
  generateBusinessPayeeExtraFields,
} = require('../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../pages/FxTransactionPage');
const { TOP_FX_COUNTRIES } = require('../../../utils/fx-countries');
const { COUNTRY_BANKING_CONFIGS } = require('../../../utils/fx-country-configs');

test.describe('User-web FX — Business payee, top destination countries', () => {
  for (const countryCode of TOP_FX_COUNTRIES) {
    test(`FX business transaction — ${countryCode}`, async ({ page, request }) => {
      test.setTimeout(180000);

      const config = COUNTRY_BANKING_CONFIGS[countryCode];
      if (!config) throw new Error(`No banking config for "${countryCode}" — add it to utils/fx-country-configs.js`);

      const fxPage = new FxTransactionPage(page);
      const fxData = generateFxTransactionData({
        randomizeSendAmountUsd: true,
        note: 'Business payment from Bivo',
        countryCode,
      });
      // Some countries use a different banking channel for business (e.g. CN: Alipay → bank deposit)
      const bankingChannel = config.businessChannel ?? config.channel;
      const bankingDetails = generateBankingDetailsForBusiness(countryCode);
      const businessExtraFields = generateBusinessPayeeExtraFields(countryCode);

      await test.step('Step 1 | Login', async () => {
        const userData = resolveUserDataForLogin();
        await loginUserWebWithPhone({ page, request, userData });
      });

      await test.step('Step 2 | Open Create FX Transaction', async () => {
        await fxPage.navigateToCreateFxTransactionUserWeb();
      });

      await test.step('Step 3 | Switch to Business tab and select destination country', async () => {
        await page.getByText('Business', { exact: true }).click();
        await fxPage.selectBusinessDestinationCountryByTestId(countryCode);
      });

      await test.step('Step 4 | Enter send amount and continue', async () => {
        await fxPage.userWebFocusYouSendSection();
        await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
        await fxPage.continue();
      });

      await test.step('Step 5 | Add business payee', async () => {
        const businessName = `${fxData.beneficiaryFirstName} Corp`;
        await fxPage.addBusinessPayee(businessName, businessExtraFields);
      });

      await test.step('Step 6 | Enter banking details', async () => {
        await fxPage.enterBankingDetailsByChannel({ channel: bankingChannel, bankingDetails });
      });

      await test.step('Step 7 | Identity verification if present', async () => {
        await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      });

      await test.step('Step 8 | Fill note and confirm — assert paymentIdentifier returned', async () => {
        await fxPage.fillFxPaymentNote(fxData.note);
        const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
        expect(
          paymentIdentifier,
          `POST /remittance/v1/international/payment should return a paymentIdentifier for ${countryCode} (business)`,
        ).toBeTruthy();
      });

      await test.step('Step 9 | Verify post-confirmation state — Processing or Ways To Fund', async () => {
        // Business FX shows either "Processing Transaction" (wallet has sufficient balance)
        // or "Ways To Fund" (wallet balance low — app asks for a funding source).
        // Both confirm the transaction was accepted; paymentIdentifier assertion in step 8
        // is the definitive "initiated" check.
        const processingHeading = page.getByRole('heading', { name: 'Processing Transaction' });
        const waysToFundHeading = page.getByRole('heading', { name: 'Ways To Fund' });

        await expect(
          processingHeading.or(waysToFundHeading),
          'Expected either Processing Transaction modal or Ways To Fund funding screen',
        ).toBeVisible({ timeout: 15000 });

        if (await processingHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
          await fxPage.verifyProcessingAndDismiss();
        }
        // Ways To Fund: transaction was created and accepted — no further action needed
      });
    });
  }
});
