import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CyncApiError } from '../src/cync/api.js';
import { FrameBuilder } from '../src/cync/protocol.js';
import { CyncService, STATUS, stateFromRecord } from '../src/cync/service.js';
import { normalizeConfig } from '../src/config.js';
import { FakeApi, FakeConnection, ManualTimers, MemoryStore, SESSION } from './helpers/fakes.js';
import { HOME, KEYS, SWITCH_IDS } from './helpers/fixtures.js';

const CONFIG = normalizeConfig({ email: 'jane@example.com', password: 'secret' });

/** A FrameBuilder that also records what it was asked to build. */
function recordingFrames() {
  const frames = new FrameBuilder();
  frames.calls = [];
  for (const name of [
    'login',
    'probe',
    'statusQuery',
    'power',
    'brightness',
    'colorTemperature',
    'rgb',
    'combo',
  ]) {
    const build = frames[name].bind(frames);
    frames[name] = (...args) => {
      frames.calls.push([name, ...args]);
      return build(...args);
    };
  }
  return frames;
}

function setup({
  api = new FakeApi(),
  store = new MemoryStore(),
  now = () => Date.UTC(2026, 0, 1),
} = {}) {
  const connection = new FakeConnection();
  const timers = new ManualTimers();
  const frames = recordingFrames();
  const service = new CyncService({ api, store, connection, frames, timers, now });
  const events = [];
  for (const name of ['status', 'entities', 'motion', 'connectivity']) {
    service.on(name, (...args) => events.push([name, ...args]));
  }
  return { service, api, store, connection, timers, frames, events };
}

/** Started, logged in, relays probed and states read. */
async function connected(options) {
  const context = setup(options);
  await context.service.start(CONFIG);
  context.connection.open();
  context.connection.push({ kind: 'probe', switchId: SWITCH_IDS.BULB, connected: true });
  context.connection.push({
    kind: 'status',
    switchId: SWITCH_IDS.BULB,
    records: [
      { meshId: 4, online: true, on: true, level: 80, colorMode: 0xfe, rgb: [255, 0, 0] },
      { meshId: 7, online: true, on: false, level: 30, colorMode: 40, rgb: [0, 0, 0] },
      { meshId: 6, online: true, on: true, level: 2, colorMode: 0, rgb: [0, 0, 0] },
      { meshId: 9, online: true, on: true, level: 50, colorMode: 0, rgb: [0, 0, 0] },
    ],
  });
  return context;
}

test('without credentials, nothing is attempted', async () => {
  const { service, api, connection } = setup();
  await service.start(normalizeConfig({}));
  assert.equal(service.status.code, STATUS.NOT_CONFIGURED);
  assert.deepEqual(api.calls, []);
  assert.equal(connection.starts, 0);
});

test('signs in, keeps the session, loads the homes and opens the TCP session', async () => {
  const { service, store, connection, frames, events } = setup();
  await service.start(CONFIG);
  assert.equal(store.session.email, 'jane@example.com');
  assert.deepEqual(frames.calls[0], ['login', SESSION.userId, SESSION.authorize]);
  assert.equal(connection.starts, 1);
  assert.equal(service.status.code, STATUS.CONNECTING);
  assert.equal(service.listEntities().length, 6);
  assert.ok(events.some(([name]) => name === 'entities'));
});

test('a stored session is reused: no sign-in, no email', async () => {
  const { service, api } = setup({ store: new MemoryStore({ ...SESSION }) });
  await service.start(CONFIG);
  assert.equal(
    api.calls.some(([name]) => name === 'signIn'),
    false,
  );
  assert.equal(service.session.accessToken, SESSION.accessToken);
});

test('the stored session of another account is dropped', async () => {
  const store = new MemoryStore({ ...SESSION, email: 'someone@else.com' });
  const { service, api } = setup({ store });
  await service.start(CONFIG);
  assert.ok(api.calls.some(([name]) => name === 'signIn'));
  assert.equal(store.session.email, 'jane@example.com');
});

test('two-step sign-in: code required, sent, then verified', async () => {
  const { service, api, connection } = setup({ api: new FakeApi({ twoFactor: true }) });
  await service.start(CONFIG);
  assert.equal(service.status.code, STATUS.CODE_REQUIRED);
  assert.equal(connection.starts, 0);

  await service.sendCode();
  assert.deepEqual(api.calls.at(-1), ['requestCode', 'jane@example.com']);

  await assert.rejects(service.verifyCode('000000'), CyncApiError);
  assert.equal(connection.starts, 0);

  await service.verifyCode('123456');
  assert.equal(connection.starts, 1);
  assert.equal(service.status.code, STATUS.CONNECTING);
});

test('an access token about to expire is refreshed before use', async () => {
  const now = () => SESSION.expiresAt - 60_000;
  const store = new MemoryStore({ ...SESSION });
  const { service, api } = setup({ store, now });
  await service.start(CONFIG);
  assert.ok(api.calls.some(([name]) => name === 'refresh'));
  assert.equal(store.session.accessToken, 'access-2');
});

test('a 401 on the homes refreshes the token and retries once', async () => {
  const api = new FakeApi();
  let refused = false;
  const subscribed = api.subscribedDevices.bind(api);
  api.subscribedDevices = async (session) => {
    if (!refused) {
      refused = true;
      throw new CyncApiError(401, 'expired');
    }
    return subscribed(session);
  };
  const { service } = setup({ api });
  await service.start(CONFIG);
  assert.ok(api.calls.some(([name]) => name === 'refresh'));
  assert.equal(service.listEntities().length, 6);
});

test('a dead refresh token falls back to the password sign-in', async () => {
  const api = new FakeApi({ twoFactor: true });
  api.refresh = async () => {
    throw new CyncApiError(401, 'refresh refused');
  };
  const store = new MemoryStore({ ...SESSION });
  const { service } = setup({ api, store, now: () => SESSION.expiresAt });
  await service.start(CONFIG);
  assert.equal(store.session, null);
  assert.equal(service.status.code, STATUS.CODE_REQUIRED);
});

test('a network failure is an error status, not a crash', async () => {
  const api = new FakeApi();
  api.signIn = async () => {
    throw new CyncApiError(0, 'Cync cloud unreachable');
  };
  const { service } = setup({ api });
  await service.start(CONFIG);
  assert.equal(service.status.code, STATUS.ERROR);
  assert.match(service.status.detail, /unreachable/);
});

test('once logged in: relays probed, then a first state read', async () => {
  const { service, connection, timers, frames } = setup();
  await service.start(CONFIG);
  connection.open();
  assert.equal(service.status.code, STATUS.CONNECTED);
  const probed = frames.calls.filter(([name]) => name === 'probe').map(([, id]) => id);
  assert.deepEqual(probed.sort(), Object.values(SWITCH_IDS).sort());
  timers.runAll();
  // No probe answer yet: the bulb the cloud lists as online stands in.
  assert.deepEqual(frames.calls.at(-1), ['statusQuery', SWITCH_IDS.BULB]);
});

test('states from a full read: lights, outlets, rooms, absent devices', async () => {
  const { service } = await connected();
  assert.deepEqual(service.getState(KEYS.LIVING), {
    online: true,
    on: true,
    brightness: 80,
    rgb: [255, 0, 0],
    colorTemperature: null,
  });
  assert.equal(service.getState(KEYS.KITCHEN).colorTemperature, 40);
  assert.equal(service.getState(KEYS.PLUG_LEFT).on, false, 'mask 2: left outlet off');
  assert.equal(service.getState(KEYS.PLUG_RIGHT).on, true);
  assert.equal(service.getState(KEYS.PLUG_RIGHT).brightness, undefined);
  const room = service.getState(KEYS.ROOM);
  assert.equal(room.on, true);
  assert.equal(room.brightness, 80);
  assert.equal(room.online, true);
});

test('a device missing from a full read goes offline, and back', async () => {
  const { service, connection, events } = await connected();
  connection.push({
    kind: 'status',
    switchId: SWITCH_IDS.BULB,
    records: [{ meshId: 4, online: true, on: true, level: 80, colorMode: 0, rgb: null }],
  });
  assert.equal(service.getState(KEYS.KITCHEN).online, false);
  const offline = events.filter(([name]) => name === 'connectivity');
  assert.ok(offline.some(([, entity, online]) => entity.key === KEYS.KITCHEN && online === false));
  connection.push({
    kind: 'sync',
    switchId: SWITCH_IDS.BULB,
    records: [{ meshId: 7, online: true, on: true, level: 10, colorMode: 30, rgb: null }],
  });
  assert.equal(service.getState(KEYS.KITCHEN).online, true);
  assert.equal(service.getState(KEYS.KITCHEN).brightness, 10);
});

test('orders go through the relay of the home', async () => {
  const { service, frames, connection } = await connected();
  const before = connection.sent.length;
  service.control(KEYS.KITCHEN, { on: true });
  assert.deepEqual(frames.calls.at(-1), ['power', SWITCH_IDS.BULB, 7, 0, true]);
  service.control(KEYS.PLUG_RIGHT, { on: false });
  assert.deepEqual(frames.calls.at(-1), ['power', SWITCH_IDS.BULB, 6, 2, false]);
  service.control(KEYS.LIVING, { brightness: 40 });
  assert.deepEqual(frames.calls.at(-1), ['brightness', SWITCH_IDS.BULB, 4, 40]);
  service.control(KEYS.ROOM, { colorTemperature: 20 });
  assert.deepEqual(frames.calls.at(-1), ['colorTemperature', SWITCH_IDS.BULB, 3, 20]);
  assert.equal(connection.sent.length, before + 4);
  // What was asked shows until the mesh confirms.
  assert.equal(service.getState(KEYS.LIVING).brightness, 40);
});

test('several values at once make one combo order', async () => {
  const { service, frames } = await connected();
  service.control(KEYS.KITCHEN, { on: true, brightness: 60, colorTemperature: 10 });
  assert.deepEqual(frames.calls.at(-1), [
    'combo',
    SWITCH_IDS.BULB,
    7,
    { on: true, brightness: 60, colorTemperature: 10, rgb: undefined },
  ]);
});

test('no order without a session or a relay', async () => {
  const { service, connection } = setup();
  await service.start(CONFIG);
  assert.throws(() => service.control(KEYS.LIVING, { on: true }), /not open/);
  connection.open();
  assert.throws(() => service.control('nope', { on: true }), /Unknown Cync device/);
});

test('motion: one event per detection, cleared if the sensor never says so', async () => {
  const { service, connection, timers, events } = await connected();
  const motion = { kind: 'sensor', switchId: SWITCH_IDS.DIMMER, meshId: 9, motion: true };
  connection.push(motion);
  connection.push(motion);
  assert.equal(events.filter(([name]) => name === 'motion').length, 1);
  assert.equal(service.getState(KEYS.DIMMER).motion, true);
  timers.runAll();
  assert.equal(service.getState(KEYS.DIMMER).motion, false);
  connection.push(motion);
  assert.equal(events.filter(([name]) => name === 'motion').length, 2);
});

test('the session going down is a status, not a device going offline', async () => {
  const { service, connection, events } = await connected();
  connection.stop();
  assert.equal(service.status.code, STATUS.OFFLINE);
  assert.equal(service.getState(KEYS.LIVING).online, true);
  assert.equal(events.filter(([name]) => name === 'connectivity').length, 0);
  assert.throws(() => service.control(KEYS.LIVING, { on: true }), /not open/);
});

test('refused logins: sign in again from the password', async () => {
  const store = new MemoryStore({ ...SESSION });
  const { service, api, connection } = setup({ store });
  await service.start(CONFIG);
  connection.emit('auth-failed');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(api.calls.some(([name]) => name === 'signIn'));
  assert.equal(connection.starts, 2);
});

test('summary for the widget and the connection test', async () => {
  const { service } = await connected();
  const summary = service.summary();
  assert.equal(summary.devices, 5);
  assert.equal(summary.rooms, 1);
  assert.equal(summary.online, 5);
  assert.deepEqual(summary.homes, [{ id: HOME.id, name: 'House', relay: 'Living bulb' }]);
});

test('a light reported in white mode drops its color, and the reverse', () => {
  const device = {
    element: 0,
    capabilities: { brightness: true, colorTemperature: true, rgb: true, plug: false },
  };
  const white = stateFromRecord(
    device,
    { online: true, on: true, level: 5, colorMode: 50 },
    { rgb: [1, 2, 3] },
  );
  assert.equal(white.rgb, null);
  assert.equal(white.colorTemperature, 50);
  const color = stateFromRecord(
    device,
    { online: true, on: true, level: 5, colorMode: 0xfe, rgb: [9, 9, 9] },
    white,
  );
  assert.equal(color.colorTemperature, null);
  assert.deepEqual(color.rgb, [9, 9, 9]);
});
