// Validate the MCP classifier against RepFlow's real cached F45 data.
// Runs classifyStatus() over each cached client and compares to RepFlow's stored
// status. No Mindbody API calls — pure logic check against ground truth.
//   npx tsx scripts/validate-against-cache.ts /tmp/f45_cached.json
import { readFileSync } from 'fs';
import { classifyStatus } from '../src/tools/classification.js';

const docs = JSON.parse(readFileSync(process.argv[2] || '/tmp/f45_cached.json', 'utf8'));

let agree = 0;
const confusion: Record<string, Record<string, number>> = {};
const mismatches: any[] = [];

for (const d of docs) {
  const catalog = new Map<number, { isIntroOffer: boolean }>();
  const services = (d.services || []).map((s: any, i: number) => {
    catalog.set(i, { isIntroOffer: !!s.is_intro_offer });
    return { ProductId: i, Remaining: s.remaining, ExpirationDate: s.expiration_date, Name: s.name };
  });
  const memberships = (d.memberships || []).map((m: any) => ({ ActiveDate: m.activation_date, ExpirationDate: m.expiration_date }));
  const contracts = (d.contracts || []).map((c: any) => ({
    AutoRenewing: c.auto_renewing, TerminationDate: c.termination_date, StartDate: c.start_date, EndDate: c.end_date,
  }));
  const client = { Active: d.active, IsProspect: d.is_prospect, Status: d.mindbody_status };
  const now = d.synced_at ? new Date(d.synced_at) : new Date();

  const res = classifyStatus(client, services, memberships, contracts, catalog, now);
  const got = res.status;
  const want = d.status;
  (confusion[want] ??= {})[got] = ((confusion[want] ??= {})[got] || 0) + 1;
  if (got === want) agree++;
  else if (mismatches.length < 25) mismatches.push({ clientId: d.client_id, stored: want, computed: got, memberType: res.memberType, mbStatus: d.mindbody_status, prospect: d.is_prospect, svc: services.length, mbr: memberships.length, ctr: contracts.length });
}

const pct = ((agree / docs.length) * 100).toFixed(2);
console.log(`Agreement: ${agree}/${docs.length} (${pct}%)\n`);
console.log('Confusion (stored -> computed):');
for (const stored of Object.keys(confusion).sort()) {
  const row = confusion[stored];
  const parts = Object.entries(row).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`);
  console.log(`  ${stored.padEnd(9)} -> ${parts.join('  ')}`);
}
if (mismatches.length) {
  console.log('\nSample mismatches:');
  for (const m of mismatches) console.log('  ', JSON.stringify(m));
}
