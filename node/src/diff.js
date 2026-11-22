// Compare two Tech Stack Detector result sets (the --json file of a "run", a plain array, or the sample file) and list, per site,
// the technologies that appeared or disappeared. Offline, no Actor run, nothing is sent anywhere.
import { toCsv } from './csv.js';

export function rowsOf(doc) {
  const rows = Array.isArray(doc) ? doc : doc?.rows ?? doc?.items;
  if (!Array.isArray(rows)) throw new Error('Expected a JSON array of rows or an object with "rows".');
  return rows;
}
const siteKey = (r) => String(r.finalUrl || r.url || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
const techSet = (r) => new Map((r.technologies ?? []).map((t) => [t.name, t.category ?? '']));

/** Returns one record per site that changed or could not be compared. */
export function diffTech(oldDoc, newDoc) {
  const before = new Map(rowsOf(oldDoc).map((r) => [siteKey(r), r]));
  const after = new Map(rowsOf(newDoc).map((r) => [siteKey(r), r]));
  const out = [];
  for (const [key, n] of after) {
    const o = before.get(key);
    if (!o) { out.push({ site: key, change: 'new-site', added: [], removed: [], note: 'not in the earlier results' }); continue; }
    if (o.scanStatus !== 'ok' || n.scanStatus !== 'ok') {
      out.push({ site: key, change: 'not-comparable', added: [], removed: [], note: `scanStatus ${o.scanStatus ?? '?'} -> ${n.scanStatus ?? '?'}` });
      continue;
    }
    const a = techSet(o), b = techSet(n);
    const added = [...b].filter(([k]) => !a.has(k)).map(([k, c]) => `${k} (${c})`);
    const removed = [...a].filter(([k]) => !b.has(k)).map(([k, c]) => `${k} (${c})`);
    if (added.length || removed.length) out.push({ site: key, change: 'changed', added, removed, note: '' });
  }
  for (const key of before.keys()) if (!after.has(key)) out.push({ site: key, change: 'missing-now', added: [], removed: [], note: 'not in the new results' });
  return out.sort((x, y) => x.site.localeCompare(y.site));
}
export function diffCsv(changes) {
  return toCsv(changes, ['site', 'change', 'added', 'removed', 'note']);
}
