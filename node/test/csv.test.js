import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allColumns, getPath, guardFormula, splitRows, toCell, toCsv } from '../src/csv.js';

test('getPath reads nested values and collects from arrays', () => {
  const row = { a: { b: 1 }, list: [{ name: 'x' }, { name: 'y' }, {}], tags: ['p', 'q'] };
  assert.equal(getPath(row, 'a.b'), 1);
  assert.deepEqual(getPath(row, 'list[].name'), ['x', 'y']);
  assert.deepEqual(getPath(row, 'tags[]'), ['p', 'q']);
  assert.equal(getPath(row, 'missing.deep'), null);
  assert.equal(getPath(row, 'a.c'), null);
});

test('formula-like text is neutralised, numbers are not', () => {
  assert.equal(guardFormula('=HYPERLINK("x")'), `'=HYPERLINK("x")`);
  assert.equal(guardFormula('@SUM(A1)'), `'@SUM(A1)`);
  assert.equal(guardFormula('-97.76'), '-97.76');
  assert.equal(guardFormula('- dash note'), `'- dash note`);
  assert.equal(toCell(-97.76), '-97.76');
});

test('cells: arrays joined, objects as JSON, null empty', () => {
  assert.equal(toCell(['a', 'b']), 'a; b');
  assert.equal(toCell({ k: 1 }), '{"k":1}');
  assert.equal(toCell(null), '');
  assert.equal(toCell(false), 'false');
});

test('toCsv quotes commas, quotes and newlines; CRLF; optional BOM', () => {
  const csv = toCsv([{ t: 'a, "b"\nc', n: 2 }], ['t', 'n']);
  assert.equal(csv, 't,n\r\n"a, ""b""\nc",2\r\n');
  assert.ok(toCsv([], ['x'], { bom: true }).startsWith('﻿x'));
});

test('splitRows separates the free summary row', () => {
  const { rows, summary } = splitRows([{ type: 'notice', id: 1 }, { type: 'summary', charged: 1 }]);
  assert.equal(rows.length, 1);
  assert.equal(summary.charged, 1);
  assert.equal(splitRows([]).summary, null);
});

test('allColumns keeps first-seen order', () => {
  assert.deepEqual(allColumns([{ a: 1, b: 2 }, { c: 3, a: 4 }]), ['a', 'b', 'c']);
});
