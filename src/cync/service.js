// -----------------------------------------------------------------------------
// The Cync service: the account, its homes and devices, and their states.
//
// It ties the three channels together, and knows nothing of Gladys (src/app.js
// does the translation):
//   - the REST API signs in and describes the homes (api.js, catalog.js);
//   - the TCP session carries the orders and the pushed states
//     (connection.js, protocol.js);
//   - the session file keeps the tokens across restarts (session.js).
//
// An order to a light goes through a "relay": a device of the same home that
// has its own Wi-Fi and is connected right now. The relays are found by
// probing every Wi-Fi device when the session opens; a home without one is
// unreachable, whatever the state of its bulbs.
//
// Events:
//   - `status` (status)                     connection status changed
//   - `entities` (entities)                 devices and rooms (re)loaded
//   - `state` (entity, state, previous)     a state changed
//   - `motion` (entity)                     a motion sensor detected motion
//   - `connectivity` (entity, online)       a device went offline / online
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { CyncApi, CyncApiError } from './api.js';
import { buildHomes, entitiesOf, homeEntries } from './catalog.js';
import { CyncConnection } from './connection.js';
import { COLOR_MODE_RGB, FrameBuilder } from './protocol.js';
import { SessionStore } from './session.js';

const logger = createLogger({ name: 'cync' });

export const STATUS = {
  NOT_CONFIGURED: 'not_configured',
  SIGNING_IN: 'signing_in',
  CODE_REQUIRED: 'code_required',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  OFFLINE: 'offline',
  ERROR: 'error',
};

/** Refresh the access token when it has less than this left. */
const TOKEN_MARGIN_MS = 60 * 60 * 1000;
/** Wait for the probe answers before the first state read. */
const FIRST_READ_DELAY_MS = 3_000;
/** A motion sensor that never says "clear" is cleared after this. */
const MOTION_CLEAR_MS = 90_000;
/** Answer of a state read: how long `refreshStates({ wait })` waits. */
const STATUS_WAIT_MS = 5_000;

export class CyncService extends EventEmitter {
  constructor({
    api = new CyncApi(),
    store = new SessionStore(),
    connection = new CyncConnection(),
    frames = new FrameBuilder(),
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
    now = Date.now,
  } = {}) {
    super();
    this.api = api;
    this.store = store;
    this.connection = connection;
    this.frames = frames;
    this.timers = timers;
    this.now = now;

    this.config = null;
    this.session = null;
    this.status = { code: STATUS.NOT_CONFIGURED };
    this.homes = [];
    this.entities = new Map();
    this.states = new Map();
    this.relays = new Map(); // home id -> Set of connected switch ids
    this.switchHomes = new Map(); // switch id -> home id
    this.refreshTimer = null;
    this.firstReadTimer = null;
    this.motionTimers = new Map();
    this.statusWaiters = [];

    connection.on('ready', () => this.#onReady());
    connection.on('down', () => this.#onDown());
    connection.on('auth-failed', () => this.#onAuthFailed());
    connection.on('message', (message) => this.#onMessage(message));
  }

  // --- Lifecycle -------------------------------------------------------------

  /** (Re)start with a configuration. Never throws: failures are a status. */
  async start(config) {
    this.#stopRuntime();
    this.config = config;
    if (!config.email || !config.password) {
      this.session = null;
      this.#setStatus(STATUS.NOT_CONFIGURED);
      return this.status;
    }
    // Twice at most: a refresh token found dead on the way clears the session,
    // and the second pass signs in again from the password.
    this.session = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.#signIn();
        if (this.session) {
          await this.#open();
        }
        break;
      } catch (err) {
        const sessionLost = this.session === null && err instanceof CyncApiError;
        if (!sessionLost || attempt === 1) {
          this.#fail(err);
          break;
        }
      }
    }
    return this.status;
  }

  async #signIn() {
    let session = await this.store.load();
    if (session && session.email !== this.config.email) {
      // Another account was typed in: the old tokens are not its own.
      await this.store.clear();
      session = null;
    }
    if (!session) {
      this.#setStatus(STATUS.SIGNING_IN);
      const result = await this.api.signIn(this.config.email, this.config.password);
      if (result.twoFactor) {
        this.session = null;
        this.#setStatus(STATUS.CODE_REQUIRED);
        return;
      }
      session = result.session;
      await this.store.save(session);
    }
    this.session = session;
  }

  /** Stop everything (shutdown). */
  stop() {
    this.#stopRuntime();
  }

  /** Ask the cloud to email a verification code. */
  async sendCode() {
    this.#requireCredentials();
    await this.api.requestCode(this.config.email);
    this.#setStatus(STATUS.CODE_REQUIRED);
  }

  /** Sign in with the emailed code, then open the session. */
  async verifyCode(code) {
    this.#requireCredentials();
    const session = await this.api.verifyCode(this.config.email, this.config.password, code);
    await this.store.save(session);
    this.session = session;
    this.#stopRuntime();
    try {
      await this.#open();
    } catch (err) {
      this.#fail(err);
    }
    return this.status;
  }

  /** Re-read the homes from the cloud (new device, renamed room...). */
  async reload() {
    if (!this.session) {
      throw new Error('Not signed in to Cync');
    }
    await this.#loadHomes();
    this.#probeRelays();
  }

  // --- States ----------------------------------------------------------------

  /** Every device and room published to Gladys. */
  listEntities() {
    return [...this.entities.values()];
  }

  getEntity(key) {
    return this.entities.get(key);
  }

  getState(key) {
    return this.states.get(key);
  }

  /**
   * Ask every home for the state of all its devices. With `wait`, resolve
   * once the answers arrived (or after a few seconds).
   * @returns {Promise<number>} how many homes were asked
   */
  async refreshStates({ wait = false } = {}) {
    if (!this.connection.ready) {
      return 0;
    }
    let asked = 0;
    for (const home of this.homes) {
      const relay = this.#relayOf(home.id);
      if (!relay) {
        this.#markHome(home.id, false);
        continue;
      }
      try {
        this.connection.send(this.frames.statusQuery(relay));
        asked += 1;
      } catch (err) {
        logger.warn(`State read failed: ${err.message}`);
      }
    }
    if (wait && asked > 0) {
      await new Promise((resolve) => {
        const timer = this.timers.setTimeout(resolve, STATUS_WAIT_MS);
        this.statusWaiters.push(() => {
          this.timers.clearTimeout(timer);
          resolve();
        });
      });
    }
    return asked;
  }

  /**
   * Drive a device or a room.
   * @param {string} key entity key
   * @param {{ on?: boolean, brightness?: number, colorTemperature?: number, rgb?: number[] }} order
   *   `brightness` 0..100, `colorTemperature` 1..100 (warm to cool)
   */
  control(key, order) {
    const entity = this.entities.get(key);
    if (!entity) {
      throw new Error(`Unknown Cync device: ${key}`);
    }
    if (!this.connection.ready) {
      throw new Error('The Cync cloud session is not open');
    }
    const relay = this.#relayOf(entity.homeId);
    if (!relay) {
      throw new Error('No Wi-Fi Cync device of this home is connected to relay the order');
    }
    const parts = ['on', 'brightness', 'colorTemperature', 'rgb'].filter(
      (part) => order[part] !== undefined && order[part] !== null,
    );
    const state = this.states.get(key) ?? {};
    const frames = [];
    if (parts.length > 1 && entity.capabilities.brightness && entity.kind !== 'fan') {
      // One combo order: the light goes straight to the target.
      frames.push(
        this.frames.combo(relay, entity.meshId, {
          on: order.on ?? true,
          brightness: order.brightness ?? (state.brightness || 100),
          colorTemperature: order.colorTemperature,
          rgb: order.colorTemperature ? undefined : order.rgb,
        }),
      );
    } else {
      if (order.on !== undefined) {
        // A room id can exceed a byte: its high byte takes the element slot.
        const element = entity.kind === 'room' ? entity.meshId >> 8 : entity.element;
        frames.push(this.frames.power(relay, entity.meshId, element, order.on));
      }
      if (order.brightness !== undefined) {
        frames.push(this.frames.brightness(relay, entity.meshId, order.brightness));
      }
      if (order.colorTemperature !== undefined) {
        frames.push(this.frames.colorTemperature(relay, entity.meshId, order.colorTemperature));
      }
      if (order.rgb !== undefined) {
        frames.push(this.frames.rgb(relay, entity.meshId, order.rgb));
      }
    }
    for (const frame of frames) {
      this.connection.send(frame);
    }

    // The mesh confirms with a push; until then, show what was asked.
    const next = { ...state };
    if (order.on !== undefined) next.on = order.on;
    if (order.brightness !== undefined) {
      next.brightness = order.brightness;
      if (order.on === undefined) next.on = order.brightness > 0;
    }
    if (order.colorTemperature !== undefined) {
      next.colorTemperature = order.colorTemperature;
      next.rgb = null;
    } else if (order.rgb !== undefined) {
      next.rgb = order.rgb;
      next.colorTemperature = null;
    }
    this.#setState(entity, next);
  }

  /** Figures for the widget and the "Test the connection" action. */
  summary() {
    const devices = this.listEntities().filter((entity) => entity.kind !== 'room');
    return {
      status: this.status,
      email: this.config?.email ?? '',
      homes: this.homes.map((home) => ({
        id: home.id,
        name: home.name,
        relay: this.#relayName(home),
      })),
      devices: devices.length,
      rooms: this.listEntities().length - devices.length,
      online: devices.filter((device) => this.states.get(device.key)?.online).length,
      relaxedTls: !this.connection.strictTls,
    };
  }

  // --- Internals -------------------------------------------------------------

  async #open() {
    await this.#ensureFreshToken();
    await this.#loadHomes();
    this.#setStatus(STATUS.CONNECTING);
    this.connection.start(this.frames.login(this.session.userId, this.session.authorize));
    this.refreshTimer = this.timers.setInterval(() => {
      this.#ensureFreshToken().catch((err) => logger.warn(`Token refresh failed: ${err.message}`));
      this.refreshStates().catch(() => {});
    }, this.config.state_refresh * 1000);
  }

  async #ensureFreshToken() {
    if (!this.session || this.session.expiresAt - this.now() > TOKEN_MARGIN_MS) {
      return;
    }
    await this.#refreshToken();
  }

  async #refreshToken() {
    try {
      this.session = await this.api.refresh(this.session);
      await this.store.save(this.session);
      logger.info('Cync access token refreshed');
    } catch (err) {
      if (err instanceof CyncApiError && err.status >= 400 && err.status < 500) {
        // The refresh token is dead too: back to the sign-in.
        await this.store.clear();
        this.session = null;
      }
      throw err;
    }
  }

  async #withToken(call) {
    try {
      return await call();
    } catch (err) {
      if (err instanceof CyncApiError && (err.status === 401 || err.status === 403)) {
        await this.#refreshToken();
        return call();
      }
      throw err;
    }
  }

  async #loadHomes() {
    const subscribed = await this.#withToken(() => this.api.subscribedDevices(this.session));
    const properties = new Map();
    for (const home of homeEntries(subscribed)) {
      try {
        properties.set(
          home.id,
          await this.#withToken(() => this.api.homeProperties(this.session, home)),
        );
      } catch (err) {
        logger.warn(`Cannot read the Cync home "${home.name ?? home.id}": ${err.message}`);
      }
    }
    this.homes = buildHomes(subscribed, properties);
    this.switchHomes = new Map();
    for (const home of this.homes) {
      for (const device of home.devices) {
        if (device.switchId) {
          this.switchHomes.set(device.switchId, home.id);
        }
      }
    }
    const entities = entitiesOf(this.homes, { includeRooms: this.config.include_rooms });
    this.entities = new Map(entities.map((entity) => [entity.key, entity]));
    for (const key of this.states.keys()) {
      if (!this.entities.has(key)) {
        this.states.delete(key);
      }
    }
    const skipped = this.homes.flatMap((home) => home.devices.filter((device) => !device.kind));
    for (const device of skipped) {
      logger.info(`Cync device "${device.name}" (type ${device.deviceType}) is not supported`);
    }
    logger.info(
      `Cync account: ${this.homes.length} home(s), ${entities.length} device(s) and room(s)`,
    );
    this.emit('entities', entities);
  }

  #onReady() {
    this.#setStatus(STATUS.CONNECTED);
    this.relays = new Map();
    this.#probeRelays();
    this.timers.clearTimeout(this.firstReadTimer);
    this.firstReadTimer = this.timers.setTimeout(() => {
      this.firstReadTimer = null;
      this.refreshStates().catch(() => {});
    }, FIRST_READ_DELAY_MS);
  }

  #probeRelays() {
    if (!this.connection.ready) {
      return;
    }
    for (const switchId of this.switchHomes.keys()) {
      try {
        this.connection.send(this.frames.probe(switchId));
      } catch {
        return;
      }
    }
  }

  // The devices keep their last known state: losing the cloud says nothing
  // about them, and marking them offline would fire a "device offline" scene
  // per device at every network blip. The status alone makes every transport
  // badge unreachable (see src/app.js), and the next full read settles it.
  #onDown() {
    this.relays = new Map();
    if (this.status.code === STATUS.CONNECTED || this.status.code === STATUS.CONNECTING) {
      this.#setStatus(STATUS.OFFLINE);
    }
  }

  async #onAuthFailed() {
    logger.warn('The Cync cloud refuses the session: signing in again');
    await this.store.clear();
    this.session = null;
    await this.start(this.config);
  }

  #onMessage(message) {
    switch (message.kind) {
      case 'probe':
        this.#onProbe(message);
        break;
      case 'status':
        this.#onRecords(message, { full: true });
        for (const resolve of this.statusWaiters.splice(0)) {
          resolve();
        }
        break;
      case 'sync':
        this.#onRecords(message, { full: false });
        break;
      case 'sensor':
        this.#onSensor(message);
        break;
      default:
        break;
    }
  }

  #onProbe({ switchId, connected }) {
    const homeId = this.switchHomes.get(switchId);
    if (homeId === undefined) {
      return;
    }
    const relays = this.relays.get(homeId) ?? new Set();
    if (connected) {
      relays.add(switchId);
    } else {
      relays.delete(switchId);
    }
    this.relays.set(homeId, relays);
  }

  #onRecords({ switchId, records }, { full }) {
    const homeId = this.switchHomes.get(switchId);
    if (homeId === undefined) {
      return;
    }
    // Whoever answers is connected: a relay, even if its probe answer was lost.
    if (!this.relays.get(homeId)?.has(switchId)) {
      this.relays.set(homeId, new Set([...(this.relays.get(homeId) ?? []), switchId]));
    }
    const seen = new Set();
    for (const record of records) {
      for (const device of this.#devicesAt(homeId, record.meshId)) {
        seen.add(device.key);
        this.#setState(device, stateFromRecord(device, record, this.states.get(device.key)));
      }
    }
    if (full) {
      // A full read lists every device the mesh still hears.
      for (const device of this.#devicesOf(homeId)) {
        if (!seen.has(device.key)) {
          this.#setState(device, { ...this.states.get(device.key), online: false });
        }
      }
    }
    this.#updateRooms();
  }

  #onSensor({ switchId, meshId, motion }) {
    const homeId = this.switchHomes.get(switchId);
    for (const device of this.#devicesAt(homeId, meshId)) {
      if (!device.capabilities.motion) {
        continue;
      }
      const previous = this.states.get(device.key) ?? {};
      this.#setState(device, { ...previous, online: true, motion });
      this.timers.clearTimeout(this.motionTimers.get(device.key));
      this.motionTimers.delete(device.key);
      if (motion) {
        if (!previous.motion) {
          this.emit('motion', device);
        }
        this.motionTimers.set(
          device.key,
          this.timers.setTimeout(() => {
            this.motionTimers.delete(device.key);
            this.#setState(device, { ...this.states.get(device.key), motion: false });
          }, MOTION_CLEAR_MS),
        );
      }
    }
  }

  #devicesOf(homeId) {
    return [...this.entities.values()].filter(
      (entity) => entity.kind !== 'room' && entity.homeId === homeId,
    );
  }

  #devicesAt(homeId, meshId) {
    return this.#devicesOf(homeId).filter((device) => device.meshId === meshId);
  }

  #markHome(homeId, online) {
    for (const device of this.#devicesOf(homeId)) {
      this.#setState(device, { ...this.states.get(device.key), online });
    }
    this.#updateRooms();
  }

  // A room shows what its lights show: on when one is on, at the brightness
  // of the brightest lit one.
  #updateRooms() {
    for (const room of this.entities.values()) {
      if (room.kind !== 'room') {
        continue;
      }
      const members = room.memberKeys.map((key) => this.states.get(key)).filter(Boolean);
      const lit = members.filter((state) => state.on);
      const reference = lit[0] ?? members[0];
      this.#setState(room, {
        online: members.some((state) => state.online),
        on: lit.length > 0,
        brightness: Math.max(0, ...(lit.length ? lit : members).map((s) => s.brightness ?? 0)),
        colorTemperature: reference?.colorTemperature ?? null,
        rgb: reference?.rgb ?? null,
      });
    }
  }

  #setState(entity, next) {
    const previous = this.states.get(entity.key);
    if (previous && sameState(previous, next)) {
      return;
    }
    this.states.set(entity.key, next);
    this.emit('state', entity, next, previous);
    if (
      entity.kind !== 'room' &&
      previous?.online !== undefined &&
      next.online !== undefined &&
      previous.online !== next.online
    ) {
      this.emit('connectivity', entity, next.online);
    }
  }

  // A relay confirmed by a probe answer first; else a Wi-Fi device the cloud
  // lists as online — its answer will confirm it (see #onRecords).
  #relayOf(homeId) {
    const connected = this.relays.get(homeId);
    if (connected?.size) {
      return [...connected][0];
    }
    const home = this.homes.find((candidate) => candidate.id === homeId);
    const fallback = home?.devices.find(
      (device) => device.switchId && device.capabilities.wifi && device.cloudOnline,
    );
    return fallback?.switchId ?? null;
  }

  #relayName(home) {
    const relay = this.#relayOf(home.id);
    return home.devices.find((device) => device.switchId === relay)?.name ?? null;
  }

  #setStatus(code, detail) {
    const changed = this.status.code !== code || this.status.detail !== detail;
    this.status = detail ? { code, detail } : { code };
    if (changed) {
      this.emit('status', this.status);
    }
  }

  #fail(err) {
    logger.error(`Cync: ${err.message}`);
    this.#setStatus(STATUS.ERROR, err.message);
  }

  #requireCredentials() {
    if (!this.config?.email || !this.config?.password) {
      throw new Error('Fill in the email and password of the Cync account first');
    }
  }

  #stopRuntime() {
    this.timers.clearInterval(this.refreshTimer);
    this.timers.clearTimeout(this.firstReadTimer);
    this.refreshTimer = null;
    this.firstReadTimer = null;
    for (const timer of this.motionTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.motionTimers.clear();
    for (const resolve of this.statusWaiters.splice(0)) {
      resolve();
    }
    this.connection.stop();
  }
}

/** The state of one device from a record of the mesh (see protocol.js). */
export function stateFromRecord(device, record, previous = {}) {
  const { capabilities } = device;
  const on =
    device.element > 0
      ? record.on && ((record.level >> (device.element - 1)) & 1) === 1
      : record.on;
  const state = { ...previous, online: record.online, on };
  if (capabilities.brightness && !capabilities.plug) {
    state.brightness = record.level;
  }
  if (record.colorMode !== null && record.colorMode !== undefined) {
    if (capabilities.colorTemperature && record.colorMode >= 1 && record.colorMode <= 100) {
      state.colorTemperature = record.colorMode;
      state.rgb = null;
    } else if (capabilities.rgb && record.colorMode === COLOR_MODE_RGB && record.rgb) {
      state.rgb = record.rgb;
      state.colorTemperature = null;
    }
  }
  return state;
}

function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
