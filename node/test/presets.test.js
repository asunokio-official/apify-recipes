// Every preset must be a valid input for its Actor (checked against a copy of the Actor's input schema),
// and the bundled samples must not contain personal data the demo promises to redact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, listPresets, loadCatalog, loadPreset, loadSample, mergeInput, parseUrlList } from '../src/catalog.js';

const catalog = loadCatalog();
const schema = (actor) => JSON.parse(readFileSync(join(REPO_ROOT, 'schemas', `${actor}.input_schema.json`), 'utf8'));

function checkValue(key, value, prop) {
  const where = `${key}=${JSON.stringify(value)}`;
  if (prop.type === 'array') {
    assert.ok(Array.isArray(value), `${where} must be an array`);
    const allowed = prop.items?.enum;
    if (allowed) for (const v of value) assert.ok(allowed.includes(v), `${where}: "${v}" not in ${allowed}`);
  } else if (prop.type === 'integer') {
    assert.ok(Number.isInteger(value), `${where} must be an integer`);
  } else if (prop.type === 'number') {
    assert.equal(typeof value, 'number', `${where} must be a number`);
  } else if (prop.type === 'boolean') {
    assert.equal(typeof value, 'boolean', `${where} must be a boolean`);
  } else if (prop.type === 'string') {
    assert.equal(typeof value, 'string', `${where} must be a string`);
  }
  if (prop.minimum != null) assert.ok(value >= prop.minimum, `${where} below minimum ${prop.minimum}`);
  if (prop.maximum != null) assert.ok(value <= prop.maximum, `${where} above maximum ${prop.maximum}`);
}

const presets = listPresets();

test('there are presets for each of the four Actors', () => {
  for (const actor of Object.keys(catalog.actors)) assert.ok(presets.some((p) => p.actor === actor), actor);
});

for (const preset of presets) {
  test(`preset ${preset.id} is a valid ${preset.actor} input`, () => {
    assert.deepEqual(loadPreset(preset.id), preset);
    assert.ok(preset.title && preset.who && preset.schedule, 'title, who and schedule are required');
    const s = schema(preset.actor);
    for (const [k, v] of Object.entries(preset.input)) {
      assert.ok(s.properties[k], `unknown input key "${k}"`);
      checkValue(k, v, s.properties[k]);
    }
    for (const req of s.required ?? []) assert.ok(req in preset.input, `missing required "${req}"`);
  });
}

test('every catalog column resolves on at least one sample row', () => {
  for (const [key, actor] of Object.entries(catalog.actors)) {
    const rows = loadSample(key).rows.filter((r) => r.type !== 'summary');
    assert.ok(rows.length > 0, key);
    for (const col of actor.columns) {
      const top = col.split('.')[0].replace('[]', '');
      assert.ok(rows.some((r) => top in r), `${key}: column ${col} not in samples`);
    }
  }
});

test('NPPES demo sample has no names, NPIs, phones, street addresses or full ZIPs', () => {
  for (const r of loadSample('nppes-new-providers-feed').rows.filter((x) => x.type === 'provider')) {
    for (const k of ['npi', 'name', 'firstName', 'lastName', 'practicePhone', 'practiceAddress1', 'licenseNumber', 'npiRegistryUrl']) {
      assert.ok(r[k] == null || r[k] === '[redacted in demo]', `${k}=${r[k]}`);
    }
    assert.match(r.practiceZip, /^\d{3}xx$/);
  }
});

test('permit demo sample masks house numbers and coarsens coordinates', () => {
  for (const r of loadSample('us-building-permits-feed').rows) {
    assert.match(r.address, /^\dx*\s/);
    assert.ok(r.latitude == null || Math.round(r.latitude * 100) / 100 === r.latitude);
    assert.equal(r.permitUrl, '[redacted in demo]');
  }
});

test('mergeInput replaces keys without mutating the preset', () => {
  const p = loadPreset('tx-dental-new-npis-weekly');
  const merged = mergeInput(p.input, { states: ['CA'] });
  assert.deepEqual(merged.states, ['CA']);
  assert.deepEqual(p.input.states, ['TX']);
  assert.throws(() => mergeInput({}, ['x']), /JSON object/);
});

test('loadPreset rejects path tricks and unknown ids', () => {
  assert.throws(() => loadPreset('../catalog'), /Invalid preset id/);
  assert.throws(() => loadPreset('does-not-exist'), /Unknown preset/);
});

test('parseUrlList accepts plain lists and the first CSV column', () => {
  assert.deepEqual(parseUrlList('domain,owner\nshop.com,me\n# skip\n\n"b.com",x\r\nc.com'), ['shop.com', 'b.com', 'c.com']);
});
