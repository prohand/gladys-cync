import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../src/app.js';
import { CyncService } from '../src/cync/service.js';
import { idsOf } from '../src/devices/index.js';
import { FakeApi, FakeConnection, ManualTimers, MemoryStore, settle } from './helpers/fakes.js';
import { KEYS, SWITCH_IDS } from './helpers/fixtures.js';

const CONFIG = { email: 'jane@example.com', password: 'secret' };

async function start({ api = new FakeApi(), config = CONFIG } = {}) {
  const gladys = createFakeGladys({ config });
  const connection = new FakeConnection();
  const service = new CyncService({
    api,
    store: new MemoryStore(),
    connection,
    timers: new ManualTimers(),
  });
  registerHandlers(gladys, { service });
  await gladys.connect();
  await settle();
  return { gladys, service, connection, api };
}

async function online() {
  const context = await start();
  context.connection.open();
  context.connection.push({ kind: 'probe', switchId: SWITCH_IDS.BULB, connected: true });
  context.connection.push({
    kind: 'status',
    switchId: SWITCH_IDS.BULB,
    records: [
      { meshId: 4, online: true, on: true, level: 80, colorMode: 0xfe, rgb: [255, 0, 0] },
      { meshId: 7, online: true, on: false, level: 30, colorMode: 40, rgb: [0, 0, 0] },
      { meshId: 6, online: true, on: true, level: 1, colorMode: 0, rgb: [0, 0, 0] },
      { meshId: 9, online: true, on: false, level: 0, colorMode: 0, rgb: [0, 0, 0] },
    ],
  });
  await settle();
  return context;
}

const ext = (gladys, service, key) => idsOf(gladys, service.getEntity(key));

test('publishes every Cync device and room, accepted by Gladys', async () => {
  const { gladys } = await start();
  const names = gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, [
    'Living bulb',
    'Kitchen bulb',
    'Terrace left',
    'Terrace right',
    'Hall dimmer',
    'Living room',
  ]);
  const living = gladys.fake.discoveredDevices[0];
  assert.deepEqual(
    living.features.map((feature) => feature.external_id.split(':').at(-1)),
    ['power', 'brightness', 'temperature', 'color'],
  );
  const dimmer = gladys.fake.discoveredDevices[4];
  assert.ok(dimmer.features.some((feature) => feature.category === 'motion-sensor'));
});

test('connection status follows the service', async () => {
  const { gladys, connection } = await start();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  connection.open();
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('two-step sign-in from the Configuration screen', async () => {
  const { gladys, api, connection } = await start({ api: new FakeApi({ twoFactor: true }) });
  assert.match(gladys.fake.connectionStatus.message.fr, /Envoyer un code/);
  const sent = await gladys.fake.action('send_code', {});
  assert.match(sent.data.message.en, /jane@example\.com/);
  assert.ok(api.calls.some(([name]) => name === 'requestCode'));
  const refused = await gladys.fake.action('verify_code', { code: '999999' });
  assert.match(refused.data.message.de, /abgelehnt/);
  const accepted = await gladys.fake.action('verify_code', { code: '123456' });
  assert.match(accepted.data.message.es, /6 dispositivo/);
  assert.equal(connection.starts, 1);
});

test('states, transports and orders', async () => {
  const { gladys, service, connection } = await online();
  const living = ext(gladys, service, KEYS.LIVING);
  assert.equal(gladys.fake.lastState(living.feature('power')), 1);
  assert.equal(gladys.fake.lastState(living.feature('brightness')), 80);
  assert.equal(gladys.fake.lastState(living.feature('color')), 0xff0000);
  const kitchen = ext(gladys, service, KEYS.KITCHEN);
  assert.equal(gladys.fake.lastState(kitchen.feature('temperature')), 4000);
  const badges = new Map(
    gladys.fake.transports.map((entry) => [entry.device_external_id, entry.transport]),
  );
  assert.equal(badges.size, 6);
  assert.ok([...badges.values()].every((transport) => transport === 'cloud'));

  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === kitchen.device);
  const feature = device.features.find((f) => f.external_id === kitchen.feature('temperature'));
  const before = connection.sent.length;
  assert.deepEqual(await gladys.fake.setValue(device, feature, 2700), { success: true });
  assert.equal(connection.sent.length, before + 1);
  assert.equal(service.getState(KEYS.KITCHEN).colorTemperature, 14);
  assert.equal(gladys.fake.lastState(kitchen.feature('temperature')), 2700);
});

test('an order Cync cannot carry fails its acknowledgement', async () => {
  const { gladys, service } = await start();
  const kitchen = ext(gladys, service, KEYS.KITCHEN);
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === kitchen.device);
  const ack = await gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
});

test('motion and connectivity reach the scenes', async () => {
  const { gladys, service, connection } = await online();
  connection.push({ kind: 'sensor', switchId: SWITCH_IDS.DIMMER, meshId: 9, motion: true });
  await settle();
  const dimmer = ext(gladys, service, KEYS.DIMMER);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).key, 'motion_detected');
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data, { device: dimmer.device });
  assert.equal(gladys.fake.lastState(dimmer.feature('motion')), 1);

  connection.push({
    kind: 'status',
    switchId: SWITCH_IDS.BULB,
    records: [{ meshId: 4, online: true, on: true, level: 80, colorMode: 0, rgb: null }],
  });
  await settle();
  const kitchen = ext(gladys, service, KEYS.KITCHEN);
  const offline = gladys.fake.sceneEvents.find(
    (event) => event.key === 'device_connectivity' && event.data.device === kitchen.device,
  );
  assert.deepEqual(offline.data, { device: kitchen.device, status: 'offline' });
  const badge = gladys.fake.transports.findLast(
    (entry) => entry.device_external_id === kitchen.device,
  );
  assert.equal(badge.transport, 'unreachable');
});

test('scene action set_light sends one order; an unknown device is an output', async () => {
  const { gladys, service, connection } = await online();
  const kitchen = ext(gladys, service, KEYS.KITCHEN);
  const before = connection.sent.length;
  const ack = await gladys.fake.sceneAction('set_light', {
    device: kitchen.device,
    power: 'on',
    brightness: 70,
    temperature: 6000,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { applied: true } } });
  assert.equal(connection.sent.length, before + 1, 'one combo order');
  assert.equal(service.getState(KEYS.KITCHEN).brightness, 70);
  assert.equal(service.getState(KEYS.KITCHEN).colorTemperature, 80);

  const unknown = await gladys.fake.sceneAction('set_light', { device: 'ext:nope', power: 'off' });
  assert.deepEqual(unknown.data.outputs, { applied: false });
});

test('scene action refresh_states answers the counts', async () => {
  const { gladys, connection } = await online();
  const pending = gladys.fake.sceneAction('refresh_states', {});
  await settle();
  connection.push({
    kind: 'status',
    switchId: SWITCH_IDS.BULB,
    records: [{ meshId: 4, online: true, on: true, level: 80, colorMode: 0, rgb: null }],
  });
  const ack = await pending;
  assert.deepEqual(ack.data.outputs, { online: 1, total: 5 });
});

test('widgets render exactly as sent, in every state', async () => {
  for (const context of [await start({ config: {} }), await online()]) {
    const { gladys } = context;
    for (const [key, settings] of [
      ['cync_status', {}],
      ['cync_devices', {}],
      ['cync_devices', { show: 'offline' }],
      ['cync_devices', { show: 'on' }],
    ]) {
      const ack = await gladys.fake.widgetGet(key, { settings, language: 'fr', units: 'metric' });
      assert.equal(ack.success, true, `${key} answered`);
      assert.deepEqual(
        validateWidgetContent(ack.data.content),
        [],
        `${key} ${JSON.stringify(settings)}`,
      );
    }
  }
});

test('the status widget buttons act', async () => {
  const { gladys, connection } = await online();
  const before = connection.sent.length;
  const refresh = await gladys.fake.widgetAction('cync_status', 'refresh_states', {}, {});
  assert.equal(refresh.success, true);
  assert.equal(connection.sent.length, before + 1);
  const reload = await gladys.fake.widgetAction('cync_status', 'reload_devices', {}, {});
  assert.match(reload.data.message.en, /6 device/);
});

test('test_connection reports the devices online', async () => {
  const { gladys, connection } = await online();
  const pending = gladys.fake.action('test_connection', {});
  await settle();
  connection.push({
    kind: 'status',
    switchId: SWITCH_IDS.BULB,
    records: [{ meshId: 4, online: true, on: true, level: 80, colorMode: 0, rgb: null }],
  });
  const ack = await pending;
  assert.match(ack.data.message.en, /^Connected — 1\/5 device\(s\) online, 1\/1 home/);
});

test('losing the Cync cloud makes every badge unreachable', async () => {
  const { gladys, connection } = await online();
  const scenes = gladys.fake.sceneEvents.length;
  connection.stop();
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /reconnecting/);
  const last = new Map(gladys.fake.transports.map((e) => [e.device_external_id, e.transport]));
  assert.ok([...last.values()].every((transport) => transport === 'unreachable'));
  assert.equal(gladys.fake.sceneEvents.length, scenes, 'no "device offline" scene storm');
});

test('a configuration update restarts the Cync session; a Gladys reconnection does not', async () => {
  const { gladys, connection } = await online();
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(connection.starts, 1);
  await gladys.fake.configUpdated({ ...CONFIG, include_rooms: false });
  await settle();
  assert.equal(connection.starts, 2);
  assert.equal(gladys.fake.discoveredDevices.length, 5);
});
