# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-21

### Added

- Cync (GE Lighting) account sign-in, with the two-step verification code sent
  by email; the session is kept across restarts.
- Lights (on/off, brightness, white temperature, color), wall switches and
  dimmers, plugs (one device per outlet), fan controller, and the rooms of the
  Cync app as lights driven with one order.
- Real-time states pushed by the Cync cloud, a periodic full read, and a
  `cloud` / `unreachable` badge per device.
- Scene triggers: motion detected, device offline / online.
- Scene actions: set a light in one go (power, brightness, white), read the
  states now.
- Dashboard widgets: "Cync status" and "Cync devices".
- Configuration actions: send and validate the verification code, test the
  connection, reload the device list.
- Interface and documentation in English, French, German and Spanish.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build),
  UI-driven Release workflow, GitHub Releases and Dependabot.

[Unreleased]: https://github.com/prohand/gladys-cync/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/prohand/gladys-cync/releases/tag/v1.0.1
