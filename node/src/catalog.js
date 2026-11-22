// Loads the shared catalog (prices, columns), presets and redacted sample data from the repository root.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadCatalog(root = REPO_ROOT) {
  return readJson(join(root, 'catalog.json'));
}

export function listPresets(root = REPO_ROOT) {
  return readdirSync(join(root, 'presets'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(join(root, 'presets', f)));
}

export function loadPreset(id, root = REPO_ROOT) {
  if (!PRESET_ID.test(String(id))) throw new Error(`Invalid preset id "${id}". Use lowercase letters, digits and dashes.`);
  const path = join(root, 'presets', `${id}.json`);
  if (!existsSync(path)) throw new Error(`Unknown preset "${id}". Run "list" to see the presets.`);
  const preset = readJson(path);
  if (preset.id !== id) throw new Error(`Preset file ${id}.json has id "${preset.id}".`);
  return preset;
}

/** Redacted real sample rows for an Actor (used by --dry-run and the demo pages). */
export function loadSample(actorKey, root = REPO_ROOT) {
  const data = readJson(join(root, 'samples', `${actorKey}.json`));
  return { note: data.note, rows: data.rows };
}

/** Shallow merge: override keys replace preset keys (arrays are replaced, not concatenated). */
export function mergeInput(base, overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Input overrides must be a JSON object, e.g. {"states":["CA"]}.');
  }
  return { ...structuredClone(base), ...structuredClone(overrides) };
}

/** One domain or URL per line; blank lines and lines starting with # are ignored. CSV: first column is used. */
export function parseUrlList(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.split(',')[0].trim().replace(/^"|"$/g, ''))
    .filter((l) => l && !l.startsWith('#') && !/^(url|domain|website)$/i.test(l));
}
