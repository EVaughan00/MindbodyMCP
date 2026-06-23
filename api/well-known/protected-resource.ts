import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBaseUrl, protectedResourceMetadata } from '../../src/oauth/index.js';
import { applyCors } from '../../src/http.js';

// Served at /.well-known/oauth-protected-resource (see vercel.json rewrites).
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  res.status(200).json(protectedResourceMetadata(getBaseUrl(req)));
}
