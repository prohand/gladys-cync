// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+).
//
//   - cync_status   the account at a glance: cloud connection, devices online,
//                   the Wi-Fi relay of each home, and two buttons (read the
//                   states now, reload the device list);
//   - cync_devices  one row per device: on (with its brightness), off, or
//                   offline — optionally only the offline ones, the list to
//                   check after a power cut.
//
// The content is declarative and rendered by the core; the core caches it
// until `ttl_seconds`, and src/app.js nudges it (`refreshWidgets`) when the
// connection or the device list changes. Keys are stored in the users'
// dashboards: never rename them.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { STATUS } from '../cync/service.js';
import { localize, pick } from '../i18n.js';
import { MESSAGES, STATUS_LABELS } from '../messages.js';

const logger = createLogger({ name: 'widgets' });

export const STATUS_WIDGET = 'cync_status';
export const DEVICES_WIDGET = 'cync_devices';

const STATUS_ACTIONS = { REFRESH_STATES: 'refresh_states', RELOAD_DEVICES: 'reload_devices' };

/** The `show` setting of cync_devices. */
export const DEVICE_FILTERS = { ALL: 'all', ON: 'on', OFFLINE: 'offline' };

const MAX_ROWS = 10;

const STATUS_COLORS = {
  [STATUS.CONNECTED]: WIDGET_COLORS.SUCCESS,
  [STATUS.CONNECTING]: WIDGET_COLORS.INFO,
  [STATUS.SIGNING_IN]: WIDGET_COLORS.INFO,
  [STATUS.OFFLINE]: WIDGET_COLORS.WARNING,
  [STATUS.CODE_REQUIRED]: WIDGET_COLORS.WARNING,
  [STATUS.NOT_CONFIGURED]: WIDGET_COLORS.NEUTRAL,
  [STATUS.ERROR]: WIDGET_COLORS.DANGER,
};

const LABELS = {
  cloud: { en: 'Cync cloud', fr: 'Cloud Cync', de: 'Cync-Cloud', es: 'Nube Cync' },
  account: { en: 'Account', fr: 'Compte', de: 'Konto', es: 'Cuenta' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  devices: { en: 'Devices', fr: 'Appareils', de: 'Geräte', es: 'Dispositivos' },
  rooms: { en: 'Rooms', fr: 'Pièces', de: 'Räume', es: 'Estancias' },
  relay: (home) => localize((language) => `${pick(language, LABELS.relayOf)} ${home}`),
  relayOf: { en: 'Relay', fr: 'Relais', de: 'Relais', es: 'Relé' },
  noRelay: { en: 'None online', fr: 'Aucun en ligne', de: 'Keins online', es: 'Ninguno' },
  refresh: { en: 'Read states', fr: 'Lire les états', de: 'Zustände lesen', es: 'Leer estados' },
  reload: { en: 'Reload devices', fr: 'Recharger', de: 'Neu laden', es: 'Recargar' },
  on: { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  nothing: {
    en: 'Nothing to show.',
    fr: 'Rien à afficher.',
    de: 'Nichts anzuzeigen.',
    es: 'Nada que mostrar.',
  },
  allOnline: {
    en: 'Every Cync device is online.',
    fr: 'Tous les appareils Cync sont en ligne.',
    de: 'Alle Cync-Geräte sind online.',
    es: 'Todos los dispositivos Cync están en línea.',
  },
  more: (count) => ({
    en: `And ${count} more.`,
    fr: `Et ${count} de plus.`,
    de: `Und ${count} weitere.`,
    es: `Y ${count} más.`,
  }),
};

export const WIDGETS = {
  [STATUS_WIDGET]: {
    async get(_gladys, { service }) {
      const summary = service.summary();
      const code = summary.status.code;
      const items = [
        {
          label: LABELS.cloud,
          icon: 'cloud',
          value: STATUS_LABELS[code],
          color: STATUS_COLORS[code] ?? WIDGET_COLORS.NEUTRAL,
        },
      ];
      if (summary.email) {
        items.push({
          label: LABELS.account,
          icon: 'user',
          // A dashboard can hang on a wall: the address is only hinted at.
          value: maskEmail(summary.email),
          color: WIDGET_COLORS.NEUTRAL,
        });
      }
      for (const home of summary.homes.slice(0, MAX_ROWS - items.length)) {
        items.push({
          label: LABELS.relay(truncate(home.name, 30)),
          icon: 'wifi',
          value: home.relay ? truncate(home.relay, 40) : LABELS.noRelay,
          color: home.relay ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
        });
      }
      return {
        ttl_seconds: 120,
        components: [
          {
            type: 'value',
            label: LABELS.online,
            icon: 'check-circle',
            value: `${summary.online}/${summary.devices}`,
            color: summary.online < summary.devices ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
          },
          {
            type: 'value',
            label: LABELS.rooms,
            icon: 'home',
            value: summary.rooms,
          },
          { type: 'status', items },
          {
            type: 'button',
            label: LABELS.refresh,
            icon: 'refresh-cw',
            style: 'secondary',
            action: { key: STATUS_ACTIONS.REFRESH_STATES },
          },
          {
            type: 'button',
            label: LABELS.reload,
            icon: 'download-cloud',
            style: 'secondary',
            action: { key: STATUS_ACTIONS.RELOAD_DEVICES },
          },
        ],
      };
    },

    async action(_gladys, { actionKey, service }) {
      logger.info(`onWidgetAction <- ${STATUS_WIDGET}.${actionKey}`);
      if (actionKey === STATUS_ACTIONS.REFRESH_STATES) {
        await service.refreshStates();
        return MESSAGES.statesRequested;
      }
      if (actionKey === STATUS_ACTIONS.RELOAD_DEVICES) {
        await service.reload();
        return MESSAGES.reloaded(service.listEntities().length);
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },

  [DEVICES_WIDGET]: {
    async get(_gladys, { service, settings = {} }) {
      const filter = Object.values(DEVICE_FILTERS).includes(settings.show)
        ? settings.show
        : DEVICE_FILTERS.ALL;
      const rows = service
        .listEntities()
        .filter((entity) => entity.kind !== 'room')
        .map((entity) => ({ entity, state: service.getState(entity.key) ?? {} }))
        .filter(({ state }) => {
          if (filter === DEVICE_FILTERS.OFFLINE) return !state.online;
          if (filter === DEVICE_FILTERS.ON) return state.online && state.on;
          return true;
        })
        .sort((a, b) => a.entity.name.localeCompare(b.entity.name));

      const components = [];
      if (rows.length === 0) {
        components.push({
          type: 'text',
          text: filter === DEVICE_FILTERS.OFFLINE ? LABELS.allOnline : LABELS.nothing,
        });
      } else {
        components.push({
          type: 'status',
          items: rows.slice(0, MAX_ROWS).map(({ entity, state }) => deviceRow(entity, state)),
        });
        if (rows.length > MAX_ROWS) {
          components.push({
            type: 'text',
            variant: 'caption',
            text: LABELS.more(rows.length - MAX_ROWS),
          });
        }
      }
      return { ttl_seconds: 60, components };
    },
  },
};

function deviceRow(entity, state) {
  const row = { label: truncate(entity.name, 40), icon: iconOf(entity) };
  if (!state.online) {
    return { ...row, value: LABELS.offline, color: WIDGET_COLORS.DANGER };
  }
  if (entity.kind === 'sensor') {
    return state.motion
      ? { ...row, value: LABELS.motion, color: WIDGET_COLORS.WARNING }
      : { ...row, value: LABELS.online, color: WIDGET_COLORS.NEUTRAL };
  }
  if (!state.on) {
    return { ...row, value: LABELS.off, color: WIDGET_COLORS.NEUTRAL };
  }
  if (entity.capabilities.brightness && Number.isFinite(state.brightness)) {
    const level = state.brightness;
    return {
      ...row,
      value: localize((language) => `${pick(language, LABELS.on)} · ${level} %`),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  return { ...row, value: LABELS.on, color: WIDGET_COLORS.SUCCESS };
}

function iconOf(entity) {
  switch (entity.kind) {
    case 'plug':
      return 'power';
    case 'fan':
      return 'wind';
    case 'sensor':
      return 'activity';
    default:
      return 'sun';
  }
}

/** `jane.doe@example.com` -> `j…e@example.com` */
export function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) {
    return '…';
  }
  const hint = user.length > 2 ? `${user[0]}…${user.at(-1)}` : `${user[0] ?? ''}…`;
  return truncate(`${hint}@${domain}`, 40);
}

function truncate(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
