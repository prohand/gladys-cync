// -----------------------------------------------------------------------------
// The signed-in session, kept in /data between restarts.
//
// The two-step sign-in sends an email: doing it again at every container start
// would bury the user in codes. The tokens are therefore written to the one
// writable volume, readable by the container user only, and reused until the
// cloud refuses them.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The writable volume of the container; overridable for the tests. */
export const DATA_DIR = process.env.CYNC_DATA_DIR || '/data';

const FILE_NAME = 'cync-session.json';

export class SessionStore {
  constructor(dir = DATA_DIR) {
    this.file = join(dir, FILE_NAME);
    this.dir = dir;
  }

  /** The saved session, or `null` when there is none or it is unreadable. */
  async load() {
    try {
      const session = JSON.parse(await readFile(this.file, 'utf8'));
      return isSession(session) ? session : null;
    } catch {
      return null;
    }
  }

  async save(session) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify(session), { mode: 0o600 });
  }

  async clear() {
    await rm(this.file, { force: true });
  }
}

function isSession(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.email === 'string' &&
    Number.isInteger(value.userId) &&
    typeof value.authorize === 'string' &&
    typeof value.accessToken === 'string' &&
    typeof value.refreshToken === 'string' &&
    Number.isFinite(value.expiresAt)
  );
}
