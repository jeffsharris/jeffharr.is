const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
const JWKS_CACHE = new Map();

async function isAdminAuthorized(request, env) {
  return Boolean(await getAdminUser(request, env));
}

async function getAdminUser(request, env) {
  const token = getAccessToken(request);
  const config = getAccessConfig(env);
  if (!token || !config) return null;

  try {
    const payload = await verifyAccessJwt(token, config);
    const email = normalizeEmail(payload.email);
    if (!isAllowedEmail(email, env)) return null;
    return {
      email,
      name: payload.name || '',
      subject: payload.sub || ''
    };
  } catch {
    return null;
  }
}

function getAccessConfig(env) {
  const teamDomain = normalizeTeamDomain(env?.CLOUDFLARE_ACCESS_TEAM_DOMAIN);
  const audience = stringOrNull(env?.ADMIN_ACCESS_AUD || env?.CLOUDFLARE_ACCESS_AUD);
  if (!teamDomain || !audience) return null;
  return { teamDomain, audience };
}

async function verifyAccessJwt(token, { teamDomain, audience }) {
  if (token.length > 16384) throw new Error('Invalid Access token');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Access token');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(decodeBase64UrlToString(encodedHeader));
  const payload = JSON.parse(decodeBase64UrlToString(encodedPayload));

  if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('Unsupported Access token');
  }

  // Reject irrelevant or expired claims before doing network or crypto work.
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('Expired Access token');
  if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now)) throw new Error('Access token is not active');
  if (payload.iss !== teamDomain) throw new Error('Unexpected Access issuer');
  if (!audienceMatches(payload.aud, audience)) throw new Error('Unexpected Access audience');

  const jwk = await getAccessJwk(teamDomain, header.kid);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  if (!verified) throw new Error('Invalid Access token signature');

  return payload;
}

async function getAccessJwk(teamDomain, kid) {
  const cached = JWKS_CACHE.get(teamDomain);
  if (cached?.expiresAt > Date.now()) {
    const key = cached.keys.find((candidate) => candidate.kid === kid);
    if (key) return key;
    // Allow key rotation, but not a certificate fetch for every invented key ID.
    if (cached.fetchedAt > Date.now() - 60000) throw new Error('Access signing key not found');
  }

  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Unable to fetch Access certs');
  const body = await response.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  JWKS_CACHE.set(teamDomain, {
    keys,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) throw new Error('Access signing key not found');
  return key;
}

function audienceMatches(value, expected) {
  if (Array.isArray(value)) return value.includes(expected);
  return value === expected;
}

function isAllowedEmail(email, env) {
  if (!email) return false;
  const configured = stringOrNull(env?.ADMIN_ALLOWED_EMAILS || env?.ADMIN_EMAILS);
  if (!configured) return false;
  const allowed = configured
    .split(',')
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
  return allowed.includes(email);
}

function normalizeTeamDomain(value) {
  const raw = stringOrNull(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.cloudflareaccess.com') || parsed.username || parsed.password || parsed.port) return '';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeEmail(value) {
  return stringOrNull(value).toLowerCase();
}

function getAccessToken(request) {
  const header = request.headers.get(ACCESS_JWT_HEADER);
  if (header) return header;
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1];
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  try { return cookie ? decodeURIComponent(cookie[1]) : ''; } catch { return ''; }
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function decodeBase64UrlToString(value) {
  return new TextDecoder().decode(decodeBase64Url(value));
}

function decodeBase64Url(value) {
  const base64 = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export { getAdminUser, isAdminAuthorized, isAllowedEmail, unauthorizedResponse };
