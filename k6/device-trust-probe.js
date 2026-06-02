/**
 * Device Trust Probe — K6
 *
 * Run this BEFORE the load test to establish device trust for all phones in phones.json.
 * For each phone it checks whether OTP is required. If so, it performs a full OTP +
 * device-registration flow and re-probes until the device is trusted or MAX_RETRIES
 * is exhausted.
 *
 * Run:
 *   k6 run k6/device-trust-probe.js
 *
 * Override retries:
 *   k6 run k6/device-trust-probe.js -e K6_PROBE_MAX_RETRIES=5
 */

import { sleep } from 'k6';
import { DEVICE_ID, MAX_RETRIES } from './lib/config.js';
import { passwordLogin }          from './lib/auth.js';
import { fullOtpLogin }           from './lib/otp.js';

const PHONES = JSON.parse(open('./phones.json'));

export const options = {
  scenarios: {
    device_trust_probe: {
      executor:    'shared-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '30m',
    },
  },
};

export default function () {
  const trusted = [];
  const failed  = [];

  console.log('\n══ DEVICE TRUST PROBE ═════════════════════════════════');
  console.log(`   Phones     : ${PHONES.length}`);
  console.log(`   DEVICE_ID  : ${DEVICE_ID}`);
  console.log(`   Max retries: ${MAX_RETRIES} per phone`);
  console.log('');

  const noPasswordPhones = [];

  for (const phone of PHONES) {
    console.log(`── ${phone} ──────────────────────────────────────────`);
    let isTrusted = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const login = passwordLogin(phone);
      if (!login) {
        console.error(`  [${attempt}/${MAX_RETRIES}] Hard failure — skipping ${phone}`);
        break;
      }
      if (login.noPassword) {
        console.error(`  ✗ No password set — complete the first-login flow for ${phone} before running the probe`);
        noPasswordPhones.push(phone);
        break;
      }

      if (!login.needsOtp) {
        console.log(`  [${attempt}/${MAX_RETRIES}] ✓ Device already trusted — OTP skipped`);
        isTrusted = true;
        break;
      }

      console.log(`  [${attempt}/${MAX_RETRIES}] OTP required — running full login + device registration`);
      const ok = fullOtpLogin(phone, login.sessionId);
      if (!ok) {
        console.error(`  [${attempt}/${MAX_RETRIES}] OTP flow failed`);
        if (attempt < MAX_RETRIES) sleep(2);
        continue;
      }

      sleep(1);
      const reProbe = passwordLogin(phone);
      if (reProbe && !reProbe.needsOtp) {
        console.log(`  [${attempt}/${MAX_RETRIES}] ✓ Device now trusted after OTP registration`);
        isTrusted = true;
        break;
      }
      console.log(`  [${attempt}/${MAX_RETRIES}] Not trusted yet — will retry`);
      if (attempt < MAX_RETRIES) sleep(2);
    }

    if (!noPasswordPhones.includes(phone)) {
      isTrusted ? trusted.push(phone) : failed.push(phone);
    }
  }

  console.log('\n══ RESULTS ════════════════════════════════════════════');
  console.log(`  ✓ Trusted      (${trusted.length}/${PHONES.length}): ${trusted.join(', ') || 'none'}`);
  console.log(`  ✗ Failed       (${failed.length}/${PHONES.length}): ${failed.join(', ') || 'none'}`);
  console.log(`  ✗ No password  (${noPasswordPhones.length}/${PHONES.length}): ${noPasswordPhones.join(', ') || 'none'}`);
  if (noPasswordPhones.length > 0) {
    console.log('  → These accounts need the first-login flow completed (sign in with phone → OTP → set password).');
    console.log('    Run the Playwright UI test 1.2 for each, or set passwords via admin API.');
  }
  if (failed.length > 0) {
    console.log('  → Re-run probe for failed numbers or increase K6_PROBE_MAX_RETRIES:');
    console.log(`    k6 run k6/device-trust-probe.js -e K6_PROBE_MAX_RETRIES=${MAX_RETRIES + 2}`);
  }
  if (trusted.length === PHONES.length) {
    console.log('  → All phones trusted. Safe to run the load test:');
    console.log('    k6 run k6/load-test.js');
  }
  console.log('');
}
