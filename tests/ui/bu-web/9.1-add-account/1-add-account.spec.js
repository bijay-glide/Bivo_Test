require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const { generateAccountName } = require('../../../../utils/test-data-generator');
const { saveExtendedState } = require('../../../../utils/shared-state');
const AddAccountPage = require('../../../../pages/AddAccountPage');

test.describe('Bu-web — Open new currency account', () => {
  // The "Add Account" modal lives behind a sidebar that the SPA occasionally
  // re-renders mid-click; the page object self-heals, but retry once for safety.
  test.describe.configure({ retries: 1 });

  test('Open a new business currency account', async ({ page }) => {
    test.setTimeout(120000);

    const addAccountPage = new AddAccountPage(page);
    // Letters/spaces only — the modal rejects numbers and special characters.
    const accountName = generateAccountName();

    await test.step('Step 1 | Login', async () => {
      const userData = resolveBuWebUserDataForLogin();
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Open the Add Account modal', async () => {
      await addAccountPage.openAddAccountModal();
    });

    await test.step(`Step 3 | Create account "${accountName}"`, async () => {
      const response = await addAccountPage.createAccount(accountName);
      expect(response.ok(), 'spending-account POST should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Verify new account is listed', async () => {
      await addAccountPage.verifyAccountInSidebar(accountName);
    });

    await test.step('Step 5 | Persist secondary-account flag to shared state', async () => {
      saveExtendedState({ secondaryUsdAccountCreated: true });
    });
  });
});
