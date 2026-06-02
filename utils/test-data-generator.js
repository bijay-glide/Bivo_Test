/**
 * Test Data Generator for User Registration
 */

const { faker } = require('@faker-js/faker');
const { toCentsInput, formatUsdDisplay } = require('./amount-input');

// Allowed US area codes for signup tests.
const ALLOWED_SIGNUP_AREA_CODES = ['212', '415', '646'];
const generatedPhoneNumbers = new Set();

/**
 * Generates a random numeric string of the given length
 */
function generateRandomDigits(length) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, '0');
}

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

function generateRandomStreetAddress() {
  return faker.location.streetAddress();
}

function generateRandomCity() {
  return faker.location.city();
}

function generateRandomBirthYear() {
  return faker.date.birthdate({ min: 24, max: 55, mode: 'age' }).getFullYear().toString();
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
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
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
  const businessName = options.businessName || `${faker.person.firstName()} Corp`;

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
  const firstName = options.firstName || faker.person.firstName();
  const lastName  = options.lastName  || faker.person.lastName();
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
 * Returns faker-generated extra payee fields for countries that need them,
 * or null for countries whose payee form only asks for name.
 * Add a new case here whenever a new country recording reveals extra fields.
 *
 * @param {string} countryCode
 * @returns {object|null}
 */
function generatePayeeExtraFields(countryCode) {
  switch (countryCode) {
    case 'AU':
      return {
        streetAddress: faker.location.streetAddress(),
        city: faker.location.city(),
      };
    case 'CN':
      return {
        streetAddress: faker.location.streetAddress(),
        city: faker.location.city(),
        zipCode: faker.string.numeric(6),       // 6-digit Chinese postal code
      };
    case 'IN':
      return {
        streetAddress: faker.location.streetAddress(),
        city: faker.location.city(),
        zipCode: faker.string.numeric(6),       // 6-digit Indian PIN code
        phone: `+91 9${faker.string.numeric(4)} ${faker.string.numeric(5)}`, // Indian mobile: +91 9XXXX XXXXX (10 digits, starts with 9)
      };
    case 'JP':
      return {
        streetAddress: faker.location.streetAddress(),
        city: faker.location.city(),
        zipCode: faker.string.numeric(7),       // 7-digit Japanese postal code
        phone: `+81 90 ${faker.string.numeric(4)} ${faker.string.numeric(4)}`, // Japanese mobile: +81 90-XXXX-XXXX
      };
    default:
      return null;
  }
}

/**
 * Generates FX transaction form data for UI tests.
 * Beneficiary name, identity number, and country-specific address fields are
 * randomised on every call.
 *
 * @param {object} options
 * @param {string} [options.countryCode]          - ISO alpha-2 destination country (default 'GB'). Drives payeeExtraFields.
 * @param {string} [options.amountUsd]            - Fixed send amount; derives amountInput + amount display.
 * @param {boolean} [options.randomizeSendAmountUsd] - Pick a random amountUsd (ignored if amountUsd is set).
 * @param {string} [options.beneficiaryFirstName] - Alias for firstName.
 * @param {string} [options.beneficiaryLastName]  - Alias for lastName.
 * @returns {object} FX transaction data
 */
function generateFxTransactionData(options = {}) {
  const firstName =
    options.firstName || options.beneficiaryFirstName || faker.person.firstName();
  const lastName = options.lastName || options.beneficiaryLastName || faker.person.lastName();

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

  const countryCode = options.countryCode ?? 'GB';

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
    payeeExtraFields: generatePayeeExtraFields(countryCode),
  };
}

// Static prefix used across all auto-generated numeric banking fields (5 digits).
// Keeps the first digits recognisable as automated test data.
const BIVO_NUMERIC_PREFIX = '98765';

/**
 * Generates a random SWIFT / BIC-shaped code of the given length.
 * First 5 digits are always BIVO_NUMERIC_PREFIX so runs are identifiable.
 * Supports 8-digit and 11-digit lengths.
 *
 * @param {8|11} length
 * @returns {string}
 */
function generateSwiftCode(length = 8) {
  return BIVO_NUMERIC_PREFIX + generateRandomDigits(length - BIVO_NUMERIC_PREFIX.length);
}

/**
 * Generates a 11-digit Chinese mobile number without any country-code prefix.
 * Prefix "138" identifies automated test data; the system adds +86 automatically.
 *
 * @returns {string}  e.g. "13852904371"
 */
function generateChinesePhoneNumber() {
  return '138' + generateRandomDigits(8);
}

/**
 * Generates a fake bank name with a "Bivo " prefix so automated entries are easy to spot.
 *
 * @returns {string}  e.g. "Bivo Henderson LLC"
 */
function generateBivoBankName() {
  return 'Bivo ' + faker.company.name().replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Returns freshly randomised banking-details for the given destination country.
 * Use this in tests instead of the static bankingDetails from COUNTRY_BANKING_CONFIGS.
 *
 * Length rules (all-digit fields):
 *   8 digits  → BIVO_NUMERIC_PREFIX (5) + 3 random
 *   9 digits  → "987" (3) + 6 random
 *  12 digits  → BIVO_NUMERIC_PREFIX (5) + 7 random
 *  15 digits  → BIVO_NUMERIC_PREFIX (5) + 10 random
 *   3 digits  → fully random (too short for a useful prefix)
 *   6 digits  → "987" (3) + 3 random
 *
 * @param {string} countryCode  ISO alpha-2, e.g. 'CN', 'JP', 'HK'
 * @returns {object}
 */
function generateBankingDetails(countryCode) {
  switch (countryCode) {
    case 'GB':
      // IBAN has a strict check-digit algorithm — keep static to avoid validation failures.
      return { iban: 'GB26542316456541232134' };

    case 'AU':
      return {
        bankName:      generateBivoBankName(),
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),  // 12 digits
        bsbCode:       '987' + generateRandomDigits(3),                 // 6 digits
      };

    case 'SV':
      return { dui: '987' + generateRandomDigits(6) }; // 9 digits

    case 'IN':
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(10), // 15 digits
        // IFSC format is strict (BANK-0-BRANCH) — keep static to pass server validation.
        ifscCode: 'IDIB000N044',
      };

    case 'JP':
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(3),  // 8 digits
        swiftCode:     generateSwiftCode(8),
        bankCode:      generateRandomDigits(3),                          // 3 digits (too short for prefix)
        branchCode:    generateRandomDigits(3),                          // 3 digits
        accountType:   'Savings',
      };

    case 'HK':
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(3),  // 8 digits
        bankName:      generateBivoBankName(),
        bankCode:      generateRandomDigits(3),                          // 3 digits
        branchCode:    generateRandomDigits(3),                          // 3 digits
        swiftCode:     generateSwiftCode(8),
      };

    case 'MX':
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),  // 12 digits
      };

    case 'CN':
      return {
        // 11 digits, no country-code prefix — system already prepends +86.
        phone:          generateChinesePhoneNumber(),
        walletProvider: 'Alipay',
        swiftCode:      generateSwiftCode(8),
        bankName:       generateBivoBankName(),
      };

    default:
      throw new Error(`generateBankingDetails: no config for country "${countryCode}"`);
  }
}

module.exports = {
  generateUserTestData,
  generateIncomingWireData,
  generateWireInstructionData,
  generateWithdrawFundData,
  generateWireFormData,
  generateWirePaymentSchedule,
  generateFxTransactionData,
  generateBankingDetails,
  generatePayeeExtraFields,
  generateRandomDigits,
  generateRandomSSN,
  generateUniqueSignupPhoneNumber,
};
