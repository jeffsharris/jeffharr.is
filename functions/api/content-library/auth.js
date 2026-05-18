function isWriteAuthorized(request, env) {
  const configured = typeof env?.LISTS_WRITE_TOKEN === 'string'
    ? env.LISTS_WRITE_TOKEN.trim()
    : '';
  if (!configured) return true;

  const auth = request.headers.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const header = request.headers.get('x-lists-write-token')?.trim();
  return bearer === configured || header === configured;
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

export { isWriteAuthorized, unauthorizedResponse };
