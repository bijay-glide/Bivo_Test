const { expect } = require('@playwright/test');

/**
 * AchLinkPage
 *
 * Covers the full ACH account-linking flow:
 *   Link Account → Link ACH instantly → Plaid iframe → Chase popup → confirm result
 *
 * Plaid renders inside an iframe so every step that targets Plaid uses
 * this.plaidFrame which is a FrameLocator, not a Page. All Playwright
 * locator methods work on FrameLocator exactly as they do on a Page.
 */
class AchLinkPage {
  constructor(page) {
    this.page = page;

    // Parent nav link — needed to re-expand the menu if it collapses
    this.depositFundsLink = page.getByRole('link', { name: 'Deposit Funds' });

    // Sidebar sub-link shown after "Deposit Funds" is clicked
    this.linkAccountLink = page.getByRole('link', { name: 'Link Account' });
    // User-web shell: parent nav — re-click to re-expand if sub-menu collapses
    this.moveMoneyLinkUserWeb = page.getByRole('link', { name: 'Move Money' });
    // User-web shell variant
    this.linkAccountLinkUserWeb = page.getByRole('link', { name: 'Link Account' });

    // Card on the Link Account landing page
    this.linkAchInstantlyOption = page.getByText('Link ACH account instantly');
    this.linkAchInstantlyOptionUserWeb = page.getByText('Link ACH account instantly');

    // Plaid iframe — FrameLocator lets us query elements inside the iframe
    this.plaidFrame = page.locator('iframe[title="Plaid Link"]').contentFrame();

    // Post-link result elements (back on the main page, outside the iframe)
    this.linkExternalAccountHeading = page.getByRole('heading', { name: 'Link External Account' });
    this.linkSuccessText            = page.getByText('Your account has been successfully linked');
    this.doneButton                 = page.getByRole('button', { name: 'Done' });
  }

  /**
   * Click "Link Account" in the Deposit Funds sub-nav.
   *
   * SELF-HEALING RETRY:
   *   Even after waitForDashboardReady(), a slow API response can still arrive
   *   and collapse the menu before this method runs. When that happens:
   *     1. linkAccountLink is not visible
   *     2. We re-click depositFundsLink to re-expand the menu
   *     3. Repeat up to 3 times total
   *
   *   This is the second layer of the two-layer fix for the SPA re-render issue.
   */
  async clickLinkAccount() {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isVisible = await this.linkAccountLink.isVisible().catch(() => false);

      if (isVisible) break;

      // Sub-menu collapsed — re-expand by clicking the parent nav item
      console.log(`[AchLinkPage] "Link Account" not visible — re-expanding Deposit Funds (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await this.depositFundsLink.waitFor({ state: 'visible', timeout: 10000 });
      await this.depositFundsLink.click();

      // Wait for the sub-link to appear before the next iteration checks it
      await this.linkAccountLink.waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {}); // silence — next iteration will retry if still missing
    }

    // Final strict wait: if the menu is still collapsed here the test fails
    // with a clear message rather than a cryptic locator timeout.
    await this.linkAccountLink.waitFor({ state: 'visible', timeout: 10000 });
    await this.linkAccountLink.click();
  }

  /**
   * User-web shell: click "Link Account".
   *
   * Same self-healing pattern as clickLinkAccount(): if an in-flight API response
   * re-renders the sidebar and hides the sub-link, re-click "Move Money" to
   * expand again (DashboardPage.waitForSidebarSettledAfterClick reduces how often
   * this is needed).
   */
  async clickLinkAccountUserWeb() {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isVisible = await this.linkAccountLinkUserWeb.isVisible().catch(() => false);

      if (isVisible) break;

      console.log(`[AchLinkPage] User-web "Link Account" not visible — re-expanding Move Money (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await this.moveMoneyLinkUserWeb.waitFor({ state: 'visible', timeout: 10000 });
      await this.moveMoneyLinkUserWeb.click();
      await this.page.waitForTimeout(500);

      await this.linkAccountLinkUserWeb.waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
    }

    await this.linkAccountLinkUserWeb.waitFor({ state: 'visible', timeout: 10000 });
    await this.linkAccountLinkUserWeb.click();
    await this.page.getByRole('heading', { name: 'Add Bank Account' })
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Click the "Link ACH account instantly" option on the landing page.
   */
  async selectLinkAchInstantly() {
    await this.linkAchInstantlyOption.waitFor({ state: 'visible', timeout: 10000 });
    await this.linkAchInstantlyOption.click();
  }

  /**
   * User-web shell card selector for ACH-instant option.
   */
  async selectLinkAchInstantlyUserWeb() {
    await this.linkAchInstantlyOptionUserWeb.waitFor({ state: 'visible', timeout: 10000 });
    await this.linkAchInstantlyOptionUserWeb.click();
  }

  /**
   * Inside the Plaid iframe: skip phone number, choose Chase, then click
   * "Continue to login" which opens the Chase OAuth popup.
   *
   * Returns the popup Page so the caller can pass it to completeChaseLogin().
   *
   * @returns {Promise<import('@playwright/test').Page>}
   */
  async startPlaidChaseFlow() {
    // Wait for iframe to mount
    await this.plaidFrame.getByRole('button', { name: 'Continue without phone number' })
      .waitFor({ state: 'visible', timeout: 15000 });
    await this.plaidFrame.getByRole('button', { name: 'Continue without phone number' }).click();

    await this.plaidFrame.getByRole('button', { name: 'Chase' })
      .waitFor({ state: 'visible', timeout: 10000 });
    await this.plaidFrame.getByRole('button', { name: 'Chase' }).click();

    // "Continue to login" opens a popup — register listener before click
    const popupPromise = this.page.waitForEvent('popup');
    await this.plaidFrame.getByRole('button', { name: 'Continue to login' }).click();

    return popupPromise;
  }

  /**
   * Complete the Chase sandbox login inside the popup window.
   *
   * @param {import('@playwright/test').Page} popup
   */
  async completeChaseLogin(popup) {
    await popup.getByRole('button', { name: 'Sign in' }).click();
    await popup.getByRole('button', { name: 'Get code' }).click();
    await popup.getByRole('button', { name: 'Submit' }).click();

    await popup.locator('#accounts-list').getByText('Plaid Checking ••• •••').click();
    await popup.getByRole('button', { name: 'Continue' }).click();

    await popup.getByRole('checkbox', { name: 'I have read and accept the' }).click();
    await popup.getByRole('button', { name: 'Connect account information' }).click();
  }

  /**
   * After the popup closes Plaid shows a "Save credentials?" prompt.
   * Dismiss it without saving.
   */
  async dismissSaveCredentials() {
    await this.plaidFrame.getByRole('button', { name: 'Finish without saving' })
      .waitFor({ state: 'visible', timeout: 15000 });
    await this.plaidFrame.getByRole('button', { name: 'Finish without saving' }).click();
  }

  /**
   * Assert the success state and click Done to return to the dashboard.
   */
  async confirmLinkSuccess() {
    await expect(this.linkExternalAccountHeading).toBeVisible({ timeout: 15000 });
    await expect(this.linkSuccessText).toBeVisible();
    await this.doneButton.click();
  }

  /**
   * Assert link success, click Done, and capture dashboard profile response
   * triggered by that transition (when emitted by this build).
   *
   * @param {object} [options]
   * @param {number} [options.timeout=12000]
   * @returns {Promise<import('@playwright/test').Response | null>}
   */
  async confirmLinkSuccessAndCaptureDashboardProfile(options = {}) {
    const { timeout = 12000 } = options;

    await expect(this.linkExternalAccountHeading).toBeVisible({ timeout: 15000 });
    await expect(this.linkSuccessText).toBeVisible();

    const [profileResponse] = await Promise.all([
      this.page.waitForResponse(
        (response) =>
          response.url().includes('/client/v1/profile') && response.status() === 200,
        { timeout },
      ).catch(() => null),
      this.doneButton.click(),
    ]);

    return profileResponse;
  }
}

module.exports = AchLinkPage;
