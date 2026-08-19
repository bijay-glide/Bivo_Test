// Bu-web FX — saved payee lifecycle. Ported from user-web's 5.4-payee-fx. Five
// independent scenarios, each creating its own payee first (self-contained, no
// dependency on run order or sandbox data):
//   1. Reuse a saved payee for a second send.
//   2. View + edit a saved payee (name + IBAN) from within the FX flow, then send again
//      with the updated details.
//   3. A payee added via the standalone Payees page (not via the FX flow) is selectable
//      in an FX transaction via its default channel.
//   4. Sending to an existing payee via a delivery channel it has no banking details for
//      yet triggers "Edit Beneficiary Details" to collect that channel's details.
//   5. Editing a payee from the standalone Payees tab (not from within the FX flow) is
//      reflected in the FX transaction's Select Payee list, then sends with that payee.
// See tests/ui/user-web/5.4-payee-fx/1-payee-fx.spec.js for the original — this file
// swaps only the login helper and the bu-web Payees-tab navigation
// (navigateToPayeesBuWeb instead of navigateToPayees); all FxTransactionPage /
// AddPayeePage methods used are already shared cross-surface (proven by bu-web's own
// 5.1/5.2/5.3/7 files).
require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { generateFxTransactionData, generateRandomDigits } = require('../../../../utils/test-data-generator');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');
const AddPayeePage = require('../../../../pages/AddPayeePage');

// Second, distinct checksum-valid GB IBAN — used only as the "edited" value so the
// update request body provably differs from the payee's original IBAN.
const EDITED_GB_IBAN = 'GB10000000119181999999';

// Static prefix keeps generated banking fields recognisable as automated test data —
// same convention as 5.3's BIVO_PREFIX.
const BIVO_PREFIX = '98765';

/** Adds a fresh GB payee via the standalone Payees page (not the FX flow), on the default
 *  IBAN channel — asserts the personal-info + account APIs. */
async function addGbPayeeViaStandalonePage(addPayeePage, fxData) {
  await addPayeePage.navigateToPayeesBuWeb();
  await addPayeePage.clickAddPayee();
  await addPayeePage.selectCountry('GB');

  const { responseBody } = await addPayeePage.fillPersonalInfoAndCaptureApi(
    fxData.beneficiaryFirstName,
    fxData.beneficiaryLastName,
  );
  expect(responseBody.referenceId, 'personal-info POST should return a referenceId').toBeTruthy();

  const { acctResponse } = await addPayeePage.fillBankingDetailsByChannelAndCaptureApi('iban', { iban: fxData.iban });
  expect(acctResponse.ok(), 'account POST (IBAN channel) should succeed').toBeTruthy();
}

/** Creates a fresh GB payee via the FX flow (asserts personal-info + details APIs) and
 *  confirms the transaction (asserts paymentIdentifier). Returns the fxData used, so the
 *  caller can select/edit that same payee afterwards. */
async function createAndConfirmNewGbPayee(fxPage, fxData) {
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();

  const { referenceId } = await fxPage.addPayeeAndCapturePersonalInfoCreateApi({
    firstName: fxData.beneficiaryFirstName,
    lastName: fxData.beneficiaryLastName,
  });
  expect(referenceId, 'new payee personal-info POST should return a referenceId').toBeTruthy();

  await fxPage.enterIbanAndCapturePersonalInfoDetailsApi({
    iban: fxData.iban,
    referenceId,
    firstName: fxData.beneficiaryFirstName,
    lastName: fxData.beneficiaryLastName,
  });
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);

  await fxPage.fillFxPaymentNote(fxData.note);
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  expect(paymentIdentifier, 'first transaction (new payee) should return a paymentIdentifier').toBeTruthy();
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();
}

test.describe('Bu-web FX — saved payee reuse and edit', () => {
  test('Reuses a saved payee for a second FX send', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | First transaction — add a new GB payee (asserts personal-info + details APIs) and confirm', async () => {
      await createAndConfirmNewGbPayee(fxPage, fxData);
    });

    await test.step('Step 3 | Second transaction — select the saved payee (no Add Payee, no banking form)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await expect(page.locator('#root')).toContainText(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);

      await fxPage.fillFxPaymentNote(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'second transaction (saved payee) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });

  test('Views and edits a saved payee, then sends again with the updated details', async ({ page }) => {
    test.setTimeout(180000);

    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });
    // "X" suffix convention for an edited value — same pattern as user-web's 5.4.
    const updatedFirstName = `${fxData.beneficiaryFirstName}X`;
    const updatedLastName = `${fxData.beneficiaryLastName}X`;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | First transaction — add a new GB payee (asserts personal-info + details APIs) and confirm', async () => {
      await createAndConfirmNewGbPayee(fxPage, fxData);
    });

    await test.step('Step 3 | View the saved payee and edit its name + IBAN (asserts update APIs)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.viewExistingPayeeDetails(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      await fxPage.editPayeeIbanAndCaptureApi({ iban: EDITED_GB_IBAN });

      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);
    });

    await test.step('Step 4 | Confirm the edited-payee transaction — assert paymentIdentifier returned', async () => {
      await fxPage.fillFxPaymentNote(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'edited-payee transaction should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });

    await test.step('Step 5 | Verify the edited IBAN persisted server-side (beneficiary-accounts list)', async () => {
      await fxPage.verifyPayeeIbanPersisted({
        firstName: updatedFirstName,
        lastName: updatedLastName,
        iban: EDITED_GB_IBAN,
        amountInput: fxData.amountInput,
      });
    });
  });

  test('Payee added via the standalone Payees page is selectable in an FX transaction', async ({ page }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Add a GB payee from the standalone Payees page (asserts personal-info + account APIs)', async () => {
      await addGbPayeeViaStandalonePage(addPayeePage, fxData);
    });

    await test.step('Step 3 | FX transaction to that payee via its default channel (IBAN powered by Visa Direct)', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
      await fxPage.continue();

      await fxPage.selectExistingPayeeByName(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);

      await fxPage.fillFxPaymentNote(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction (default channel) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });

  test('Sending to an existing payee via a new delivery channel triggers Edit Beneficiary Details', async ({ page }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });
    const bankDepositDetails = {
      accountNumber: BIVO_PREFIX + generateRandomDigits(7), // 12 digits
      sortCode: '987' + generateRandomDigits(3),            // 6 digits
    };

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Add a GB payee from the standalone Payees page (asserts personal-info + account APIs)', async () => {
      await addGbPayeeViaStandalonePage(addPayeePage, fxData);
    });

    await test.step('Step 3 | FX transaction to the same payee via a DIFFERENT channel (Bank Deposit) — asserts the Edit Beneficiary Details redirect and its account API', async () => {
      await fxPage.navigateToCreateFxTransactionUserWeb();
      await fxPage.selectDestinationCountryByTestId('GB');
      await fxPage.userWebFocusYouSendSection();
      await fxPage.selectDeliverToOption('Bank Deposit');
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
      await fxPage.fillFxPaymentNote(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction (new channel) should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });

  test('Editing a payee from the Payees tab is reflected in the FX Select Payee list, then sends with that payee', async ({ page }) => {
    test.setTimeout(180000);

    const addPayeePage = new AddPayeePage(page);
    const fxPage = new FxTransactionPage(page);
    const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });
    // "Y" suffix — distinct from Test 2's "X" convention, purely to keep log output
    // unambiguous between the two edit scenarios.
    const updatedFirstName = `${fxData.beneficiaryFirstName}Y`;
    const updatedLastName = `${fxData.beneficiaryLastName}Y`;

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Add a GB payee from the standalone Payees page (asserts personal-info + account APIs)', async () => {
      await addGbPayeeViaStandalonePage(addPayeePage, fxData);
    });

    await test.step('Step 3 | Open the payee from the Payees tab and edit its name + IBAN (asserts update APIs)', async () => {
      await addPayeePage.openPayeeDetails(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
      await fxPage.editPayeeNameAndCaptureApi({ firstName: updatedFirstName, lastName: updatedLastName });
      await fxPage.editPayeeIbanAndCaptureApi({ iban: EDITED_GB_IBAN });
    });

    await test.step('Step 4 | Verify the edit is reflected in the FX transaction Select Payee list', async () => {
      await fxPage.verifyPayeeIbanPersisted({
        firstName: updatedFirstName,
        lastName: updatedLastName,
        iban: EDITED_GB_IBAN,
        amountInput: fxData.amountInput,
      });
      await expect(page.locator('#root')).toContainText(`${updatedFirstName} ${updatedLastName}`);
    });

    await test.step('Step 5 | Send a transaction to the edited payee — assert paymentIdentifier returned', async () => {
      // verifyPayeeIbanPersisted already lands on the Select Payee screen (its last
      // action is Continue) — no need to re-navigate.
      await fxPage.selectExistingPayeeByName(updatedFirstName, updatedLastName);
      await fxPage.fillFxPaymentNote(fxData.note);
      const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
      expect(paymentIdentifier, 'transaction to the edited payee should return a paymentIdentifier').toBeTruthy();
      await fxPage.verifyProcessingOrWaysToFundAndDismiss();
    });
  });
});
