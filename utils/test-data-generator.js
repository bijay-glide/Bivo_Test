/**
 * Test Data Generator for User Registration
 */

const { toCentsInput, formatUsdDisplay } = require('./amount-input');

// Allowed US area codes for signup tests.
const ALLOWED_SIGNUP_AREA_CODES = ['212', '415', '646'];
const generatedPhoneNumbers = new Set();

/**
 * Generates a random 4-digit number
 * @returns {string} 4-digit random number
 */
function generateRandomDigits(length) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, '0');
}

/**
 * Generates a random name from a list
 * @param {string} type - 'first' or 'last'
 * @returns {string} Random name
 */
function generateRandomName(type) {
  const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Barbara', 'David', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];

  if (type === 'first') {
    return firstNames[Math.floor(Math.random() * firstNames.length)];
  } else {
    return lastNames[Math.floor(Math.random() * lastNames.length)];
  }
}

/**
 * Generates a signup email for UI registration flows.
 * Uses example.com and an automation prefix to clearly mark test-created users.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @returns {string}
 */
function generateSignupEmail(firstName, lastName) {
  const safeFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const safeLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
  return `automation.${safeFirst}.${safeLast}.${generateRandomDigits(4)}@example.com`;
}

/**
 * NANP exchange code (NXX): first digit 2-9; excludes reserved N11 patterns.
 * @returns {string}
 */
function generateValidExchangeCode() {
  let exchange;
  do {
    exchange = (Math.floor(Math.random() * 800) + 200).toString(); // 200-999
  } while (exchange[1] === '1' && exchange[2] === '1');
  return exchange;
}

/**
 * Generates a unique phone number for the current run, using approved area codes.
 * Format: AAAXXXYYYY where AAA is in ALLOWED_SIGNUP_AREA_CODES.
 *
 * @param {string[]} areaCodes
 * @returns {string}
 */
function generateUniqueSignupPhoneNumber(areaCodes = ALLOWED_SIGNUP_AREA_CODES) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];
    const exchange = generateValidExchangeCode();
    const lineNumber = generateRandomDigits(4);
    const phoneNumber = `${areaCode}${exchange}${lineNumber}`;

    if (!generatedPhoneNumbers.has(phoneNumber)) {
      generatedPhoneNumbers.add(phoneNumber);
      return phoneNumber;
    }
  }

  throw new Error('Unable to generate a unique signup phone number');
}

/**
 * Generates a random street address
 * @returns {string} Random street address
 */
function generateRandomStreetAddress() {
  const streetNames = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Pine Rd', 'Elm St', 'Washington Blvd', 'Park Ave', 'Lake Dr', 'Hill St'];
  const streetNumber = Math.floor(Math.random() * 9999) + 1;
  const street = streetNames[Math.floor(Math.random() * streetNames.length)];

  return `${streetNumber} ${street}`;
}

/**
 * Generates a random city name
 * @returns {string} Random city name
 */
function generateRandomCity() {
  const cities = ['Springfield', 'Franklin', 'Clinton', 'Georgetown', 'Madison', 'Salem', 'Fairview', 'Bristol', 'Arlington', 'Manchester', 'Oxford', 'Clayton', 'Hudson', 'Riverside', 'Auburn'];

  return cities[Math.floor(Math.random() * cities.length)];
}

/**
 * Generates a random birth year (between 1970-2000)
 * @returns {string} Random birth year
 */
function generateRandomBirthYear() {
  const year = Math.floor(Math.random() * (2000 - 1970 + 1)) + 1970;
  return year.toString();
}

/**
 * Random fake SSN-shaped value using the 555-xx-xxxx test range (full XXX-XX-XXXX string).
 * Needed so UI validation enables Next on both masked and full-format fields.
 * @returns {string}
 */
function generateRandomSSN() {
  const mid = generateRandomDigits(2);
  const last = generateRandomDigits(4);
  return `555-${mid}-${last}`;
}

/**
 * Generates complete test data for user registration
 * @returns {object} Test data object
 */
function generateUserTestData() {
  const firstName = generateRandomName('first');
  const lastName = generateRandomName('last');
  const phoneNumber = generateUniqueSignupPhoneNumber();
  const email = generateSignupEmail(firstName, lastName);

  return {
    // 10-digit US — no +1 prefix (UI and OTP use this as-is)
    phoneNumber,

    // Personal Info (randomized)
    firstName: firstName,
    lastName: lastName,
    email: email,

    // Address (randomized except state, aptSuite, zipCode)
    streetAddress: generateRandomStreetAddress(),
    aptSuite: 'three', // Fixed
    city: generateRandomCity(),
    state: 'MA', // Fixed
    zipCode: '70112', // Fixed

    // Date of Birth (randomized)
    birthYear: generateRandomBirthYear(),
    dayIndex: Math.floor(Math.random() * 3), // Random day index 0-2

    // SSN (randomized)
    ssnFirst: generateRandomSSN(),
    ssnSecond: generateRandomSSN(),

    // Employment & Investment (fixed)
    employmentStatus: 'Employed',
    investmentGoal: 'Income'
  };
}

/**
 * Generates incoming wire transfer data
 * @param {string} accountNumber - The account number to receive funds
 * @param {object} options - Optional overrides for default values
 * @returns {object} Incoming wire transfer data
 */
function generateIncomingWireData(accountNumber, options = {}) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);

  return {
    accountNumber: options.accountNumber || accountNumber,
    amount: options.amount || 10000,
    description: options.description || 'Test incoming wire transfer',
    correlationId: options.correlationId || `QA-test-txn-${timestamp}-${randomSuffix}`,
    traceId: options.traceId || null,
    provider: options.provider || 'SVB'
  };
}

/**
 * Generates wire instruction data
 * @param {number|string} clientId - The client ID
 * @param {object} options - Optional overrides for default values
 * @returns {object} Wire instruction data
 */
function generateWireInstructionData(clientId, options = {}) {
  const randomDigits = generateRandomDigits(8);
  const businessName = options.businessName || `${generateRandomName('first')} Corp`;

  return {
    clientId: options.clientId || clientId,
    businessName: businessName,
    accountNickname: options.accountNickname || businessName.split(' ')[0],
    streetAddress: options.streetAddress || generateRandomStreetAddress(),
    city: options.city || generateRandomCity(),
    state: options.state || 'NY',
    zipCode: options.zipCode || '10011',
    accountNumber: options.accountNumber || `498493${randomDigits}`,
    wireRoutingNumber: options.wireRoutingNumber || '021000089'
  };
}

/**
 * Generates withdraw fund data
 * @param {number|string} clientId - The client ID
 * @param {string} wireInstructionsId - The wire instruction identifier
 * @param {object} options - Optional overrides for default values
 * @returns {object} Withdraw fund data
 */
function generateWithdrawFundData(clientId, wireInstructionsId, options = {}) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);

  return {
    businessId: options.businessId || null,
    clientId: options.clientId || clientId,
    fromAccount: options.fromAccount || null,
    wireInstructionsId: options.wireInstructionsId || wireInstructionsId,
    amount: options.amount || 1000,
    description: options.description || 'Move fund to other bank own account',
    correlationId: options.correlationId || `QA-withdraw-${timestamp}-${randomSuffix}`
  };
}

/**
 * Generates fresh wire recipient form data for UI tests.
 * Every call produces a unique recipient so parallel/repeated runs don't clash.
 *
 * @param {object} options - Optional field overrides
 * @returns {object} Wire form data
 */
function generateWireFormData(options = {}) {
  const firstName = options.firstName || generateRandomName('first');
  const lastName  = options.lastName  || generateRandomName('last');
  const digits    = generateRandomDigits(10);

  return {
    firstName,
    lastName,
    nickname:      options.nickname      || `${firstName} ${lastName[0]}`,
    streetAddress: options.streetAddress || generateRandomStreetAddress(),
    city:          options.city          || generateRandomCity(),
    state:         options.state         || 'NY',
    zipCode:       options.zipCode       || '10011',
    accountNumber: options.accountNumber || `498493${digits}`,
    routingNumber: options.routingNumber || '021000021',
  };
}

/**
 * Generates wire payment schedule data.
 * requestedDate is computed at call-time so it always matches today's date
 * and never needs manual updating in the test file.
 *
 * @param {object} options - Optional field overrides
 * @returns {object} Payment schedule data
 */
function generateWirePaymentSchedule(options = {}) {
  const requestedDate = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return {
    frequency:    options.frequency    || 'One Time Only',
    message:      options.message      || 'Wire transfer test',
    requestedDate: options.requestedDate || requestedDate,
    amountInput:  options.amountInput  || '9000',   // digits typed into field — app formats as $90.00
    amount:       options.amount       || '$90.00',
  };
}

/** Random send amount in USD for user-web FX (keeps run-to-run variation; stay in a safe band for balance). */
function generateRandomSendAmountUsd() {
  const whole = 52 + Math.floor(Math.random() * 34);
  const cents = Math.floor(Math.random() * 100);
  return `${whole}.${String(cents).padStart(2, '0')}`;
}

/**
 * Generates FX transaction form data for UI tests.
 * Beneficiary name and identity number are randomised on every call.
 *
 * @param {object} options
 * @param {string} [options.amountUsd] - When set (or `randomizeSendAmountUsd`), derives `amountInput` via `toCentsInput` and `amount` display.
 * @param {boolean} [options.randomizeSendAmountUsd] - Pick a random `amountUsd` (ignored if `amountUsd` is already set).
 * @param {string} [options.beneficiaryFirstName] - Alias for `firstName`.
 * @param {string} [options.beneficiaryLastName] - Alias for `lastName`.
 * @returns {object} FX transaction data
 */
function generateFxTransactionData(options = {}) {
  const firstName =
    options.firstName || options.beneficiaryFirstName || generateRandomName('first');
  const lastName = options.lastName || options.beneficiaryLastName || generateRandomName('last');

  let amountUsd = null;
  if (options.amountUsd != null && options.amountUsd !== '') {
    amountUsd = Number(options.amountUsd).toFixed(2);
  } else if (options.randomizeSendAmountUsd) {
    amountUsd = generateRandomSendAmountUsd();
  }

  let amountInput;
  let amount;
  if (amountUsd != null) {
    amountInput = options.amountInput ?? toCentsInput(amountUsd);
    amount = options.amount ?? formatUsdDisplay(amountUsd);
  } else {
    amountInput = options.amountInput ?? '5500';
    amount = options.amount ?? '$55.00';
  }

  return {
    beneficiaryFirstName: firstName,
    beneficiaryLastName: lastName,
    country: options.country ?? 'United Kingdom (GB)',
    iban: options.iban ?? 'GB26542316456541232134',
    identityType: options.identityType ?? 'Passport',
    identityNumber: options.identityNumber ?? generateRandomDigits(7),
    note: options.note !== undefined && options.note !== null ? options.note : 'Sending to the UK',
    amountInput,
    amount,
    amountUsd,
  };
}

module.exports = {
  generateUserTestData,
  generateIncomingWireData,
  generateWireInstructionData,
  generateWithdrawFundData,
  generateWireFormData,
  generateWirePaymentSchedule,
  generateFxTransactionData,
  generateRandomDigits,
  toCentsInput,
  formatUsdDisplay,
  generateRandomName,
  generateRandomStreetAddress,
  generateRandomCity,
  generateRandomBirthYear,
  generateRandomSSN,
  generateUniqueSignupPhoneNumber
};
