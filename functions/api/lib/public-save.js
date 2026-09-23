import { hashCredential } from './client-auth.js';

// Public saves intentionally remain available to browser shortcuts. Bound their
// cost globally as well as per IP; never store the originating IP itself.
export async function allowPublicSave(request, env) {
  if (!env.CONTENT_DB) return false;
  const now = Math.floor(Date.now() / 1000);
  const day = Math.floor(now / 86400);
  const hour = Math.floor(now / 3600);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const limits = [
    [`ip:${hour}:${await hashCredential(`${day}:${ip}`)}`, 10, (hour + 1) * 3600],
    [`day:${day}`, 30, (day + 1) * 86400]
  ];
  for (const [bucket, limit, expiresAt] of limits) {
    const row = await env.CONTENT_DB.prepare(`
      INSERT INTO public_save_limits (bucket, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET count = count + 1 WHERE count < ?
      RETURNING count
    `).bind(bucket, expiresAt, limit).first();
    if (!row) return false;
  }
  await env.CONTENT_DB.prepare('DELETE FROM public_save_limits WHERE expires_at < ?').bind(now).run();
  return true;
}
