/**
 * External Portal — Beneficiary Field Validation
 *
 * Authenticates as the MXN sandbox portal user (HAR: EXT-MXN-BeneficiaryValidation.har),
 * then fires every test case against POST /api-gateway/v1/external/beneficiary,
 * varying only the four mutable fields:
 *   business_name, address_one, city, postal_code
 *
 * All other payload values are fixed from the HAR capture:
 *   currencyId=18 (GBP), beneficiaryType=BUSINESS, clientId=38693, businessId=13203, country=GB
 *
 * API field constraints (from GET /beneficiary/fields?currency_id=18&beneficiary_type=BUSINESS):
 *   business_name : minLength=1,  maxLength=100, regex ^.{0,100}$   (very permissive)
 *   address_one   : minLength=3,  maxLength=100, regex ^.{0,100}$   (very permissive)
 *   city          : minLength=3,  maxLength=50,  regex ^.{0,50}$    (very permissive)
 *   postal_code   : minLength=3,  maxLength=14,  regex ^[A-Za-z0-9\- ]{3,14}$
 *
 * FE enforces max 40 chars for all fields (stricter than API for business_name/address_one/city).
 *
 * Status interpretation:
 *   200 — ACCEPTED: beneficiary created successfully
 *   400 — REJECTED BY API VALIDATION: specific error returned
 *   500 — PASSES FIELD VALIDATION: downstream service error (not a field issue)
 */

const { test } = require('@playwright/test');

// ── Auth / fixed config ─────────────────────────────────────────────────────
const BASE_URL = 'https://api-sandbox.bivotech.co';
const TENANT   = 'bivo_sandbox';
const EMAIL    = 'mxn-sanboxportaluser@test.money';
const PASSWORD = 'bjiiamuaDHjM';
const DEVICE_ID = 'dtbl2o-web';

// Fixed payload (from HAR — do not change)
const FIXED_PAYLOAD = {
  currencyId     : 18,
  beneficiaryType: 'BUSINESS',
  clientId       : 38693,
  businessId     : 13203,
  country        : 'GB',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const str = (n, ch = 'A') => ch.repeat(n);
const VALID = { business_name: 'Claudia Eaton', address_one: '45 Baker Street', city: 'London', postal_code: 'SW1A 1AA' };

// ── Test cases ──────────────────────────────────────────────────────────────
const TEST_CASES = [

  // ── Baseline ──────────────────────────────────────────────────────────────
  { id:'TC01', cat:'Baseline',              desc:'All fields valid (baseline from HAR)',                                   fields:{...VALID} },

  // ── business_name — length ────────────────────────────────────────────────
  { id:'TC02', cat:'Length — business_name', desc:'business_name at FE max (40 chars)',                                   fields:{...VALID, business_name:str(40)} },
  { id:'TC03', cat:'Length — business_name', desc:'business_name 41 chars (1 over FE limit, within API max 100)',         fields:{...VALID, business_name:str(41)} },
  { id:'TC04', cat:'Length — business_name', desc:'business_name at API max (100 chars)',                                 fields:{...VALID, business_name:str(100)} },
  { id:'TC05', cat:'Length — business_name', desc:'business_name over API max (101 chars)',                               fields:{...VALID, business_name:str(101)} },
  { id:'TC06', cat:'Length — business_name', desc:'business_name at API min (1 char)',                                    fields:{...VALID, business_name:'A'} },

  // ── address_one — length ──────────────────────────────────────────────────
  { id:'TC07', cat:'Length — address_one',   desc:'address_one at FE max (40 chars)',                                     fields:{...VALID, address_one:str(40)} },
  { id:'TC08', cat:'Length — address_one',   desc:'address_one 41 chars (1 over FE limit, within API max 100)',           fields:{...VALID, address_one:str(41)} },
  { id:'TC09', cat:'Length — address_one',   desc:'address_one at API max (100 chars)',                                   fields:{...VALID, address_one:str(100)} },
  { id:'TC10', cat:'Length — address_one',   desc:'address_one over API max (101 chars)',                                 fields:{...VALID, address_one:str(101)} },
  { id:'TC11', cat:'Length — address_one',   desc:'address_one at API min (3 chars)',                                     fields:{...VALID, address_one:'ABC'} },
  { id:'TC12', cat:'Length — address_one',   desc:'address_one below API min (2 chars)',                                  fields:{...VALID, address_one:'AB'} },

  // ── city — length ─────────────────────────────────────────────────────────
  { id:'TC13', cat:'Length — city',          desc:'city at FE max (40 chars)',                                            fields:{...VALID, city:str(40)} },
  { id:'TC14', cat:'Length — city',          desc:'city at API max (50 chars)',                                           fields:{...VALID, city:str(50)} },
  { id:'TC15', cat:'Length — city',          desc:'city over API max (51 chars)',                                         fields:{...VALID, city:str(51)} },
  { id:'TC16', cat:'Length — city',          desc:'city at API min (3 chars)',                                            fields:{...VALID, city:'LON'} },
  { id:'TC17', cat:'Length — city',          desc:'city below API min (2 chars)',                                         fields:{...VALID, city:'LA'} },

  // ── postal_code — length ──────────────────────────────────────────────────
  { id:'TC18', cat:'Length — postal_code',   desc:'postal_code at API max (14 alphanumeric chars)',                       fields:{...VALID, postal_code:'AB1234567890CD'} },
  { id:'TC19', cat:'Length — postal_code',   desc:'postal_code over API max (15 chars)',                                  fields:{...VALID, postal_code:'AB1234567890CDE'} },
  { id:'TC20', cat:'Length — postal_code',   desc:'postal_code at API min (3 chars)',                                     fields:{...VALID, postal_code:'W1A'} },
  { id:'TC21', cat:'Length — postal_code',   desc:'postal_code below API min (2 chars)',                                  fields:{...VALID, postal_code:'W1'} },

  // ── Empty / null ──────────────────────────────────────────────────────────
  { id:'TC22', cat:'Empty/Null',             desc:'business_name empty string',                                           fields:{...VALID, business_name:''} },
  { id:'TC23', cat:'Empty/Null',             desc:'address_one empty string',                                             fields:{...VALID, address_one:''} },
  { id:'TC24', cat:'Empty/Null',             desc:'city empty string',                                                    fields:{...VALID, city:''} },
  { id:'TC25', cat:'Empty/Null',             desc:'postal_code empty string',                                             fields:{...VALID, postal_code:''} },
  { id:'TC26', cat:'Empty/Null',             desc:'All four fields empty strings',                                        fields:{business_name:'', address_one:'', city:'', postal_code:''} },
  { id:'TC27', cat:'Empty/Null',             desc:'business_name null',                                                   fields:{...VALID, business_name:null} },
  { id:'TC28', cat:'Empty/Null',             desc:'address_one null',                                                     fields:{...VALID, address_one:null} },
  { id:'TC29', cat:'Empty/Null',             desc:'city null',                                                            fields:{...VALID, city:null} },
  { id:'TC30', cat:'Empty/Null',             desc:'postal_code null',                                                     fields:{...VALID, postal_code:null} },

  // ── Whitespace ────────────────────────────────────────────────────────────
  { id:'TC31', cat:'Whitespace',             desc:'business_name whitespace only (3 spaces)',                             fields:{...VALID, business_name:'   '} },
  { id:'TC32', cat:'Whitespace',             desc:'address_one whitespace only (3 spaces)',                               fields:{...VALID, address_one:'   '} },
  { id:'TC33', cat:'Whitespace',             desc:'city whitespace only (3 spaces)',                                      fields:{...VALID, city:'   '} },
  { id:'TC34', cat:'Whitespace',             desc:'business_name with leading and trailing spaces',                       fields:{...VALID, business_name:'  Claudia Eaton  '} },

  // ── Character types ───────────────────────────────────────────────────────
  { id:'TC35', cat:'Char Type',              desc:'business_name alphanumeric (123 Corp)',                                fields:{...VALID, business_name:'123 Corp'} },
  { id:'TC36', cat:'Char Type',              desc:'business_name numeric only (12345)',                                   fields:{...VALID, business_name:'12345'} },
  { id:'TC37', cat:'Char Type',             desc:"business_name with apostrophe & ampersand (O'Brien & Co.)",            fields:{...VALID, business_name:"O'Brien & Co."} },
  { id:'TC38', cat:'Char Type',              desc:'business_name with unicode diacritics (Müller GmbH)',                 fields:{...VALID, business_name:'Müller GmbH'} },
  { id:'TC39', cat:'Char Type',              desc:'address_one with street number (123 Main St)',                        fields:{...VALID, address_one:'123 Main St'} },
  { id:'TC40', cat:'Char Type',              desc:'postal_code with hyphen (SW1A-1AA) — allowed by regex',              fields:{...VALID, postal_code:'SW1A-1AA'} },
  { id:'TC41', cat:'Char Type',              desc:'postal_code with exclamation mark (SW1A!1AA) — not allowed',          fields:{...VALID, postal_code:'SW1A!1AA'} },
  { id:'TC42', cat:'Char Type',              desc:'postal_code starting with @ symbol (@SW1A1A) — not allowed',         fields:{...VALID, postal_code:'@SW1A1A'} },
  { id:'TC43', cat:'Char Type',              desc:'postal_code all digits (123456)',                                      fields:{...VALID, postal_code:'123456'} },
  { id:'TC44', cat:'Char Type',              desc:'city with hyphen (Stratford-upon-Avon)',                              fields:{...VALID, city:'Stratford-upon-Avon'} },

  // ── Security ──────────────────────────────────────────────────────────────
  { id:'TC45', cat:'Security',               desc:"SQL injection in business_name ('; DROP TABLE beneficiaries;--)",     fields:{...VALID, business_name:"'; DROP TABLE beneficiaries;--"} },
  { id:'TC46', cat:'Security',               desc:'XSS payload in business_name (<script>alert(1)</script>)',            fields:{...VALID, business_name:'<script>alert(1)</script>'} },
  { id:'TC47', cat:'Security',               desc:'Path traversal in address_one (../../../etc/passwd)',                  fields:{...VALID, address_one:'../../../etc/passwd'} },
  { id:'TC48', cat:'Security',               desc:'Oversized payload in business_name (500 chars)',                      fields:{...VALID, business_name:str(500)} },
];

// ── Auth helper ─────────────────────────────────────────────────────────────
async function authenticate(request) {
  const sessionHeaders = {
    'Content-Type'       : 'application/json',
    'x-session-id'       : '1234',
    'x-tenant-identifier': TENANT,
  };

  await request.post(`${BASE_URL}/identity/v1/grant-type`, {
    headers: sessionHeaders,
    data   : { email: EMAIL },
  });

  const tokenRes = await request.post(`${BASE_URL}/identity/v1/token`, {
    headers: sessionHeaders,
    data   : { username: EMAIL, grantType: 'password', deviceId: DEVICE_ID, password: PASSWORD },
  });

  if (!tokenRes.ok()) throw new Error(`token failed: ${tokenRes.status()} ${await tokenRes.text()}`);
  const { accessToken, forceOtpAuth } = await tokenRes.json();
  if (forceOtpAuth) throw new Error('OTP required but not expected for this device');

  return {
    'Content-Type'       : 'application/json',
    'x-session-id'       : '1234',
    'x-tenant-identifier': TENANT,
    'Authorization'      : `Bearer ${accessToken}`,
  };
}

// ── Status interpretation ────────────────────────────────────────────────────
function classify(status) {
  if (status === 200)                     return 'ACCEPTED (created)';
  if (status === 400)                     return 'REJECTED BY VALIDATION';
  if (status === 500)                     return 'PASSES VALIDATION (server error downstream)';
  return `HTTP ${status}`;
}

function verdict(status) {
  if (status === 200 || status === 500)   return '✅ PASSES FIELD VALIDATION';
  if (status === 400)                     return '❌ REJECTED BY API';
  return `⚠️  HTTP ${status}`;
}

// ── Report formatter ─────────────────────────────────────────────────────────
function buildReport(results) {
  const W = 100;
  const hr  = '═'.repeat(W);
  const hr2 = '─'.repeat(W);
  const lines = [
    hr,
    ' BENEFICIARY FIELD VALIDATION REPORT',
    ' POST /api-gateway/v1/external/beneficiary',
    hr,
    ` Auth user       : ${EMAIL}`,
    ` Environment     : ${BASE_URL}   tenant: ${TENANT}`,
    ` Fixed payload   : currencyId=18 (GBP), beneficiaryType=BUSINESS,`,
    `                   clientId=38693, businessId=13203, country=GB`,
    '',
    ' STATUS LEGEND',
    '   200  ACCEPTED — beneficiary created in the system',
    '   400  REJECTED BY VALIDATION — field rule violated; API returns specific error',
    '   500  PASSES FIELD VALIDATION — downstream service error unrelated to field values',
    hr,
    '',
  ];

  let lastCat = '';

  for (const r of results) {
    if (r.cat !== lastCat) {
      if (lastCat) lines.push('');
      lines.push(hr2);
      lines.push(` Category: ${r.cat}`);
      lines.push(hr2);
      lastCat = r.cat;
    }

    const fn = v => (v === null ? '<null>' : v === '' ? '<empty>' : String(v).length > 42 ? String(v).slice(0, 39) + '...' : String(v));
    lines.push('');
    lines.push(` ${r.id}  ${r.desc}`);
    lines.push(`   business_name : ${fn(r.fields.business_name)}`);
    lines.push(`   address_one   : ${fn(r.fields.address_one)}`);
    lines.push(`   city          : ${fn(r.fields.city)}`);
    lines.push(`   postal_code   : ${fn(r.fields.postal_code)}`);
    lines.push(`   → HTTP ${r.status}  ${classify(r.status)}`);
    lines.push(`   → ${verdict(r.status)}`);
    if (r.errorCode) {
      lines.push(`   → Error ${r.errorCode}: ${r.userMessage}`);
    }
    if (r.refId) {
      lines.push(`   → referenceId: ${r.refId}`);
    }
  }

  lines.push('');
  lines.push(hr);

  // Summary table
  const accepted = results.filter(r => r.status === 200);
  const passVal  = results.filter(r => r.status === 500);
  const rejected = results.filter(r => r.status === 400);
  const other    = results.filter(r => ![200, 400, 500].includes(r.status));

  lines.push(' SUMMARY');
  lines.push(`   Total cases run    : ${results.length}`);
  lines.push(`   200 ACCEPTED       : ${accepted.length}  — ${accepted.map(r=>r.id).join(', ') || 'none'}`);
  lines.push(`   500 PASSES VALID.  : ${passVal.length}  — fields pass, server error downstream`);
  lines.push(`   400 REJECTED       : ${rejected.length}  — ${rejected.map(r=>r.id).join(', ')}`);
  if (other.length) lines.push(`   Other              : ${other.map(r=>`${r.id}(${r.status})`).join(', ')}`);
  lines.push('');

  // Findings
  lines.push(' KEY FINDINGS');

  const bugs = [];
  const nullBug = results.filter(r => r.fields[Object.keys(r.fields).find(k => r.fields[k] === null)] === null && r.status === 500 && [27,28,29,30].includes(+r.id.replace('TC','')));
  if (nullBug.length) bugs.push('⚠️  BUG: null values for required fields return 500 instead of 400 (mandatory check bypassed for null)');

  const addr2 = results.find(r => r.id === 'TC12');
  if (addr2?.status === 500) bugs.push('⚠️  BUG: address_one with 2 chars (below API minLength=3) passes validation → 500 (minLength not enforced for address_one)');

  const city2 = results.find(r => r.id === 'TC17');
  if (city2?.status === 500) bugs.push('⚠️  BUG: city with 2 chars (below API minLength=3) passes validation → 500 (minLength not enforced for city)');

  const feMax = results.filter(r => ['TC03','TC08'].includes(r.id) && r.status === 500);
  if (feMax.length) bugs.push('ℹ️  INFO: API accepts fields over FE max (40 chars) — business_name API max=100, address_one API max=100, city API max=50');

  const security = results.filter(r => ['TC45','TC46','TC47'].includes(r.id) && r.status === 500);
  if (security.length) bugs.push('⚠️  SECURITY: SQL injection, XSS, path traversal all pass field validation without rejection — review sanitization');

  const whitespace = results.filter(r => ['TC31','TC32','TC33'].includes(r.id) && r.status === 400);
  if (whitespace.length) bugs.push('✓  GOOD: Whitespace-only strings correctly treated as mandatory (trimmed before check)');

  for (const b of bugs) lines.push(`   ${b}`);

  lines.push(hr);
  return lines.join('\n');
}

// ── The test ─────────────────────────────────────────────────────────────────
test.describe('Beneficiary Field Validation — EXT Portal (GBP / GB / BUSINESS)', () => {
  test.describe.configure({ mode: 'serial' });

  test('Run all field validation cases and produce report', async ({ request }) => {
    const authHeaders = await authenticate(request);
    const results = [];

    for (const tc of TEST_CASES) {
      const payload = { ...FIXED_PAYLOAD, fields: tc.fields };
      const res = await request.post(`${BASE_URL}/api-gateway/v1/external/beneficiary`, {
        headers: authHeaders,
        data   : payload,
      });

      let body = {};
      try { body = await res.json(); } catch { body = {}; }

      results.push({
        id      : tc.id,
        cat     : tc.cat,
        desc    : tc.desc,
        fields  : tc.fields,
        status  : res.status(),
        errorCode  : body.errorCode   || null,
        userMessage: body.userMessage || null,
        refId      : body.referenceId || null,
      });

      // Throttle to avoid overwhelming the service
      await new Promise(r => setTimeout(r, 300));
    }

    const report = buildReport(results);
    console.log('\n' + report);

    test.info().attach('beneficiary-validation-report.txt', {
      body       : Buffer.from(report, 'utf-8'),
      contentType: 'text/plain',
    });

    test.info().attach('beneficiary-validation-results.json', {
      body       : Buffer.from(JSON.stringify(results, null, 2), 'utf-8'),
      contentType: 'application/json',
    });
  });
});
