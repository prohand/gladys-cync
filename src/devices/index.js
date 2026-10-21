// -----------------------------------------------------------------------------
// Cync devices as Gladys sees them.
//
// One entity of the service (a device or a room, see src/cync/catalog.js)
// becomes one Gladys device. Its features follow its capabilities:
//
//   kind     features
//   light    power, brightness, temperature (white), color — as supported
//   room     the same, limited to what ALL its lights support
//   plug     power
//   fan      power, speed (the Cync fan controller dims its motor)
//   sensor   motion (a switch with a motion sensor is a light AND a sensor)
//
// External ids are built from the entity key — home id and mesh address —
// never from a name: renaming a bulb in the Cync app must not create a new
// Gladys device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

/** Feature keys: stored by Gladys, never rename them. */
export const FEATURES = {
  POWER: 'power',
  BRIGHTNESS: 'brightness',
  TEMPERATURE: 'temperature',
  COLOR: 'color',
  SPEED: 'speed',
  MOTION: 'motion',
};

/** White range of the Cync lights, in kelvin: 1 is 2000 K, 100 is 7000 K. */
export const KELVIN_MIN = 2000;
export const KELVIN_MAX = 7000;
const KELVIN_STEP = (KELVIN_MAX - KELVIN_MIN) / 100;

const ENTITY_TYPE = { room: 'room' };

/** The external ids of an entity. */
export function idsOf(gladys, entity) {
  return gladys.externalIds(ENTITY_TYPE[entity.kind] ?? 'device', entity.key);
}

/** The discovery payload of every entity. */
export function buildDiscoveredDevices(gladys, entities) {
  return entities.map((entity) => buildDevice(gladys, entity));
}

/** The discovery payload of one entity. */
export function buildDevice(gladys, entity) {
  const ids = idsOf(gladys, entity);
  return {
    name: entity.name,
    external_id: ids.device,
    features: featuresOf(entity).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

function featuresOf(entity) {
  const { capabilities, kind } = entity;
  const features = [];
  const control = { read_only: false, has_feedback: false, keep_history: true };
  if (kind === 'light' || kind === 'room') {
    features.push({
      key: FEATURES.POWER,
      name: 'Power',
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.BINARY,
      min: 0,
      max: 1,
      ...control,
    });
    if (capabilities.brightness) {
      features.push({
        key: FEATURES.BRIGHTNESS,
        name: 'Brightness',
        category: CATEGORIES.LIGHT,
        type: TYPES.LIGHT.BRIGHTNESS,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        ...control,
      });
    }
    if (capabilities.colorTemperature) {
      features.push({
        key: FEATURES.TEMPERATURE,
        name: 'White temperature',
        category: CATEGORIES.LIGHT,
        type: TYPES.LIGHT.TEMPERATURE,
        unit: UNITS.KELVIN,
        min: KELVIN_MIN,
        max: KELVIN_MAX,
        ...control,
      });
    }
    if (capabilities.rgb) {
      features.push({
        key: FEATURES.COLOR,
        name: 'Color',
        category: CATEGORIES.LIGHT,
        type: TYPES.LIGHT.COLOR,
        min: 0,
        max: 0xffffff,
        ...control,
      });
    }
  }
  if (kind === 'plug' || kind === 'fan') {
    features.push({
      key: FEATURES.POWER,
      name: 'Power',
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      ...control,
    });
  }
  if (kind === 'fan' && capabilities.brightness) {
    features.push({
      key: FEATURES.SPEED,
      name: 'Speed',
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.DIMMER,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      ...control,
    });
  }
  if (capabilities.motion) {
    features.push({
      key: FEATURES.MOTION,
      name: 'Motion',
      category: CATEGORIES.MOTION_SENSOR,
      type: TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }
  return features;
}

/** The feature keys an entity publishes. */
export function featureKeysOf(entity) {
  return featuresOf(entity).map((feature) => feature.key);
}

/**
 * The Gladys states of an entity, from its service state. Only the values the
 * state knows: a light never read yet publishes nothing.
 */
export function statesOf(gladys, entity, state) {
  if (!state) {
    return [];
  }
  const ids = idsOf(gladys, entity);
  const states = [];
  for (const key of featureKeysOf(entity)) {
    const value = featureValue(key, state);
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  }
  return states;
}

function featureValue(key, state) {
  switch (key) {
    case FEATURES.POWER:
      return state.on === undefined ? null : state.on ? 1 : 0;
    case FEATURES.BRIGHTNESS:
    case FEATURES.SPEED:
      return Number.isFinite(state.brightness) ? state.brightness : null;
    case FEATURES.TEMPERATURE:
      return state.colorTemperature ? toKelvin(state.colorTemperature) : null;
    case FEATURES.COLOR:
      return state.rgb ? rgbToInt(state.rgb) : null;
    case FEATURES.MOTION:
      return state.motion === undefined ? null : state.motion ? 1 : 0;
    default:
      return null;
  }
}

/**
 * The service order for a value Gladys sets on a feature.
 * @returns {object} order for `CyncService.control`
 */
export function orderFor(featureKey, value) {
  const number = Number(value);
  switch (featureKey) {
    case FEATURES.POWER:
      return { on: number === 1 };
    case FEATURES.BRIGHTNESS:
    case FEATURES.SPEED:
      return { brightness: clamp(Math.round(number), 0, 100) };
    case FEATURES.TEMPERATURE:
      return { colorTemperature: fromKelvin(number) };
    case FEATURES.COLOR:
      return { rgb: intToRgb(number) };
    default:
      throw new Error(`Feature "${featureKey}" cannot be set`);
  }
}

/**
 * The entity and feature key a Gladys feature external id points at.
 * @returns {{ entity: object, featureKey: string } | null}
 */
export function resolveFeature(gladys, entities, deviceExternalId, featureExternalId) {
  const entity = findEntity(gladys, entities, deviceExternalId);
  if (!entity) {
    return null;
  }
  const ids = idsOf(gladys, entity);
  const featureKey = featureKeysOf(entity).find((key) => ids.feature(key) === featureExternalId);
  return featureKey ? { entity, featureKey } : null;
}

/** The entity behind a Gladys device external id. */
export function findEntity(gladys, entities, deviceExternalId) {
  return entities.find((entity) => idsOf(gladys, entity).device === deviceExternalId) ?? null;
}

/** Cync white temperature (1..100) to kelvin. */
export function toKelvin(temperature) {
  return Math.round(KELVIN_MIN + clamp(temperature, 0, 100) * KELVIN_STEP);
}

/** Kelvin to the Cync white temperature (1..100). */
export function fromKelvin(kelvin) {
  return clamp(Math.round((kelvin - KELVIN_MIN) / KELVIN_STEP), 1, 100);
}

export function rgbToInt([r, g, b]) {
  return (r << 16) + (g << 8) + b;
}

export function intToRgb(value) {
  const color = clamp(Math.round(value), 0, 0xffffff);
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
