// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there knows which
// handlers the code registers, nor the rules this repository adds (four
// languages everywhere): these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { CONNECTIVITY, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { DEVICE_FILTERS, WIDGETS } from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('package.json'));
const appSource = await read('src/app.js');

test('the version is the same everywhere, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-cync:${pkg.version}`);
});

test('the catalog texts fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} must be 10-100 characters, got ${text.length}`,
    );
  }
});

test('every text of the manifest exists in every language', () => {
  const missing = [];
  (function walk(node, path) {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      if (typeof node.en === 'string') {
        for (const language of LANGUAGES) {
          if (typeof node[language] !== 'string' || node[language].trim() === '') {
            missing.push(`${path}.${language}`);
          }
        }
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  })(manifest, '');
  assert.deepEqual(missing, []);
});

// The store schema is the admission authority: a field type outside this list,
// or a placeholder that is not a multi-language object, gets the integration
// rejected by the indexer.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts', () => {
  const fields = [
    ...manifest.config_schema,
    ...manifest.actions.flatMap((action) => action.fields ?? []),
    ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
    ...manifest.scene_triggers.flatMap((trigger) => trigger.fields ?? []),
    ...manifest.scene_actions.flatMap((action) => action.fields ?? []),
  ];
  for (const field of fields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type));
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
  }
});

test('config_schema defaults are the DEFAULT_CONFIG of the code', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(keys.sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
});

test('the password is a secret field', () => {
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
});

test('every manifest action has a handler', () => {
  for (const action of manifest.actions) {
    assert.match(
      appSource,
      new RegExp(`onAction\\('${action.key}'`),
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('scene actions: declared and handled, the same keys', () => {
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
});

test('scene triggers: every event fired is declared, and its data keys too', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const connectivity = manifest.scene_triggers.find((t) => t.key === 'device_connectivity');
  const statusField = connectivity.fields.find((field) => field.key === 'status');
  assert.deepEqual(
    statusField.options.map((option) => option.value).sort(),
    Object.values(CONNECTIVITY).sort(),
  );
  for (const trigger of manifest.scene_triggers) {
    const keys = [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
    assert.ok(keys.includes('device'), `${trigger.key}: the event carries "device"`);
  }
  assert.ok(
    connectivity.variables.some((variable) => variable.key === 'status'),
    'the status is readable by the following actions',
  );
});

test('widgets: declared and served, the same keys, at most five', () => {
  assert.ok(manifest.widgets.length <= 5);
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.keys(WIDGETS).sort(),
  );
  const devices = manifest.widgets.find((widget) => widget.key === 'cync_devices');
  const show = devices.settings.find((setting) => setting.key === 'show');
  assert.deepEqual(
    show.options.map((option) => option.value).sort(),
    Object.values(DEVICE_FILTERS).sort(),
  );
});

test('Gladys 5.1 for the capabilities; cloud is the only transport', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    await access(new URL(`../docs/${language}.md`, import.meta.url));
  }
});
