const { faker } = require('@faker-js/faker');

// Set seed for reproducibility if needed (optional)
// faker.seed(123);

/**
 * Generate a random string of specified length
 */
function generateRandomString(length = 10) {
  return faker.string.alphanumeric(length).toLowerCase();
}

/**
 * Generate a random phone number (US format)
 * Default: 715 + 7 random digits = 10 digits total
 */
function generatePhoneNumber(prefix = '715') {
  // Generate 7 random digits to complete the 10-digit phone number
  const remainingDigits = faker.string.numeric(7);
  return `${prefix}${remainingDigits}`;
}

/**
 * Generate a random SSN (for testing purposes only)
 */
function generateSSN() {
  const part1 = faker.number.int({ min: 100, max: 899 });
  const part2 = faker.number.int({ min: 10, max: 99 });
  const part3 = faker.number.int({ min: 1000, max: 9999 });
  return `${part1}${part2}${part3}`;
}

/**
 * Generate a random date of birth (age between 18-80 years)
 * Optionally, customize age range with min and max parameters
 */
function generateDateOfBirth(minAge = 18, maxAge = 80) {
  const birthDate = faker.date.birthdate({ min: minAge, max: maxAge, mode: 'age' });
  const year = birthDate.getFullYear();
  const month = (birthDate.getMonth() + 1).toString().padStart(2, '0');
  const day = birthDate.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate a unique correlation ID
 */
function generateCorrelationId() {
  return `QA-Auto_${Date.now()}_${faker.string.alphanumeric(16)}`;
}

/**
 * Generate a unique email based on name and a random string for uniqueness
 */
function generateUniqueEmail(firstName, lastName) {
  return `${firstName}.${lastName}${generateRandomString(5)}@automation.com`;
}

/**
 * Generate complete client account data with realistic information
 * Allows overriding of any field
 */
function generateClientAccountData(overrides = {}) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  const defaultData = {
    personalInfo: {
      firstName: firstName,
      lastName: lastName,
      email: generateUniqueEmail(firstName, lastName),
      phoneNumber: generatePhoneNumber('715'),
      identificationType: 'SSN',
      identificationNumber: generateSSN(),
      dateOfBirth: generateDateOfBirth()
    },
    address: {
      addressLine1: faker.location.streetAddress(),
      addressLine2: "three",
      zipCode: faker.location.zipCode('#####'),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      countryCode: 'US'
    },
    clientIpAddress: faker.internet.ipv4(),
    correlationId: generateCorrelationId()
  };

  return {
    ...defaultData,
    personalInfo: { ...defaultData.personalInfo, ...(overrides.personalInfo || {}) },
    address: { ...defaultData.address, ...(overrides.address || {}) },
    ...(overrides.clientIpAddress && { clientIpAddress: overrides.clientIpAddress }),
    ...(overrides.correlationId && { correlationId: overrides.correlationId })
  };
}

/**
 * US States array for validation
 */
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

/**
 * Identification types
 */
const IDENTIFICATION_TYPES = ['SSN'];

/**
 * Account statuses
 */
const ACCOUNT_STATUSES = [
  'REQUESTED',
  'FAILED',
  'ACTIVE',
  'DECLINED',
  'CLOSED_PENDING',
  'CLOSED'
];

module.exports = {
  generateRandomString,
  generatePhoneNumber,
  generateSSN,
  generateDateOfBirth,
  generateCorrelationId,
  generateUniqueEmail,
  generateClientAccountData,
  US_STATES,
  IDENTIFICATION_TYPES,
  ACCOUNT_STATUSES
};