// -----------------------------------------------------------------------------
// The texts the user reads: connection status, action answers. Every one is a
// `{ en, fr, de, es }` object (see src/i18n.js).
// -----------------------------------------------------------------------------

import { STATUS } from './cync/service.js';

const STATUS_TEXTS = {
  [STATUS.NOT_CONFIGURED]: {
    en: 'Fill in the email and password of your Cync account, then save.',
    fr: 'Renseignez l’email et le mot de passe de votre compte Cync, puis enregistrez.',
    de: 'Gib die E-Mail-Adresse und das Passwort deines Cync-Kontos ein und speichere.',
    es: 'Introduzca el correo y la contraseña de su cuenta Cync y guarde.',
  },
  [STATUS.SIGNING_IN]: {
    en: 'Signing in to Cync…',
    fr: 'Connexion au compte Cync…',
    de: 'Anmeldung bei Cync…',
    es: 'Iniciando sesión en Cync…',
  },
  [STATUS.CODE_REQUIRED]: {
    en: 'Two-step verification: click “Send a verification code”, then enter the code received by email with “Validate the code”.',
    fr: 'Vérification en deux étapes : cliquez sur « Envoyer un code de vérification », puis saisissez le code reçu par email avec « Valider le code ».',
    de: 'Zweistufige Verifizierung: Klicke auf „Bestätigungscode senden“ und gib dann den per E-Mail erhaltenen Code mit „Code bestätigen“ ein.',
    es: 'Verificación en dos pasos: pulse «Enviar un código de verificación» e introduzca el código recibido por correo con «Validar el código».',
  },
  [STATUS.CONNECTING]: {
    en: 'Connecting to the Cync cloud…',
    fr: 'Connexion au cloud Cync…',
    de: 'Verbindung mit der Cync-Cloud…',
    es: 'Conectando con la nube Cync…',
  },
  [STATUS.OFFLINE]: {
    en: 'Connection to the Cync cloud lost, reconnecting…',
    fr: 'Connexion au cloud Cync perdue, reconnexion en cours…',
    de: 'Verbindung zur Cync-Cloud verloren, neuer Versuch läuft…',
    es: 'Conexión con la nube Cync perdida, reconectando…',
  },
  [STATUS.ERROR]: {
    en: 'Cync error',
    fr: 'Erreur Cync',
    de: 'Cync-Fehler',
    es: 'Error de Cync',
  },
};

/**
 * The connection status as Gladys shows it: `{ connected, message }`.
 * @param {{ code: string, detail?: string }} status service status
 */
export function connectionStatus(status) {
  if (status.code === STATUS.CONNECTED) {
    return { connected: true, message: undefined };
  }
  const texts = STATUS_TEXTS[status.code] ?? STATUS_TEXTS[STATUS.ERROR];
  if (status.detail) {
    // The detail comes from the cloud or the network, in English.
    return {
      connected: false,
      message: Object.fromEntries(
        Object.entries(texts).map(([language, text]) => [language, `${text}: ${status.detail}`]),
      ),
    };
  }
  return { connected: false, message: texts };
}

/** Short label of a status, for the widget. */
export const STATUS_LABELS = {
  [STATUS.NOT_CONFIGURED]: {
    en: 'Not configured',
    fr: 'Non configuré',
    de: 'Nicht eingerichtet',
    es: 'Sin configurar',
  },
  [STATUS.SIGNING_IN]: {
    en: 'Signing in',
    fr: 'Connexion',
    de: 'Anmeldung',
    es: 'Iniciando sesión',
  },
  [STATUS.CODE_REQUIRED]: {
    en: 'Code required',
    fr: 'Code requis',
    de: 'Code nötig',
    es: 'Código necesario',
  },
  [STATUS.CONNECTING]: { en: 'Connecting', fr: 'Connexion', de: 'Verbinde', es: 'Conectando' },
  [STATUS.CONNECTED]: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  [STATUS.OFFLINE]: {
    en: 'Reconnecting',
    fr: 'Reconnexion',
    de: 'Neuer Versuch',
    es: 'Reconectando',
  },
  [STATUS.ERROR]: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
};

export const MESSAGES = {
  codeSent: (email) => ({
    en: `A verification code was sent to ${email}. Enter it with “Validate the code”.`,
    fr: `Un code de vérification a été envoyé à ${email}. Saisissez-le avec « Valider le code ».`,
    de: `Ein Bestätigungscode wurde an ${email} gesendet. Gib ihn mit „Code bestätigen“ ein.`,
    es: `Se ha enviado un código de verificación a ${email}. Introdúzcalo con «Validar el código».`,
  }),
  codeRefused: {
    en: 'The Cync cloud refused this code (wrong, expired, or wrong password). Ask for a new code and try again.',
    fr: 'Le cloud Cync a refusé ce code (erroné, expiré, ou mot de passe incorrect). Demandez un nouveau code et réessayez.',
    de: 'Die Cync-Cloud hat diesen Code abgelehnt (falsch, abgelaufen oder falsches Passwort). Fordere einen neuen Code an und versuche es erneut.',
    es: 'La nube Cync ha rechazado este código (erróneo, caducado o contraseña incorrecta). Pida un código nuevo e inténtelo de nuevo.',
  },
  signedIn: (devices) => ({
    en: `Signed in. ${devices} Cync device(s) and room(s) found: add them from the Discovery tab.`,
    fr: `Connecté. ${devices} appareil(s) et pièce(s) Cync trouvés : ajoutez-les depuis l’onglet Découverte.`,
    de: `Angemeldet. ${devices} Cync-Gerät(e) und Raum/Räume gefunden: Füge sie im Tab „Erkennung“ hinzu.`,
    es: `Sesión iniciada. ${devices} dispositivo(s) y estancia(s) Cync encontrados: añádalos desde la pestaña Descubrimiento.`,
  }),
  needCredentials: STATUS_TEXTS[STATUS.NOT_CONFIGURED],
  reloaded: (devices) => ({
    en: `Device list reloaded from the Cync cloud: ${devices} device(s) and room(s).`,
    fr: `Liste des appareils rechargée depuis le cloud Cync : ${devices} appareil(s) et pièce(s).`,
    de: `Geräteliste aus der Cync-Cloud neu geladen: ${devices} Gerät(e) und Raum/Räume.`,
    es: `Lista de dispositivos recargada desde la nube Cync: ${devices} dispositivo(s) y estancia(s).`,
  }),
  statesRequested: {
    en: 'States requested from the Cync cloud.',
    fr: 'États demandés au cloud Cync.',
    de: 'Zustände bei der Cync-Cloud angefragt.',
    es: 'Estados solicitados a la nube Cync.',
  },
};
