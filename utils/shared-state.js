// Shared state under .bivo-state/: suite-specific JSON when BIVO_UI_STATE_SUITE is set.
// Stored outside test-results/ so Playwright's per-run cleanup does not delete it.
// tryLoadSignupData also considers legacy shared-state.json (newest valid file wins).

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(process.cwd(), '.bivo-state');

function statePaths() {
  return {
    legacy: path.join(RESULTS_DIR, 'shared-state.json'),
    bcr: path.join(RESULTS_DIR, 'shared-state-bcr.json'),
    userweb: path.join(RESULTS_DIR, 'shared-state-userweb.json'),
    buweb: path.join(RESULTS_DIR, 'shared-state-buweb.json'),
  };
}

// Without env, falls back to legacy path.
function activeStateFile() {
  const suite = process.env.BIVO_UI_STATE_SUITE;
  const p = statePaths();
  if (suite === 'bcr') return p.bcr;
  if (suite === 'userweb') return p.userweb;
  if (suite === 'buweb') return p.buweb;
  return p.legacy;
}

function readStateFileOrThrow(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Shared state file not found at ${file}.\n` +
        `Run the signup test first (e.g. npm run test:ui:bcr:signup or npm run test:ui:userweb:signup)`
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function stripLegacyPhoneCountryField(obj) {
  if (!obj || typeof obj !== 'object') return;
  if ('phoneNumberWithCountryCode' in obj) {
    delete obj.phoneNumberWithCountryCode;
  }
}

function normalizePhoneInMemory(data) {
  if (!data) return;
  const legacyCc = data.phoneNumberWithCountryCode;
  delete data.phoneNumberWithCountryCode;
  if (!data.phoneNumber && legacyCc) {
    const digits = String(legacyCc).replace(/\D/g, '');
    if (digits.length >= 10) data.phoneNumber = digits.slice(-10);
  }
  if (data.phoneNumber) {
    const plain = String(data.phoneNumber).replace(/\D/g, '');
    data.phoneNumber = plain.length >= 10 ? plain.slice(-10) : plain;
  }
}

function saveSignupData(data) {
  const file = activeStateFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = { ...data, savedAt: new Date().toISOString() };
  stripLegacyPhoneCountryField(payload);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function loadSignupData() {
  const file = activeStateFile();
  const data = readStateFileOrThrow(file);
  normalizePhoneInMemory(data);
  return data;
}

function findBestSignupState(maxAgeHours) {
  const files = Object.values(statePaths());
  let best = null;
  let bestTime = -1;

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      continue;
    }
    if (!data.savedAt) continue;
    const ageHours = (Date.now() - new Date(data.savedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > maxAgeHours) continue;
    const t = new Date(data.savedAt).getTime();
    if (t > bestTime) {
      bestTime = t;
      best = { file, data };
    }
  }
  return best;
}

function tryLoadSignupData(maxAgeHours = 8) {
  const found = findBestSignupState(maxAgeHours);
  if (!found) {
    console.log('\n⚠️  Shared state not found — falling back to standalone credentials');
    return null;
  }

  const { data } = found;
  normalizePhoneInMemory(data);
  return data;
}

// Like tryLoadSignupData but scoped to the ACTIVE suite's file only (BIVO_UI_STATE_SUITE).
// Used so user-web specs pick up the user the onboarding suite just created — never a
// newer-but-different suite's user. Returns null (no throw) when the file is missing,
// unparseable, has no phoneNumber, or is older than maxAgeHours, so callers can fall back.
function tryLoadActiveSuiteSignupData(maxAgeHours = 8) {
  const file = activeStateFile();
  if (!fs.existsSync(file)) return null;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }

  normalizePhoneInMemory(data);
  if (!data.phoneNumber) return null;

  // savedAt is written by saveSignupData; treat a missing timestamp as too old to trust.
  if (!data.savedAt) return null;
  const ageHours = (Date.now() - new Date(data.savedAt).getTime()) / (1000 * 60 * 60);
  if (ageHours > maxAgeHours) {
    console.log(`\n⚠️  ${path.basename(file)} is ${ageHours.toFixed(1)}h old (> ${maxAgeHours}h) — ignoring`);
    return null;
  }

  return data;
}

function saveClientData({ clientId, accountNumber }) {
  const file = activeStateFile();
  const data = readStateFileOrThrow(file);
  data.clientId = clientId;
  data.accountNumber = accountNumber;
  data.clientSavedAt = new Date().toISOString();
  stripLegacyPhoneCountryField(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function saveClientId(clientId) {
  saveClientData({ clientId, accountNumber: undefined });
}

function loadClientId() {
  const file = activeStateFile();
  const data = readStateFileOrThrow(file);
  if (!data.clientId) {
    throw new Error(
      `clientId not found in shared state.\n` +
        `Run the first-login test first (npm run test:ui:bcr:first-login).`
    );
  }
  return data.clientId;
}

function loadAccountNumber() {
  const file = activeStateFile();
  const data = readStateFileOrThrow(file);
  if (!data.accountNumber) {
    throw new Error(
      `accountNumber not found in shared state.\n` +
        `Run user-web signup (1.1) or the first-login test that persists account-info first.`
    );
  }
  return data.accountNumber;
}

function saveExtendedState(fields) {
  const file = activeStateFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = fs.existsSync(file) ? readStateFileOrThrow(file) : {};

  const data = {
    ...existing,
    ...fields,
    extendedSavedAt: new Date().toISOString(),
  };
  stripLegacyPhoneCountryField(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  saveSignupData,
  loadSignupData,
  tryLoadSignupData,
  tryLoadActiveSuiteSignupData,
  saveClientData,
  saveClientId,
  loadClientId,
  loadAccountNumber,
  saveExtendedState,
};
