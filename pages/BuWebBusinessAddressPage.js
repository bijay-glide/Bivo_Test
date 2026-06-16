class BuWebBusinessAddressPage {
  constructor(page) {
    this.page = page;
    this.streetInput    = page.getByRole('textbox', { name: 'Street address (no PO box)' });
    this.suiteInput     = page.getByRole('textbox', { name: 'Enter suite / office / floor' });
    this.cityInput      = page.getByRole('textbox', { name: 'City' });
    this.stateButton    = page.getByRole('button', { name: 'Enter state' });
    this.zipInput       = page.getByRole('textbox', { name: 'Zip code' });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
  }

  async fill({ street, suite, city, state, zip }) {
    await this.streetInput.fill(street);
    await this.page.getByText('Country').click();
    await this.suiteInput.fill(suite);
    await this.cityInput.fill(city);
    await this.stateButton.click();
    await this.page.getByRole('button', { name: state }).click();
    await this.zipInput.fill(zip);
    await this.page.locator('.check-wrapper').first().click();
    await this.page.locator('div:nth-child(2) > .d-flex > div > .bivo-check-box > label > .check-wrapper').click();
  }

  async clickContinue() {
    await this.continueButton.click();
  }
}

module.exports = BuWebBusinessAddressPage;
