// -----------------------------------------------------------------------------
// The Gladys side: every SDK handler, and the translation of the service
// events (src/cync/service.js) into Gladys devices, states, transports, scene
// events and widget nudges.
//
// `registerHandlers` takes the Gladys client and the service, so the tests run
// it against the SDK's fake Gladys and a service with fake channels.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { normalizeConfig, hasCredentials } from './config.js';
import { applyLogLevel } from './logging.js';
import { CyncApiError } from './cync/api.js';
import { CyncService, STATUS } from './cync/service.js';
import {
  buildDiscoveredDevices,
  idsOf,
  orderFor,
  resolveFeature,
  statesOf,
} from './devices/index.js';
import {
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  connectivityEvent,
  motionEvent,
} from './capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './capabilities/widgets.js';
import { localize, pick } from './i18n.js';
import { MESSAGES, STATUS_LABELS, connectionStatus } from './messages.js';

const logger = createLogger({ name: 'app' });

/** A value that did not change is re-sent this often, to stay recently dated. */
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * Register every handler on `gladys`. Call before `gladys.connect()`.
 * @returns {{ service: CyncService, getConfig: () => object }}
 */
export function registerHandlers(gladys, { service = new CyncService() } = {}) {
  let config = normalizeConfig();
  // The configuration the service runs with: a Gladys reconnection with the
  // same configuration must not restart the Cync session.
  let runningWith = null;

  const run = (label, task) =>
    Promise.resolve()
      .then(task)
      .catch((err) => logger.error(`${label} failed: ${err.message}`));

  // --- Service -> Gladys -----------------------------------------------------

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, service.listEntities()));
  }

  async function publishStates(entities = service.listEntities()) {
    const states = entities.flatMap((entity) =>
      statesOf(gladys, entity, service.getState(entity.key)),
    );
    if (states.length === 0) {
      return;
    }
    try {
      await gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    } catch (err) {
      // A device still in the Discovery tab has no feature to receive it.
      logger.debug(`States not published: ${err.message}`);
    }
  }

  async function publishTransports() {
    const entities = service.listEntities();
    if (entities.length === 0) {
      return;
    }
    const connected = service.status.code === STATUS.CONNECTED;
    await gladys.publishTransports(
      entities.map((entity) => ({
        external_id: idsOf(gladys, entity).device,
        // The cloud is the only way to these devices: a device the mesh no
        // longer hears, or every device while the session is down, is
        // unreachable.
        transport:
          connected && service.getState(entity.key)?.online
            ? DEVICE_TRANSPORTS.CLOUD
            : DEVICE_TRANSPORTS.UNREACHABLE,
      })),
    );
  }

  async function reportStatus() {
    const { connected, message } = connectionStatus(service.status);
    await gladys.setConnectionStatus(connected, message);
  }

  service.on('status', () =>
    run('Status report', async () => {
      await reportStatus();
      await publishTransports();
      refreshWidgets(gladys);
    }),
  );

  service.on('entities', () =>
    run('Device publication', async () => {
      await publishDevices();
      await publishTransports();
      await publishStates();
      refreshWidgets(gladys);
    }),
  );

  service.on('state', (entity) => run('State publication', () => publishStates([entity])));

  service.on('motion', (entity) =>
    run('Motion event', () =>
      gladys.publishSceneEvent(
        SCENE_TRIGGERS.MOTION_DETECTED,
        motionEvent(idsOf(gladys, entity).device),
      ),
    ),
  );

  service.on('connectivity', (entity, online) =>
    run('Connectivity event', async () => {
      await gladys.publishSceneEvent(
        SCENE_TRIGGERS.DEVICE_CONNECTIVITY,
        connectivityEvent(idsOf(gladys, entity).device, online),
      );
      await publishTransports();
      refreshWidgets(gladys);
    }),
  );

  // --- Gladys -> service -----------------------------------------------------

  async function applyConfig(raw) {
    config = normalizeConfig(raw);
    applyLogLevel(config);
    const signature = JSON.stringify(config);
    if (signature === runningWith && service.status.code !== STATUS.NOT_CONFIGURED) {
      // Same configuration: only re-sync Gladys with what the service holds.
      await reportStatus();
      if (service.listEntities().length > 0) {
        await publishDevices();
        await publishTransports();
        await publishStates();
      }
      refreshWidgets(gladys);
      return;
    }
    runningWith = signature;
    await service.start(config);
    // A status unchanged by the restart emits nothing: say it anyway.
    await reportStatus();
    refreshWidgets(gladys);
  }

  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> reloading the Cync homes');
    if (service.session) {
      await service.reload();
    } else {
      await publishDevices();
    }
  });

  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    const target = resolveFeature(
      gladys,
      service.listEntities(),
      device.external_id,
      feature.external_id,
    );
    if (!target) {
      throw new Error(`Unknown Cync feature: ${feature.external_id}`);
    }
    // Throwing acks the order as failed: Gladys shows the message.
    service.control(target.entity.key, orderFor(target.featureKey, value));
  });

  // --- Manifest actions (Configuration screen) -------------------------------

  gladys.onAction('send_code', async () => {
    if (!hasCredentials(config)) {
      return MESSAGES.needCredentials;
    }
    await service.sendCode();
    return MESSAGES.codeSent(config.email);
  });

  gladys.onAction('verify_code', async (fields) => {
    if (!hasCredentials(config)) {
      return MESSAGES.needCredentials;
    }
    try {
      await service.verifyCode(fields.code);
    } catch (err) {
      if (err instanceof CyncApiError && err.status >= 400 && err.status < 500) {
        return MESSAGES.codeRefused;
      }
      throw err;
    }
    runningWith = JSON.stringify(config);
    return MESSAGES.signedIn(service.listEntities().length);
  });

  gladys.onAction('test_connection', async () => {
    if (service.status.code === STATUS.CONNECTED) {
      await service.refreshStates({ wait: true });
    }
    return connectionReport(service);
  });

  gladys.onAction('refresh_devices', async () => {
    if (!service.session) {
      return connectionReport(service);
    }
    await service.reload();
    return MESSAGES.reloaded(service.listEntities().length);
  });

  // --- Scene actions and widgets (Gladys 5.1+) -------------------------------

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(gladys, { fields, service }));
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, service }));
    if (typeof widget.action === 'function') {
      gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
        widget.action(gladys, { actionKey, params, settings, service }),
      );
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  gladys.onConfigUpdated(async (raw) => {
    logger.info('onConfigUpdated -> new configuration received');
    await applyConfig(raw);
  });

  gladys.on('connected', async () => {
    try {
      await applyConfig(await gladys.getConfig());
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: 'L’initialisation a échoué, consultez les logs de l’intégration.',
          de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Logs der Integration nach.',
          es: 'La inicialización ha fallado, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    service.stop();
  });

  return { service, getConfig: () => config };
}

/** The answer of "Test the connection". */
export function connectionReport(service) {
  const summary = service.summary();
  const status = STATUS_LABELS[summary.status.code];
  const relays = summary.homes.filter((home) => home.relay).length;
  return localize((language) => {
    const parts = [pick(language, status)];
    if (summary.status.code === STATUS.CONNECTED) {
      parts.push(
        pick(language, {
          en: `${summary.online}/${summary.devices} device(s) online, ${relays}/${summary.homes.length} home(s) with a Wi-Fi relay`,
          fr: `${summary.online}/${summary.devices} appareil(s) en ligne, ${relays}/${summary.homes.length} maison(s) avec un relais Wi-Fi`,
          de: `${summary.online}/${summary.devices} Gerät(e) online, ${relays}/${summary.homes.length} Zuhause mit WLAN-Relais`,
          es: `${summary.online}/${summary.devices} dispositivo(s) en línea, ${relays}/${summary.homes.length} hogar(es) con relé Wi-Fi`,
        }),
      );
    } else {
      const { message } = connectionStatus(summary.status);
      if (message) {
        parts.push(pick(language, message));
      }
    }
    return parts.join(' — ');
  });
}
