import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHomes,
  capabilitiesOf,
  entitiesOf,
  homeEntries,
  kindOf,
} from '../src/cync/catalog.js';
import { HOME, KEYS, PROPERTIES, SUBSCRIBED, SWITCH_IDS } from './helpers/fixtures.js';

const homes = () => buildHomes(SUBSCRIBED, new Map([[HOME.id, PROPERTIES]]));

test('capabilities and kind of known device types', () => {
  assert.deepEqual(capabilitiesOf(137), {
    onOff: true,
    brightness: true,
    colorTemperature: true,
    rgb: true,
    motion: false,
    wifi: true,
    plug: false,
    fan: false,
  });
  assert.equal(kindOf(capabilitiesOf(137)), 'light');
  assert.equal(kindOf(capabilitiesOf(67)), 'plug');
  assert.equal(kindOf(capabilitiesOf(81)), 'fan');
  assert.equal(kindOf(capabilitiesOf(37)), 'light', 'a dimmer with a motion sensor drives a light');
  assert.equal(capabilitiesOf(37).motion, true);
  assert.equal(kindOf(capabilitiesOf(200)), null, 'unknown types are not driven');
});

test('mesh address, outlet element and relay of every device', () => {
  const [home] = homes();
  assert.equal(home.name, 'House');
  const byKey = new Map(home.devices.map((device) => [device.key, device]));
  assert.deepEqual(
    [...byKey.keys()].sort(),
    [
      KEYS.LIVING,
      KEYS.KITCHEN,
      KEYS.PLUG_LEFT,
      KEYS.PLUG_RIGHT,
      KEYS.DIMMER,
      `${HOME.id}-12`,
    ].sort(),
  );
  const left = byKey.get(KEYS.PLUG_LEFT);
  assert.equal(left.meshId, 6);
  assert.equal(left.element, 1);
  assert.equal(byKey.get(KEYS.PLUG_RIGHT).element, 2);
  assert.equal(byKey.get(KEYS.LIVING).switchId, SWITCH_IDS.BULB);
  assert.equal(byKey.get(KEYS.LIVING).cloudOnline, true);
  assert.equal(byKey.get(KEYS.KITCHEN).switchId, 0);
  assert.equal(byKey.get(KEYS.DIMMER).cloudOnline, false);
});

test('a room offers what all its lights can do; a room without light is left out', () => {
  const [home] = homes();
  assert.equal(home.rooms.length, 1);
  const [room] = home.rooms;
  assert.equal(room.key, KEYS.ROOM);
  assert.deepEqual(room.memberKeys, [KEYS.LIVING, KEYS.KITCHEN]);
  assert.equal(room.capabilities.brightness, true);
  assert.equal(room.capabilities.colorTemperature, true);
  assert.equal(room.capabilities.rgb, false, 'the kitchen bulb has no color');
});

test('entities: driven devices, then rooms unless turned off', () => {
  const entities = entitiesOf(homes());
  assert.equal(entities.length, 6, 'five devices without the camera, one room');
  assert.equal(entities.at(-1).kind, 'room');
  assert.equal(entitiesOf(homes(), { includeRooms: false }).length, 5);
});

test('homes are the entries marked source 5, or every entry when none is', () => {
  assert.deepEqual(homeEntries(SUBSCRIBED), [HOME]);
  const unmarked = [{ id: 1 }, { id: 2 }];
  assert.deepEqual(homeEntries(unmarked), unmarked);
});

test('a home whose description failed is skipped, not fatal', () => {
  assert.deepEqual(buildHomes(SUBSCRIBED, new Map()), []);
});
