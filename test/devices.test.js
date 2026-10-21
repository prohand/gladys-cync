import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildHomes, entitiesOf } from '../src/cync/catalog.js';
import {
  buildDevice,
  fromKelvin,
  intToRgb,
  orderFor,
  resolveFeature,
  rgbToInt,
  statesOf,
  toKelvin,
} from '../src/devices/index.js';
import { HOME, KEYS, PROPERTIES, SUBSCRIBED } from './helpers/fixtures.js';

const entities = entitiesOf(buildHomes(SUBSCRIBED, new Map([[HOME.id, PROPERTIES]])));
const byKey = (key) => entities.find((entity) => entity.key === key);
const gladys = createFakeGladys();
const featureNames = (device) => device.features.map((f) => f.external_id.split(':').at(-1));

test('features follow the capabilities', () => {
  assert.deepEqual(featureNames(buildDevice(gladys, byKey(KEYS.KITCHEN))), [
    'power',
    'brightness',
    'temperature',
  ]);
  assert.deepEqual(featureNames(buildDevice(gladys, byKey(KEYS.PLUG_LEFT))), ['power']);
  assert.deepEqual(featureNames(buildDevice(gladys, byKey(KEYS.DIMMER))), [
    'power',
    'brightness',
    'motion',
  ]);
  assert.deepEqual(featureNames(buildDevice(gladys, byKey(KEYS.ROOM))), [
    'power',
    'brightness',
    'temperature',
  ]);
});

test('every feature declares its range', () => {
  for (const entity of entities) {
    for (const feature of buildDevice(gladys, entity).features) {
      assert.ok(Number.isFinite(feature.min) && Number.isFinite(feature.max), feature.external_id);
      assert.equal(feature.key, undefined, 'the internal key is not published');
    }
  }
});

test('external ids come from the home and mesh address, rooms apart', () => {
  assert.equal(
    buildDevice(gladys, byKey(KEYS.LIVING)).external_id,
    `ext:test-integration:device:${KEYS.LIVING}`,
  );
  assert.equal(
    buildDevice(gladys, byKey(KEYS.ROOM)).external_id,
    `ext:test-integration:room:${KEYS.ROOM}`,
  );
});

test('white temperature: Cync 1..100 is 2000..7000 K', () => {
  assert.equal(toKelvin(1), 2050);
  assert.equal(toKelvin(100), 7000);
  assert.equal(fromKelvin(2000), 1, 'never 0, which is not a white temperature');
  assert.equal(fromKelvin(7000), 100);
  assert.equal(fromKelvin(4500), 50);
  assert.equal(fromKelvin(toKelvin(37)), 37);
});

test('colors: integer <-> RGB', () => {
  assert.equal(rgbToInt([255, 128, 1]), 0xff8001);
  assert.deepEqual(intToRgb(0xff8001), [255, 128, 1]);
  assert.deepEqual(intToRgb(-5), [0, 0, 0]);
});

test('orders from Gladys values', () => {
  assert.deepEqual(orderFor('power', 1), { on: true });
  assert.deepEqual(orderFor('power', 0), { on: false });
  assert.deepEqual(orderFor('brightness', 140), { brightness: 100 });
  assert.deepEqual(orderFor('temperature', 2700), { colorTemperature: 14 });
  assert.deepEqual(orderFor('color', 0x00ff00), { rgb: [0, 255, 0] });
  assert.throws(() => orderFor('motion', 1), /cannot be set/);
});

test('states only for what is known', () => {
  const kitchen = byKey(KEYS.KITCHEN);
  assert.deepEqual(statesOf(gladys, kitchen, undefined), []);
  const states = statesOf(gladys, kitchen, { on: true, brightness: 30, colorTemperature: null });
  assert.deepEqual(
    states.map((state) => [state.device_feature_external_id.split(':').at(-1), state.state]),
    [
      ['power', 1],
      ['brightness', 30],
    ],
  );
});

test('a Gladys feature resolves to its entity, a foreign one to nothing', () => {
  const device = buildDevice(gladys, byKey(KEYS.LIVING));
  const target = resolveFeature(
    gladys,
    entities,
    device.external_id,
    device.features[1].external_id,
  );
  assert.equal(target.entity.key, KEYS.LIVING);
  assert.equal(target.featureKey, 'brightness');
  assert.equal(resolveFeature(gladys, entities, device.external_id, 'ext:other'), null);
  assert.equal(resolveFeature(gladys, entities, 'ext:other', 'ext:other'), null);
});
