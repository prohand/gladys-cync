// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module only provides the defaults
// and normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

/** Bounds of the state refresh interval, in seconds (see the manifest). */
export const STATE_REFRESH_MIN = 60;
export const STATE_REFRESH_MAX = 3600;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // Seconds between two full state reads. The Cync cloud pushes every change
  // as it happens: this read only catches what a push missed (a device that
  // went offline says nothing).
  state_refresh: 300,
  // Publish the rooms and groups of the Cync app as Gladys lights: one mesh
  // order switches the whole room at once, where one order per bulb ripples.
  include_rooms: true,
  debug_logs: false,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const refresh = Number(raw.state_refresh ?? DEFAULT_CONFIG.state_refresh);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // The account is the email the Cync app signs in with: case and stray
    // spaces from a paste must not make it a different account.
    email: String(raw.email ?? '')
      .trim()
      .toLowerCase(),
    password: String(raw.password ?? ''),
    state_refresh: Number.isFinite(refresh)
      ? Math.min(STATE_REFRESH_MAX, Math.max(STATE_REFRESH_MIN, Math.round(refresh)))
      : DEFAULT_CONFIG.state_refresh,
    include_rooms: raw.include_rooms !== false,
    debug_logs: raw.debug_logs === true,
  };
}

/** True when the account fields are filled in. */
export function hasCredentials(config) {
  return Boolean(config.email && config.password);
}
