import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CyncConnection } from '../src/cync/connection.js';
import { PING_FRAME } from '../src/cync/protocol.js';
import { ManualTimers } from './helpers/fakes.js';

const LOGIN = Buffer.from('13000000010300', 'hex');
const LOGIN_ACK = Buffer.from('18000000020000', 'hex');

class FakeSocket extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.written = [];
    this.destroyed = false;
  }

  write(frame) {
    this.written.push(frame);
  }

  destroy() {
    this.destroyed = true;
  }
}

function setup() {
  const sockets = [];
  const timers = new ManualTimers();
  const connection = new CyncConnection({
    timers,
    connect: (options) => {
      const socket = new FakeSocket(options);
      sockets.push(socket);
      return socket;
    },
  });
  return { connection, sockets, timers };
}

test('logs in, then pings and relays the decoded messages', () => {
  const { connection, sockets, timers } = setup();
  const events = [];
  connection.on('ready', () => events.push('ready'));
  connection.on('message', (message) => events.push(message.kind));

  connection.start(LOGIN);
  const [socket] = sockets;
  assert.equal(socket.options.strict, true, 'strict TLS first');
  socket.emit('secureConnect');
  assert.deepEqual(socket.written, [LOGIN]);
  assert.equal(connection.ready, false);

  // The ack and a probe answer in one chunk, the probe cut in two.
  const probe = Buffer.from('ab0000000700005ba0000100', 'hex');
  socket.emit('data', Buffer.concat([LOGIN_ACK, probe.subarray(0, 4)]));
  assert.equal(connection.ready, true);
  socket.emit('data', probe.subarray(4));
  assert.deepEqual(events, ['ready', 'login', 'probe']);

  timers.runAll();
  assert.deepEqual(socket.written.at(-1), PING_FRAME);
});

test('an expired server certificate falls back to relaxed TLS', () => {
  const { connection, sockets } = setup();
  connection.start(LOGIN);
  const error = Object.assign(new Error('certificate has expired'), {
    code: 'CERT_HAS_EXPIRED',
  });
  sockets[0].emit('error', error);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].options.strict, false);
  assert.equal(connection.strictTls, false);
});

test('a lost session reconnects after a delay, and says it went down', () => {
  const { connection, sockets, timers } = setup();
  let downs = 0;
  connection.on('down', () => (downs += 1));
  connection.start(LOGIN);
  sockets[0].emit('secureConnect');
  sockets[0].emit('data', LOGIN_ACK);
  sockets[0].emit('close');
  assert.equal(downs, 1);
  assert.equal(connection.ready, false);
  assert.equal(sockets.length, 1, 'not at once');
  timers.runAll();
  assert.equal(sockets.length, 2);
});

test('sending without a session throws', () => {
  const { connection } = setup();
  assert.throws(() => connection.send(PING_FRAME), /not open/);
});

test('three unanswered logins in a row ask for a new sign-in', () => {
  const { connection, sockets, timers } = setup();
  let authFailed = false;
  connection.on('auth-failed', () => (authFailed = true));
  connection.start(LOGIN);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sockets.at(-1).emit('secureConnect');
    timers.runAll(); // login timeout
    timers.runAll(); // reconnection delay
  }
  assert.equal(authFailed, true);
  assert.equal(connection.state, 'stopped');
});

test('stop closes politely and for good', () => {
  const { connection, sockets, timers } = setup();
  connection.start(LOGIN);
  sockets[0].emit('secureConnect');
  sockets[0].emit('data', LOGIN_ACK);
  connection.stop();
  assert.equal(sockets[0].written.at(-1).toString('hex'), 'e30000000103');
  assert.equal(sockets[0].destroyed, true);
  assert.equal(timers.pending.size, 0);
});
