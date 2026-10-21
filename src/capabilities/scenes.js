// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// Triggers ("this happened"), fired with `gladys.publishSceneEvent` by
// src/app.js when the service reports the event:
//   - motion_detected      a Cync motion sensor saw motion (one event per
//                          detection, not per frame);
//   - device_connectivity  a Cync device dropped off the mesh or came back.
//
// Actions ("do this, with these parameters"), registered per key with
// `gladys.onSceneAction`:
//   - set_light            power, brightness and white in ONE order;
//   - refresh_states       read every state now.
//
// A scene action is never a condition: a light that cannot be reached is an
// output (`applied: false`), not a failure, and the scene author gates on it.
// Keys are stored in the users' scenes: never rename them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { findEntity, fromKelvin } from '../devices/index.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_TRIGGERS = {
  MOTION_DETECTED: 'motion_detected',
  DEVICE_CONNECTIVITY: 'device_connectivity',
};

/** The `status` values of the device_connectivity trigger. */
export const CONNECTIVITY = { ONLINE: 'online', OFFLINE: 'offline' };

export const SCENE_ACTIONS = {
  async set_light(gladys, { fields, service }) {
    const entity = findEntity(gladys, service.listEntities(), fields.device);
    if (!entity || entity.kind === 'sensor') {
      logger.warn(`set_light: ${fields.device} is not a Cync light`);
      return { applied: false };
    }
    const order = { on: fields.power !== 'off' };
    if (order.on) {
      const brightness = Number(fields.brightness);
      if (fields.brightness !== undefined && fields.brightness !== null && brightness > 0) {
        order.brightness = Math.min(100, Math.round(brightness));
      }
      const kelvin = Number(fields.temperature);
      if (entity.capabilities.colorTemperature && kelvin > 0) {
        order.colorTemperature = fromKelvin(kelvin);
      }
      if (!entity.capabilities.brightness) {
        delete order.brightness;
      }
    }
    try {
      service.control(entity.key, order);
      return { applied: true };
    } catch (err) {
      logger.warn(`set_light on "${entity.name}" failed: ${err.message}`);
      return { applied: false };
    }
  },

  async refresh_states(_gladys, { service }) {
    await service.refreshStates({ wait: true });
    const { devices, online } = service.summary();
    return { online, total: devices };
  },
};

/** The `publishSceneEvent` payload of a motion detection. */
export function motionEvent(deviceExternalId) {
  return { device: deviceExternalId };
}

/** The `publishSceneEvent` payload of a connectivity change. */
export function connectivityEvent(deviceExternalId, online) {
  return {
    device: deviceExternalId,
    status: online ? CONNECTIVITY.ONLINE : CONNECTIVITY.OFFLINE,
  };
}
