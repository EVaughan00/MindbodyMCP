// Unit test for the lifecycle classifier (no Mindbody API needed).
// Run: npx tsx scripts/test-classify.ts
import { classifyStatus, isActiveService, isActiveContract, isActiveMembership } from '../src/tools/classification.js';

const now = new Date('2026-06-23T12:00:00Z');
const future = '2026-12-01T00:00:00Z';
const past = '2026-01-01T00:00:00Z';

// catalog: ProductId 100 = intro offer, 200 = normal
const catalog = new Map<number, { isIntroOffer: boolean }>([
  [100, { isIntroOffer: true }],
  [200, { isIntroOffer: false }],
]);

let pass = 0, fail = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${name}: got "${got}"${ok ? '' : ` want "${want}"`}`);
  ok ? pass++ : fail++;
}

// 1. Lead: prospect, no purchases
check('lead (prospect, nothing)',
  classifyStatus({ Active: true, IsProspect: true, Status: 'Non-Member' }, [], [], [], catalog, now).status,
  'lead');

// 2. Trialer: active intro service only
check('trialer (active intro)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Non-Member' },
    [{ ProductId: 100, Remaining: 5, ExpirationDate: future }], [], [], catalog, now).status,
  'trialer');

// 3. Trialer NOT triggered by expired intro
check('lapsed (expired intro, not prospect)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Non-Member' },
    [{ ProductId: 100, Remaining: 0, ExpirationDate: past }], [], [], catalog, now).status,
  'lapsed');

// 4. Member: active auto-renewing contract
check('member (autorenew contract)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Non-Member' },
    [], [], [{ AutoRenewing: true, StartDate: past }], catalog, now).status,
  'member');

// 5. Member: active non-contract membership (punch pass)
check('member (active membership)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Non-Member' },
    [], [{ ActiveDate: past, ExpirationDate: future }], [], catalog, now).status,
  'member');

// 6. Member: Mindbody Status=Active
check('member (status Active)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Active' }, [], [], [], catalog, now).status,
  'member');

// 7. Terminated status + active intro -> trialer (re-engaged)
check('trialer (terminated but active intro)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Terminated' },
    [{ ProductId: 100, Remaining: 3, ExpirationDate: future }], [], [], catalog, now).status,
  'trialer');

// 8. Terminated status, no intro -> lapsed (churned)
const churn = classifyStatus({ Active: true, IsProspect: false, Status: 'Terminated' },
  [], [], [{ AutoRenewing: false, StartDate: past, TerminationDate: past }], catalog, now);
check('lapsed (terminated contract)', churn.status, 'lapsed');
check('  churned flag set', String(churn.churned), 'true');

// 9. External: ClassPass
check('external (classpass)',
  classifyStatus({ Active: true, IsProspect: false, Status: 'Non-Member' },
    [{ ProductId: 200, Remaining: 5, ExpirationDate: future, Name: 'ClassPass Drop-in' }], [], [], catalog, now).status,
  'external');

// 10. Inactive profile
check('inactive (Active=false)',
  classifyStatus({ Active: false, IsProspect: false, Status: 'Active' }, [], [], [], catalog, now).status,
  'inactive');

// 11. Pending (future-dated) contract -> member
const pend = classifyStatus({ Active: true, IsProspect: false, Status: 'Non-Member' },
  [], [], [{ AutoRenewing: false, StartDate: future }], catalog, now);
check('member (future-dated contract)', pend.status, 'member');
check('  membershipStartsOn set', pend.membershipStartsOn ? 'set' : 'unset', 'set');

// predicate spot-checks
check('isActiveService unlimited (-1)', String(isActiveService({ Remaining: -1, ExpirationDate: null }, now)), 'true');
check('isActiveService spent (0)', String(isActiveService({ Remaining: 0, ExpirationDate: future }, now)), 'false');
check('isActiveContract terminated', String(isActiveContract({ TerminationDate: past, StartDate: past }, now)), 'false');
check('isActiveMembership future activation', String(isActiveMembership({ ActiveDate: future }, now)), 'false');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
