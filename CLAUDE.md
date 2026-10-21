# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors when working
with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Cync** (formerly C by GE, GE Lighting):
bulbs, light strips, wall switches and dimmers, plugs and the fan controller of a Cync account.
Gladys 5.1+ adds scene triggers (motion detected, device offline/online), scene actions (set a
light in one go, read the states now) and two widgets ("Cync status", "Cync devices").

Cloud only (manifest `"transports": ["cloud"]`): Cync devices have no local API, the Cync app
itself drives them through the Cync cloud.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/protocol.test.js           # one file
node --test --test-name-pattern "combo"     # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks (needs Node 24)
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, plus the
store checks and a Docker build on pull requests: run the three commands before pushing.

## Architecture

```
index.js                SDK bootstrap only: registerHandlers(), then connect()
src/app.js              every SDK handler; service events -> devices, states, transports, scene events
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/messages.js         connection status and action answers, { en, fr, de, es }
src/i18n.js             LANGUAGES, localize(), pick()
src/logging.js          "Detailed logs" switch (LOG_LEVEL, no restart)
src/cync/api.js         REST: sign-in, two-step code, token refresh, homes (api.gelighting.com)
src/cync/session.js     session tokens kept in /data (mode 0600)
src/cync/catalog.js     device types -> capabilities; homes, devices, rooms model
src/cync/protocol.js    TCP frames: build orders, decode pushed states (pure, no socket)
src/cync/connection.js  TLS session to cm-sec.gelighting.com:23779: login, ping, reconnect
src/cync/service.js     orchestration: sign-in, relays, states, orders; emits events
src/devices/index.js    entity -> Gladys device / features / states; Gladys value -> order
src/capabilities/       scenes.js (triggers + actions), widgets.js (Gladys 5.1)
docs/{en,fr,de,es}.md   user documentation, re-hosted by Gladys (mandatory)
test/                   node --test; fakes in test/helpers (API, TCP, store, timers, fixtures)
```

### Invariants worth knowing

- **External ids are forever.** A device is `gladys.externalIds('device', '<home id>-<mesh
address>')`, a room `gladys.externalIds('room', '<home id>-room-<group id>')`; features are
  `power`, `brightness`, `temperature`, `color`, `speed`, `motion`. Never build them from a name.
  Changing one creates a new Gladys device and orphans the old one. The same goes for the manifest
  keys users store: `config_schema`, `actions`, scene trigger/action keys and fields, widget keys
  and settings.
- **Mesh addressing**: the cloud `deviceID` modulo the home id is the mesh address; its thousands
  are the outlet of a multi-outlet plug (`element`), the rest the mesh id. A power order carries
  `[mesh id, element]`; brightness/color/combo carry the mesh id on 2 bytes (little-endian).
- **Orders go through a relay**: a Wi-Fi device of the same home, confirmed by a probe answer (or,
  until then, one the cloud lists as online). No relay, no order: `control()` throws and Gladys
  shows the failed acknowledgement.
- **Two byte orders**: the outer frame is big-endian, the inner mesh frame little-endian, and a
  `0x7e` inside the inner frame is escaped as `0x7d 0x5e`. `test/protocol.test.js` pins the
  layouts with real frames: never change a builder without a captured frame to prove it.
- **White temperature**: Cync 1..100 = 2000..7000 K (0 is not a white value; 254 in the color
  mode byte means RGB mode).
- **Two-step sign-in**: a 400 on `/v2/user_auth` means "a code is needed" (or a wrong password).
  The code is only ever sent on the user's click (`send_code`): never automatically, it emails the
  user. The session is saved in `/data` so a restart needs no code.
- **TLS**: strict first, relaxed fallback (the server certificate is expired); keep the warning.
- **Secrets**: never log the password, a token, the `authorize` string or the code. Debug logs hold
  raw frames: fine, the login frame is not logged at debug level by `connection.js` (it is written
  in `#login`, not through `send`).
- **Polling**: none from Gladys. States are pushed; a periodic full read (`state_refresh`, seconds)
  only catches devices that went offline. If Gladys polling is ever added, `poll_frequency` is an
  enum in ms (`DEVICE_POLL_FREQUENCIES`), anything else rejects the whole discovery.
- **Every feature declares `min`/`max`**.

### Manifest

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code: defaults equal
`DEFAULT_CONFIG`, every action has an `onAction`, scene action / trigger / widget keys match the
code, every text exists in the four languages, versions agree. Change both sides together.

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or in the manifest, nor the `docker_image` tag, by hand.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **Four languages**: every user-facing text is `{ en, fr, de, es }` (manifest, messages, widgets),
  and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md` stay in sync.
- **The container rootfs is read-only**: write only under `/data`.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network.
