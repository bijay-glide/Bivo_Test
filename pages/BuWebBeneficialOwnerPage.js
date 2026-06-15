class BuWebBeneficialOwnerPage {
  constructor(page) {
    this.page = page;
    this.continueButton = page.getByRole('button', { name: 'Continue' });
  }

  // Beneficial owner form — fills all fields and clicks Continue
  async fillAndSubmitOwnerForm({ firstName, lastName, jobTitle, ownershipPct, citizenship, idType, ssn, email, street, suite, city, state, zip }) {
    await this.page.getByRole('textbox', { name: 'First name' }).fill(firstName);
    await this.page.getByRole('textbox', { name: 'Last name' }).fill(lastName);
    await this.page.getByRole('textbox', { name: 'Job title' }).fill(jobTitle);
    await this.page.getByRole('textbox', { name: 'Enter date of birth' }).click();
    await this.page.getByRole('button', { name: 'OK' }).click();
    await this.page.getByRole('textbox', { name: '%' }).fill(ownershipPct);
    await this.page.getByRole('button', { name: 'Select beneficiary citizenship' }).click();
    await this.page.locator('a').filter({ hasText: citizenship }).click();
    await this.page.getByRole('button', { name: 'Select identification type' }).click();
    await this.page.getByRole('button', { name: idType }).click();
    await this.page.getByRole('textbox', { name: `Enter ${idType}` }).fill(ssn);
    await this.page.getByRole('textbox', { name: 'Enter email address' }).fill(email);
    await this.page.getByRole('textbox', { name: 'Street address (no PO box)' }).fill(street);
    await this.page.getByRole('textbox', { name: 'Enter suite / office / floor' }).fill(suite);
    await this.page.getByRole('textbox', { name: 'City' }).fill(city);
    await this.page.getByRole('button', { name: 'Enter state' }).click();
    await this.page.getByRole('button', { name: state }).click();
    await this.page.getByRole('textbox', { name: 'Zip code' }).fill(zip);
    await this.continueButton.click();
  }

  // Beneficial owners list — checks "No other owner" checkbox and clicks Continue
  async confirmNoOtherOwnersAndContinue() {
    await this.page.locator('.check-wrapper').first().click();
    await this.continueButton.click();
  }

  // Checks the "I am the key person" checkbox to reveal the Key Person Details form
  async confirmAsKeyPerson() {
    await this.page.locator('.check-wrapper').first().click();
  }

  // Key Person Details form — fills all fields and clicks Continue
  async fillAndSubmitKeyPersonDetails({ jobTitle, phone, citizenship, idType, ssn }) {
    await this.page.getByRole('textbox', { name: 'Job title' }).fill(jobTitle);
    await this.page.getByRole('textbox', { name: 'Enter date of birth' }).click();
    await this.page.getByRole('button', { name: 'OK' }).click();
    await this.page.getByRole('textbox', { name: 'Enter your mobile number' }).fill(phone);
    await this.page.getByRole('button', { name: 'Select beneficiary citizenship' }).click();
    await this.page.locator('a').filter({ hasText: citizenship }).click();
    await this.page.getByRole('button', { name: 'Select identification type' }).click();
    await this.page.getByRole('button', { name: idType }).click();
    await this.page.getByRole('textbox', { name: `Enter ${idType}` }).fill(ssn);
    await this.continueButton.click();
  }
}

module.exports = BuWebBeneficialOwnerPage;
