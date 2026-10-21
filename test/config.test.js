import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';

test('defaults fill what the user left empty', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('the email is one account whatever its case and spaces', () => {
  assert.equal(normalizeConfig({ email: '  Jane@Example.COM ' }).email, 'jane@example.com');
});

test('the refresh interval is a number within its bounds', () => {
  assert.equal(normalizeConfig({ state_refresh: '120' }).state_refresh, 120);
  assert.equal(normalizeConfig({ state_refresh: 5 }).state_refresh, 60);
  assert.equal(normalizeConfig({ state_refresh: 99999 }).state_refresh, 3600);
  assert.equal(normalizeConfig({ state_refresh: 'abc' }).state_refresh, 300);
});

test('booleans: rooms on unless turned off, debug off unless turned on', () => {
  assert.equal(normalizeConfig({ include_rooms: undefined }).include_rooms, true);
  assert.equal(normalizeConfig({ include_rooms: false }).include_rooms, false);
  assert.equal(normalizeConfig({ debug_logs: 'yes' }).debug_logs, false);
  assert.equal(normalizeConfig({ debug_logs: true }).debug_logs, true);
});

test('credentials need both fields', () => {
  assert.equal(hasCredentials(normalizeConfig({ email: 'a@b.c' })), false);
  assert.equal(hasCredentials(normalizeConfig({ email: 'a@b.c', password: 'x' })), true);
});
