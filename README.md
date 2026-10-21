# Cync — Gladys Assistant integration

External integration for [Gladys Assistant](https://gladysassistant.com) that drives the devices
of a **Cync** account (formerly **C by GE**, GE Lighting): bulbs, light strips, downlights, wall
switches and dimmers, plugs and the fan controller.

Built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and the
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## What it does

| Surface               | What                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Devices               | Lights (on/off, brightness, white 2000–7000 K, color), dimmers, plugs (one device per outlet), fan controller, motion sensors |
| Rooms                 | The rooms and groups of the Cync app as lights, switched with one mesh order                                                  |
| States                | Pushed in real time by the Cync cloud, plus a periodic full read                                                              |
| Transport badge       | `cloud` while the device is reachable, `unreachable` otherwise (manifest `transports: ["cloud"]`)                             |
| Scene triggers        | `motion_detected`, `device_connectivity` (offline / online)                                                                   |
| Scene actions         | `set_light` (power + brightness + white in one order), `refresh_states`                                                       |
| Widgets               | `cync_status` (connection, devices online, relays, buttons), `cync_devices` (per device)                                      |
| Configuration actions | `send_code`, `verify_code` (two-step sign-in), `test_connection`, `refresh_devices`                                           |
| Languages             | English, French, German, Spanish — manifest, messages, widgets and documentation                                              |

Requires **Gladys 5.1.0** or later (scene and widget capabilities).

## How it talks to Cync

Cync devices have no local API: the Cync app drives them through the Cync cloud, and so does this
integration. Hence the manifest declares the **cloud** transport only.

1. **REST** (`https://api.gelighting.com`): sign-in with the account email and password, plus the
   two-step code Cync emails; then the description of the homes (devices, mesh addresses, rooms).
   The tokens are kept in `/data/cync-session.json` (mode 0600), so a restart needs no new code.
2. **TCP/TLS** (`cm-sec.gelighting.com:23779`): one permanent session. Orders go to a **Wi-Fi
   device of the home** (the relay), which passes them to the Bluetooth mesh; state changes come
   back the same way, from Gladys, the Cync app or a wall switch alike.

The binary protocol (frames, checksums, escaping, mesh addressing) was established by the Cync
clients of the Home Assistant community; [`test/protocol.test.js`](test/protocol.test.js) pins it
with frames captured from the Cync cloud. See [`CLAUDE.md`](CLAUDE.md) for the invariants.

## Project structure

```
.
├─ index.js                          # SDK bootstrap: registerHandlers(), connect()
├─ src/
│  ├─ app.js                         # every SDK handler, service events -> Gladys
│  ├─ config.js                      # defaults + normalization
│  ├─ messages.js                    # status and answers, 4 languages
│  ├─ i18n.js                        # LANGUAGES, localize(), pick()
│  ├─ logging.js                     # "Detailed logs" switch
│  ├─ cync/
│  │  ├─ api.js                      # REST: sign-in, code, refresh, homes
│  │  ├─ session.js                  # tokens kept in /data
│  │  ├─ catalog.js                  # device types -> capabilities, homes model
│  │  ├─ protocol.js                 # TCP frames (pure)
│  │  ├─ connection.js               # TLS session: login, ping, reconnect
│  │  └─ service.js                  # orchestration: relays, states, orders
│  ├─ devices/index.js               # Gladys devices, features, states, orders
│  └─ capabilities/
│     ├─ scenes.js                   # scene triggers and actions (Gladys 5.1+)
│     └─ widgets.js                  # dashboard widgets (Gladys 5.1+)
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
└─ .github/                          # CI, Release, build, GitHub releases, Dependabot
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="cync" \
CYNC_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

The `GLADYS_*` variables are injected by the Gladys supervisor inside the container.
`CYNC_DATA_DIR` moves the session file out of `/data` for a local run.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: protocol, API, service, Gladys side (SDK fake Gladys)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs the first three on Node 22 and 24 for every push and pull request; pull requests also
run the store checks and build the Docker image.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json` and the manifest (`version`, `docker_image`), rolls the
changelog, tags `vX.Y.Z`, builds the `linux/amd64` + `linux/arm64` image to
`ghcr.io/prohand/gladys-cync` (`:X.Y.Z` and `:latest`) and publishes the GitHub Release. The
repository needs the GitHub topic `gladys-assistant-integration`, a public package, and
**Private vulnerability reporting** turned on (see [`SECURITY.md`](SECURITY.md)).

## Credits

The Cync protocol knowledge comes from the community: the Home Assistant integrations
[nikshriv/cync_lights](https://github.com/nikshriv/cync_lights) and
[pycync](https://github.com/Kinachi249/pycync). This project is an independent JavaScript
implementation; it is not affiliated with Cync, GE Lighting or Savant.

## License

Apache-2.0
