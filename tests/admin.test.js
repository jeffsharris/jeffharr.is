import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as adminPageRequest } from '../functions/admin/index.js';

test('admin page redirects signed-out visitors to the Access-protected session endpoint', async () => {
  const response = await adminPageRequest({
    request: new Request('https://jeffharr.is/admin/?returnTo=/poems/?poem=wild-geese'),
    env: {}
  });

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('location'),
    'https://jeffharr.is/api/admin/session?redirect=%2Fpoems%2F%3Fpoem%3Dwild-geese'
  );
});

test('admin fallback page does not display the admin email address', async () => {
  const response = await adminPageRequest({
    request: new Request('https://jeffharr.is/admin/?returnTo=/', {
      headers: {
        'cf-access-jwt-assertion': 'present-but-unverified'
      }
    }),
    env: {}
  });
  const html = await response.text();

  assert.equal(response.status, 503);
  assert.equal(html.includes('jeff.s.harris@gmail.com'), false);
});
