// -----------------------------------------------------------------------------
// One Cync home, shaped like the cloud answers:
//   - a full-color Wi-Fi bulb (relay), mesh 4
//   - a white bulb without Wi-Fi, mesh 7
//   - a two-outlet plug (Wi-Fi), outlets at mesh 6, elements 1 and 2
//   - a dimmer switch with a motion sensor (Wi-Fi), mesh 9
//   - a device type this integration does not drive (a camera), mesh 12
//   - rooms: "Living room" (the two bulbs), "Terrace" (the plug only)
// -----------------------------------------------------------------------------

export const HOME = { id: 1000003, product_id: 'prod-home', name: 'House', source: 5 };

export const SWITCH_IDS = { BULB: 50001, PLUG: 50002, DIMMER: 50003 };

export const SUBSCRIBED = [
  HOME,
  { id: SWITCH_IDS.BULB, product_id: 'prod-bulb', is_online: true, mac: 'AABBCCDDEE01' },
  { id: SWITCH_IDS.PLUG, product_id: 'prod-plug', is_online: true, mac: 'AABBCCDDEE02' },
  { id: SWITCH_IDS.DIMMER, product_id: 'prod-dim', is_online: false, mac: 'AABBCCDDEE03' },
];

const mesh = (address) => HOME.id * 7 + address;

export const PROPERTIES = {
  bulbsArray: [
    {
      deviceID: mesh(4),
      deviceType: 137,
      displayName: 'Living bulb',
      switchID: SWITCH_IDS.BULB,
      mac: 'AABBCCDDEE01',
    },
    { deviceID: mesh(7), deviceType: 5, displayName: 'Kitchen bulb', switchID: 0 },
    {
      deviceID: mesh(1006),
      deviceType: 67,
      displayName: 'Terrace left',
      switchID: SWITCH_IDS.PLUG,
    },
    {
      deviceID: mesh(2006),
      deviceType: 67,
      displayName: 'Terrace right',
      switchID: SWITCH_IDS.PLUG,
    },
    {
      deviceID: mesh(9),
      deviceType: 37,
      displayName: 'Hall dimmer',
      switchID: SWITCH_IDS.DIMMER,
    },
    { deviceID: mesh(12), deviceType: 200, displayName: 'Door camera' },
  ],
  groupsArray: [
    { groupID: 3, displayName: 'Living room', deviceIDArray: [4, 7], isSubgroup: false },
    { groupID: 5, displayName: 'Terrace', deviceIDArray: [1006, 2006], isSubgroup: false },
  ],
};

export const KEYS = {
  LIVING: `${HOME.id}-4`,
  KITCHEN: `${HOME.id}-7`,
  PLUG_LEFT: `${HOME.id}-1006`,
  PLUG_RIGHT: `${HOME.id}-2006`,
  DIMMER: `${HOME.id}-9`,
  ROOM: `${HOME.id}-room-3`,
};
