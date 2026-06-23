require('./state-suite-env');

const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const UserWebAddAccountPage = require('../../../pages/UserWebAddAccountPage');

// The name-only "Add an Account" modal opens a secondary account in the base
// currency (USD). Put the currency at the end of the label so it is easy to tell
// apart from the multicurrency accounts (mirrors "QA Account <CODE>" in 1.13).
const ACCOUNT_NAME = 'QA Account USD';

test.describe('User-web — Open new account', () => {
  // The "Add an Account" modal lives behind a sidebar that the SPA occasionally
  // re-renders mid-click; the page object self-heals, but retry once for safety.
  test.describe.configure({ retries: 1 });

  test('Open a new account', async ({ page, request }) => {
    test.setTimeout(120000);

    const addAccountPage = new UserWebAddAccountPage(page);

    await test.step('Step 1 | Login', async () => {
      const userData = resolveUserDataForLogin();
      await loginUserWebWithPhone({ page, request, userData });
    });

    await test.step('Step 2 | Open the Add Account modal', async () => {
      await addAccountPage.openAddAccountModal();
    });

    await test.step(`Step 3 | Create account "${ACCOUNT_NAME}"`, async () => {
      const response = await addAccountPage.createAccount(ACCOUNT_NAME);
      expect(response.ok(), 'spending-account add-secondary POST should succeed').toBeTruthy();
    });

    await test.step('Step 4 | Verify new account is listed', async () => {
      await addAccountPage.verifyAccountInList(ACCOUNT_NAME);
    });
  });
});
