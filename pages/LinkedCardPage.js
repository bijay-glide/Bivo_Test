const { expect } = require('@playwright/test');
const DashboardPage = require('./DashboardPage');
const { getUiBaseUrl } = require('../utils/env');

/**
 * Payment gateway card tokenization (browser flow).
 * POST https://info.bivotech.co/pgw/v1/card — body includes vault session token, pan,
 * expiry_month / expiry_year, cvv, address.postal_code, device fingerprinting.
 *
 * Success (typical): { "identifier": "<digits>" } — identifier length varies.
 * Failure (non-debit / policy): { "status": "ERROR", "message": "...", "timestamp": "..." }.
 *
 * Around the same screen load, devapi may also call (Bearer + tenant headers), for example:
 * GET  .../remittance/v1/currencies
 * GET  .../transactions/v1/transactions/accountbalance
 * GET  .../clientaccount/v1/externalaccount?verified=true
 * Those are not asserted here; this page focuses on PGW card linking.
 */
const PGW_V1_CARD_PATH = '/pgw/v1/card';

/** Static test PANs: success path uses a debit test card; failure uses a card rejected as non-debit. */
const LINK_CARD_SUCCESS = Object.freeze({
  pan: '4300008010000125',
  cvv: '185',
  expiryMmYy: '12/31',
  zip: '10055',
});

const LINK_CARD_FAILURE = Object.freeze({
  pan: '4123448010000128',
  cvv: '185',
  expiryMmYy: '12/31',
  zip: '55022',
});

class LinkedCardPage {
  constructor(page) {
    this.page = page;
    this.dashboard = new DashboardPage(page);

    this.linkCardLink = page.getByRole('link', { name: 'Link Card Link Card' });

    this.linkCardInstantlyCard = page.getByText('Link Card Account Instantly');
    this.pageHeading = page.getByRole('heading');

    this.cardIframe = page.locator('#card iframe');
    this.cvvIframe = page.locator('#cvv iframe');
    this.expIframe = page.locator('#exp iframe');
    this.zipIframe = page.locator('#zip iframe');

    this.linkCardSubmitButton = page.getByRole('button', { name: 'Link Card' });
    this.addCardAccountButton = page.getByRole('button', { name: 'Add Card Account' });
  }

  /** User-web: click Move Money once, then open Link Card. */
  async navigateToLinkCardUserWeb() {
    await this.dashboard.goToMoveMoneyUserWeb();

    const canClickLinkCard = await this.linkCardLink
      .isVisible({ timeout: 6000 })
      .catch(() => false);

    if (canClickLinkCard) {
      await this.linkCardLink.click();
      await this.dashboard.waitForSidebarSettledAfterClick();
    } else {
      // Keep Move Money to a single click; if sub-menu is not present, continue via direct route.
      await this.gotoLinkedCardAccountsPage();
    }

    await expect(this.pageHeading.first()).toContainText('Linked Card Account', { timeout: 20000 });
  }

  async openLinkCardInstantly() {
    // Two possible states depending on whether cards already exist on the account:
    //   • No cards yet  → "Link Card Account Instantly" tile is shown
    //   • Cards present → "Add Card Account" button is shown instead
    // Race both; click whichever appears first.
    const which = await Promise.race([
      this.linkCardInstantlyCard
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => 'instantly'),
      this.addCardAccountButton
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => 'add-card'),
    ]);

    if (which === 'instantly') {
      await this.linkCardInstantlyCard.click();
    } else {
      await this.addCardAccountButton.click();
    }

    await this.waitForVaultIframes();
  }

  async gotoLinkedCardAccountsPage() {
    await this.page.goto(`${getUiBaseUrl()}/user-web/money-transfer/linked-card-accounts`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await expect(this.pageHeading.first()).toContainText('Linked Card Account', { timeout: 20000 });
  }

  async clickAddCardAccount() {
    await this.addCardAccountButton.waitFor({ state: 'visible', timeout: 15000 });
    await this.addCardAccountButton.click();
    await this.waitForVaultIframes();
  }

  async waitForVaultIframes() {
    await this.cardIframe.waitFor({ state: 'visible', timeout: 30000 });
    await this.cvvIframe.waitFor({ state: 'visible', timeout: 15000 });
    await this.expIframe.waitFor({ state: 'visible', timeout: 15000 });
    await this.zipIframe.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * @param {{ pan: string, cvv: string, expiryMmYy: string, zip: string }} data
   */
  async fillCardVaultFields(data) {
    const cardFrame = this.cardIframe.contentFrame();
    const cvvFrame = this.cvvIframe.contentFrame();
    const expFrame = this.expIframe.contentFrame();
    const zipFrame = this.zipIframe.contentFrame();

    const cardNumber = cardFrame.getByRole('textbox', { name: 'Card Number' });
    await cardNumber.click();
    await cardNumber.fill(data.pan);

    const cvvInput = cvvFrame.getByRole('textbox', { name: /CVV/i });
    await cvvInput.click();
    await cvvInput.fill(data.cvv);

    const expiry = expFrame.getByRole('textbox', { name: 'Expiration MM/YY' });
    await expiry.click();
    await expiry.fill(data.expiryMmYy);

    const zip = zipFrame.getByRole('textbox', { name: 'Zip Code' });
    await zip.click();
    await zip.fill(data.zip);
  }

  /**
   * Clicks Link Card and returns the PGW POST response JSON (and Response).
   * @param {{ pan: string, cvv: string, expiryMmYy: string, zip: string }} cardData
   */
  async fillVaultAndSubmitCapturingPgwCardApi(cardData) {
    await this.fillCardVaultFields(cardData);

    const responsePromise = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes(PGW_V1_CARD_PATH),
      { timeout: 90000 },
    );

    await this.linkCardSubmitButton.click();
    const response = await responsePromise;

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }

    return { response, body };
  }

  static assertPgwCardSuccess(body) {
    expect(body, 'PGW response body should be JSON').toBeTruthy();
    const id = body.identifier != null ? String(body.identifier).trim() : '';
    expect(id.length, 'PGW success should include a non-empty identifier (digits/format may vary)').toBeGreaterThan(0);
  }

  static assertPgwCardFailureDebitOnly(body) {
    expect(body?.status, 'PGW error response should have status ERROR').toBe('ERROR');
    expect(String(body?.message || ''), 'PGW error should mention debit cards').toMatch(/debit/i);
  }
}

module.exports = LinkedCardPage;
module.exports.LINK_CARD_SUCCESS = LINK_CARD_SUCCESS;
module.exports.LINK_CARD_FAILURE = LINK_CARD_FAILURE;
module.exports.PGW_V1_CARD_PATH = PGW_V1_CARD_PATH;
