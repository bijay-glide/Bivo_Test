const { expect } = require('@playwright/test');

class UserRegistrationPage {
  constructor(page) {
    this.page = page;

    // Personal Info Locators
    this.firstNameInput = page.getByRole('textbox', { name: 'First Name' });
    this.lastNameInput = page.getByRole('textbox', { name: 'Last Name' });
    this.emailInput = page.getByRole('textbox', { name: 'Email Address' });

    // Address Locators
    this.streetAddressInput = page.getByRole('textbox', { name: 'Street Address (No PO Box)' });
    this.aptSuiteInput = page.getByRole('textbox', { name: 'Enter apt/suite number' });
    this.cityInput = page.getByRole('textbox', { name: 'City' });
    this.stateButton = page.getByRole('button', { name: 'Enter state' });
    this.zipCodeInput = page.getByRole('textbox', { name: 'ZIP Code' });

    // Date of Birth Locators
    this.dobInput = page.getByRole('textbox', { name: 'MM/DD/YYYY' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
    this.okButton = page.getByRole('button', { name: 'OK' });

    // SSN Locators (mask label varies: pay shell vs standalone user-web)
    this.ssnInput = page.getByRole('textbox', {
      name: /XXX-XX-XXXX|XXXX/,
    });

    // Consent/Checkbox Locators
    this.firstCheckbox = page.locator('.check-wrapper').first();

    // Employment Locators
    this.employmentDropdown = page.getByRole('button', { name: 'Select your employment' });
    this.employedOption = page.getByRole('button', { name: 'Employed', exact: true });

    // Investment Goal Locators
    this.investmentGoalDropdown = page.getByRole('button', { name: 'Select investment goal' });
    this.incomeOption = page.getByRole('button', { name: 'Income' });

    // Auto-invest Locators
    this.autoInvestCheckbox = page.locator('#auto-invest').nth(3);
    this.noneOfAboveText = page.getByText('None of the above');

    // Common Buttons
    this.nextButton = page.getByRole('button', { name: 'Next' });
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.proceedButton = page.getByRole('button', { name: 'Proceed' });
    this.submitButton = page.getByRole('button', { name: 'Submit' });
  }

  // Step 1: Personal Information
  async fillPersonalInfo(firstName, lastName, email) {
    await this.firstNameInput.click();
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.click();
    await this.lastNameInput.fill(lastName);
    await this.emailInput.click();
    await this.emailInput.fill(email);
    await this.nextButton.click();
  }

  // Step 2: Address Information
  async fillAddressInfo(streetAddress, aptSuite, city, state, zipCode) {
    await this.streetAddressInput.click();
    await this.streetAddressInput.fill(streetAddress);
    await this.aptSuiteInput.click();
    await this.aptSuiteInput.fill(aptSuite);
    await this.cityInput.click();
    await this.cityInput.fill(city);
    await this.stateButton.click();
    await this.page.getByRole('button', { name: state }).click();
    await this.zipCodeInput.click();
    await this.zipCodeInput.fill(zipCode);
    await this.nextButton.click();
  }

  // Step 3: Date of Birth
  async selectDateOfBirth(year, dayIndex = 1) {
    await this.dobInput.click();
    if (await this.okButton.isVisible().catch(() => false)) {
      await this.okButton.click();
    } else {
      // Standalone user-web: calendar grid — nth(1) avoids the wrong "1" (e.g. month control).
      await this.page
        .getByRole('button', { name: '1', exact: true })
        .nth(1)
        .click();
    }
    await this.nextButton.click();
  }

  // Step 4: SSN Entry (First Time)
  async enterSSNFirstAttempt(ssn, opts = {}) {
    await this.ssnInput.click();
    await this.ssnInput.fill(ssn);
    await this.nextButton.click();
    if (opts.extraNextAfterSsn) {
      await this.nextButton.click();
    }
  }

  async assertConsentDisclosureCopyVisible() {
    const form = this.page.locator('form');
    await expect(form).toContainText(
      'I have read and agree to the Bivo Electronic Communication Agreement',
    );
    await expect(form).toContainText('Bivo Privacy Policy');
  }

  // Step 6: Consent Checkboxes
  async acceptConsents() {
    await this.page.locator('.check-wrapper').nth(0).click();
    await this.page.locator('.check-wrapper').nth(1).click();
    await this.proceedButton.click();
  }

  // Step 7: Employment Status
  async selectEmploymentStatus(status = 'Employed') {
    await this.employmentDropdown.click();
    await this.page.getByRole('button', { name: status, exact: true }).click();
    await this.nextButton.click();
  }

  // Step 8: Additional Disclosure Checkbox
  async acceptAdditionalDisclosure() {
    await this.page.locator('.check-wrapper').nth(2).click();
  }

  // Step 9: Investment Goal
  async selectInvestmentGoal(goal = 'Income') {
    await this.investmentGoalDropdown.click();
    await this.page.getByRole('button', { name: goal }).click();
    await this.continueButton.click();
  }

  // Step 10: Investment Experience Checkboxes
  async selectInvestmentExperience() {
    await expect(this.page.getByRole('heading', { name: 'Please Verify' })).toBeVisible();
    await this.page.locator('.check-wrapper').first().click();
    await this.page.locator('div:nth-child(2) > .d-flex > div > .bivo-check-box > label > .check-wrapper').click();
    await this.proceedButton.click();
  }

  // Step 11: Final Disclosures and Submit
  async completeFinalDisclosuresAndSubmit() {
    await this.autoInvestCheckbox.check();
    await this.noneOfAboveText.click();
    await this.noneOfAboveText.click();
    await this.autoInvestCheckbox.check();
    await this.submitButton.click();
  }

  // Complete Full Registration Flow
  async completeFullRegistration(userData, registrationOptions = {}) {
    await this.fillPersonalInfo(userData.firstName, userData.lastName, userData.email);
    await this.fillAddressInfo(
      userData.streetAddress,
      userData.aptSuite,
      userData.city,
      userData.state,
      userData.zipCode
    );
    await this.selectDateOfBirth(userData.birthYear, userData.dayIndex);
    await this.enterSSNFirstAttempt(userData.ssnFirst, registrationOptions);
    if (registrationOptions.assertConsentDisclosureCopy) {
      await this.assertConsentDisclosureCopyVisible();
    }
    await this.acceptConsents();
    // await this.selectEmploymentStatus(userData.employmentStatus);
    // await this.acceptAdditionalDisclosure();
    // await this.selectInvestmentGoal(userData.investmentGoal);
    // await this.selectInvestmentExperience();
    // await this.completeFinalDisclosuresAndSubmit();
  }
}

module.exports = UserRegistrationPage;
