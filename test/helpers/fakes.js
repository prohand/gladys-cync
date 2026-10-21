// -----------------------------------------------------------------------------
// Stand-ins for the three channels of the service (REST API, TCP session,
// session file) and for the timers: no network, no disk, no waiting.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { CyncApiError } from '../../src/cync/api.js';
import { HOME, PROPERTIES, SUBSCRIBED } from './fixtures.js';

export const SESSION = {
  email: 'jane@example.com',
  userId: 123456,
  authorize: 'auth-string',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.UTC(2030, 0, 1),
};

/** The REST API, answering from the fixtures. */
export class FakeApi {
  constructor({ twoFactor = false, session = SESSION } = {}) {
    this.twoFactor = twoFactor;
    this.session = session;
    this.calls = [];
    this.subscribed = SUBSCRIBED;
    this.properties = new Map([[HOME.id, PROPERTIES]]);
  }

  async signIn(email, password) {
    this.calls.push(['signIn', email, password]);
    return this.twoFactor ? { twoFactor: true } : { session: { ...this.session, email } };
  }

  async requestCode(email) {
    this.calls.push(['requestCode', email]);
  }

  async verifyCode(email, _password, code) {
    this.calls.push(['verifyCode', email, code]);
    if (code !== '123456') {
      throw new CyncApiError(400, 'Cync cloud answered 400 to /v2/user_auth/two_factor');
    }
    return { ...this.session, email };
  }

  async refresh(session) {
    this.calls.push(['refresh']);
    return { ...session, accessToken: 'access-2', expiresAt: Date.UTC(2031, 0, 1) };
  }

  async subscribedDevices() {
    this.calls.push(['subscribedDevices']);
    return this.subscribed;
  }

  async homeProperties(_session, home) {
    this.calls.push(['homeProperties', home.id]);
    return this.properties.get(home.id);
  }
}

/** The session file, in memory. */
export class MemoryStore {
  constructor(session = null) {
    this.session = session;
  }

  async load() {
    return this.session;
  }

  async save(session) {
    this.session = session;
  }

  async clear() {
    this.session = null;
  }
}

/** The TCP session: records what is sent, the test plays the server. */
export class FakeConnection extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.strictTls = true;
    this.sent = [];
    this.loginFrame = null;
    this.starts = 0;
  }

  start(loginFrame) {
    this.loginFrame = loginFrame;
    this.starts += 1;
  }

  stop() {
    const wasReady = this.ready;
    this.ready = false;
    if (wasReady) {
      this.emit('down');
    }
  }

  send(frame) {
    if (!this.ready) {
      throw new Error('The Cync cloud session is not open');
    }
    this.sent.push(frame);
  }

  /** The server accepted the login. */
  open() {
    this.ready = true;
    this.emit('ready');
  }

  /** The server pushed a decoded message. */
  push(message) {
    this.emit('message', message);
  }
}

/** Timers that only fire when the test says so. */
export class ManualTimers {
  constructor() {
    this.pending = new Map();
    this.next = 1;
  }

  setTimeout = (fn, ms) => {
    const id = this.next++;
    this.pending.set(id, { fn, ms, repeat: false });
    return id;
  };

  setInterval = (fn, ms) => {
    const id = this.next++;
    this.pending.set(id, { fn, ms, repeat: true });
    return id;
  };

  clearTimeout = (id) => {
    this.pending.delete(id);
  };

  clearInterval = (id) => {
    this.pending.delete(id);
  };

  /** Run every timer (once), the intervals staying armed. */
  runAll() {
    for (const [id, timer] of [...this.pending]) {
      if (!timer.repeat) {
        this.pending.delete(id);
      }
      timer.fn();
    }
  }

  /** How many timers of this delay are armed. */
  count(ms) {
    return [...this.pending.values()].filter((timer) => timer.ms === ms).length;
  }
}

/** Let the fire-and-forget publications of src/app.js finish. */
export async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
