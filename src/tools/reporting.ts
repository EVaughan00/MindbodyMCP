import { mindbodyClient } from '../api/client.js';
import { generalCache } from '../cache/index.js';
import { getServiceCatalog } from './classification.js';

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

export interface RosterClient {
  id: string;
  name: string;
  status: string;
  isProspect: boolean;
  createdDate?: string;
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

// Count + list clients whose profile was created in the window.
export async function getNewClientsTool(
  startDate: string,
  endDate: string
): Promise<{
  window: { startDate: string; endDate: string };
  totalClientsInStudio: number;
  newClientCount: number;
  byStatus: Record<string, number>;
  clients: Array<{ id: string; name: string; status: string; createdDate?: string }>;
}> {
  const roster = await getClientRoster();
  const created = roster.filter((c) => inWindow(c.createdDate, startDate, endDate));
  const byStatus: Record<string, number> = {};
  for (const c of created) byStatus[c.status] = (byStatus[c.status] || 0) + 1;

  return {
    window: { startDate, endDate },
    totalClientsInStudio: roster.length,
    newClientCount: created.length,
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
  window?: { startDate: string; endDate: string };
  note?: string;
  members: Array<{ clientId: string; name: string; membership: string; activeDate?: string; expirationDate?: string; startedInWindow: boolean }>;
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
      const memberships = wrapper.Memberships || [];
      if (!cid || memberships.length === 0) continue;
      let best = memberships[0];
      for (const m of memberships) if ((m.ActiveDate || '') > (best.ActiveDate || '')) best = m;
      byClient.set(cid, best);
    }
  }

  const hasWindow = !!(startDate && endDate);
  const members = Array.from(byClient.entries()).map(([clientId, m]) => {
    const startedInWindow = hasWindow ? inWindow(m.ActiveDate, startDate!, endDate!) : false;
    return {
      clientId,
      name: nameById.get(clientId)?.name || clientId,
      membership: m.Name,
      activeDate: m.ActiveDate,
      expirationDate: m.ExpirationDate,
      startedInWindow,
    };
  });

  return {
    totalActiveMembers: members.length,
    ...(hasWindow
      ? {
          membershipsActivatedInWindow: members.filter((m) => m.startedInWindow).length,
          window: { startDate: startDate!, endDate: endDate! },
          note: 'membershipsActivatedInWindow counts memberships whose current period ActiveDate falls in the window — this INCLUDES autopay renewals, not just brand-new members. True new-member (excludes renewals) counts require status-transition history in the RepFlow backend.',
        }
      : {}),
    members: members.sort((a, b) => (b.activeDate || '').localeCompare(a.activeDate || '')),
  };
}
