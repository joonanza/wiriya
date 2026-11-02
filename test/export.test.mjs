import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCSV, QUOTE_COLUMNS } from '../js/export.js';

test('csvCell escapes commas, quotes, newlines', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(250), '250');
});

test('csvCell blocks formula injection but keeps negative numbers', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell('+66812345678'), "'+66812345678");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-50'), '-50');
});

test('toCSV adds BOM and header, Thai text intact', () => {
  const out = toCSV([{ status: 'confirmed', customer_name: 'สมชาย', pickup: { name: 'บ้าน, ชลบุรี' }, options: { roundTrip: true }, fare_quoted: 300, created_at: '2026-11-02T03:00:00Z' }], QUOTE_COLUMNS);
  assert.ok(out.startsWith('﻿สร้างเมื่อ,'));
  const line = out.split('\r\n')[1];
  assert.match(line, /^2026-11-02 10:00,/);   // เวลาไทย
  assert.match(line, /ยืนยันแล้ว/);
  assert.match(line, /"บ้าน, ชลบุรี"/);
  assert.match(line, /,ใช่,/);
});
