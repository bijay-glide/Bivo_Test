#!/usr/bin/env node
/**
 * Reads test-results/api-capture/*.json (written by CAPTURE_APIS=1 runs)
 * and prints two tables:
 *   1. Per-spec call log  — method, status, URL (path only)
 *   2. Unique endpoint inventory  — method, path pattern, seen statuses
 *
 * Usage:
 *   node scripts/api-summary.js
 *   node scripts/api-summary.js --json     # machine-readable output
 */

const fs = require('fs');
const path = require('path');

const capDir = path.join(process.cwd(), 'api-capture');
const jsonMode = process.argv.includes('--json');

if (!fs.existsSync(capDir)) {
  console.error(`No capture directory found at ${capDir}`);
  console.error('Run: CAPTURE_APIS=1 npm run test:ui:userweb:parallel-all');
  process.exit(1);
}

const files = fs.readdirSync(capDir).filter(f => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('No capture files found. Run tests with CAPTURE_APIS=1 first.');
  process.exit(1);
}

const allSpecs = [];
const endpointMap = new Map(); // key: "METHOD path-pattern" → { statuses, specs }

function pathPattern(url) {
  try {
    const u = new URL(url);
    // Normalise UUIDs, account numbers, transaction IDs to placeholders
    return u.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{uuid}')
      .replace(/\/\d{10,}/g, '/{id}')
      .replace(/\/[0-9a-f]{24,}/gi, '/{hex}');
  } catch {
    return url;
  }
}

for (const file of files) {
  const raw = fs.readFileSync(path.join(capDir, file), 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch { continue; }

  const specEntry = { spec: data.spec, test: data.test, calls: [] };

  for (const call of (data.calls || [])) {
    const pat = pathPattern(call.url);
    const method = (call.method || 'GET').toUpperCase();
    const status = call.status ?? '?';
    const ok = call.ok;

    specEntry.calls.push({ method, url: call.url, status, ok, pat });

    const key = `${method} ${pat}`;
    if (!endpointMap.has(key)) {
      endpointMap.set(key, { method, pattern: pat, statuses: new Set(), specs: new Set() });
    }
    const ep = endpointMap.get(key);
    ep.statuses.add(status);
    ep.specs.add(data.spec);
  }

  allSpecs.push(specEntry);
}

if (jsonMode) {
  const endpoints = [...endpointMap.entries()].map(([, v]) => ({
    method: v.method,
    pattern: v.pattern,
    statuses: [...v.statuses].sort(),
    specs: [...v.specs].sort(),
  }));
  console.log(JSON.stringify({ specs: allSpecs, endpoints }, null, 2));
  process.exit(0);
}

// ── Per-spec tables ─────────────────────────────────────────────────────────
for (const s of allSpecs) {
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`SPEC: ${s.spec}   TEST: ${s.test}`);
  console.log('─'.repeat(100));

  if (s.calls.length === 0) {
    console.log('  (no API calls captured)');
    continue;
  }

  const colW = [6, 6, 70];
  const header = [
    'Method'.padEnd(colW[0]),
    'Status'.padEnd(colW[1]),
    'URL',
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(85));

  for (const c of s.calls) {
    const statusStr = String(c.status).padEnd(colW[1]);
    const flag = c.ok === false ? ' ✗' : '';
    const urlShort = c.url.length > 90 ? c.url.slice(0, 87) + '…' : c.url;
    console.log(`${c.method.padEnd(colW[0])}  ${statusStr}  ${urlShort}${flag}`);
  }
}

// ── Unique endpoint inventory ────────────────────────────────────────────────
console.log(`\n${'═'.repeat(100)}`);
console.log('UNIQUE API ENDPOINT INVENTORY');
console.log('═'.repeat(100));
console.log(`${'Method'.padEnd(7)}  ${'Status(es)'.padEnd(14)}  Endpoint Pattern`);
console.log('-'.repeat(100));

const sorted = [...endpointMap.values()].sort((a, b) =>
  a.pattern.localeCompare(b.pattern) || a.method.localeCompare(b.method)
);

for (const ep of sorted) {
  const statuses = [...ep.statuses].sort().join(',').padEnd(14);
  console.log(`${ep.method.padEnd(7)}  ${statuses}  ${ep.pattern}`);
}

console.log(`\nTotal unique endpoints: ${endpointMap.size}`);
console.log(`Capture files read: ${files.length}`);
