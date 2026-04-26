import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const serverHtml = readFileSync(new URL('../dist/server/log-graph-v091.html', import.meta.url), 'utf8');
const buildManifest = JSON.parse(readFileSync(new URL('../dist/server/build-manifest.json', import.meta.url), 'utf8'));

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

function sha256(textOrBuffer) {
  return createHash('sha256').update(textOrBuffer).digest('hex');
}

test('main inline script is syntactically valid', () => {
  new Function(mainScript());
});

test('build emits the static-server runtime', () => {
  assert.match(serverHtml, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(serverHtml, /<script src="app\.js"><\/script>/);
  assert.doesNotMatch(serverHtml, /function parseTextCore/);
});

test('build manifest matches the current source files', () => {
  assert.equal(buildManifest.entrypoint, 'log-graph-v091.html');
  assert.equal(buildManifest.sources['src/index.template.html'], sha256(serverHtml));
  assert.equal(buildManifest.sources['src/styles.css'], sha256(styleSource));
  assert.equal(buildManifest.sources['src/app.js'], sha256(appSource));
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
    'wallClockTimestampFromParts',
    'timestampFromParts',
    'shortNameFromTag',
    'parseTextCore'
  ]);
  const sample = readFileSync(new URL('../data_base/test_base.txt', import.meta.url), 'utf8');
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
    'wallClockTimestampFromParts',
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

test('grouped parser accepts English Date/Time headers', () => {
  const core = loadCore([
    'stripImportedControlChars',
    'cleanCell',
    'stripBom',
    'normalizeYear',
    'epochToMs',
    'wallClockTimestampFromParts',
    'timestampFromParts',
    'shortNameFromTag',
    'parseTextCore'
  ]);
  const text = [
    '%PAHEADER%',
    'Date TAG2 [bar]\tTime TAG2 [bar]\tms\tstatus\tvalue',
    '22.02.2026\t12:00:00\t000\tGOOD\t1,25'
  ].join('\n');
  const parsed = core.parseTextCore(text);
  assert.equal(parsed.e, null);
  assert.equal(parsed.p.length, 1);
  assert.equal(parsed.p[0].tag, 'TAG2 [bar]');
  assert.equal(parsed.p[0].data[0].status, 'GOOD');
});

test('epoch timestamp is the source of truth when present', () => {
  const core = loadCore(['normalizeYear', 'epochToMs', 'wallClockTimestampFromParts', 'timestampFromParts']);
  const epochUs = '1774155600000000';
  assert.equal(core.timestampFromParts('01-01-2000', '00:00:00', '000', epochUs), core.epochToMs(epochUs));
  assert.equal(core.timestampFromParts('22-03-2026', '12:00:00', '000', ''), core.wallClockTimestampFromParts('22-03-2026', '12:00:00', '000'));
});

test('file parsing is bounded to one or two concurrent files', () => {
  const core = loadCore(['chooseFileParseConcurrency']);
  assert.equal(core.chooseFileParseConcurrency([]), 0);
  assert.equal(core.chooseFileParseConcurrency([{size: 10}, {size: 20}, {size: 30}]), 2);
  assert.equal(core.chooseFileParseConcurrency([{size: 51 * 1024 * 1024}, {size: 20}]), 1);
});

test('merge policy keeps conflicting same-timestamp values and marks them', () => {
  const core = loadCore(
    ['ensureParamColor', 'mergeParsedParams'],
    'const S={style:{PC:{}}}; const PAL=["#38bdf8"];'
  );
  const existing = [{tag: 'TAG', unit: 'bar', sourceFile: 'a.txt', dc: 0, tc: 1, mc: 2, sc: -1, ec: -1, vc: 3, data: [{ts: 1000, val: 1, sourceFile: 'a.txt'}]}];
  const incoming = [{tag: 'TAG', unit: 'bar', sourceFile: 'b.txt', dc: 0, tc: 1, mc: 2, sc: -1, ec: -1, vc: 3, data: [{ts: 1000, val: 2, sourceFile: 'b.txt'}]}];
  const res = core.mergeParsedParams(incoming, existing);
  assert.equal(res.conflicts, 1);
  assert.equal(res.p[0].data.length, 2);
  assert.equal(res.p[0].data.filter(d => d.mergeConflict).length, 2);
});

test('save-with-rename only edits matching header cells', () => {
  const core = loadCore(['stripImportedControlChars', 'cleanCell', 'replaceHeaderTagCell']);
  assert.equal(core.replaceHeaderTagCell('TAG_A [bar]', 'TAG_A [bar]', 'TAG_B [bar]'), 'TAG_B [bar]');
  assert.equal(core.replaceHeaderTagCell('Дата TAG_A [bar]', 'TAG_A [bar]', 'TAG_B [bar]'), 'Дата TAG_B [bar]');
  assert.equal(core.replaceHeaderTagCell('COMMENT TAG_A [bar] COMMENT', 'TAG_A [bar]', 'TAG_B [bar]'), 'COMMENT TAG_A [bar] COMMENT');
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
