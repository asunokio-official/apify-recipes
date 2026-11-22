// Flat, spreadsheet-safe CSV from Actor dataset rows.
// - Column paths: "a.b.c" for nested values, "list[].name" to collect a field from every element of an array.
// - Arrays are joined with "; ", objects are written as JSON.
// - Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR) is prefixed with an apostrophe.

export function getPath(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (cur == null) return null;
    const part = parts[i];
    if (part.endsWith('[]')) {
      const arr = cur[part.slice(0, -2)];
      if (!Array.isArray(arr)) return null;
      const rest = parts.slice(i + 1).join('.');
      return rest ? arr.map((el) => getPath(el, rest)).filter((v) => v != null) : arr;
    }
    cur = cur[part];
  }
  return cur === undefined ? null : cur;
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

export function guardFormula(text) {
  if (text === '' || NUMERIC.test(text)) return text;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function toCell(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return guardFormula(value.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v))).join('; '));
  }
  if (typeof value === 'object') return guardFormula(JSON.stringify(value));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return guardFormula(String(value));
}

const quote = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Union of top-level keys in first-seen order (for --all-columns). */
export function allColumns(rows) {
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export function toCsv(rows, columns, { bom = false } = {}) {
  const lines = [columns.map(quote).join(',')];
  for (const row of rows) lines.push(columns.map((c) => quote(toCell(getPath(row, c)))).join(','));
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

/** Splits dataset items into data rows and the Actors' free summary row(s). */
export function splitRows(items) {
  const rows = [];
  const summaries = [];
  for (const it of items) (it && it.type === 'summary' ? summaries : rows).push(it);
  return { rows, summary: summaries.at(-1) ?? null };
}
