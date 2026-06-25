import { mindbodyClient } from '../api/client.js';
import { generalCache } from '../cache/index.js';
import { getServiceCatalog } from './classification.js';
import { countClientAttendedVisits, getClientContractsTool } from './clientManagement.js';

/**
 * Studio-wide reporting tools. These paginate the FULL result set server-side
 * (the prior point-lookup tools only ever returned page 1, so aggregate
 * questions silently missed records). Mirrors RepFlow's "pull once, compute"
 * pattern: fetch the whole client roster once, cache it, then derive answers.
 *
 * NOTE: true funnel/conversion *rates* and new-vs-renewal status transitions
 * live in the RepFlow backend (status-change event history). These tools answer
 * "how many X happened in this window" from current Mindbody data — completely,
 * not by sampling.
 */

const MAX_PAGES = 60; // safety cap (~12k records at 200/page)
const PAGE = 200;

function inWindow(dateStr: string | undefined, start: string, end: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= start && d <= end;
}

const THIRD_PARTY = /classpass|gympass|wellhub|peerfit|zeamo|fitreserve|onepass|aaptiv|optum|welld/i;
const MEMBERSHIP_TEXT = /member|unlimited|month to month|m2m|annual|passport|founding|foundation|tier|limited/i;

/**
 * Could this client plausibly hold a ClientContract (so a /clientcontracts call
 * is worth spending)? "Non-Member" / "Prospect" records — drop-ins, leads and
 * ClassPass/aggregator attendees — never do, and they dominate the
 * recently-modified set. Unknown/blank status is kept (don't risk a miss).
 */
function canHoldContract(status?: string): boolean {
  const n = (status || '').trim().toLowerCase();
  if (!n) return true;
  return n !== 'non-member' && n !== 'prospect';
}

/**
 * Map a Mindbody pricing-option / membership name to the studio's "membership
 * tier" label used in the Active Members and Terminations reports. This is a
 * name-based heuristic (Mindbody has no tier field) tuned to this studio's
 * pricing options — order matters: paid-in-full passes and comp/staff names
 * are checked before duration keywords so "F45 Training | Annual Pass" reads as
 * Paid In Full, not Annual.
 */
export function membershipTier(name?: string): string {
  const n = (name || '').toLowerCase();
  if (!n) return 'Unknown';
  // Third-party aggregator passes (ClassPass / Wellhub / Optum-Welld / etc.) are
  // NOT studio members — never let them read as a membership tier.
  if (THIRD_PARTY.test(n)) return 'Third-Party';
  if (/complimentary|comp\b|staff membership|passport/.test(n)) return 'Comp Member';
  if (/influencer/.test(n)) return 'Influencer';
  if (/challenge/.test(n)) return 'Challenge Member';
  if (/training|one month pass|paid in full/.test(n)) return 'Paid In Full';
  if (/month to month|m2m/.test(n)) return 'M2M Member';
  if (/annual/.test(n)) return 'Annual Member';
  if (/6 month|six month/.test(n)) return '6 Month Member';
  if (/3 month|three month/.test(n)) return '3 Month Member';
  if (/foundation/.test(n)) return 'Foundation Member';
  if (/limited/.test(n)) return 'Limited Member';
  if (/class(es| pass)|\d+\s*class/.test(n)) return 'Class Passes';
  return name || 'Unknown';
}

export interface RosterClient {
  id: string;
  name: string;
  status: string;
  isProspect: boolean;
  createdDate?: string;
  phone?: string;
  email?: string;
}

/** Fetch + cache the entire client roster (id, name, status, createdDate). */
export async function getClientRoster(): Promise<RosterClient[]> {
  const cached = generalCache.get<RosterClient[]>('client-roster');
  if (cached) return cached;

  const map = (c: any): RosterClient => ({
    id: c.Id,
    name: [c.FirstName, c.LastName].filter(Boolean).join(' ').trim(),
    status: c.Status,
    isProspect: !!c.IsProspect,
    createdDate: c.CreationDate,
    phone: c.MobilePhone || c.HomePhone || undefined,
    email: c.Email || undefined,
  });

  // First page tells us the total; fetch the remaining pages in parallel.
  const first = await mindbodyClient.get<any>('/client/clients', {
    params: { Limit: PAGE, Offset: 0, IncludeInactive: true },
  });
  const total = first.PaginationResponse?.TotalResults ?? (first.Clients || []).length;
  const clients: RosterClient[] = (first.Clients || []).map(map);

  const offsets: number[] = [];
  for (let o = PAGE; o < total && offsets.length < MAX_PAGES; o += PAGE) offsets.push(o);
  const rest = await Promise.all(
    offsets.map((o) =>
      mindbodyClient.get<any>('/client/clients', { params: { Limit: PAGE, Offset: o, IncludeInactive: true } })
    )
  );
  for (const resp of rest) for (const c of resp.Clients || []) clients.push(map(c));

  generalCache.set('client-roster', clients, 10);
  return clients;
}

/**
 * Cost-aware client fetch: pull only clients whose record changed on/after
 * `since` (Mindbody's LastModifiedDate filter) instead of the entire roster.
 * Any client created OR terminated in a window is, by definition, modified in
 * that window — so window-scoped questions (new leads, terminations) can work
 * from this small set and skip the ~27-page full-roster scan. Cached per
 * (since) key so two window-scoped tools share one fetch. Bounded by `cap`.
 */
export async function fetchModifiedClients(
  since: string,
  cap: number = 4000
): Promise<{ clients: RosterClient[]; truncated: boolean; total: number }> {
  const cacheKey = `modified-clients:${since}:${cap}`;
  const cached = generalCache.get<{ clients: RosterClient[]; truncated: boolean; total: number }>(cacheKey);
  if (cached) return cached;

  const map = (c: any): RosterClient => ({
    id: c.Id,
    name: [c.FirstName, c.LastName].filter(Boolean).join(' ').trim(),
    status: c.Status,
    isProspect: !!c.IsProspect,
    createdDate: c.CreationDate,
    phone: c.MobilePhone || c.HomePhone || undefined,
    email: c.Email || undefined,
  });

  const clients: RosterClient[] = [];
  let truncated = false;
  let offset = 0;
  let total = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const resp = await mindbodyClient.get<any>('/client/clients', {
      params: { LastModifiedDate: since, Limit: PAGE, Offset: offset, IncludeInactive: true },
    });
    const batch = resp.Clients || [];
    for (const c of batch) clients.push(map(c));
    total = resp.PaginationResponse?.TotalResults ?? clients.length;
    offset += batch.length;
    if (clients.length >= cap) {
      truncated = offset < total;
      break;
    }
    if (batch.length === 0 || offset >= total) break;
  }

  const result = { clients: clients.slice(0, cap), truncated, total };
  generalCache.set(cacheKey, result, 10);
  return result;
}

// Count + list clients whose profile was created in the window. Cost-aware:
// created-in-window ⊆ modified-in-window, so we scan the LastModifiedDate set
// (a few pages) rather than the full roster (~27 pages).
export async function getNewClientsTool(
  startDate: string,
  endDate: string
): Promise<{
  window: { startDate: string; endDate: string };
  newClientCount: number;
  candidatesScanned: number;
  candidatesTruncated: boolean;
  byStatus: Record<string, number>;
  clients: Array<{ id: string; name: string; status: string; createdDate?: string }>;
}> {
  // Use the full page budget (not the smaller default cap) — lead counting has
  // no per-client fan-out, so completeness matters more than bounding here.
  const { clients: modified, truncated } = await fetchModifiedClients(startDate, MAX_PAGES * PAGE);
  const created = modified.filter((c) => inWindow(c.createdDate, startDate, endDate));
  const byStatus: Record<string, number> = {};
  for (const c of created) byStatus[c.status] = (byStatus[c.status] || 0) + 1;

  return {
    window: { startDate, endDate },
    newClientCount: created.length,
    candidatesScanned: modified.length,
    candidatesTruncated: truncated,
    byStatus,
    clients: created
      .sort((a, b) => (a.createdDate || '').localeCompare(b.createdDate || ''))
      .map((c) => ({ id: c.id, name: c.name, status: c.status, createdDate: c.createdDate })),
  };
}

type Category = 'trial' | 'contract' | 'membership' | 'package' | 'thirdParty' | 'retail';

function classifyItem(item: any, catalog: Map<number, { isIntroOffer: boolean }>): Category {
  const cat = catalog.get(Number(item.Id));
  if (cat?.isIntroOffer) return 'trial';
  if (item.ContractId) return 'contract';
  const text = String(item.Description ?? item.Name ?? '');
  if (THIRD_PARTY.test(text)) return 'thirdParty';
  if (item.IsService && MEMBERSHIP_TEXT.test(text)) return 'membership';
  if (item.IsService) return 'package';
  return 'retail';
}

// Everything that sold in a window, classified — answers "how many trials /
// contracts / memberships started in June" completely (full pagination).
export async function getSignupsTool(
  startDate: string,
  endDate: string
): Promise<{
  window: { startDate: string; endDate: string };
  totalSales: number;
  truncated: boolean;
  counts: Record<Category, number>;
  note: string;
  trials: Array<any>;
  contracts: Array<any>;
  memberships: Array<any>;
}> {
  const [roster, catalog] = await Promise.all([getClientRoster(), getServiceCatalog()]);
  const nameById = new Map(roster.map((c) => [c.id, c]));

  const sales: any[] = [];
  let offset = 0;
  let truncated = false;
  let total = 0;
  for (let i = 0; i < MAX_PAGES; i++) {
    const resp = await mindbodyClient.get<any>('/sale/sales', {
      params: { StartSaleDateTime: startDate, EndSaleDateTime: endDate, Limit: PAGE, Offset: offset },
    });
    const batch = resp.Sales || [];
    sales.push(...batch);
    total = resp.PaginationResponse?.TotalResults ?? sales.length;
    offset += batch.length;
    if (batch.length === 0 || offset >= total) break;
    if (i === MAX_PAGES - 1 && offset < total) truncated = true;
  }

  const counts: Record<Category, number> = { trial: 0, contract: 0, membership: 0, package: 0, thirdParty: 0, retail: 0 };
  const trials: any[] = [];
  const contracts: any[] = [];
  const memberships: any[] = [];

  for (const sale of sales) {
    const clientId: string = sale.ClientId;
    const client = nameById.get(clientId);
    const date = (sale.SaleDateTime ?? sale.SaleDate)?.slice(0, 10);
    for (const item of sale.PurchasedItems || []) {
      if (item.Returned || (item.Quantity ?? 1) < 0) continue;
      const category = classifyItem(item, catalog);
      counts[category]++;
      if (category === 'trial' || category === 'contract' || category === 'membership') {
        const row = {
          clientId,
          name: client?.name || clientId,
          date,
          item: item.Description ?? item.Name,
          amount: item.TotalAmount,
          // "new" = client profile created in this same window (fresh vs returning proxy)
          newClient: inWindow(client?.createdDate, startDate, endDate),
        };
        if (category === 'trial') trials.push(row);
        else if (category === 'contract') contracts.push(row);
        else memberships.push(row);
      }
    }
  }

  const bydate = (a: any, b: any) => (a.date || '').localeCompare(b.date || '');
  return {
    window: { startDate, endDate },
    totalSales: total,
    truncated,
    counts,
    note: "trials are exact (intro-offer catalog). 'contract' counts every sale line with a ContractId, which INCLUDES recurring autopay charges on existing contracts — not just new contracts. For true new membership starts use getActiveMembers with a window (counts memberships by ActiveDate).",
    trials: trials.sort(bydate),
    contracts: contracts.sort(bydate),
    memberships: memberships.sort(bydate),
  };
}

// Active members across the studio via the BULK memberships endpoint (200 ids
// per call) instead of one call per client. Optionally counts memberships whose
// ActiveDate falls in a window ("new memberships started in June").
export async function getActiveMembersTool(
  startDate?: string,
  endDate?: string
): Promise<{
  totalActiveMembers: number;
  membershipsActivatedInWindow?: number;
  newMembersInWindow?: number;
  window?: { startDate: string; endDate: string };
  note?: string;
  members: Array<{
    clientId: string;
    name: string;
    membership: string;
    membershipTier: string;
    remainingSessions?: number;
    nextAutopayDate?: string;
    joinedDate?: string;
    phone?: string;
    email?: string;
    activeDate?: string;
    expirationDate?: string;
    startedInWindow: boolean;
    isNewMember: boolean;
  }>;
}> {
  const roster = await getClientRoster();
  const nameById = new Map(roster.map((c) => [c.id, c]));
  const ids = roster.map((c) => c.id);

  // The bulk response is one wrapper per requested client: { ClientId, Memberships[] }.
  // A client is an active member only if their nested Memberships array is non-empty.
  // Fetch the 200-id batches in parallel — sequential calls time out on large rosters.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

  const responses = await Promise.all(
    chunks.map((chunk) =>
      mindbodyClient.get<any>('/client/activeclientsmemberships', { params: { ClientIds: chunk, Limit: 200 } })
    )
  );

  const byClient = new Map<string, any>();
  for (const resp of responses) {
    for (const wrapper of resp.ClientMemberships || []) {
      const cid = wrapper.ClientId ?? wrapper.ClientID;
      // Exclude third-party aggregator passes (Optum/Welld, ClassPass, Wellhub…):
      // those are not studio members and must never count toward member totals
      // or "new member" counts.
      const memberships = (wrapper.Memberships || []).filter((m: any) => !THIRD_PARTY.test(m.Name || ''));
      if (!cid || memberships.length === 0) continue;
      let best = memberships[0];
      for (const m of memberships) if ((m.ActiveDate || '') > (best.ActiveDate || '')) best = m;
      byClient.set(cid, best);
    }
  }

  const hasWindow = !!(startDate && endDate);
  const members = Array.from(byClient.entries()).map(([clientId, m]) => {
    const startedInWindow = hasWindow ? inWindow(m.ActiveDate, startDate!, endDate!) : false;
    const client = nameById.get(clientId);
    // "joined" = the client profile creation date; a NEW member is one whose
    // profile was created within the window (a real new join, not an autopay
    // renewal whose ActiveDate merely rolled forward).
    const isNewMember = hasWindow ? inWindow(client?.createdDate, startDate!, endDate!) : false;
    return {
      clientId,
      name: client?.name || clientId,
      membership: m.Name,
      membershipTier: membershipTier(m.Name),
      remainingSessions: m.Remaining,
      nextAutopayDate: m.PaymentDate,
      joinedDate: client?.createdDate?.slice(0, 10),
      phone: client?.phone,
      email: client?.email,
      activeDate: m.ActiveDate,
      expirationDate: m.ExpirationDate,
      startedInWindow,
      isNewMember,
    };
  });

  return {
    totalActiveMembers: members.length,
    ...(hasWindow
      ? {
          membershipsActivatedInWindow: members.filter((m) => m.startedInWindow).length,
          newMembersInWindow: members.filter((m) => m.isNewMember).length,
          window: { startDate: startDate!, endDate: endDate! },
          note: 'membershipsActivatedInWindow counts memberships whose current-period ActiveDate falls in the window — this INCLUDES autopay renewals (ActiveDate rolls forward each cycle), so it OVERCOUNTS joins. newMembersInWindow counts active members whose client profile was created in the window (a cleaner "joined" signal for members of any kind). For new contract/autopay members specifically, getNewContracts.newContractCount is the most precise (resolves each ClientContract.StartDate).',
        }
      : {}),
    members: members.sort((a, b) => (b.activeDate || '').localeCompare(a.activeDate || '')),
  };
}

// --- Attendance milestones ----------------------------------------------------
// "Which clients are about to hit a 100/200/300… class milestone?"
//
// A client can only REACH a milestone by attending their next class, so the
// candidate set is never the whole roster (5,000+) — it's only clients who
// ATTENDED within the recent lookback window. We discover them from the
// class-visit feed (the authoritative attendance signal — a client's profile
// LastModified is NOT reliably bumped by attendance), then recompute lifetime
// attended for just those candidates, early-exiting once a client is provably
// past the top milestone. Cost scales with recent attendance, not roster size.

const MILESTONE_DEFAULTS = [99, 199, 299, 399, 499];
const MILESTONE_LOOKBACK_DAYS = 14;     // attended in the last two weeks ⇒ candidate
const MILESTONE_FEED_CONCURRENCY = 8;   // parallel class-visit reads (feed phase)
const MILESTONE_COUNT_CONCURRENCY = 6;  // parallel per-candidate lifetime counts
const MILESTONE_MAX_CANDIDATES = 4000;  // safety ceiling on candidates scanned in one pass
const MILESTONE_LIFETIME_START = '2005-01-01'; // wide enough to predate any client's first visit
const MILESTONE_CACHE_MINUTES = 1440;   // 24h
const CLASS_PAGE = 200;
const CLASS_MAX_PAGES = 60;             // ~12k classes in a window before we stop
const VISITS_FEED_MAX_PAGES = 10;       // up to 2k signed-in visits per class before we stop

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/** Run `fn` over `items` with a bounded number of concurrent workers. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface MilestoneClient {
  clientId: string;
  name: string;
  attendedVisits: number;   // lifetime classes actually attended (SignedIn === true)
  milestone: number;        // the milestone they're sitting on (e.g. 99)
  nextClassNumber: number;  // their upcoming class number (e.g. 100) — the one to celebrate
}

/**
 * Flag clients whose lifetime ATTENDED-class count sits on a milestone
 * (default 99/199/299/399/499) — i.e. their NEXT class is the celebratory
 * 100th/200th/etc. Only clients who attended within `lookbackDays` (default 30)
 * are considered — they're the only ones whose count could have just changed.
 *
 * Cost: ~(#classes in window) feed calls + ~1 call per distinct recent attendee.
 * Scales with recent attendance, NOT the 5,000+ roster. Cached 24h.
 */
export async function getMilestoneClientsTool(opts?: {
  milestones?: number[];
  proximity?: number;     // 0 (default) = exactly on the milestone; N = within N classes below it
  lookbackDays?: number;  // how far back recent attendance counts as a candidate (default 30)
}): Promise<{
  milestones: number[];
  proximity: number;
  lookbackDays: number;
  window: { startDate: string; endDate: string };
  generatedAt: string;
  classesScanned: number;
  recentAttendees: number;
  candidatesTruncated: boolean;
  countTruncated: string[];  // candidate ids whose history exceeded the page cap (counts may be low)
  approxApiCalls: number;
  flaggedCount: number;
  clients: MilestoneClient[];
  note: string;
}> {
  const milestones = (opts?.milestones?.length ? opts.milestones : MILESTONE_DEFAULTS)
    .slice()
    .sort((a, b) => a - b);
  const proximity = Math.max(0, opts?.proximity ?? 0);
  const lookbackDays = Math.max(1, Math.floor(opts?.lookbackDays ?? MILESTONE_LOOKBACK_DAYS));
  const maxMilestone = milestones[milestones.length - 1];

  const startDate = daysAgoISO(lookbackDays);
  const endDate = new Date().toISOString().split('T')[0];

  const cacheKey = `milestone-clients:${milestones.join(',')}:${proximity}:${lookbackDays}`;
  const cached = generalCache.get<any>(cacheKey);
  if (cached) return cached;

  let approxApiCalls = 0;

  // 1) Discover classes in the window. Paginate /class/classes directly — the
  //    getClasses tool only ever returns page 1, which truncates a busy month.
  const classIds: number[] = [];
  let classOffset = 0;
  for (let page = 0; page < CLASS_MAX_PAGES; page++) {
    const resp = await mindbodyClient.get<any>('/class/classes', {
      params: {
        StartDateTime: `${startDate}T00:00:00`,
        EndDateTime: `${endDate}T23:59:59`,
        Limit: CLASS_PAGE,
        Offset: classOffset,
      },
    });
    approxApiCalls++;
    const batch: any[] = resp.Classes || [];
    const total = resp.PaginationResponse?.TotalResults ?? classOffset + batch.length;
    for (const c of batch) if (c?.Id != null) classIds.push(c.Id);
    classOffset += batch.length;
    if (batch.length === 0 || classOffset >= total) break;
  }

  // 2) Pull each class's visits → distinct clients who SIGNED IN (attended).
  //    Capture a display name from the visit so we never touch the 5k+ roster.
  const candidates = new Map<string, string>(); // clientId -> name
  await mapLimit(classIds, MILESTONE_FEED_CONCURRENCY, async (classId) => {
    // Paginate the visit feed — a popular class can have >200 signed-in visits,
    // and reading only page 1 would drop every attendee past the 200th.
    let visitOffset = 0;
    for (let page = 0; page < VISITS_FEED_MAX_PAGES; page++) {
      const resp = await mindbodyClient.get<any>('/class/classvisits', {
        params: { ClassId: classId, Limit: 200, Offset: visitOffset },
      });
      approxApiCalls++;
      const batch: any[] = resp.Class?.Visits || [];
      const visitTotal = resp.PaginationResponse?.TotalResults ?? visitOffset + batch.length;
      for (const v of batch) {
        if (!v.SignedIn || v.ClientId == null) continue;
        const id = String(v.ClientId);
        if (!candidates.has(id)) {
          const name = [v.Client?.FirstName || v.FirstName, v.Client?.LastName || v.LastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          candidates.set(id, name || id);
        }
      }
      visitOffset += batch.length;
      if (batch.length === 0 || visitOffset >= visitTotal) break;
    }
  });

  const candidateEntries = Array.from(candidates.entries());
  const candidatesTruncated = candidateEntries.length > MILESTONE_MAX_CANDIDATES;
  const scanList = candidateEntries.slice(0, MILESTONE_MAX_CANDIDATES);

  // 3) For each recent attendee, count lifetime attended (early-exit once they
  //    pass the top milestone) and flag anyone sitting on a milestone.
  const milestoneFor = (attended: number): number | null => {
    for (const m of milestones) {
      if (attended <= m && attended >= m - proximity) return m;
    }
    return null;
  };

  const countTruncated: string[] = [];
  const scanned = await mapLimit(scanList, MILESTONE_COUNT_CONCURRENCY, async ([clientId, name]) => {
    const { attended, exceeded, truncated, apiCalls } = await countClientAttendedVisits(
      clientId,
      MILESTONE_LIFETIME_START,
      endDate,
      maxMilestone
    );
    approxApiCalls += apiCalls;
    if (truncated) countTruncated.push(clientId);
    if (exceeded) return null; // provably past the top milestone

    const milestone = milestoneFor(attended);
    if (milestone === null) return null;
    return {
      clientId,
      name,
      attendedVisits: attended,
      milestone,
      nextClassNumber: attended + 1,
    } as MilestoneClient;
  });

  const clients = scanned
    .filter((c): c is MilestoneClient => c !== null)
    .sort((a, b) => b.attendedVisits - a.attendedVisits);

  const note =
    `Candidates = clients who attended in the last ${lookbackDays} day(s) (${scanList.length} of ${candidateEntries.length}). ` +
    `Counted SignedIn (attended) visits only; clients past ${maxMilestone} are skipped. ` +
    (candidatesTruncated
      ? `Recent-attendee count exceeded the ${MILESTONE_MAX_CANDIDATES} safety cap — only the first ${MILESTONE_MAX_CANDIDATES} were scanned. `
      : '') +
    (countTruncated.length
      ? `${countTruncated.length} client(s) had more history than the page cap; their counts may be low. `
      : '') +
    `Heavy on a cold run (~1 call per recent attendee + the class feed); cached ${MILESTONE_CACHE_MINUTES / 60}h.`;

  const result = {
    milestones,
    proximity,
    lookbackDays,
    window: { startDate, endDate },
    generatedAt: new Date().toISOString(),
    classesScanned: classIds.length,
    recentAttendees: candidateEntries.length,
    candidatesTruncated,
    countTruncated,
    approxApiCalls,
    flaggedCount: clients.length,
    clients,
    note,
  };

  generalCache.set(cacheKey, result, MILESTONE_CACHE_MINUTES);
  return result;
}

// --- New contracts vs autopay charges ----------------------------------------
// A sale line with a ContractId is NOT a new contract — every monthly autopay
// charge carries the ContractId too. The origination signal is the
// ClientContract.StartDate. We pull contract buyers over [start - lookback, end]
// (the lookback catches post-dated signups sold before they start), fetch each
// buyer's contracts (bounded concurrency), then split: new = a contract whose
// StartDate is in the window; autopay = an in-window contract charge from a
// client with no contract starting in the window.

const NEW_CONTRACT_LOOKBACK_DAYS = 45;
const NEW_CONTRACT_CACHE_MINUTES = 60;

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function getNewContractsTool(
  startDate: string,
  endDate: string,
  lookbackDays: number = NEW_CONTRACT_LOOKBACK_DAYS
): Promise<{
  window: { startDate: string; endDate: string };
  contractSaleLinesInWindow: number;
  newContractCount: number;
  autopayChargeCount: number;
  buyersScanned: number;
  scanErrors: number;
  salesTruncated: boolean;
  newContracts: Array<{ clientId: string; name: string; contract: string; startDate?: string; soldDate?: string }>;
  note: string;
}> {
  const cacheKey = `new-contracts:${startDate}:${endDate}:${lookbackDays}`;
  const cached = generalCache.get<any>(cacheKey);
  if (cached) return cached;

  const roster = await getClientRoster();
  const nameById = new Map(roster.map((c) => [c.id, c]));

  // 1. Pull sales over [start - lookback, end]; collect contract sale lines.
  const salesStart = shiftDate(startDate, -Math.max(0, lookbackDays));
  const sales: any[] = [];
  let offset = 0;
  let total = 0;
  let salesTruncated = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const resp = await mindbodyClient.get<any>('/sale/sales', {
      params: { StartSaleDateTime: salesStart, EndSaleDateTime: endDate, Limit: PAGE, Offset: offset },
    });
    const batch = resp.Sales || [];
    sales.push(...batch);
    total = resp.PaginationResponse?.TotalResults ?? sales.length;
    offset += batch.length;
    if (batch.length === 0 || offset >= total) break;
    if (i === MAX_PAGES - 1 && offset < total) salesTruncated = true;
  }

  const buyers = new Set<string>();
  const inWindowLines: Array<{ clientId: string }> = [];
  for (const sale of sales) {
    const cid: string = sale.ClientId;
    const date = (sale.SaleDateTime ?? sale.SaleDate)?.slice(0, 10);
    for (const item of sale.PurchasedItems || []) {
      if (item.Returned || (item.Quantity ?? 1) < 0) continue;
      if (!item.ContractId) continue;
      buyers.add(cid);
      if (date && date >= startDate && date <= endDate) inWindowLines.push({ clientId: cid });
    }
  }

  // 2. Fetch each buyer's contracts (bounded concurrency — see mapLimit).
  const buyerList = Array.from(buyers);
  const contractsByClient = new Map<string, any[]>();
  let scanErrors = 0;
  await mapLimit(buyerList, 6, async (clientId) => {
    try {
      const res = await getClientContractsTool(clientId);
      contractsByClient.set(clientId, res.contracts);
    } catch {
      // Couldn't read this buyer's contracts — count it so the caller knows the
      // result is incomplete rather than silently treating it as zero contracts.
      scanErrors++;
      contractsByClient.set(clientId, []);
    }
  });

  // 3. New contract = StartDate in window (origination). Catches post-dated signups.
  const newContracts: Array<{ clientId: string; name: string; contract: string; startDate?: string; soldDate?: string }> = [];
  const newClients = new Set<string>();
  for (const [clientId, contracts] of contractsByClient) {
    for (const k of contracts) {
      if (inWindow(k.startDate, startDate, endDate)) {
        newContracts.push({ clientId, name: nameById.get(clientId)?.name || clientId, contract: k.name, startDate: k.startDate, soldDate: k.soldDate });
        newClients.add(clientId);
      }
    }
  }

  // 4. Autopay = in-window contract charges from clients with no new contract.
  const autopayChargeCount = inWindowLines.filter((l) => !newClients.has(l.clientId)).length;

  const result = {
    window: { startDate, endDate },
    contractSaleLinesInWindow: inWindowLines.length,
    newContractCount: newContracts.length,
    autopayChargeCount,
    buyersScanned: buyerList.length,
    scanErrors,
    salesTruncated,
    newContracts: newContracts.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')),
    note:
      `New contracts = ClientContract.StartDate within the window (true origination), resolved by fetching contracts for the ${buyerList.length} client(s) with any contract charge in [${salesStart}..${endDate}] (lookback ${lookbackDays}d catches post-dated signups). ` +
      `autopayChargeCount = in-window contract charges from clients with no new contract this window (a client with BOTH a new contract and a separate recurring charge has that charge attributed to the signup, not autopay). ` +
      (salesTruncated ? `WARNING: sales exceeded the ${MAX_PAGES}-page cap — counts may be low. ` : '') +
      (scanErrors ? `${scanErrors} buyer contract lookup(s) failed and were skipped — counts may be low. ` : '') +
      `Misses a brand-new contract only if it had zero charge in the lookback window (rare). Cached ${NEW_CONTRACT_CACHE_MINUTES}m.`,
  };

  generalCache.set(cacheKey, result, NEW_CONTRACT_CACHE_MINUTES);
  return result;
}

// --- Terminations -------------------------------------------------------------
// Who terminated/churned in a window. Mindbody has no bulk terminations
// endpoint, and scanning the entire historical roster (one /clientcontracts call
// each) does not scale — it blows the function timeout and the 2000 req/hr cap.
// Instead we use LastModifiedDate as a cheap pre-filter: terminating a contract
// modifies the client record, so the candidate set is "clients changed since the
// window opened" (a small fraction of the roster). We then read each candidate's
// contracts (bounded concurrency) and keep TerminationDates inside the window.
// Reason / Missed Revenue / Lifetime Sales from the studio's export are
// RepFlow-computed and not returned by the Mindbody API.

const TERMINATIONS_CONCURRENCY = 10;
const TERMINATIONS_CACHE_MINUTES = 60;
const TERMINATIONS_MAX_CANDIDATES = 1500; // hard ceiling so one call can't run away
const TERMINATIONS_LOOKBACK_DAYS = 7;     // catch terminations entered just before the window

export async function getTerminatedMembersTool(
  startDate: string,
  endDate: string,
  lookbackDays: number = TERMINATIONS_LOOKBACK_DAYS
): Promise<{
  window: { startDate: string; endDate: string };
  terminatedCount: number;
  scannedClients: number;
  candidatesTruncated: boolean;
  scanErrors: number;
  approxApiCalls: number;
  members: Array<{
    clientId: string;
    name: string;
    membershipTier: string;
    contract: string;
    terminatedOn?: string;
    joinedOn?: string;
    phone?: string;
    email?: string;
  }>;
  note: string;
}> {
  const cacheKey = `terminated-members:${startDate}:${endDate}:${lookbackDays}`;
  const cached = generalCache.get<any>(cacheKey);
  if (cached) return cached;

  // Candidate set: clients modified on/after (start - lookback). A termination
  // touches the client record, so churn in the window lands here without a
  // full-roster scan (shared LastModifiedDate fetch, cached).
  const modifiedSince = shiftDate(startDate, -Math.max(0, lookbackDays));
  const { clients: candidates, truncated: candidatesTruncated } = await fetchModifiedClients(
    modifiedSince,
    TERMINATIONS_MAX_CANDIDATES
  );

  // Status narrowing: a /clientcontracts call only pays off for someone who
  // could hold a contract. Prospects and "Non-Member" records (drop-ins,
  // ClassPass/aggregator attendees — the bulk of recently-modified clients)
  // never have one, so skipping them avoids a wasted ~$0.002 call each.
  const toScan = candidates.filter((c) => !c.isProspect && canHoldContract(c.status));

  const members: Array<{
    clientId: string;
    name: string;
    membershipTier: string;
    contract: string;
    terminatedOn?: string;
    joinedOn?: string;
    phone?: string;
    email?: string;
  }> = [];

  let scanErrors = 0;
  await mapLimit(toScan, TERMINATIONS_CONCURRENCY, async (client) => {
    let contracts: Awaited<ReturnType<typeof getClientContractsTool>>['contracts'];
    try {
      ({ contracts } = await getClientContractsTool(client.id));
    } catch {
      // Couldn't read this client's contracts — count it so a low churn number
      // is attributable to scan gaps rather than read as ground truth.
      scanErrors++;
      return;
    }
    // A termination is only real churn if the client has NO currently-active
    // contract. This filters out member→staff/comp conversions and same-day
    // cancel-and-rebuys (the old contract terminates but a new one is active),
    // which are not departures — matching the studio's churn report. Free: uses
    // the contracts already fetched, no extra API call.
    const now = new Date();
    const stillMember = contracts.some((k) => {
      const term = k.terminationDate ? new Date(k.terminationDate) : null;
      if (term && term <= now) return false;
      const start = k.startDate ? new Date(k.startDate) : null;
      if (start && start > now) return false;
      const end = k.endDate ? new Date(k.endDate) : null;
      if (end && end <= now) return false;
      return true;
    });
    if (stillMember) return;

    for (const k of contracts) {
      // Skip third-party aggregator "contracts" — they aren't studio memberships.
      if (THIRD_PARTY.test(k.name || '')) continue;
      if (inWindow(k.terminationDate, startDate, endDate)) {
        members.push({
          clientId: client.id,
          name: client.name,
          membershipTier: membershipTier(k.name),
          contract: k.name,
          terminatedOn: k.terminationDate?.slice(0, 10),
          joinedOn: (k.startDate || client.createdDate)?.slice(0, 10),
          phone: client.phone,
          email: client.email,
        });
      }
    }
  });

  // One row per client — a client with multiple terminated contracts churns
  // once; keep their latest in-window termination.
  const byClientId = new Map<string, (typeof members)[number]>();
  for (const m of members) {
    const prev = byClientId.get(m.clientId);
    if (!prev || (m.terminatedOn || '') > (prev.terminatedOn || '')) byClientId.set(m.clientId, m);
  }
  const deduped = Array.from(byClientId.values());

  const result = {
    window: { startDate, endDate },
    terminatedCount: deduped.length,
    scannedClients: toScan.length,
    candidatesTruncated,
    scanErrors,
    approxApiCalls: toScan.length,
    members: deduped.sort((a, b) => (a.terminatedOn || '').localeCompare(b.terminatedOn || '')),
    note:
      `Terminations = ClientContract.TerminationDate within the window. Candidate set = clients modified since ${modifiedSince} (lookback ${lookbackDays}d), narrowed by status to ${toScan.length} who could hold a contract (Non-Member/Prospect leads skipped), one /clientcontracts call each (cached ${TERMINATIONS_CACHE_MINUTES}m). ` +
      (candidatesTruncated
        ? `Candidate set hit the ${TERMINATIONS_MAX_CANDIDATES} ceiling — widen the window or lower lookback if a count looks low. `
        : '') +
      (scanErrors ? `${scanErrors} contract lookup(s) failed and were skipped — count may be low. ` : '') +
      `A termination entered well before the window (record untouched since) can be missed — raise lookbackDays for full back-coverage. ` +
      `Reason / Missed Revenue / Lifetime Sales from the studio's export are RepFlow-computed and not available from the Mindbody API.`,
  };

  generalCache.set(cacheKey, result, TERMINATIONS_CACHE_MINUTES);
  return result;
}
