import http from 'k6/http';
import { check } from 'k6';
import { HOST } from './config.js';
import { today, randInt, randAcctNum, step } from './helpers.js';

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function runDashboard(h, user, vu) {
  let r;

  r = http.get(`${HOST}/user/v1/dashboard`, { headers: h });
  step(vu, 1, r, 'GET', '/user/v1/dashboard');
  check(r, { 'dashboard 200': res => res.status === 200 });

  r = http.get(`${HOST}/user/v1/permissions`, { headers: h });
  step(vu, 2, r, 'GET', '/user/v1/permissions');
  check(r, { 'permissions 200': res => res.status === 200 });

  r = http.get(`${HOST}/client/v1/profile`, { headers: h });
  step(vu, 3, r, 'GET', '/client/v1/profile');
  check(r, { 'profile 200': res => res.status === 200 });

  r = http.get(`${HOST}/transactions/v1/transactions/accountbalance`, { headers: h });
  step(vu, 4, r, 'GET', '/transactions/v1/transactions/accountbalance');
  check(r, { 'balance 200': res => res.status === 200 });

  r = http.get(`${HOST}/transactions/v1/transactions?accountId=${user.walletAccount}&page=0&size=10`, { headers: h });
  step(vu, 5, r, 'GET', `/transactions/v1/transactions?accountId=${user.walletAccount}`);
  check(r, { 'tx-list 200': res => res.status === 200 });

  r = http.get(`${HOST}/remittance/v1/currencies`, { headers: h });
  step(vu, 6, r, 'GET', '/remittance/v1/currencies');
  check(r, { 'currencies 200': res => res.status === 200 });
}

// ── Wire withdrawal ───────────────────────────────────────────────────────────
export function runWire(h, user, vu) {
  let r = http.post(
    `${HOST}/user/v1/beneficiary`,
    JSON.stringify({
      firstName:         'Tiger',
      lastName:          'Barr',
      accountNickname:   `K6 Wire ${randInt(100, 999)}`,
      streetAddress:     '12333 West Olympic Boulevard',
      city:              'Los Angeles',
      state:             'CA',
      zipCode:           '90064',
      accountNumber:     randAcctNum(),
      wireRoutingNumber: '1000122',
      ownAccount:        true,
    }),
    { headers: h },
  );
  const beneficiaryOk = step(vu, 7, r, 'POST', '/user/v1/beneficiary');
  check(r, { 'wire beneficiary 2xx': res => res.status === 200 || res.status === 201 });
  if (!beneficiaryOk) {
    console.error(`  VU${vu} wire beneficiary FAILED (${r.status}) body=${r.body}`);
    return;
  }

  // POST response doesn't return the identifier — fetch it from the list
  const listRes = http.get(`${HOST}/user/v1/beneficiary?own-account=true`, { headers: h });
  step(vu, 8, listRes, 'GET', '/user/v1/beneficiary?own-account=true');
  check(listRes, { 'wire beneficiary list 200': res => res.status === 200 });

  let wireBeneId = null;
  try {
    const list = listRes.json();
    wireBeneId = Array.isArray(list) ? list[0]?.identifier : null;
  } catch {}

  if (!wireBeneId) {
    console.error(`  VU${vu} could not extract beneficiary identifier from list`);
    return;
  }

  r = http.post(
    `${HOST}/user/v1/transaction/withdraw-fund`,
    JSON.stringify({
      fromAccount: user.walletAccount,
      toAccount:   wireBeneId,
      amount:      '1.00',
      name:        'K6 Wire',
      type:        'WIRE',
      startDate:   today(),
      endDate:     today(),
    }),
    { headers: h },
  );
  step(vu, 9, r, 'POST', '/user/v1/transaction/withdraw-fund');
  check(r, { 'wire withdraw 200': res => res.status === 200 });
  if (r.status !== 200) console.error(`  VU${vu} wire withdraw FAILED (${r.status}) body=${r.body}`);
}

// ── Move money (internal transfer) ───────────────────────────────────────────
export function runMoveFund(h, user, vu) {
  if (!user.externalAccount) {
    console.warn(`VU${vu}: no external account — move-money skipped`);
    return;
  }

  const r = http.post(
    `${HOST}/user/v1/transaction/move-fund`,
    JSON.stringify({
      fromAccount: user.walletAccount,
      toAccount:   user.externalAccount,
      amount:      1,
      type:        'INTERNAL',
    }),
    { headers: h },
  );
  step(vu, 10, r, 'POST', '/user/v1/transaction/move-fund');
  check(r, { 'move-fund 200': res => res.status === 200 });
  if (r.status !== 200) {
    console.error(`  VU${vu} move-fund FAILED (${r.status}) from=${user.walletAccount} to=${user.externalAccount} body=${r.body}`);
  }
}

// ── Add Payee — all 7 FX countries ───────────────────────────────────────────
export function runAddPayee(h, user, vu) {
  function piPost(stepNum, country, currencyId, data) {
    const r = http.post(
      `${HOST}/remittance/v1/beneficiary/personal-info`,
      JSON.stringify({ data, currencyId, beneficiaryType: 'INDIVIDUAL', country }),
      { headers: h },
    );
    step(vu, stepNum, r, 'POST', `/remittance/v1/beneficiary/personal-info (${country})`);
    check(r, { [`payee PI ${country} 2xx`]: res => res.status === 200 || res.status === 202 });
    try { return r.json('referenceId'); } catch { return null; }
  }

  function acctPost(stepNum, country, channel, data, referenceId) {
    if (!referenceId) { console.error(`  VU${vu} payee ${country}: no referenceId — skipping account`); return; }
    const r = http.post(
      `${HOST}/remittance/v1/beneficiary/account`,
      JSON.stringify({ data, channel, referenceId, beneficiaryType: 'INDIVIDUAL', country }),
      { headers: h },
    );
    step(vu, stepNum, r, 'POST', `/remittance/v1/beneficiary/account (${country})`);
    check(r, { [`payee acct ${country} 2xx`]: res => res.status === 200 || res.status === 202 });
  }

  // GB — IBAN (static IBAN — passes server check-digit validation)
  const gbRef = piPost(14, 'GB', 18, [
    { fieldName: 'first_name', value: 'K6' },
    { fieldName: 'last_name',  value: 'PayeeGB' },
  ]);
  acctPost(15, 'GB', 'iban', [
    { fieldName: 'bank_account_number', value: 'GB26542316456541232134' },
  ], gbRef);

  // AU — BSB (bank channel; bank_code = BSB 6 digits)
  const auRef = piPost(16, 'AU', 42, [
    { fieldName: 'first_name',  value: 'K6' },
    { fieldName: 'last_name',   value: 'PayeeAU' },
    { fieldName: 'address_one', value: '123 AU Street' },
    { fieldName: 'city',        value: 'Sydney' },
  ]);
  acctPost(17, 'AU', 'bank', [
    { fieldName: 'bank_name',           value: 'Bivo K6 Bank AU' },
    { fieldName: 'bank_account_number', value: '98765' + String(randInt(1000000, 9999999)) },
    { fieldName: 'bank_code',           value: '987' + String(randInt(100, 999)) },
  ], auRef);

  // IN — IFSC (bank channel; bank_code = IFSC; phone in personal-info)
  const inRef = piPost(18, 'IN', 4, [
    { fieldName: 'first_name',  value: 'K6' },
    { fieldName: 'last_name',   value: 'PayeeIN' },
    { fieldName: 'address_one', value: '123 IN Street' },
    { fieldName: 'city',        value: 'Mumbai' },
    { fieldName: 'postal_code', value: '400001' },
    { fieldName: 'phone',       value: '919876543210' },
  ]);
  acctPost(19, 'IN', 'bank', [
    { fieldName: 'bank_account_number', value: '98765' + String(randInt(1000000000, 9999999999)) },
    { fieldName: 'bank_code',           value: 'IDIB000N044' },
  ], inRef);

  // JP — SWIFT (bank channel; routing_code = branch code; custom_ac_one = account type: 2 = Savings; phone in personal-info)
  const jpRef = piPost(20, 'JP', 6, [
    { fieldName: 'first_name',  value: 'K6' },
    { fieldName: 'last_name',   value: 'PayeeJP' },
    { fieldName: 'phone',       value: '819012345678' },
    { fieldName: 'address_one', value: '1 JP Street' },
    { fieldName: 'city',        value: 'Tokyo' },
    { fieldName: 'postal_code', value: '1000001' },
  ]);
  acctPost(21, 'JP', 'bank', [
    { fieldName: 'bank_account_number', value: '98765' + String(randInt(100, 999)) },
    { fieldName: 'swift_code',          value: '98765' + String(randInt(100, 999)) },
    { fieldName: 'bank_code',           value: String(randInt(100, 999)) },
    { fieldName: 'routing_code',        value: String(randInt(100, 999)) },
    { fieldName: 'custom_ac_one',       value: '2' },
  ], jpRef);

  // HK — bank (routing_code = branch code; Bank code ≠ branch code, both 3 digits)
  const hkRef = piPost(22, 'HK', 87, [
    { fieldName: 'first_name', value: 'K6' },
    { fieldName: 'last_name',  value: 'PayeeHK' },
  ]);
  acctPost(23, 'HK', 'bank', [
    { fieldName: 'bank_account_number', value: '98765' + String(randInt(100, 999)) },
    { fieldName: 'bank_name',           value: 'Bivo K6 HK Bank' },
    { fieldName: 'bank_code',           value: String(randInt(100, 999)) },
    { fieldName: 'routing_code',        value: String(randInt(100, 999)) },
    { fieldName: 'swift_code',          value: '98765' + String(randInt(100, 999)) },
  ], hkRef);

  // CN — Alipay (wallet channel; bank_account_number = mobile number 11 digits)
  const cnRef = piPost(24, 'CN', 12, [
    { fieldName: 'first_name',  value: 'K6' },
    { fieldName: 'last_name',   value: 'PayeeCN' },
    { fieldName: 'address_one', value: '1 CN Street' },
    { fieldName: 'city',        value: 'Beijing' },
    { fieldName: 'postal_code', value: '100001' },
  ]);
  acctPost(25, 'CN', 'wallet', [
    { fieldName: 'bank_account_number', value: '138' + String(randInt(10000000, 99999999)) },
    { fieldName: 'bank_code',           value: String(randInt(10000, 99999)) },
    { fieldName: 'swift_code',          value: '98765' + String(randInt(100, 999)) },
    { fieldName: 'bank_name',           value: 'Bivo K6 China Bank' },
  ], cnRef);

  // MX — RTP (bank channel; account number only)
  const mxRef = piPost(26, 'MX', 15, [
    { fieldName: 'first_name', value: 'K6' },
    { fieldName: 'last_name',  value: 'PayeeMX' },
  ]);
  acctPost(27, 'MX', 'bank', [
    { fieldName: 'bank_account_number', value: '98765' + String(randInt(1000000, 9999999)) },
  ], mxRef);

  // Verify all payees are listed — gate before returning
  const listRes = http.get(
    `${HOST}/remittance/v1/beneficiary/accounts?beneficiary_type=INDIVIDUAL&page=0&size=10`,
    { headers: h },
  );
  const listOk = step(vu, 28, listRes, 'GET', '/remittance/v1/beneficiary/accounts');
  check(listRes, { 'payee list 200': res => res.status === 200 });
  if (!listOk) {
    console.error(`  VU${vu} payee list FAILED (${listRes.status}) body=${listRes.body}`);
  }
}

// ── US ACH transfer ───────────────────────────────────────────────────────────
export function runACH(h, user, vu) {
  const piRes = http.post(
    `${HOST}/remittance/v1/beneficiary/personal-info`,
    JSON.stringify({
      data: [
        { fieldName: 'first_name', value: 'LoadTest' },
        { fieldName: 'last_name',  value: 'Ach' },
      ],
      currencyId:      5,
      beneficiaryType: 'INDIVIDUAL',
      country:         'US',
      channel:         'domestic',
    }),
    { headers: h },
  );
  step(vu, 11, piRes, 'POST', '/remittance/v1/beneficiary/personal-info');
  check(piRes, { 'ach personal-info 2xx': res => res.status === 200 || res.status === 202 });

  let referenceId = null;
  try { referenceId = piRes.json('referenceId'); } catch {}
  if (!referenceId) return;

  const baRes = http.post(
    `${HOST}/remittance/v1/beneficiary/account`,
    JSON.stringify({
      data: [
        { fieldName: 'bank_account_number', value: randAcctNum() },
        { fieldName: 'routing_code',        value: '021000021' },
      ],
      channel:         'domestic',
      referenceId,
      beneficiaryType: 'INDIVIDUAL',
      country:         'US',
    }),
    { headers: h },
  );
  step(vu, 12, baRes, 'POST', '/remittance/v1/beneficiary/account');
  check(baRes, { 'ach account 2xx': res => res.status === 200 || res.status === 202 });

  let achToAccount = null;
  try { achToAccount = baRes.json('accountNumber'); } catch {}
  if (!achToAccount) return;

  const r = http.post(
    `${HOST}/user/v1/transaction/transfer-fund`,
    JSON.stringify({
      fromAccount: user.walletAccount,
      toAccount:   achToAccount,
      amount:      '1.00',
      name:        'K6 ACH',
      type:        'ACH',
      startDate:   today(),
      endDate:     today(),
    }),
    { headers: h },
  );
  step(vu, 13, r, 'POST', '/user/v1/transaction/transfer-fund');
  check(r, { 'ach transfer 200': res => res.status === 200 });
}
