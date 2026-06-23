const { expect } = require('@playwright/test');

/**
 * UserWebAddAccountPage
 *
 * User-web counterpart to bu-web's AddAccountPage — the simple "open a new
 * account" flow that adds a secondary account in the base currency (NOT the
 * multicurrency modal; see UserWebMultiCurrencyAccountPage for that).
 *
 *   Accounts (sidebar) → Add Account → "Add an Account" modal
 *   → enter account name → Add Account → POST .../spending-account/add-secondary
 *
 * The modal markup is identical to bu-web (heading "Add an Account",
 * placeholder "Enter account name"); only the sidebar entry and the create
 * endpoint differ. The name field rejects numbers/special chars, so the submit
 * button only enables once the name is letters/spaces only
 * (see generateAccountName in utils/test-data-generator.js).
 */
class UserWebAddAccountPage {
  constructor(page) {
    this.page = page;

    // Sidebar — Accounts section exposes the "Add Account" link.
    this.accountsNav    = page.getByTestId('Sidebar-nav-accounts');
    this.addAccountLink = page.getByTestId('Sidebar-accounts-addAccount');
    // Always present once the Accounts section has rendered — used as a load marker.
    this.accountsLoadedMarker = page.getByTestId('multicurrency-add-account-button');

    // "Add an Account" modal.
    this.modal            = page.locator('[role="dialog"]');
    this.modalHeading     = this.modal.getByText('Add an Account', { exact: true });
    this.accountNameInput = page.getByPlaceholder('Enter account name');
    // Scope the submit to the modal — "Add Account" also exists as the sidebar link.
    this.submitButton     = this.modal.getByRole('button', { name: 'Add Account' });
    this.cancelButton     = this.modal.getByRole('button', { name: 'Cancel' });
  }

  /**
   * Navigate to the Accounts section and open the "Add an Account" modal.
   *
   * "Add Account" is a sub-link under the Accounts nav that renders once the
   * Accounts section is open. Mirrors the proven sidebar-expand pattern used for
   * Move Money in exploratory.spec.js: click the nav, wait for the link, and
   * re-expand once or twice if it hasn't appeared yet. We deliberately avoid a
   * networkidle wait here — this SPA keeps background XHRs open, so networkidle
   * never settles and only wastes the timeout budget, mis-spacing the re-clicks.
   */
  async openAddAccountModal() {
    await this.accountsNav.waitFor({ state: 'visible', timeout: 15000 });
    await this.accountsNav.click();

    // Confirm the Accounts section rendered (the multicurrency button is a stable marker).
    await this.accountsLoadedMarker.first()
      .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    const linkVisible = (timeout) =>
      this.addAccountLink.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

    // First wait must be generous so a slow-rendering link is caught BEFORE we
    // re-click (re-clicking can collapse the just-expanded sub-menu).
    let appeared = await linkVisible(8000);
    for (let attempt = 1; !appeared && attempt <= 2; attempt++) {
      console.log(`[UserWebAddAccountPage] "Add Account" not visible — re-expanding Accounts (attempt ${attempt}/2)`);
      await this.accountsNav.click();
      appeared = await linkVisible(8000);
    }
    if (!appeared) {
      throw new Error('"Add Account" link never appeared after opening Accounts.');
    }

    await this.addAccountLink.scrollIntoViewIfNeeded().catch(() => {});
    await this.addAccountLink.click();
    await this.modalHeading.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Fill the account name, submit, and return the create-account API response.
   * Resolves the POST /clientaccount/v1/spending-account/add-secondary response
   * so the caller can assert on its status.
   *
   * @param {string} name letters/spaces only
   * @returns {Promise<import('@playwright/test').Response>}
   */
  async createAccount(name) {
    await this.accountNameInput.click();
    await this.accountNameInput.fill(name);
    // Submit stays disabled until the name passes the letters-only validation.
    await expect(this.submitButton).toBeEnabled({ timeout: 10000 });

    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/clientaccount/v1/spending-account/add-secondary') &&
        response.request().method() === 'POST',
      { timeout: 20000 },
    );
    await this.submitButton.click();
    const response = await responsePromise;
    await this.modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return response;
  }

  /**
   * Verify the newly created account is listed in the Accounts section.
   * @param {string} name
   */
  async verifyAccountInList(name) {
    await expect(
      this.page.getByText(name, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
  }
}

module.exports = UserWebAddAccountPage;
