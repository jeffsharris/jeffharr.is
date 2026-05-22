const DEFAULT_ADMIN_EMAIL = 'jeff.s.harris@gmail.com';
const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
const ACCESS_COOKIE = 'CF_Authorization';
const CLOCK_SKEW_SECONDS = 60;
const CERT_CACHE_SECONDS = 300;

let cachedCerts = null;

export async function authenticateAdminRequest(request, env = {}) {
  const token = getAccessToken(request);
  if (!token) {
    return authFailure('not_authenticated', 401);
  }

  const config = getAccessConfig(env);
  if (!config.teamDomain || !config.audience) {
    return authFailure('access_not_configured', 503);
  }

  const verification = await verifyAccessJwt(token, config);
  if (!verification.ok) {
    return authFailure(verification.error || 'invalid_access_token', 401);
  }

  const email = normalizeEmail(
    verification.payload.email ||
    verification.payload.common_name ||
    verification.payload.sub ||
    ''
  );

  if (!email || !config.allowedEmails.has(email)) {
    return {
      authenticated: false,
      admin: false,
      status: 403,
      error: 'not_admin',
      email: email || null,
    };
  }

  return {
    authenticated: true,
    admin: true,
    email,
    payload: verification.payload,
  };
}

export function adminJsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

function authFailure(error, status) {
  return {
    authenticated: false,
    admin: false,
    status,
    error,
  };
}

function getAccessConfig(env) {
  const teamDomain = normalizeTeamDomain(
    env.CLOUDFLARE_ACCESS_TEAM_DOMAIN ||
    env.CF_ACCESS_TEAM_DOMAIN ||
    env.ACCESS_TEAM_DOMAIN ||
    ''
  );
  const audience = String(
    env.CLOUDFLARE_ACCESS_AUD ||
    env.CF_ACCESS_AUD ||
    env.ACCESS_AUD ||
    ''
  ).trim();
  const allowedEmails = parseAllowedEmails(
    env.ADMIN_EMAILS ||
    env.ADMIN_EMAIL ||
    DEFAULT_ADMIN_EMAIL
  );

  return { teamDomain, audience, allowedEmails };
}

function parseAllowedEmails(value) {
  const emails = String(value || DEFAULT_ADMIN_EMAIL)
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
  return new Set(emails.length ? emails : [DEFAULT_ADMIN_EMAIL]);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTeamDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
}

function getAccessToken(request) {
  const headerToken = request.headers.get(ACCESS_JWT_HEADER);
  if (headerToken) return headerToken.trim();

  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function verifyAccessJwt(token, config) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'malformed_access_token' };
  }

  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64UrlText(parts[0]));
    payload = JSON.parse(decodeBase64UrlText(parts[1]));
  } catch {
    return { ok: false, error: 'invalid_access_payload' };
  }

  if (header.alg !== 'RS256' || !header.kid) {
    return { ok: false, error: 'unsupported_access_token' };
  }

  const issuer = `https://${config.teamDomain}`;
  if (payload.iss !== issuer) {
    return { ok: false, error: 'invalid_access_issuer' };
  }

  if (!audienceMatches(payload.aud, config.audience)) {
    return { ok: false, error: 'invalid_access_audience' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - CLOCK_SKEW_SECONDS) {
    return { ok: false, error: 'expired_access_token' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now + CLOCK_SKEW_SECONDS) {
    return { ok: false, error: 'early_access_token' };
  }

  const key = await findSigningKey(config.teamDomain, header.kid);
  if (!key) {
    return { ok: false, error: 'missing_access_key' };
  }

  const valid = await verifySignature(key, `${parts[0]}.${parts[1]}`, parts[2]);
  if (!valid) {
    return { ok: false, error: 'invalid_access_signature' };
  }

  return { ok: true, payload };
}

function audienceMatches(value, audience) {
  if (Array.isArray(value)) return value.includes(audience);
  return value === audience;
}

async function findSigningKey(teamDomain, kid) {
  const certs = await getAccessCerts(teamDomain);
  return certs.find((key) => key.kid === kid) || null;
}

async function getAccessCerts(teamDomain) {
  const now = Date.now();
  if (cachedCerts && cachedCerts.teamDomain === teamDomain && cachedCerts.expiresAt > now) {
    return cachedCerts.keys;
  }

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error('Cloudflare Access certs could not be loaded');
  }

  const body = await response.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  cachedCerts = {
    teamDomain,
    keys,
    expiresAt: now + CERT_CACHE_SECONDS * 1000,
  };
  return keys;
}

async function verifySignature(jwk, signingInput, signaturePart) {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(signingInput)
  );
}

function decodeBase64UrlText(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
