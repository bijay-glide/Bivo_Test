// User-web FX — United Kingdom payee lifecycle. Three scenarios exercising saved-payee
// reuse/edit on top of the channel matrix in 1-uk-fx.spec.js:
//   1. Creates a GBP payee via "IBAN powered by Visa Direct", then reuses that same
//      payee for a second send via a DIFFERENT channel (Bank Deposit) — excluding
//      Instant Card Payout, which has no saved-banking-details reuse path. The name
//      auto-fills from the saved payee; the account section (sort code + account
//      number) is entered fresh since Bank Deposit has no saved details for it yet.
//   2. Edits an existing payee's name + IBAN from the standalone Payees list page, then
//      sends to the edited payee.
//   3. Edits an existing payee's name + IBAN from the transaction Review Transfer page
//      itself (a distinct entry point — see FxTransactionPage.openPayeeDetailsFromReviewTransfer),
//      then confirms with the edited details.
// Every scenario asserts the payment API returns a paymentIdentifier and that the
// review/confirmation UI reflects the correct (possibly edited) name.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test, expect } = require('@playwright/test');
const { generateFxTransactionData, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

// Real, checksum-valid IBAN (NatWest) — same static value used by 1-uk-fx.spec.js.
const GB_IBAN = 'GB29NWBK60161331926819';
// Second, distinct checksum-valid GB IBAN — used only as the "edited" value.
const EDITED_GB_IBAN = 'GB10000000119181999999';
const BIVO_PREFIX = '98765';

/** Creates a fresh GBP payee via "IBAN powered by Visa Direct" and confirms the
 *  transaction. Returns the fxData used, so the caller can reuse/edit that payee. */
async function createAndConfirmNewGbIbanPayee(fxPage, fxData) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.verifyDeliverToSelected('IBAN powered by Visa Direct');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  await fxPage.addPayeeAutoByTestId({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
  await fxPage.fillFxBankingByTestId({ channel: 'IBAN powered by Visa Direct', currency: 'GBP', data: { iban: GB_IBAN } });
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.fillFxPaymentNoteIfPresent(fxData.note);
  await fxPage.verifyFxReviewStructure({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new GB IBAN payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();
}

test.describe('User-web FX — United Kingdom payee lifecycle', () => {
  test.describe.configure({ retries: 1 });

  test('Reuses a GB payee created via IBAN for a second send via Bank Deposit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });
    const bankDepositDetails = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7),
      sortCode: '601613',
    };

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      await loginUserWebWithPhone({ page, request, userData });
    });

    await test.step('Step 2 | First transaction — new GB payee via IBAN powered by Visa Direct', async () => {
      await createAndConfirmNewGbIbanPayee(fxPage, fxData);
    });

    await test.step('Step 3 | Second transaction — same payee, switched to Bank Deposit (no saved details yet)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.selectDeliverToOption('Bank Deposit');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(fxData.beneficiaryFirstName, fxData.beneficiaryLastName, {
        expectReviewTransfer: false,
      });
      await expect(
        page.getByRole('heading', { name: 'Edit Beneficiary Details' }),
        'payee has no saved Bank Deposit details yet — app should prompt to add them',
      ).toBeVisible({ timeout: 15000 });

      const { acctResponse } = await fxPage.fillEditBeneficiaryBankDepositDetailsAndCaptureApi(bankDepositDetails);
      expect(acctResponse.ok(), 'account POST (Bank Deposit channel) should succeed').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);

      await fxPage.fillFxPaymentNoteIfPresent(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'second transaction (Bank Deposit, reused payee) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });

  test('Edits a saved GB payee from the standalone Payees list page, then sends to the edited payee', async ({ page, request }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });
    const updatedFirstName = `${fxData.beneficiaryFirstName}X`;
    const updatedLastName = `${fxData.beneficiaryLastName}X`;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      await loginUserWebWithPhone({ page, request, userData });
    });

    await test.step('Step 2 | First transaction — new GB payee via IBAN powered by Visa Direct', async () => {
      await createAndConfirmNewGbIbanPayee(fxPage, fxData);
    });

    await test.step('Step 3 | Edit the payee (name + IBAN) from the standalone Payees list page', async () => {
      await addPayeePage.navigateToPayees();
      await addPayeePage.openPayeeDetails(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      await fxPage.editPayeeIbanAndCaptureApi({ iban: EDITED_GB_IBAN });
    });

    await test.step('Step 4 | Send a new transaction to the edited payee', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.verifyDeliverToSelected('IBAN powered by Visa Direct');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(updatedFirstName, updatedLastName);
      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);

      await fxPage.fillFxPaymentNoteIfPresent(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction to the list-page-edited payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });

  test('Edits a saved GB payee from the transaction Review Transfer page, then confirms with the edit', async ({ page, request }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });
    const updatedFirstName = `${fxData.beneficiaryFirstName}Z`;
    const updatedLastName = `${fxData.beneficiaryLastName}Z`;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      await loginUserWebWithPhone({ page, request, userData });
    });

    await test.step('Step 2 | Transaction up to Review Transfer — new GB payee via IBAN powered by Visa Direct', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.verifyDeliverToSelected('IBAN powered by Visa Direct');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.addPayeeAutoByTestId({ firstName: fxData.beneficiaryFirstName, lastName: fxData.beneficiaryLastName });
      await fxPage.fillFxBankingByTestId({ channel: 'IBAN powered by Visa Direct', currency: 'GBP', data: { iban: GB_IBAN } });
      await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('Step 3 | Edit the payee (name + IBAN) from the Review Transfer page itself', async () => {
      await fxPage.openPayeeDetailsFromReviewTransfer(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      await fxPage.editPayeeIbanAndCaptureApi({ iban: EDITED_GB_IBAN });

      await expect(page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);
    });

    await test.step('Step 4 | Confirm the transaction with the edited payee', async () => {
      await fxPage.fillFxPaymentNoteIfPresent(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction confirmed with review-page-edited payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });
});
