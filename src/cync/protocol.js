// -----------------------------------------------------------------------------
// The Cync TCP protocol: building the frames we send, decoding the ones the
// cloud pushes. Pure functions, no socket: see connection.js for the wire.
//
// Every frame starts with a 5-byte header:
//
//   byte 0      message type (high nibble), "is a response" flag (0x08) and
//               protocol version (low 3 bits)
//   bytes 1..4  payload length, big-endian
//
// The orders to the lights travel as PIPE messages (type 7). Their payload is
// addressed to a Wi-Fi device of the home (its cloud id, the "switch id"),
// which relays the order to the Bluetooth mesh: a bulb without Wi-Fi is only
// reachable through a neighbour that has it. Inside, an "inner frame" between
// two 0x7e delimiters carries the mesh command; its own integers are
// little-endian, and a 0x7e inside it is escaped as 0x7d 0x5e.
//
// The byte layouts below were established by the open-source Cync clients of
// the Home Assistant community; the tests pin them with known frames.
// -----------------------------------------------------------------------------

export const MESSAGE_TYPES = {
  LOGIN: 1,
  HANDSHAKE: 2,
  SYNC: 4,
  PIPE: 7,
  PIPE_SYNC: 8,
  PROBE: 10,
  PING: 13,
  DISCONNECT: 14,
};

export const PIPE_COMMANDS = {
  SET_POWER: 0xd0,
  SET_BRIGHTNESS: 0xd2,
  SET_COLOR: 0xe2,
  DEVICE_STATUS: 0xdb,
  COMBO: 0xf0,
  STATUS_PAGES: 0x52,
  SENSOR: 0x54,
};

const PROTOCOL_VERSION = 3;
const HEADER_LENGTH = 5;
const DIRECTION_REQUEST = 0xf8;
const DELIMITER = 0x7e;

/** Color mode byte of a light in RGB mode (1..100 is a white temperature). */
export const COLOR_MODE_RGB = 0xfe;
/** Color mode byte of a combo order that leaves the color as it is. */
const COLOR_MODE_KEEP = 0xff;

/** Ping, sent to keep the session open (an empty PING request). */
export const PING_FRAME = Buffer.from('d300000000', 'hex');
/** Polite goodbye before closing the socket. */
export const DISCONNECT_FRAME = Buffer.from('e30000000103', 'hex');

/**
 * Builds the outgoing frames. It owns the two counters the protocol needs —
 * the 16-bit packet number of the outer payload and the 32-bit sequence of
 * the inner frame — so a test can start them where it wants.
 */
export class FrameBuilder {
  constructor({ packetCounter = 1, innerSequence = 257 } = {}) {
    this.packetCounter = packetCounter;
    this.innerSequence = innerSequence;
  }

  /** LOGIN: the user id and the `authorize` string of the REST login. */
  login(userId, authorize) {
    const auth = Buffer.from(String(authorize), 'ascii');
    const payload = Buffer.concat([
      Buffer.from([PROTOCOL_VERSION]),
      u32be(userId),
      u16be(auth.length),
      auth,
      // Two reserved bytes, then the keep-alive the server expects, in
      // seconds: 30, so a ping every 20 s keeps the session open.
      Buffer.from([0x00, 0x00, 0x1e]),
    ]);
    return withHeader(MESSAGE_TYPES.LOGIN, payload);
  }

  /** PROBE: asks a Wi-Fi device whether it is connected right now. */
  probe(switchId) {
    const payload = Buffer.concat([
      u32be(switchId),
      u16be(this.#nextPacket()),
      Buffer.from([0, 2]),
    ]);
    return withHeader(MESSAGE_TYPES.PROBE, payload);
  }

  /** Every mesh device of the home, through the relay `switchId`. */
  statusQuery(switchId) {
    // Two reserved bytes, then "all pages" (0xffff) from offset 0.
    const args = Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
    return this.#pipe(switchId, PIPE_COMMANDS.STATUS_PAGES, args, { secondSequence: false });
  }

  /**
   * On/off. `element` picks one outlet of a multi-outlet device (1, 2...), 0
   * the whole device; a room id goes in `meshId` with element 0.
   */
  power(switchId, meshId, element, on) {
    const args = Buffer.from([
      0x00,
      meshId & 0xff,
      element & 0xff,
      PIPE_COMMANDS.SET_POWER,
      0x11,
      0x02,
      on ? 1 : 0,
      0x00,
      0x00,
    ]);
    return this.#pipe(switchId, PIPE_COMMANDS.SET_POWER, args);
  }

  /** Brightness, 0..100. */
  brightness(switchId, meshId, level) {
    const args = Buffer.concat([
      Buffer.from([0x00]),
      u16le(meshId),
      Buffer.from([PIPE_COMMANDS.SET_BRIGHTNESS, 0x11, 0x02, clampByte(level, 0, 100)]),
    ]);
    return this.#pipe(switchId, PIPE_COMMANDS.SET_BRIGHTNESS, args);
  }

  /** White temperature, 1 (warmest) .. 100 (coolest). */
  colorTemperature(switchId, meshId, temperature) {
    const args = Buffer.concat([
      Buffer.from([0x00]),
      u16le(meshId),
      Buffer.from([PIPE_COMMANDS.SET_COLOR, 0x11, 0x02, 0x05, clampByte(temperature, 1, 100)]),
    ]);
    return this.#pipe(switchId, PIPE_COMMANDS.SET_COLOR, args);
  }

  /** RGB color, `[r, g, b]` each 0..255. */
  rgb(switchId, meshId, [r, g, b]) {
    const args = Buffer.concat([
      Buffer.from([0x00]),
      u16le(meshId),
      Buffer.from([PIPE_COMMANDS.SET_COLOR, 0x11, 0x02, 0x04]),
      Buffer.from([r, g, b].map((c) => clampByte(c, 0, 255))),
    ]);
    return this.#pipe(switchId, PIPE_COMMANDS.SET_COLOR, args);
  }

  /**
   * Power, brightness and color in ONE order: the light goes straight to the
   * target, without first lighting up at its previous color.
   * `colorTemperature` (1..100) wins over `rgb`; neither keeps the color.
   */
  combo(switchId, meshId, { on, brightness, colorTemperature, rgb }) {
    let mode = COLOR_MODE_KEEP;
    let color = [0, 0, 0];
    if (colorTemperature !== undefined && colorTemperature !== null) {
      mode = clampByte(colorTemperature, 1, 100);
    } else if (rgb) {
      mode = COLOR_MODE_RGB;
      color = rgb.map((c) => clampByte(c, 0, 255));
    }
    const args = Buffer.concat([
      Buffer.from([0x00]),
      u16le(meshId),
      Buffer.from([
        PIPE_COMMANDS.COMBO,
        0x11,
        0x02,
        on ? 1 : 0,
        clampByte(brightness, 0, 100),
        mode,
        ...color,
      ]),
    ]);
    return this.#pipe(switchId, PIPE_COMMANDS.COMBO, args);
  }

  #pipe(switchId, command, args, { secondSequence = true } = {}) {
    const sequence = u32le(this.#nextInner());
    // The orders repeat the inner sequence at the head of their arguments; the
    // status query does not.
    const body = secondSequence ? Buffer.concat([sequence, args]) : args;
    const commandBlock = Buffer.concat([Buffer.from([command]), u16le(body.length), body]);
    const inner = Buffer.concat([
      sequence,
      Buffer.from([DIRECTION_REQUEST]),
      commandBlock,
      Buffer.from([checksum(commandBlock)]),
    ]);
    const payload = Buffer.concat([
      u32be(switchId),
      u16be(this.#nextPacket()),
      Buffer.from([0x00, DELIMITER]),
      escape(inner),
      Buffer.from([DELIMITER]),
    ]);
    return withHeader(MESSAGE_TYPES.PIPE, payload);
  }

  #nextPacket() {
    const value = this.packetCounter;
    this.packetCounter = (this.packetCounter + 1) % 65536;
    return value;
  }

  #nextInner() {
    const value = this.innerSequence;
    this.innerSequence = this.innerSequence + 1 < 0xffffffff ? this.innerSequence + 1 : 257;
    return value;
  }
}

/**
 * Cut a byte stream into frames. TCP gives chunks, not frames: a chunk can
 * hold several frames, or the start of one.
 *
 * @param {Buffer} buffer bytes received and not consumed yet
 * @returns {{ frames: Buffer[], rest: Buffer }}
 */
export function splitFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_LENGTH) {
    const length = buffer.readUInt32BE(offset + 1);
    const end = offset + HEADER_LENGTH + length;
    if (end > buffer.length) {
      break;
    }
    frames.push(buffer.subarray(offset, end));
    offset = end;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * Decode one frame into a message the service understands.
 *
 * - `{ kind: 'login' }`: the server accepted the session;
 * - `{ kind: 'probe', switchId, connected }`: a Wi-Fi device answered a probe;
 * - `{ kind: 'status', switchId, records }`: the state of every mesh device,
 *   answer to a status query;
 * - `{ kind: 'sync', switchId, records }`: states that just changed;
 * - `{ kind: 'sensor', switchId, meshId, motion }`: a motion sensor event;
 * - `{ kind: 'disconnect' }`, `{ kind: 'ping' }`;
 * - `{ kind: 'ignored', reason }` for everything else.
 *
 * A record is `{ meshId, online, on, level, colorMode, rgb }`: `level` is the
 * brightness of a light, and the bit mask of the powered outlets of a
 * multi-outlet plug.
 *
 * @param {Buffer} frame one complete frame (see splitFrames)
 */
export function decodeFrame(frame) {
  const type = frame[0] >> 4;
  const isResponse = Boolean(frame[0] & 0x08);
  const version = frame[0] & 0x07;
  const payload = frame.subarray(HEADER_LENGTH);
  if (payload.length !== frame.readUInt32BE(1)) {
    return { kind: 'ignored', reason: 'length mismatch' };
  }

  switch (type) {
    case MESSAGE_TYPES.LOGIN:
      return { kind: 'login', isResponse };
    case MESSAGE_TYPES.PING:
      return { kind: 'ping' };
    case MESSAGE_TYPES.DISCONNECT:
      return { kind: 'disconnect' };
    case MESSAGE_TYPES.PROBE:
      if (payload.length < 4) {
        return { kind: 'ignored', reason: 'short probe' };
      }
      // Version 0 is the server answering for a device it cannot reach.
      return { kind: 'probe', switchId: payload.readUInt32BE(0), connected: version !== 0 };
    case MESSAGE_TYPES.SYNC:
      return decodeSync(payload);
    case MESSAGE_TYPES.PIPE:
    case MESSAGE_TYPES.PIPE_SYNC:
      return decodePipe(payload);
    default:
      return { kind: 'ignored', reason: `message type ${type}` };
  }
}

function decodeSync(payload) {
  if (payload.length < 7 || payload.readUIntBE(4, 3) !== 0x010106) {
    return { kind: 'ignored', reason: 'sync without state' };
  }
  const switchId = payload.readUInt32BE(0);
  const records = [];
  let offset = 7;
  // Each entry: one byte, a 12-bit length, then that many bytes of state.
  while (payload.length - offset >= 3) {
    const length = payload.readUInt16BE(offset + 1) & 0x0fff;
    const entry = payload.subarray(offset + 3, offset + 3 + length);
    if (entry.length < 4) {
      break;
    }
    records.push({
      meshId: entry[0],
      online: true,
      on: entry[1] > 0,
      level: entry[2],
      colorMode: entry[3],
      rgb: entry.length >= 7 ? [entry[4], entry[5], entry[6]] : null,
    });
    offset += 3 + length;
  }
  return { kind: 'sync', switchId, records };
}

function decodePipe(payload) {
  if (payload.length < 9 || payload[7] !== DELIMITER || payload.at(-1) !== DELIMITER) {
    return { kind: 'ignored', reason: 'pipe without inner frame' };
  }
  const switchId = payload.readUInt32BE(0);
  const inner = unescape(payload.subarray(8, -1));
  // seq (4) | direction (1) | command (1) | length (2, LE) | data | checksum
  if (inner.length < 9) {
    return { kind: 'ignored', reason: 'short inner frame' };
  }
  const command = inner[5];
  const length = inner.readUInt16LE(6);
  const data = inner.subarray(8, 8 + length);
  if (checksum(inner.subarray(5, -1)) !== inner.at(-1)) {
    return { kind: 'ignored', reason: 'bad checksum' };
  }

  switch (command) {
    case PIPE_COMMANDS.STATUS_PAGES:
      return { kind: 'status', switchId, records: decodeStatusPages(data) };
    case PIPE_COMMANDS.SENSOR:
      if (data.length < 9) {
        return { kind: 'ignored', reason: 'short sensor event' };
      }
      return { kind: 'sensor', switchId, meshId: data[0], motion: data[6] > 0 };
    case PIPE_COMMANDS.DEVICE_STATUS:
      if (data.length < 13) {
        return { kind: 'ignored', reason: 'short device status' };
      }
      return {
        kind: 'sync',
        switchId,
        records: [
          {
            meshId: data[5],
            online: true,
            on: data[11] > 0,
            level: data[12],
            colorMode: null,
            rgb: null,
          },
        ],
      };
    default:
      return { kind: 'ignored', reason: `pipe command 0x${command.toString(16)}` };
  }
}

// Status pages: 4 bytes, the device count (LE16), then 24 bytes per device.
function decodeStatusPages(data) {
  if (data.length < 6) {
    return [];
  }
  const count = data.readUInt16LE(4);
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const entry = data.subarray(6 + i * 24, 6 + (i + 1) * 24);
    if (entry.length < 24) {
      break;
    }
    records.push({
      meshId: entry.readUInt16LE(0),
      online: entry[3] > 0,
      on: entry[8] > 0,
      level: entry[12],
      colorMode: entry[16],
      rgb: [entry[20], entry[21], entry[22]],
    });
  }
  return records;
}

function withHeader(type, payload) {
  return Buffer.concat([
    Buffer.from([(type << 4) | PROTOCOL_VERSION]),
    u32be(payload.length),
    payload,
  ]);
}

function checksum(bytes) {
  let sum = 0;
  for (const byte of bytes) {
    sum = (sum + byte) % 256;
  }
  return sum;
}

function escape(bytes) {
  const out = [];
  for (const byte of bytes) {
    if (byte === DELIMITER) {
      out.push(0x7d, 0x5e);
    } else {
      out.push(byte);
    }
  }
  return Buffer.from(out);
}

function unescape(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x7d && bytes[i + 1] === 0x5e) {
      out.push(DELIMITER);
      i += 1;
    } else {
      out.push(bytes[i]);
    }
  }
  return Buffer.from(out);
}

function clampByte(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function u16be(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value & 0xffff);
  return buffer;
}

function u16le(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff);
  return buffer;
}

function u32be(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}
