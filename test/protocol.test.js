import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameBuilder, decodeFrame, splitFrames } from '../src/cync/protocol.js';

// Frames captured from the Cync cloud by the community clients: they pin the
// byte layouts. Relay 23456 (0x5ba0), packet number 1, inner sequence 257.
const RELAY = 23456;
const hex = (buffer) => buffer.toString('hex');
const builder = () => new FrameBuilder();

test('login frame carries the user id and the authorize string', () => {
  const frame = builder().login(123456, '123456789abcdef');
  assert.equal(
    hex(frame),
    '1300000019030001e240000f' + Buffer.from('123456789abcdef').toString('hex') + '00001e',
  );
});

test('state query of every device of the home', () => {
  assert.equal(
    hex(builder().statusQuery(RELAY)),
    '730000001800005ba00001007e01010000f85206000000ffff0000567e',
  );
});

test('power order, whole device and one outlet', () => {
  assert.equal(
    hex(builder().power(RELAY, 5, 0, true)),
    '730000001f00005ba00001007e01010000f8d00d0001010000000500d01102010000c87e',
  );
  assert.equal(
    hex(builder().power(RELAY, 6, 1, true)),
    '730000001f00005ba00001007e01010000f8d00d0001010000000601d01102010000ca7e',
  );
});

test('brightness, white temperature and RGB orders', () => {
  assert.equal(
    hex(builder().brightness(RELAY, 5, 42)),
    '730000001d00005ba00001007e01010000f8d20b0001010000000500d211022af37e',
  );
  assert.equal(
    hex(builder().colorTemperature(RELAY, 5, 56)),
    '730000001e00005ba00001007e01010000f8e20c0001010000000500e211020538277e',
  );
  assert.equal(
    hex(builder().rgb(RELAY, 5, [190, 239, 237])),
    '730000002000005ba00001007e01010000f8e20e0001010000000500e2110204beefed8a7e',
  );
});

test('combo order: white, color, or color kept', () => {
  assert.equal(
    hex(builder().combo(RELAY, 5, { on: true, brightness: 45, colorTemperature: 56 })),
    '730000002200005ba00001007e01010000f8f0100001010000000500f01102012d38000000707e',
  );
  assert.equal(
    hex(builder().combo(RELAY, 5, { on: true, brightness: 45, rgb: [190, 239, 237] })),
    '730000002200005ba00001007e01010000f8f0100001010000000500f01102012dfebeefedd07e',
  );
  assert.equal(
    hex(builder().combo(RELAY, 5, { on: true, brightness: 45 })),
    '730000002200005ba00001007e01010000f8f0100001010000000500f01102012dff000000377e',
  );
});

test('a 0x7e inside the inner frame is escaped', () => {
  assert.equal(
    hex(builder().power(RELAY, 0x7e, 0, true)),
    '730000002000005ba00001007e01010000f8d00d0001010000007d5e00d01102010000417e',
  );
});

test('the counters move on with every frame', () => {
  const frames = new FrameBuilder();
  frames.power(RELAY, 5, 0, true);
  assert.equal(
    hex(frames.power(RELAY, 5, 0, true)),
    '730000001f00005ba00002007e02010000f8d00d0002010000000500d01102010000c97e',
  );
});

test('values out of range are clamped, never wrapped', () => {
  const frame = builder().brightness(RELAY, 5, 250);
  // 100 (0x64), not 250 & 0xff.
  assert.equal(frame.at(-3), 100);
});

test('decodes the status pages of a home', () => {
  const frame = Buffer.from(
    '730000009100000d8002e5007e01010000f9527d5e000500000005000400890100008901010000005000000039000000d796ff0007000001000000010000000000000000fe000000f8383000020000010000000101000000410000001e00000000000000e800000100000001010000005000000039000000000000001e0000010000000101000000500000003900000000000000d17e',
    'hex',
  );
  const message = decodeFrame(frame);
  assert.equal(message.kind, 'status');
  assert.equal(message.switchId, 3456);
  assert.deepEqual(
    message.records.map((r) => r.meshId),
    [4, 7, 2, 232, 30],
  );
  assert.deepEqual(message.records[0], {
    meshId: 4,
    online: true,
    on: true,
    level: 80,
    colorMode: 57,
    rgb: [215, 150, 255],
  });
  assert.equal(message.records[1].on, false);
  assert.equal(message.records[1].colorMode, 0xfe);
});

test('a frame with a bad checksum is ignored', () => {
  const frame = Buffer.from(
    '730000009100000d8002e5007e01010000f9527d5e000500000005000400890100008901010000005000000039000000d796ff0007000001000000010000000000000000fe000000f8383000020000010000000101000000410000001e00000000000000e800000100000001010000005000000039000000000000001e0000010000000101000000500000003900000000000000127e',
    'hex',
  );
  assert.deepEqual(decodeFrame(frame), { kind: 'ignored', reason: 'bad checksum' });
});

test('decodes pushed state changes', () => {
  const light = decodeFrame(
    Buffer.from('430000001a0000092901010606001007014cfef8383001141e000000000000', 'hex'),
  );
  assert.deepEqual(light, {
    kind: 'sync',
    switchId: 2345,
    records: [
      { meshId: 7, online: true, on: true, level: 76, colorMode: 0xfe, rgb: [248, 56, 48] },
    ],
  });
  const plug = decodeFrame(Buffer.from('4300000011000004d201010600000706010200000000', 'hex'));
  assert.equal(plug.records[0].meshId, 6);
  assert.equal(plug.records[0].level, 2, 'outlet mask: the right outlet');
});

test('a sync that carries no state (sensor data) is ignored', () => {
  const frame = Buffer.from('4300000009000004d2010203aabb', 'hex');
  assert.equal(decodeFrame(frame).kind, 'ignored');
});

test('login acknowledgement, probe answers, length mismatch', () => {
  assert.equal(decodeFrame(Buffer.from('18000000020000', 'hex')).kind, 'login');
  assert.deepEqual(decodeFrame(Buffer.from('ab0000000700005ba0000100', 'hex')), {
    kind: 'probe',
    switchId: RELAY,
    connected: true,
  });
  assert.equal(decodeFrame(Buffer.from('a80000000700005ba0000100', 'hex')).connected, false);
  assert.equal(decodeFrame(Buffer.from('1800000009000000', 'hex')).kind, 'ignored');
});

test('splits a byte stream into frames, keeping a partial one', () => {
  const login = Buffer.from('18000000020000', 'hex');
  const query = builder().statusQuery(RELAY);
  const stream = Buffer.concat([login, query, query.subarray(0, 10)]);
  const { frames, rest } = splitFrames(stream);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1], query);
  assert.equal(rest.length, 10);
  const next = splitFrames(Buffer.concat([rest, query.subarray(10)]));
  assert.deepEqual(next.frames, [query]);
  assert.equal(next.rest.length, 0);
});
