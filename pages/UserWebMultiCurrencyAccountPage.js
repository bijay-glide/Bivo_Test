const { expect } = require('@playwright/test');

/**
 * UserWebMultiCurrencyAccountPage
 *
 * Covers the user-web "Add a New Account" multicurrency modal. The modal markup
 * is shared with bu-web (same `addcurrencymodal-*` testids), but on user-web it
 * is reached from the Accounts section (Sidebar-nav-accounts →
 * multicurrency-add-account-button) and the create endpoints are the individual
 * ones rather than the business ones:
 *   - Fiat Currency (Fiat tab)   → POST /clientaccount/v1/spending-account/wallet-account
 *   - Stablecoin    (Crypto tab) → POST /user/v1/coin/accounts
 *
 * Already-owned currencies are excluded from the dropdowns by the app, so the
 * available lists are read at runtime rather than hard-coded.
 */
class UserWebMultiCurrencyAccountPage {
  constructor(page) {
    this.page = page;

    this.accountsNav      = page.getByTestId('Sidebar-nav-accounts');
    this.addAccountButton = page.getByTestId('multicurrency-add-account-button');
    this.modal            = page.getByTestId('addcurrencymodal');
    this.fiatTab          = page.getByTestId('addcurrencymodal-fiat-tab');
    this.cryptoTab        = page.getByTestId('addcurrencymodal-crypto-tab');
    this.currencySelect   = page.getByTestId('addcurrencymodal-currency-select');
    this.stablecoinSelect = page.getByTestId('addcurrencymodal-stablecoin-select');
    this.accountNameInput = page.getByTestId('addcurrencymodal-accountname-input');
    this.confirmButton    = page.getByTestId('addcurrencymodal-confirm-button');
    this.closeButton      = page.getByTestId('addcurrencymodal-close-button');
  }

  /** Navigate to the Accounts section so the add-account button is in the DOM. */
  async goToAccounts() {
    await this.accountsNav.waitFor({ state: 'visible', timeout: 15000 });
    await this.accountsNav.click();
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  }

  async openModal() {
    await this.goToAccounts();
    await this.addAccountButton.first().waitFor({ state: 'visible', timeout: 15000 });
    await this.addAccountButton.first().click();
    await this.modal.waitFor({ state: 'visible', timeout: 10000 });
  }

  async closeModal() {
    if (await this.modal.count()) {
      await this.closeButton.click().catch(() => {});
      await this.modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  // Read the option codes currently rendered for a dropdown testid prefix,
  // scrolling the last option into view to flush any virtualized rows.
  async _readOptionCodes(prefix) {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const ids = await this.page.evaluate(
        (p) => Array.from(document.querySelectorAll(`[data-testid^="${p}"]`))
          .map((el) => el.getAttribute('data-testid')),
        prefix,
      );
      const before = seen.size;
      ids.forEach((id) => seen.add(id.replace(prefix, '')));
      const last = this.page.locator(`[data-testid^="${prefix}"]`).last();
      if (await last.count()) await last.scrollIntoViewIfNeeded().catch(() => {});
      await this.page.waitForTimeout(120);
      if (seen.size === before && i > 1) break;
    }
    return [...seen];
  }

  // Open a dropdown (if its select control is present) and read its option codes.
  // When every currency in a category is already owned the app omits the select
  // entirely, so a missing/hidden control just means "nothing available" → [].
  async _readDropdown(select, optionPrefix) {
    const present = await select
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!present) return [];
    await select.click();
    await this.page.waitForTimeout(500);
    return this._readOptionCodes(optionPrefix);
  }

  /** Open a fresh modal and return { fiat: string[], stablecoins: string[] } of available codes. */
  async getAvailableCurrencies() {
    await this.openModal();

    await this.fiatTab.click();
    const fiat = await this._readDropdown(this.currencySelect, 'addcurrencymodal-currency-option-');

    await this.cryptoTab.click();
    const stablecoins = await this._readDropdown(this.stablecoinSelect, 'addcurrencymodal-stablecoin-option-');

    await this.closeModal();
    return { fiat, stablecoins };
  }

  /**
   * Open the modal, create one fiat-currency account, and return the API response.
   * @returns {Promise<import('@playwright/test').Response>}
   */
  async createFiatAccount(currencyCode, accountName) {
    await this.openModal();
    await this.fiatTab.click();
    await this.currencySelect.click();
    await this.page.getByTestId(`addcurrencymodal-currency-option-${currencyCode}`).click();
    await this.accountNameInput.click();
    await this.accountNameInput.fill(accountName);
    await expect(this.confirmButton).toBeEnabled({ timeout: 10000 });

    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes('/clientaccount/v1/spending-account/wallet-account') && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await this.confirmButton.click();
    const response = await responsePromise;
    await this.modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    return response;
  }

  /**
   * Open the modal, create one stablecoin account, and return the API response.
   * The "Supported Network" chip is auto-selected; if the confirm button is
   * somehow still disabled, the first available network chip is clicked.
   * @returns {Promise<import('@playwright/test').Response>}
   */
  async createStablecoinAccount(coinCode, accountName) {
    await this.openModal();
    await this.cryptoTab.click();
    await this.stablecoinSelect.click();
    await this.page.getByTestId(`addcurrencymodal-stablecoin-option-${coinCode}`).click();
    await this.page.waitForTimeout(500);
    await this.accountNameInput.click();
    await this.accountNameInput.fill(accountName);

    if (await this.confirmButton.isDisabled().catch(() => false)) {
      const chip = this.page.locator('[data-testid^="addcurrencymodal-network-chip-"]').first();
      if (await chip.count()) await chip.click();
    }
    await expect(this.confirmButton).toBeEnabled({ timeout: 10000 });

    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes('/user/v1/coin/accounts') && r.request().method() === 'POST',
      { timeout: 20000 },
    );
    await this.confirmButton.click();
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

module.exports = UserWebMultiCurrencyAccountPage;
