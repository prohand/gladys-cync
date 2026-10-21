import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CyncApi, CyncApiError } from '../src/cync/api.js';

const NOW = Date.UTC(2026, 9, 1);

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method, headers: options.headers, body: options.body });
    const route = routes[path];
    if (!route) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const { status = 200, body = {} } = typeof route === 'function' ? route(options) : route;
    return { ok: status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

const TOKENS = {
  access_token: 'access',
  refresh_token: 'refresh',
  authorize: 'auth',
  user_id: 42,
  expire_in: 3600,
};

test('sign-in without a code gives a session', async () => {
  const { fetch, calls } = fakeFetch({ '/v2/user_auth': { body: TOKENS } });
  const api = new CyncApi({ fetch, now: () => NOW });
  const result = await api.signIn('jane@example.com', 'secret');
  assert.deepEqual(result.session, {
    email: 'jane@example.com',
    userId: 42,
    authorize: 'auth',
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: NOW + 3600 * 1000,
  });
  assert.deepEqual(JSON.parse(calls[0].body), {
    corp_id: '1007d2ad150c4000',
    email: 'jane@example.com',
    password: 'secret',
  });
});

test('a 400 on sign-in means a code is needed', async () => {
  const { fetch } = fakeFetch({ '/v2/user_auth': { status: 400 } });
  assert.deepEqual(await new CyncApi({ fetch }).signIn('a@b.c', 'x'), { twoFactor: true });
});

test('the code is requested, then verified', async () => {
  const { fetch, calls } = fakeFetch({
    '/v2/two_factor/email/verifycode': { status: 200 },
    '/v2/user_auth/two_factor': { body: TOKENS },
  });
  const api = new CyncApi({ fetch, now: () => NOW });
  await api.requestCode('jane@example.com');
  const session = await api.verifyCode('jane@example.com', 'secret', ' 123456 ');
  assert.equal(session.authorize, 'auth');
  assert.equal(JSON.parse(calls[1].body).two_factor, '123456', 'pasted spaces are trimmed');
});

test('refresh keeps the authorize string and the user', async () => {
  const { fetch } = fakeFetch({
    '/v2/user/token/refresh': { body: { access_token: 'new', refresh_token: 'r2', expire_in: 60 } },
  });
  const api = new CyncApi({ fetch, now: () => NOW });
  const session = await api.refresh({
    email: 'a@b.c',
    userId: 42,
    authorize: 'auth',
    accessToken: 'old',
    refreshToken: 'r1',
    expiresAt: 0,
  });
  assert.equal(session.accessToken, 'new');
  assert.equal(session.refreshToken, 'r2');
  assert.equal(session.authorize, 'auth');
  assert.equal(session.expiresAt, NOW + 60_000);
});

test('home requests carry the access token', async () => {
  const { fetch, calls } = fakeFetch({
    '/v2/user/42/subscribe/devices': { body: [{ id: 1, source: 5 }] },
    '/v2/product/p1/device/1/property': { body: { bulbsArray: [] } },
  });
  const api = new CyncApi({ fetch });
  const session = { userId: 42, accessToken: 'tok' };
  assert.deepEqual(await api.subscribedDevices(session), [{ id: 1, source: 5 }]);
  assert.deepEqual(await api.homeProperties(session, { id: 1, product_id: 'p1' }), {
    bulbsArray: [],
  });
  assert.equal(calls[0].headers['Access-Token'], 'tok');
});

test('errors carry the status, and never the password', async () => {
  const { fetch } = fakeFetch({ '/v2/user_auth/two_factor': { status: 403 } });
  const api = new CyncApi({ fetch });
  await assert.rejects(api.verifyCode('a@b.c', 'hunter2', '1'), (err) => {
    assert.ok(err instanceof CyncApiError);
    assert.equal(err.status, 403);
    assert.doesNotMatch(err.message, /hunter2/);
    return true;
  });
  const down = new CyncApi({
    fetch: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  await assert.rejects(down.signIn('a@b.c', 'hunter2'), (err) => {
    assert.equal(err.status, 0);
    assert.doesNotMatch(err.message, /hunter2/);
    return true;
  });
});
