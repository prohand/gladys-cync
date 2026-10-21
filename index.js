// -----------------------------------------------------------------------------
// Entry point of the Cync external integration for Gladys Assistant.
//
// Instantiates the SDK, registers the handlers (src/app.js) BEFORE connecting,
// then connects. The SDK reads the environment the Gladys supervisor injects
// (GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR)
// and handles the WebSocket, its authentication and its reconnections.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();

registerHandlers(gladys);

logger.info('Starting the Cync integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
