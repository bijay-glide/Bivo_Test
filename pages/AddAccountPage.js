const { expect } = require('@playwright/test');

/**
 * AddAccountPage
 *
 * Covers the bu-web "open a new currency account" flow:
 *   Business Accounts (sidebar) → Add Account → "Add an Account" modal
 *   → enter account name → Add Account → new account appears in the sidebar.
 *
 * The account-name field validates "No number or special char allowed.", so the
 * submit button only enables once the name is letters/spaces only
 * (see generateAccountName in utils/test-data-generator.js).
 */
class AddAccountPage {
  constructor(page) {
    this.page = page;

    // Sidebar — "Business Accounts" expands to reveal the account list + "Add Account".
    this.businessAccountsLink = page.getByRole('link', { name: 'Business Accounts' });
    this.addAccountLink       = page.getByRole('link', { name: 'Add Account' });

    // "Add an Account" modal (Bootstrap dialog).
    this.modal           = page.locator('[role="dialog"]');
    this.modalHeading    = this.modal.getByText('Add an Account', { exact: true });
    this.accountNameInput = page.getByPlaceholder('Enter account name');
    // Scope the submit button to the modal — "Add Account" also exists as a sidebar link.
    this.submitButton    = this.modal.getByRole('button', { name: 'Add Account' });
    this.cancelButton    = this.modal.getByRole('button', { name: 'Cancel' });
  }

  /**
   * Expand "Business Accounts" and open the "Add an Account" modal.
   *
   * The SPA occasionally re-renders the sidebar mid-click and collapses the
   * sub-menu, so we re-expand until the "Add Account" link is clickable
   * (same self-healing pattern as AchLinkPage.clickLinkAccount).
   */
  async openAddAccountModal() {
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.businessAccountsLink.waitFor({ state: 'visible', timeout: 15000 });
      await this.businessAccountsLink.click();

      const addAccountVisible = await this.addAccountLink
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (addAccountVisible) break;
      if (attempt === MAX_ATTEMPTS) {
        throw new Error('"Add Account" link never appeared after expanding Business Accounts.');
      }
      console.log(`[AddAccountPage] "Add Account" not visible — re-expanding Business Accounts (attempt ${attempt}/${MAX_ATTEMPTS})`);
    }

    await this.addAccountLink.click();
    await this.modalHeading.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Fill the account name, submit, and return the create-account API response.
   * Resolves the POST /clientaccount/v1/business/spending-account response so the
   * caller can assert on its status.
   *
   * @param {string} name letters/spaces only
   * @returns {Promise<import('@playwright/test').Response>}
   */
  async createAccount(name) {
    await this.accountNameInput.click();
    await this.accountNameInput.fill(name);
    // The submit button is disabled until the name passes the letters-only validation.
    await expect(this.submitButton).toBeEnabled({ timeout: 10000 });

    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/clientaccount/v1/business/spending-account') &&
        response.request().method() === 'POST',
      { timeout: 20000 },
    );
    await this.submitButton.click();
    return responsePromise;
  }

  /**
   * Verify the newly created account is listed in the Business Accounts sidebar.
   * New accounts render as "<name> *****\n$0.00".
   *
   * @param {string} name
   */
  async verifyAccountInSidebar(name) {
    await expect(
      this.page.getByText(name, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
  }
}

module.exports = AddAccountPage;
