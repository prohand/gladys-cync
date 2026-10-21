// -----------------------------------------------------------------------------
// The TCP session with the Cync cloud (cm-sec.gelighting.com:23779, TLS).
//
// It carries both directions: our orders to the lights, and the states the
// lights push as they change — a light switched from the Cync app or a wall
// switch shows up in Gladys within a second, without polling.
//
// The life of the session:
//   1. connect, send LOGIN with the `authorize` of the REST sign-in;
//   2. the server acknowledges; from then on, ping every 20 s;
//   3. when the socket drops, reconnect with a growing delay (5 s to 2 min).
// Three refused logins in a row mean the `authorize` itself is stale: the
// connection stops and says so (`auth-failed`), the service signs in again.
//
// The certificate: the Cync server has long presented an expired certificate
// whose name does not match. Strict verification is tried first, every time;
// when it fails, the session goes on with relaxed verification — the only way
// the Cync app itself still connects — and says so in the logs.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import { createLogger } from '@gladysassistant/integration-sdk';
import { DISCONNECT_FRAME, PING_FRAME, decodeFrame, splitFrames } from './protocol.js';

export const CYNC_HOST = 'cm-sec.gelighting.com';
export const CYNC_PORT = 23779;

const PING_INTERVAL_MS = 20_000;
const LOGIN_TIMEOUT_MS = 15_000;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 120_000;
const MAX_LOGIN_FAILURES = 3;

const logger = createLogger({ name: 'cync-tcp' });

function defaultConnect({ host, port, strict }) {
  return tls.connect({ host, port, servername: host, rejectUnauthorized: strict });
}

/**
 * Events:
 *   - `ready`        logged in, orders can be sent;
 *   - `message` (m)  a decoded frame (see protocol.js decodeFrame);
 *   - `down`         the session is lost (a reconnection is scheduled);
 *   - `auth-failed`  the server keeps refusing the login: sign in again.
 */
export class CyncConnection extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {Function} [options.connect] socket factory, injected in the tests
   * @param {object} [options.timers] `{ setTimeout, clearTimeout, setInterval, clearInterval }`
   */
  constructor({ connect = defaultConnect, host = CYNC_HOST, port = CYNC_PORT, timers } = {}) {
    super();
    this.connectSocket = connect;
    this.host = host;
    this.port = port;
    this.timers = timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
    this.socket = null;
    this.state = 'stopped'; // stopped | connecting | ready | waiting
    this.loginFrame = null;
    this.buffer = Buffer.alloc(0);
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.loginFailures = 0;
    this.strictTls = true;
    this.relaxedTlsWarned = false;
    this.pingTimer = null;
    this.loginTimer = null;
    this.reconnectTimer = null;
  }

  get ready() {
    return this.state === 'ready';
  }

  /** Open the session with the LOGIN frame (see FrameBuilder.login). */
  start(loginFrame) {
    this.stop();
    this.loginFrame = loginFrame;
    this.loginFailures = 0;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.strictTls = true;
    this.#open();
  }

  /** Close the session for good (no reconnection). */
  stop() {
    this.#clearTimers();
    const wasOpen = this.socket !== null;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.removeAllListeners();
      // A late error of a socket being closed must not crash the process.
      socket.on('error', () => {});
      if (this.state === 'ready') {
        try {
          socket.write(DISCONNECT_FRAME);
        } catch {
          // Closing anyway.
        }
      }
      socket.destroy();
    }
    this.state = 'stopped';
    this.buffer = Buffer.alloc(0);
    if (wasOpen) {
      this.emit('down');
    }
  }

  /** Send a frame. Throws when the session is not logged in. */
  send(frame) {
    if (!this.ready || !this.socket) {
      throw new Error('The Cync cloud session is not open');
    }
    logger.debug(`-> ${frame.toString('hex')}`);
    this.socket.write(frame);
  }

  #open() {
    this.state = 'connecting';
    this.buffer = Buffer.alloc(0);
    const strict = this.strictTls;
    let socket;
    try {
      socket = this.connectSocket({ host: this.host, port: this.port, strict });
    } catch (err) {
      logger.warn(`Cannot open the Cync session: ${err.message}`);
      this.#scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.setNoDelay?.(true);

    socket.on('secureConnect', () => {
      if (!strict && !this.relaxedTlsWarned) {
        this.relaxedTlsWarned = true;
        logger.warn(
          'The Cync server certificate does not verify (expired or for another name): ' +
            'connected with relaxed TLS verification, as the Cync app does',
        );
      }
      this.#login();
    });
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('error', (err) => {
      if (strict && isCertificateError(err)) {
        // Retried at once without strict verification (see the header).
        this.strictTls = false;
        logger.debug(`Strict TLS refused (${err.code}), retrying with relaxed verification`);
        this.#drop({ immediate: true });
        return;
      }
      logger.warn(`Cync session error: ${err.message}`);
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.#drop();
      }
    });
  }

  #login() {
    this.socket.write(this.loginFrame);
    this.loginTimer = this.timers.setTimeout(() => {
      this.loginTimer = null;
      logger.warn('The Cync cloud did not answer the login');
      this.#loginRefused();
    }, LOGIN_TIMEOUT_MS);
  }

  #loginRefused() {
    this.loginFailures += 1;
    if (this.loginFailures >= MAX_LOGIN_FAILURES) {
      this.stop();
      this.emit('auth-failed');
      return;
    }
    this.#drop();
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { frames, rest } = splitFrames(this.buffer);
    this.buffer = Buffer.from(rest);
    for (const frame of frames) {
      logger.debug(`<- ${frame.toString('hex')}`);
      const message = decodeFrame(frame);
      if (message.kind === 'login') {
        this.#onLogin();
      } else if (message.kind === 'disconnect') {
        logger.info('The Cync cloud closed the session');
        if (this.state === 'connecting') {
          this.#loginRefused();
          return;
        }
        this.#drop();
        return;
      }
      this.emit('message', message);
    }
  }

  #onLogin() {
    if (this.state === 'ready') {
      return;
    }
    this.timers.clearTimeout(this.loginTimer);
    this.loginTimer = null;
    this.state = 'ready';
    this.loginFailures = 0;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.pingTimer = this.timers.setInterval(() => {
      try {
        this.send(PING_FRAME);
      } catch {
        // The drop handler reconnects.
      }
    }, PING_INTERVAL_MS);
    logger.info('Connected to the Cync cloud');
    this.emit('ready');
  }

  #drop({ immediate = false } = {}) {
    const wasReady = this.state === 'ready';
    this.#clearTimers();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.destroy();
    }
    if (wasReady) {
      logger.warn('Lost the Cync cloud session');
      this.emit('down');
    }
    if (immediate) {
      this.#open();
    } else {
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect() {
    this.state = 'waiting';
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    logger.debug(`Reconnecting to the Cync cloud in ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.strictTls = true;
      this.#open();
    }, delay);
  }

  #clearTimers() {
    this.timers.clearInterval(this.pingTimer);
    this.timers.clearTimeout(this.loginTimer);
    this.timers.clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.loginTimer = null;
    this.reconnectTimer = null;
  }
}

function isCertificateError(err) {
  return (
    typeof err?.code === 'string' &&
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS_CERT_ALTNAME_INVALID/.test(err.code)
  );
}
