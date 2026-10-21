// -----------------------------------------------------------------------------
// From the Cync cloud's description of a home to the model the integration
// works with: devices, their capabilities, their mesh address, and the rooms.
//
// The cloud describes a device by a numeric `deviceType`. What each type can do
// is not in the answer, only in the Cync app: the lists below record it, as
// published by the community clients. A type missing here is a device this
// integration does not drive (camera, thermostat...): it is left out.
// -----------------------------------------------------------------------------

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const ON_OFF = new Set([
  1,
  ...range(5, 11),
  ...range(13, 15),
  ...range(17, 40),
  ...range(47, 49),
  ...range(51, 59),
  ...range(61, 68),
  ...range(80, 83),
  85,
  ...range(128, 156),
  ...range(158, 166),
  ...range(169, 172),
]);
const BRIGHTNESS = new Set([
  1,
  ...range(5, 11),
  ...range(13, 15),
  ...range(17, 37),
  ...range(47, 49),
  55,
  56,
  ...range(80, 83),
  85,
  ...range(128, 156),
  ...range(158, 166),
  ...range(169, 171),
]);
const COLOR_TEMPERATURE = new Set([
  ...range(5, 8),
  10,
  11,
  14,
  15,
  ...range(19, 23),
  25,
  26,
  ...range(28, 35),
  47,
  80,
  82,
  83,
  85,
  ...range(129, 133),
  ...range(135, 147),
  ...range(153, 156),
  ...range(158, 166),
  ...range(169, 171),
]);
const RGB = new Set([
  ...range(6, 8),
  ...range(21, 23),
  ...range(30, 35),
  47,
  ...range(131, 133),
  ...range(137, 143),
  146,
  147,
  ...range(153, 156),
  ...range(158, 166),
  ...range(169, 171),
]);
const MOTION = new Set([37, 49, 54]);
// Devices with their own Wi-Fi: they can relay orders to the Bluetooth mesh.
const WIFI = new Set([
  ...range(36, 40),
  ...range(47, 49),
  ...range(51, 59),
  ...range(61, 68),
  80,
  81,
  ...range(128, 156),
  ...range(158, 166),
  ...range(169, 172),
]);
const PLUG = new Set([...range(64, 68), 172]);
const FAN = new Set([81]);

/** Mesh ids are numbered per home; an element offset of 1000 per outlet. */
const ELEMENT_STRIDE = 1000;

/**
 * What a device type can do.
 * @param {number} deviceType the `deviceType` of the cloud description
 */
export function capabilitiesOf(deviceType) {
  return {
    onOff: ON_OFF.has(deviceType),
    brightness: BRIGHTNESS.has(deviceType),
    colorTemperature: COLOR_TEMPERATURE.has(deviceType),
    rgb: RGB.has(deviceType),
    motion: MOTION.has(deviceType),
    wifi: WIFI.has(deviceType),
    plug: PLUG.has(deviceType),
    fan: FAN.has(deviceType),
  };
}

/**
 * What Gladys should see the device as: `light`, `plug`, `fan`, `sensor`, or
 * `null` for a device this integration does not drive.
 */
export function kindOf(capabilities) {
  if (capabilities.plug) {
    return 'plug';
  }
  if (capabilities.fan) {
    return 'fan';
  }
  if (capabilities.onOff) {
    // Wall dimmers and switches drive a light circuit: a light in Gladys.
    return 'light';
  }
  if (capabilities.motion) {
    return 'sensor';
  }
  return null;
}

/**
 * Build the model of every home.
 *
 * @param {object[]} subscribed answer of `/v2/user/<id>/subscribe/devices`:
 *   the homes, and the Wi-Fi devices with their cloud id and online flag
 * @param {Map<number, object>} propertiesByHome answer of
 *   `/v2/product/<product>/device/<home>/property`, per home id
 * @returns {object[]} homes `{ id, name, devices, rooms }`
 */
export function buildHomes(subscribed, propertiesByHome) {
  const cloudDevices = new Map(subscribed.map((entry) => [entry.id, entry]));
  const homes = [];
  for (const home of homeEntries(subscribed)) {
    const properties = propertiesByHome.get(home.id);
    if (!properties) {
      continue;
    }
    const devices = (properties.bulbsArray ?? [])
      .map((bulb) => buildDevice(home, bulb, cloudDevices))
      .filter(Boolean);
    const rooms = (properties.groupsArray ?? [])
      .map((group) => buildRoom(home, group, devices))
      .filter(Boolean);
    homes.push({ id: home.id, name: String(home.name ?? `Home ${home.id}`), devices, rooms });
  }
  return homes;
}

/**
 * The homes among the subscribed entries. The cloud marks them with
 * `source: 5`; an account where no entry carries it lists only its homes.
 */
export function homeEntries(subscribed) {
  const marked = subscribed.filter((entry) => entry.source === 5);
  return marked.length > 0 ? marked : subscribed;
}

function buildDevice(home, bulb, cloudDevices) {
  if (!Number.isInteger(bulb.deviceID) || !Number.isInteger(bulb.deviceType)) {
    return null;
  }
  const capabilities = capabilitiesOf(bulb.deviceType);
  const kind = kindOf(capabilities);
  // The cloud numbers devices across homes: the remainder is the address in
  // this home's mesh, its thousands the outlet of a multi-outlet device.
  const meshAddress = bulb.deviceID % home.id;
  const switchId = Number.isInteger(bulb.switchID) && bulb.switchID > 0 ? bulb.switchID : 0;
  const cloud = switchId ? cloudDevices.get(switchId) : undefined;
  return {
    // `<home>-<mesh address>`: what the Cync app itself keys the device on,
    // stable across renames and Wi-Fi changes.
    key: `${home.id}-${meshAddress}`,
    homeId: home.id,
    name: String(bulb.displayName ?? `Cync ${meshAddress}`),
    deviceType: bulb.deviceType,
    meshId: meshAddress % ELEMENT_STRIDE,
    element: Math.floor(meshAddress / ELEMENT_STRIDE),
    switchId,
    mac: bulb.mac ?? cloud?.mac ?? null,
    firmware: bulb.firmwareVersion ?? cloud?.firmware_version ?? null,
    cloudOnline: cloud ? cloud.is_online !== false : null,
    capabilities,
    kind,
  };
}

function buildRoom(home, group, devices) {
  if (!Number.isInteger(group.groupID)) {
    return null;
  }
  const memberIds = new Set(group.deviceIDArray ?? []);
  const members = devices.filter(
    (device) =>
      memberIds.has(device.meshId + device.element * ELEMENT_STRIDE) && device.kind === 'light',
  );
  // A room with no light (only plugs, or empty) has nothing to dim: as a
  // Gladys light it would mislead. Its plugs stay reachable one by one.
  if (members.length === 0) {
    return null;
  }
  const every = (capability) => members.every((device) => device.capabilities[capability]);
  return {
    key: `${home.id}-room-${group.groupID}`,
    homeId: home.id,
    name: String(group.displayName ?? `Room ${group.groupID}`),
    meshId: group.groupID,
    element: 0,
    isSubgroup: group.isSubgroup === true,
    memberKeys: members.map((device) => device.key),
    capabilities: {
      onOff: true,
      // A room offers what all its lights can do: a "color" slider that half
      // the bulbs ignore is worse than no slider.
      brightness: every('brightness'),
      colorTemperature: every('colorTemperature'),
      rgb: every('rgb'),
      motion: false,
      wifi: false,
      plug: false,
      fan: false,
    },
    kind: 'room',
  };
}

/** Every device and room of the homes, rooms after devices. */
export function entitiesOf(homes, { includeRooms = true } = {}) {
  const devices = homes.flatMap((home) => home.devices.filter((device) => device.kind));
  const rooms = includeRooms ? homes.flatMap((home) => home.rooms) : [];
  return [...devices, ...rooms];
}
