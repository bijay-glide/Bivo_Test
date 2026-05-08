// Runs once before the FX multi-country parallel suite.
// Logs in and saves browser state.
process.env.BIVO_UI_STATE_SUITE = 'userweb';

const { test: setup } = require('@playwright/test');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');

const AUTH_STATE_FILE = 'test-results/auth-userweb.json';

setup('authenticate user-web', async ({ page, request }) => {
  setup.setTimeout(90000);
  const userData = resolveUserDataForLogin();
  await loginUserWebWithPhone({ page, request, userData });
  await page.context().storageState({ path: AUTH_STATE_FILE });
});

module.exports = { AUTH_STATE_FILE };
