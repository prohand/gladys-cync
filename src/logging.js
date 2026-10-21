// -----------------------------------------------------------------------------
// The log level, switchable from the Configuration screen.
//
// A light that ignores Gladys is either not heard by the Cync cloud, without a
// Wi-Fi relay, or answered with a frame this integration does not decode: only
// the debug channel tells those apart. The SDK logger re-reads
// `process.env.LOG_LEVEL` on every line, so writing that variable takes effect
// at once, for every logger already created — no restart.
//
// The operator who set `LOG_LEVEL` on the container keeps it: their value is
// the baseline, captured once, and the switch only raises it to debug while it
// is on.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'logging' });

const BASELINE = process.env.LOG_LEVEL;

/**
 * Apply the log level a configuration asks for.
 * @param {{ debug_logs?: boolean }} config normalized configuration
 * @returns {string} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config?.debug_logs ? 'debug' : BASELINE;
  const current = process.env.LOG_LEVEL;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
  if (current !== process.env.LOG_LEVEL) {
    logger.info(
      config?.debug_logs
        ? 'Detailed logs turned on: every Cync frame is logged'
        : `Detailed logs turned off (level: ${process.env.LOG_LEVEL ?? 'info'})`,
    );
  }
  return process.env.LOG_LEVEL ?? 'info';
}
