import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const rootHtml = readFileSync(new URL('../log-graph-v091.html', import.meta.url), 'utf8');
const serverHtml = readFileSync(new URL('../dist/server/log-graph-v091.html', import.meta.url), 'utf8');

function mainScript() {
  return appSource;
}

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} is present`);
  const bodyStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`function ${name} body was not closed`);
}

function loadCore(names, prefix = '') {
  const src = mainScript();
  const code = [
    prefix,
    ...names.map(name => extractFunction(src, name)),
    `return {${names.join(',')}};`
  ].join('\n');
  return new Function('TextDecoder', 'TextEncoder', code)(TextDecoder, TextEncoder);
}

test('main inline script is syntactically valid', () => {
  new Function(mainScript());
});

test('build emits server and standalone variants', () => {
  assert.match(serverHtml, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(serverHtml, /<script src="app\.js"><\/script>/);
  assert.match(rootHtml, /<style>/);
  assert.match(rootHtml, /vendor\/plotly-3\.5\.0\.min\.js|plotly\.js v/i);
  assert.match(rootHtml, /function parseTextCore/);
});

test('external parser worker is syntactically valid', () => {
  const worker = readFileSync(new URL('../parser.worker.js', import.meta.url), 'utf8');
  new Function(worker);
});

test('external trace worker is syntactically valid', () => {
  const worker = readFileSync(new URL('../trace.worker.js', import.meta.url), 'utf8');
  new Function(worker);
});

test('external parser worker parses sample log', () => {
  const worker = readFileSync(new URL('../parser.worker.js', import.meta.url), 'utf8');
  let posted = null;
  const ctx = {
    self: { postMessage: msg => { posted = msg; } },
    TextDecoder,
    Date,
    Number,
    Math,
    RegExp,
    String,
    Array,
    Object,
    Set
  };
  vm.createContext(ctx);
  vm.runInContext(worker, ctx);
  const sample = readFileSync(new URL('../data_base/test_base.txt', import.meta.url));
  ctx.self.onmessage({ data: { buffer: sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength) } });
  assert.equal(posted.error, null);
  assert.ok(posted.params.length > 0);
});

test('external trace worker prepares downsampled trace', () => {
  const worker = readFileSync(new URL('../trace.worker.js', import.meta.url), 'utf8');
  let posted = null;
  const ctx = {
    self: { postMessage: msg => { posted = msg; } },
    Date,
    Number,
    Math,
    String,
    Array,
    Object,
    Set
  };
  vm.createContext(ctx);
  vm.runInContext(worker, ctx);
  ctx.self.onmessage({ data: { items: [{
    key: 'k',
    param: {
      name: 'P',
      signalKind: 'analog',
      isDiscrete: false,
      color: '#fff',
      lw: 1,
      ld: 'solid',
      data: Array.from({ length: 100 }, (_, i) => ({ ts: i * 100, val: Math.sin(i) }))
    },
    view: { tr: null, qualityGoodOnly: false, dsAlg: 'minmax', maxPts: 20, cgaps: true, t0ms: null }
  }] } });
  assert.equal(posted.error, null);
  assert.equal(posted.items[0].key, 'k');
  assert.ok(posted.items[0].data.yDisp.length <= 22);
});

test('parser handles sample wide log and strips hidden bidi controls', () => {
  const core = loadCore([
    'stripImportedControlChars',
    'cleanCell',
    'stripBom',
    'normalizeYear',
    'epochToMs',
    'timestampFromParts',
    'shortNameFromTag',
    'parseTextCore'
  ]);
  const sample = readFileSync(new URL('../data_base/22-02-2026_12-00_OPRCH_v4_.txt', import.meta.url), 'utf8');
  const parsed = core.parseTextCore(sample);
  assert.equal(parsed.e, null);
  assert.ok(parsed.p.length >= 10);
  assert.ok(parsed.p.some(p => p.unit === '°C'));
  assert.ok(parsed.p.every(p => !/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(p.tag)));
  assert.ok(parsed.p.every(p => p.data.length > 0));
  assert.ok(parsed.p.some(p => p.data.some(d => d.epochUs != null)));
});

test('grouped parser preserves status column per point', () => {
  const core = loadCore([
    'stripImportedControlChars',
    'cleanCell',
    'stripBom',
    'normalizeYear',
    'epochToMs',
    'timestampFromParts',
    'shortNameFromTag',
    'parseTextCore'
  ]);
  const text = [
    '%PAHEADER%',
    'Дата TAG1 [°C]\tВремя TAG1 [°C]\tмс\tstatus\tзначение',
    '22.02.2026\t12:00:00\t100\tGOOD\t23,5',
    '22.02.2026\t12:00:01\t000\tSUBSTITUTED\t24,0'
  ].join('\n');
  const parsed = core.parseTextCore(text);
  assert.equal(parsed.e, null);
  assert.equal(parsed.p.length, 1);
  assert.equal(parsed.p[0].data[0].status, 'GOOD');
  assert.equal(parsed.p[0].data[1].status, 'SUBSTITUTED');
});

test('signal kind detection separates binary, step, and analog series', () => {
  const core = loadCore(['detectSignalKind']);
  assert.equal(core.detectSignalKind([{val: 0}, {val: 1}, {val: 1}], 'relay'), 'binary');
  assert.equal(core.detectSignalKind([{val: 103.6}, {val: 103.6}, {val: 104.0}], 'TNR Speed/Load Set Point'), 'step');
  assert.equal(core.detectSignalKind([{val: 10.1}, {val: 10.3}, {val: 10.7}, {val: 11.2}], 'temperature'), 'analog');
});

test('smart decoder round-trips Windows-1251 log bytes', () => {
  const core = loadCore([
    'stripImportedControlChars',
    'cleanCell',
    'stripBom',
    'scoreDecodedLog',
    'decodeWithLabel',
    'decodeBytesSmart',
    'toCp1251'
  ]);
  const source = 'Дата\tВремя\tмс\tТемпература [°C]\n22.02.2026\t12:00:00\t000\t23,5';
  const decoded = core.decodeBytesSmart(core.toCp1251(source));
  assert.equal(decoded.encoding, 'windows-1251');
  assert.match(decoded.text, /Температура \[°C\]/);
});

test('CSV escaping quotes semicolons, quotes, and line breaks', () => {
  const core = loadCore(['csvCell', 'rowsToCsv']);
  const csv = core.rowsToCsv([
    ['A', 'B;C', 'D"E', 'F\nG']
  ]);
  assert.equal(csv, 'A;"B;C";"D""E";"F\nG"');
});

test('raw-long export branch does not interpolate synthetic values', () => {
  const src = mainScript();
  const start = src.indexOf("if(mode === 'raw' || mode === 'raw-long')");
  const end = src.indexOf('/* Optional extra X range', start);
  assert.ok(start > 0 && end > start, 'raw-long branch is found');
  const branch = src.slice(start, end);
  assert.doesNotMatch(branch, /interpY|interpStep|dsDispatch|downsample/);
  assert.match(branch, /d\.status/);
});
