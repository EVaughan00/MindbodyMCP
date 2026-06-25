import { mindbodyClient } from '../api/client.js';
import { generalCache } from '../cache/index.js';

/**
 * Client lifecycle classification — ported from the RepFlow backend
 * (`repflow_api/infrastructure/mindbody/service.py` `_determine_status` /
 * `_is_active_service`) so the MCP labels clients exactly the way RepFlow does.
 *
 * Status precedence (first match wins) is intentionally identical to the
 * backend; see classifyStatus() below.
 */

export type ClientStatus = 'lead' | 'trialer' | 'member' | 'lapsed' | 'external' | 'inactive';

const MEMBER_STATUSES = new Set(['Active', 'Suspended']);
const TERMINATED_STATUSES = new Set(['Terminated', 'Expired', 'Declined']);
const THIRD_PARTY_PATTERNS = [
  'classpass', 'gympass', 'wellhub', 'peerfit', 'zeamo',
  'fitreserve', 'onepass', 'aaptiv', 'optum', 'welld',
];

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function matchesThirdParty(name?: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return THIRD_PARTY_PATTERNS.some((p) => n.includes(p));
}

// --- active predicates (mirror backend _is_active_* helpers) ----------------

/** A ClientService is active if it has uses left and hasn't expired. */
export function isActiveService(s: any, now: Date): boolean {
  const remaining = s.Remaining;
  const exp = parseDate(s.ExpirationDate);
  return remaining !== 0 && (exp === null || exp > now);
}

/** A ClientMembership is active if activation has passed and it hasn't expired. */
export function isActiveMembership(m: any, now: Date): boolean {
  const activation = parseDate(m.ActiveDate ?? m.ActivationDate);
  if (activation && activation > now) return false;
  const exp = parseDate(m.ExpirationDate);
  return exp === null || exp > now;
}

/** A ClientContract is active if in date range and not terminated. */
export function isActiveContract(c: any, now: Date): boolean {
  const term = parseDate(c.TerminationDate);
  if (term && term <= now) return false;
  const start = parseDate(c.StartDate);
  if (start && start > now) return false;
  const end = parseDate(c.EndDate);
  if (end && end <= now) return false;
  return true;
}

/** Earliest future start of a committed-but-not-yet-started membership. */
function pendingMembershipStart(contracts: any[], now: Date): Date | null {
  const candidates = contracts
    .map((c) => ({ start: parseDate(c.StartDate), term: parseDate(c.TerminationDate), end: parseDate(c.EndDate) }))
    .filter((c) => c.start && c.start > now && !(c.term && c.term <= now) && !(c.end && c.end <= now))
    .map((c) => c.start as Date);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/**
 * Fetch + cache the service catalog (ProductId/Service.Id -> IsIntroOffer).
 * ClientService.ProductId joins to Service.Id; IsIntroOffer lives only on the
 * catalog, never on the ClientService itself.
 */
export async function getServiceCatalog(): Promise<Map<number, { isIntroOffer: boolean; introOfferType?: string; name?: string; price?: number }>> {
  const cached = generalCache.get<any[]>('service-catalog');
  let services = cached;
  if (!services) {
    services = [];
    let offset = 0;
    // Page through the catalog (usually small) so the intro-offer map is complete.
    for (let i = 0; i < 20; i++) {
      const resp = await mindbodyClient.get<any>('/sale/services', { params: { Limit: 200, Offset: offset } });
      const batch = resp.Services || [];
      services.push(...batch);
      const total = resp.PaginationResponse?.TotalResults ?? services.length;
      offset += batch.length;
      if (batch.length === 0 || offset >= total) break;
    }
    generalCache.set('service-catalog', services, 60);
  }

  // /sale/services returns Id as a string, but ClientService.ProductId is a
  // number — normalize both to Number so the join actually matches.
  const map = new Map<number, { isIntroOffer: boolean; introOfferType?: string; name?: string; price?: number }>();
  for (const s of services) {
    map.set(Number(s.Id), {
      isIntroOffer: !!s.IsIntroOffer,
      introOfferType: s.IntroOfferType,
      name: s.Name,
      price: s.Price,
    });
  }
  return map;
}

export interface Classification {
  status: ClientStatus;
  /** when status is member: 'contract' (has a ClientContract) vs 'non-contract' (membership/class-pack only) */
  memberType?: 'contract' | 'non-contract';
  /** churned = terminated contract OR lapsed non-contract membership */
  churned: boolean;
  wasEverMember: boolean;
  membershipStartsOn?: string;
  signals: {
    isProspect: boolean;
    mindbodyStatus?: string;
    active: boolean;
    hasAutoRenewingActiveContract: boolean;
    hasActiveMembership: boolean;
    hasActiveIntroService: boolean;
    hasThirdParty: boolean;
    terminatedContract: boolean;
    expiredMembership: boolean;
  };
}

/**
 * Pure classifier. Pass the Mindbody client object plus its services /
 * memberships / contracts arrays and the intro-offer catalog. Precedence is
 * identical to the RepFlow backend.
 */
export function classifyStatus(
  client: any,
  services: any[],
  memberships: any[],
  contracts: any[],
  catalog: Map<number, { isIntroOffer: boolean }>,
  now: Date = new Date()
): Classification {
  const active = client.Active !== false;
  const mbStatus: string | undefined = client.Status;
  const isProspect = !!client.IsProspect;

  const hasAutoRenewingActiveContract = contracts.some((c) => c.AutoRenewing && isActiveContract(c, now));
  const pendingStart = pendingMembershipStart(contracts, now);
  const hasActiveIntroService = services.some((s) => catalog.get(Number(s.ProductId))?.isIntroOffer && isActiveService(s, now));
  const hasActiveMembership = memberships.some((m) => isActiveMembership(m, now));
  const hasThirdParty = services.some((s) => matchesThirdParty(s.Name));
  // For our use case an active non-intro, non-third-party service (class pack,
  // paid-in-full pass, etc.) counts as a member — surfaced as memberType
  // 'non-contract' so it's distinguishable from contract members. (RepFlow's
  // own classifier excludes these; we intentionally include them here.)
  const hasActiveClassPack = services.some(
    (s) => isActiveService(s, now) && !catalog.get(Number(s.ProductId))?.isIntroOffer && !matchesThirdParty(s.Name)
  );
  const terminatedContract = contracts.some((c) => {
    const t = parseDate(c.TerminationDate);
    return t !== null && t <= now;
  });
  const expiredMembership = memberships.some((m) => {
    const exp = parseDate(m.ExpirationDate);
    return exp !== null && exp <= now;
  });

  let status: ClientStatus;
  if (!active) {
    status = 'inactive';
  } else if (hasAutoRenewingActiveContract) {
    status = 'member';
  } else if (pendingStart) {
    status = 'member';
  } else if (mbStatus && TERMINATED_STATUSES.has(mbStatus)) {
    status = hasActiveIntroService ? 'trialer' : hasThirdParty ? 'external' : 'lapsed';
  } else if (mbStatus && MEMBER_STATUSES.has(mbStatus)) {
    status = 'member';
  } else if (hasActiveMembership) {
    status = 'member';
  } else if (hasActiveClassPack) {
    status = 'member';
  } else if (hasActiveIntroService) {
    status = 'trialer';
  } else if (hasThirdParty) {
    status = 'external';
  } else if (isProspect) {
    status = 'lead';
  } else {
    status = 'lapsed';
  }

  const wasEverMember =
    status === 'member' ||
    memberships.length > 0 ||
    contracts.length > 0 ||
    (!!mbStatus && (MEMBER_STATUSES.has(mbStatus) || TERMINATED_STATUSES.has(mbStatus)));

  // contract vs non-contract member: a non-contract member holds an active
  // membership/class-pack but no ClientContract (answers "members without a contract").
  const memberType: 'contract' | 'non-contract' | undefined =
    status === 'member' ? (contracts.length > 0 ? 'contract' : 'non-contract') : undefined;

  return {
    status,
    memberType,
    churned: terminatedContract || (expiredMembership && !hasActiveMembership && !hasAutoRenewingActiveContract),
    wasEverMember,
    membershipStartsOn: pendingStart ? pendingStart.toISOString() : undefined,
    signals: {
      isProspect,
      mindbodyStatus: mbStatus,
      active,
      hasAutoRenewingActiveContract,
      hasActiveMembership,
      hasActiveIntroService,
      hasThirdParty,
      terminatedContract,
      expiredMembership,
    },
  };
}

/**
 * Classify a single client (lead / trialer / member / lapsed / external /
 * inactive). One /client/clientcompleteinfo call returns services, memberships
 * and contracts together; the service catalog supplies IsIntroOffer.
 */
export async function classifyClientTool(clientId: string): Promise<{
  clientId: string;
  name?: string;
  status: ClientStatus;
  memberType?: 'contract' | 'non-contract';
  churned: boolean;
  wasEverMember: boolean;
  membershipStartsOn?: string;
  signals: Classification['signals'];
}> {
  const [resp, catalog] = await Promise.all([
    mindbodyClient.get<any>('/client/clientcompleteinfo', {
      params: { ClientId: clientId, ShowActiveOnly: false },
    }),
    getServiceCatalog(),
  ]);

  // clientcompleteinfo nests the arrays on the client; fall back to top-level.
  const c = resp.Clients?.[0] ?? resp.Client ?? resp;
  const services = c.ClientServices ?? resp.ClientServices ?? [];
  const memberships = c.ClientMemberships ?? resp.ClientMemberships ?? [];
  const contracts = c.ClientContracts ?? resp.ClientContracts ?? [];

  const result = classifyStatus(c, services, memberships, contracts, catalog);

  return {
    clientId,
    name: [c.FirstName, c.LastName].filter(Boolean).join(' ') || undefined,
    ...result,
  };
}
