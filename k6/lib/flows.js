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
