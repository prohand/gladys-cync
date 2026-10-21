// -----------------------------------------------------------------------------
// The Cync cloud REST API (api.gelighting.com): sign-in, two-step
// verification, token refresh, and the description of the homes.
//
// Sign-in happens in two steps for most accounts: the password alone is
// refused (HTTP 400) until a code, sent by email, comes with it. The answer
// then carries the tokens of the REST API and the `authorize` string the TCP
// session logs in with (see connection.js).
//
// No secret is ever logged: neither the password, nor the code, nor a token.
// -----------------------------------------------------------------------------

export const API_BASE_URL = 'https://api.gelighting.com';

// The application id of the Cync app, which every sign-in request names.
const CORP_ID = '1007d2ad150c4000';

const REQUEST_TIMEOUT_MS = 20_000;

export class CyncApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CyncApiError';
    this.status = status;
  }
}

/**
 * A session, as the integration keeps it between restarts (see session.js).
 * @typedef {object} CyncSession
 * @property {string} email account it belongs to
 * @property {number} userId
 * @property {string} authorize TCP login secret
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} expiresAt epoch ms
 */

export class CyncApi {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] injected in the tests
   * @param {string} [options.baseUrl]
   * @param {() => number} [options.now]
   */
  constructor({
    fetch: fetchImpl = globalThis.fetch,
    baseUrl = API_BASE_URL,
    now = Date.now,
  } = {}) {
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
    this.now = now;
  }

  /**
   * Sign in with the password alone.
   * @returns {Promise<{ session: CyncSession } | { twoFactor: true }>}
   */
  async signIn(email, password) {
    try {
      const body = await this.#request('POST', '/v2/user_auth', {
        json: { corp_id: CORP_ID, email, password },
      });
      return { session: this.#session(email, body) };
    } catch (err) {
      // The cloud answers 400 both for "a code is needed" and for a wrong
      // password; only the code step can tell them apart.
      if (err instanceof CyncApiError && err.status === 400) {
        return { twoFactor: true };
      }
      throw err;
    }
  }

  /** Ask the cloud to email a verification code. */
  async requestCode(email) {
    await this.#request('POST', '/v2/two_factor/email/verifycode', {
      json: { corp_id: CORP_ID, email, local_lang: 'en-us' },
      expectJson: false,
    });
  }

  /** Sign in with the password and the emailed code. */
  async verifyCode(email, password, code) {
    const body = await this.#request('POST', '/v2/user_auth/two_factor', {
      json: {
        corp_id: CORP_ID,
        email,
        password,
        two_factor: String(code).trim(),
        resource: 'abcdefghijklmnop',
      },
    });
    return this.#session(email, body);
  }

  /** New tokens from the refresh token; the TCP `authorize` does not change. */
  async refresh(session) {
    const body = await this.#request('POST', '/v2/user/token/refresh', {
      json: { refresh_token: session.refreshToken },
    });
    return {
      ...session,
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? session.refreshToken,
      expiresAt: this.now() + Number(body.expire_in ?? 0) * 1000,
    };
  }

  /** The homes and Wi-Fi devices of the account. */
  async subscribedDevices(session) {
    const body = await this.#request('GET', `/v2/user/${session.userId}/subscribe/devices`, {
      token: session.accessToken,
    });
    return Array.isArray(body) ? body : [];
  }

  /** The mesh devices (`bulbsArray`) and rooms (`groupsArray`) of a home. */
  async homeProperties(session, home) {
    return this.#request('GET', `/v2/product/${home.product_id}/device/${home.id}/property`, {
      token: session.accessToken,
    });
  }

  #session(email, body) {
    if (!body?.access_token || !body?.authorize || !Number.isInteger(body?.user_id)) {
      throw new CyncApiError(0, 'Unexpected sign-in answer from the Cync cloud');
    }
    return {
      email,
      userId: body.user_id,
      authorize: body.authorize,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: this.now() + Number(body.expire_in ?? 0) * 1000,
    };
  }

  async #request(method, path, { json, token, expectJson = true } = {}) {
    const headers = {};
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) {
      headers['Access-Token'] = token;
    }
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // The path only: never the body, which can carry the password.
      throw new CyncApiError(0, `Cync cloud unreachable (${method} ${path}): ${err.message}`);
    }
    if (!response.ok) {
      throw new CyncApiError(response.status, `Cync cloud answered ${response.status} to ${path}`);
    }
    if (!expectJson) {
      return null;
    }
    try {
      return await response.json();
    } catch {
      throw new CyncApiError(response.status, `Cync cloud sent an unreadable answer to ${path}`);
    }
  }
}
