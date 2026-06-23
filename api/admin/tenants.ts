import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  deleteTenant,
  getTenant,
  hashPassword,
  listTenants,
  saveTenant,
  tenantToPublic,
  type Tenant,
} from '../../src/store/index.js';
import { applyCors, requireAdmin } from '../../src/http.js';

/**
 * Admin CRUD for tenants. Protected by ADMIN_PASSWORD (HTTP Basic).
 *   GET                -> list tenants (no secrets)
 *   POST   {tenant...} -> create or update a tenant
 *   DELETE ?id=...     -> remove a tenant
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET') {
    const tenants = await listTenants();
    return res.status(200).json({ tenants: tenants.map(tenantToPublic) });
  }

  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, any>;
    const id = String(b.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid id. Use 2-64 chars: a-z, 0-9, -, _' });
    }

    const existing = await getTenant(id);

    // Password: required on create; optional on update (keep existing if blank).
    let passwordHash: string;
    if (b.password) {
      passwordHash = hashPassword(String(b.password));
    } else if (existing) {
      passwordHash = existing.passwordHash;
    } else {
      return res.status(400).json({ error: 'password is required when creating a tenant' });
    }

    // Mindbody secrets: keep existing value if the field is omitted on update.
    const keep = (incoming: any, prev?: string) =>
      incoming === undefined || incoming === '' ? prev : String(incoming);

    const tenant: Tenant = {
      id,
      name: String(b.name || existing?.name || id),
      mindbodyApiKey: keep(b.mindbodyApiKey, existing?.mindbodyApiKey) || '',
      mindbodySiteId: keep(b.mindbodySiteId, existing?.mindbodySiteId) || '',
      mindbodySourceName: keep(b.mindbodySourceName, existing?.mindbodySourceName),
      mindbodySourcePassword: keep(b.mindbodySourcePassword, existing?.mindbodySourcePassword),
      mindbodyApiUrl: keep(b.mindbodyApiUrl, existing?.mindbodyApiUrl),
      passwordHash,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    if (!tenant.mindbodyApiKey || !tenant.mindbodySiteId) {
      return res.status(400).json({ error: 'mindbodyApiKey and mindbodySiteId are required' });
    }

    await saveTenant(tenant);
    return res.status(200).json({ ok: true, tenant: tenantToPublic(tenant) });
  }

  if (req.method === 'DELETE') {
    const id = String((req.query.id as string) || '').trim().toLowerCase();
    if (!id) return res.status(400).json({ error: 'id required' });
    await deleteTenant(id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
