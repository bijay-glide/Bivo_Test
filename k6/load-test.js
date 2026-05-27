/**
 * Bivo Sandbox — K6 Load Test
 *
 * All phones MUST be device-trusted before running — run the probe first:
 *   k6 run k6/device-trust-probe.js
 *
 * Run:
 *   k6 run k6/load-test.js
 *
 * Live dashboard:
 *   k6 run --out web-dashboard k6/load-test.js
 *   → open http://localhost:5665
 */

import { sleep } from 'k6';
import { VUS, ITERATIONS }                        from './lib/config.js';
import { buildHeaders }                           from './lib/helpers.js';
import { authenticate }                           from './lib/auth.js';
import { runDashboard, runWire, runMoveFund, runACH } from './lib/flows.js';

const PHONES = JSON.parse(open('./phones.json'));

export const options = {
  scenarios: {
    api_load: {
      executor:    'per-vu-iterations',
      vus:         VUS,
      iterations:  ITERATIONS,
      maxDuration: '20m',
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.05'],  // < 5% failure rate
    http_req_duration: ['p(95)<5000'], // 95th percentile < 5 s
  },
};

export function setup() {
  console.log('\n══ SETUP ══════════════════════════════════════════════');
  const users = PHONES.map(authenticate);
  const ready = users.filter(u => u?.walletAccount).length;
  console.log(`══ ${ready}/${PHONES.length} users ready ═══\n`);
  return users;
}

export default function (users) {
  const vu   = __VU;
  const iter = __ITER + 1;
  const user = users[(__VU - 1) % users.length];

  if (!user?.token || !user?.walletAccount) {
    console.warn(`VU${vu}: no valid session — skipping`);
    return;
  }

  const h = buildHeaders(user.token, user.sessionId);
  console.log(`\n── VU${vu} iter ${iter}/${ITERATIONS}  (${user.phone}) ──`);

  runDashboard(h, user, vu);  sleep(0.5);
  runWire(h, user, vu);       sleep(0.5);
  runMoveFund(h, user, vu);   sleep(0.5);
  runACH(h, user, vu);        sleep(1);
}
