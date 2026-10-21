import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/cync/session.js';
import { SESSION } from './helpers/fakes.js';

test('saves the session readable by its owner only, and loads it back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cync-'));
  const store = new SessionStore(join(dir, 'nested'));
  assert.equal(await store.load(), null);
  await store.save(SESSION);
  assert.deepEqual(await store.load(), SESSION);
  const { mode } = await stat(store.file);
  assert.equal(mode & 0o777, 0o600);
  await store.clear();
  assert.equal(await store.load(), null);
});

test('an unreadable or incomplete file is no session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cync-'));
  const store = new SessionStore(dir);
  await writeFile(store.file, '{ broken');
  assert.equal(await store.load(), null);
  await writeFile(store.file, JSON.stringify({ email: 'a@b.c' }));
  assert.equal(await store.load(), null);
});
