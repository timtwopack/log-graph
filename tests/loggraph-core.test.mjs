import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const parserCoreSource = readFileSync(new URL('../src/parser-core.js', import.meta.url), 'utf8');
const parserWorkerSource = readFileSync(new URL('../src/parser.worker.js', import.meta.url), 'utf8');
const traceWorkerSource = readFileSync(new URL('../src/trace.worker.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const serveLocalSource = readFileSync(new URL('../serve-local.ps1', import.meta.url), 'utf8');
const serverHtml = readFileSync(new URL('../build/index.html', import.meta.url), 'utf8');
const builtAppSource = readFileSync(new URL('../build/app.js', import.meta.url), 'utf8');
const buildManifest = JSON.parse(readFileSync(new URL('../build/build-manifest.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(packageSource);

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

function loadFromSource(src, names, prefix = '') {
  const code = [
    prefix,
    ...names.map(name => extractFunction(src, name)),
    `return {${names.join(',')}};`
  ].join('\n');
  return new Function('TextDecoder', 'TextEncoder', code)(TextDecoder, TextEncoder);
}
function loadAppCore(names, prefix = '') {
  const columnarDeps = [
    '_isArrayIndex',
    '_newCodeArray',
    '_cloneFloatArray',
    '_cloneBoolArray',
    '_codeColumnGet',
    '_codeColumnSet',
    '_codeColumnDelete',
    '_floatColumnGet',
    '_floatColumnSet',
    '_floatColumnDelete',
    'createColumnarPoint',
    'createColumnarData',
    'isColumnarData',
    'columnarValue',
    'columnarSetValue',
    'columnarDeleteValue',
    'columnarHasField',
    'columnarCount',
    'columnarFilteredXY',
    'columnarTraceWorkerPayload',
    'columnarDataFromPoints',
    'columnarDataFromSeries',
    'ensureColumnarParam'
  ];
  const needsColumnar = names.some(name => columnarDeps.includes(name) || [
    'inflateWorkerParams',
    'mergeParsedParams',
    'detectSignalKind',
    'detectDiscrete',
    'hasBadQuality',
    'filt',
    'prepareXYData'
  ].includes(name));
  const expanded = needsColumnar ? [...columnarDeps, ...names] : names;
  return loadFromSource(appSource, Array.from(new Set(expanded)), prefix);
}
function loadParserCore(names, prefix = '') {
  const code = [
    'const self = {};',
    prefix,
    parserCoreSource,
    `return {${names.join(',')}};`
  ].join('\n');
  return new Function('TextDecoder', 'TextEncoder', code)(TextDecoder, TextEncoder);
}

function sha256(textOrBuffer) {
  return createHash('sha256').update(textOrBuffer).digest('hex');
}

function startStaticServer(rootUrl) {
  const server = createServer((req, res) => {
    try{
      const rawPath = (req.url || '/').split('?', 1)[0] || '/';
      if(rawPath.includes('..')){
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const path = rawPath === '/' ? '/index.html' : rawPath;
      const body = readFileSync(new URL('.' + path, rootUrl));
      res.writeHead(200, {'Content-Type': 'application/octet-stream'});
      res.end(body);
    }catch(_e){
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({server, baseUrl: `http://127.0.0.1:${address.port}`});
    });
  });
}

test('main inline script is syntactically valid', () => {
  new Function(appSource);
});

test('build emits the static-server runtime', () => {
  assert.match(serverHtml, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(serverHtml, /<script src="app\.js"><\/script>/);
  assert.doesNotMatch(serverHtml, /\son(?:click|input|change|drop|dragover|dragleave|keydown|keyup|submit)=/i);
  assert.doesNotMatch(serverHtml, /function parseTextCore/);
  assert.doesNotMatch(appSource, /function parseTextCore/);
  assert.doesNotMatch(appSource, /function decodeBytesSmart/);
  assert.doesNotMatch(appSource, /parserWorkerScript/);
});

test('local static server enables cross-origin isolation for shared buffers', () => {
  assert.match(serveLocalSource, /Cross-Origin-Opener-Policy:\s*same-origin/);
  assert.match(serveLocalSource, /Cross-Origin-Embedder-Policy:\s*require-corp/);
  assert.match(serveLocalSource, /Cross-Origin-Resource-Policy:\s*same-origin/);
});

test('build manifest matches the current source files', () => {
  assert.equal(buildManifest.entrypoint, 'index.html');
  assert.equal(buildManifest.sources['src/index.template.html'], sha256(templateSource));
  assert.equal(buildManifest.sources['src/styles.css'], sha256(styleSource));
  assert.equal(buildManifest.sources['src/app.js'], sha256(appSource));
  assert.equal(buildManifest.sources['package.json'], sha256(packageSource));
  assert.equal(buildManifest.sources['serve-local.ps1'], sha256(serveLocalSource));
  assert.equal(buildManifest.sources['src/parser-core.js'], sha256(parserCoreSource));
  assert.equal(buildManifest.sources['src/parser.worker.js'], sha256(parserWorkerSource));
  assert.equal(buildManifest.sources['src/trace.worker.js'], sha256(traceWorkerSource));
  assert.match(serverHtml, new RegExp(`PA·GRAPH v${packageJson.version.replaceAll('.', '\\.')}`));
  assert.match(builtAppSource, new RegExp(`const APP_VERSION = '${packageJson.version.replaceAll('.', '\\.')}'`));
  assert.doesNotMatch(builtAppSource, /__APP_VERSION__/);
});

test('external parser worker is syntactically valid', () => {
  new Function(parserWorkerSource);
});

test('external trace worker is syntactically valid', () => {
  new Function(traceWorkerSource);
});

test('external parser worker parses sample log', async () => {
  let posted = null;
  let postedTransfer = null;
  const ctx = {
    self: { postMessage: (msg, transfer) => { posted = msg; postedTransfer = transfer || []; } },
    importScripts: (...paths) => {
      for(const path of paths){
        if(path !== 'parser-core.js') throw new Error(`unexpected importScripts path: ${path}`);
        vm.runInContext(parserCoreSource, ctx);
      }
    },
    TextDecoder,
    Date,
    Number,
    Math,
    RegExp,
    String,
    Array,
    Map,
    Object,
    Set,
    Float64Array,
    Int32Array,
    Uint8Array,
    BigInt64Array,
    BigInt
  };
  vm.createContext(ctx);
  vm.runInContext(parserWorkerSource, ctx);
  const app = loadAppCore(['inflateWorkerParams', 'isColumnarData']);
  const sample = readFileSync(new URL('../data_base/test_base.txt', import.meta.url));
  ctx.self.onmessage({ data: { buffer: sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength), keepText: true } });
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if(posted) resolve();
      else if(Date.now() - started > 1000) reject(new Error('parser worker did not post a result'));
      else setTimeout(tick, 5);
    };
    tick();
  });
  assert.equal(posted.error, null);
  assert.ok(posted.paramsColumnar.length > 0);
  assert.ok(postedTransfer.length >= posted.paramsColumnar.length * 2);
  let params = app.inflateWorkerParams(posted);
  assert.ok(params.length > 0);
  assert.equal(Array.isArray(params[0].data), false);
  assert.equal(app.isColumnarData(params[0].data), true);
  assert.ok(params[0].data.length > 0);
  assert.ok(params.some(p => p.data.some(d => d.epochRaw === '1774155600000000' && d.epochUs === 1774155600000000)));
  assert.ok(posted.text.length > 0);

  posted = null;
  postedTransfer = null;
  ctx.self.onmessage({ data: { buffer: sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength), keepText: false } });
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if(posted) resolve();
      else if(Date.now() - started > 1000) reject(new Error('parser worker did not post a second result'));
      else setTimeout(tick, 5);
    };
    tick();
  });
  assert.equal(posted.error, null);
  assert.equal(posted.text, '');
  params = app.inflateWorkerParams(posted);
  assert.ok(params.length > 0);

  posted = null;
  postedTransfer = null;
  ctx.self.onmessage({ data: { file: new File([sample], 'sample.txt'), keepText: false } });
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if(posted) resolve();
      else if(Date.now() - started > 1000) reject(new Error('parser worker did not post a stream result'));
      else setTimeout(tick, 5);
    };
    tick();
  });
  assert.equal(posted.error, null);
  params = app.inflateWorkerParams(posted);
  assert.ok(params.length > 0);
  assert.equal(posted.text, '');
});

test('parser worker emits SharedArrayBuffer columns when cross-origin isolated', async () => {
  let posted = null;
  let postedTransfer = null;
  const ctx = {
    self: {
      crossOriginIsolated: true,
      postMessage: (msg, transfer) => { posted = msg; postedTransfer = transfer || []; }
    },
    importScripts: (...paths) => {
      for(const path of paths){
        if(path !== 'parser-core.js') throw new Error(`unexpected importScripts path: ${path}`);
        vm.runInContext(parserCoreSource, ctx);
      }
    },
    TextDecoder,
    Date,
    Number,
    Math,
    RegExp,
    String,
    Array,
    Map,
    Object,
    Set,
    Float64Array,
    Int32Array,
    Uint8Array,
    BigInt64Array,
    BigInt,
    SharedArrayBuffer
  };
  vm.createContext(ctx);
  vm.runInContext(parserWorkerSource, ctx);
  const sample = readFileSync(new URL('../data_base/test_base.txt', import.meta.url));
  ctx.self.onmessage({ data: { buffer: sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength), keepText: false } });
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if(posted) resolve();
      else if(Date.now() - started > 1000) reject(new Error('parser worker did not post a shared-buffer result'));
      else setTimeout(tick, 5);
    };
    tick();
  });
  assert.equal(posted.error, null);
  assert.equal(posted.sharedBuffers, true);
  assert.ok(posted.paramsColumnar.length > 0);
  assert.equal(postedTransfer.length, 0);
  assert.ok(posted.paramsColumnar[0].ts.buffer instanceof SharedArrayBuffer);
  assert.ok(posted.paramsColumnar[0].val.buffer instanceof SharedArrayBuffer);
  const app = loadAppCore(['inflateWorkerParams']);
  const params = app.inflateWorkerParams(posted);
  assert.ok(params[0].data._cols.ts.buffer instanceof SharedArrayBuffer);
});

test('trace worker payload transfers cloned columnar buffers', () => {
  const app = loadAppCore([
    'createColumnarData',
    'columnarSetValue',
    'columnarValue',
    'columnarTraceWorkerPayload'
  ]);
  const data = app.createColumnarData({
    ts: new Float64Array([1000, 2000]),
    val: new Float64Array([10, 20])
  });
  app.columnarSetValue(data, 0, 'status', 'Bad');
  const transfer = [];
  const payload = app.columnarTraceWorkerPayload(data, transfer);
  assert.deepEqual(Array.from(payload.ts), [1000, 2000]);
  assert.deepEqual(Array.from(payload.val), [10, 20]);
  assert.deepEqual(payload.statusValues, ['Bad']);
  assert.notEqual(payload.ts.buffer, data._cols.ts.buffer);
  assert.notEqual(payload.val.buffer, data._cols.val.buffer);
  assert.ok(transfer.includes(payload.ts.buffer));
  assert.ok(transfer.includes(payload.val.buffer));
  payload.ts[0] = 9999;
  assert.equal(app.columnarValue(data, 0, 'ts'), 1000);
});

test('trace worker payload reuses shared columnar buffers without transfer', () => {
  const app = loadAppCore([
    'createColumnarData',
    'columnarTraceWorkerPayload'
  ]);
  const ts = new Float64Array(new SharedArrayBuffer(16));
  const val = new Float64Array(new SharedArrayBuffer(16));
  ts.set([1000, 2000]);
  val.set([10, 20]);
  const data = app.createColumnarData({ts, val});
  const transfer = [];
  const payload = app.columnarTraceWorkerPayload(data, transfer);
  assert.equal(payload.sharedBuffers, true);
  assert.equal(payload.ts.buffer, data._cols.ts.buffer);
  assert.equal(payload.val.buffer, data._cols.val.buffer);
  assert.equal(transfer.length, 0);
});

test('worker columnar params inflate status, epoch, and time source', () => {
  const app = loadAppCore(['inflateWorkerParams', 'isColumnarData']);
  const params = app.inflateWorkerParams({
    paramsColumnar: [{
      meta: {tag: 'TAG [bar]', unit: 'bar', length: 2, timezone: 'epoch', timeSource: 'epoch'},
      ts: new Float64Array([10, 20]),
      val: new Float64Array([1.5, 2.5]),
      statusValues: ['GOOD'],
      statusCodes: new Int32Array([0, -1]),
      epochUs: new Float64Array([1000000, NaN]),
      epochRaw: new BigInt64Array([1000000n, 0n]),
      epochRawMask: new Uint8Array([1, 0]),
      timeSourceValues: ['epoch', 'local'],
      timeSourceCodes: new Int32Array([0, 1])
    }]
  });
  assert.equal(Array.isArray(params[0].data), false);
  assert.equal(app.isColumnarData(params[0].data), true);
  assert.equal(params[0].tag, 'TAG [bar]');
  assert.equal(params[0].data[0].status, 'GOOD');
  assert.equal(params[0].data[0].epochRaw, '1000000');
  assert.equal(params[0].data[0].timeSource, 'epoch');
  assert.equal(params[0].data[1].timeSource, 'local');
});

test('external trace worker prepares downsampled trace', () => {
  let posted = null;
  const ctx = {
    self: { postMessage: msg => { posted = msg; } },
    Date,
    Number,
    Math,
    String,
    Array,
    Object,
    Set,
    Float64Array,
    Int32Array,
    Uint8Array
  };
  vm.createContext(ctx);
  vm.runInContext(traceWorkerSource, ctx);
  const ts = new Float64Array(100);
  const val = new Float64Array(100);
  for(let i = 0; i < 100; i++){
    ts[i] = i * 100;
    val[i] = Math.sin(i);
  }
  ctx.self.onmessage({ data: {
    type: 'load',
    requestId: 'load-1',
    reset: true,
    params: [{id: 'p1', dataColumnar: {ts, val, statusCodes: null, statusValues: []}}]
  } });
  assert.equal(posted.error, null);
  assert.equal(posted.type, 'load');
  assert.equal(posted.stored, 1);
  ctx.self.onmessage({ data: { type: 'prepare', requestId: 'prep-1', items: [{
    key: 'k',
    param: {
      dataId: 'p1',
      name: 'P',
      signalKind: 'analog',
      isDiscrete: false,
      color: '#fff',
      lw: 1,
      ld: 'solid'
    },
    view: { tr: null, qualityGoodOnly: false, dsAlg: 'minmax', maxPts: 20, cgaps: true, t0ms: null }
  }] } });
  assert.equal(posted.error, null);
  assert.equal(posted.type, 'prepare');
  assert.equal(posted.requestId, 'prep-1');
  assert.equal(posted.items[0].key, 'k');
  assert.ok(posted.items[0].data.yDisp.length <= 22);
});

test('built runtime assets are fetchable over HTTP', async t => {
  const {server, baseUrl} = await startStaticServer(new URL('../build/', import.meta.url));
  t.after(() => server.close());
  for(const path of ['/index.html', '/app.js', '/parser-core.js', '/parser.worker.js', '/trace.worker.js', '/vendor/plotly-3.5.0.min.js']){
    const res = await fetch(baseUrl + path);
    assert.equal(res.status, 200, `${path} is served`);
    const text = await res.text();
    assert.ok(text.length > 0, `${path} has content`);
  }
});

test('parser handles sample wide log and strips hidden bidi controls', () => {
  const core = loadParserCore([
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
  assert.equal(Array.isArray(parsed.p[0].data), false);
  assert.ok(parsed.p.some(p => p.data.some(d => d.epochUs != null)));
});

test('grouped parser preserves status column per point', () => {
  const core = loadParserCore([
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
  const core = loadParserCore([
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
  const core = loadParserCore(['normalizeYear', 'epochToMs', 'wallClockTimestampFromParts', 'timestampFromParts']);
  const epochUs = '1774155600000000';
  assert.equal(core.timestampFromParts('01-01-2000', '00:00:00', '000', epochUs), core.epochToMs(epochUs));
  assert.equal(core.timestampFromParts('22-03-2026', '12:00:00', '000', ''), core.wallClockTimestampFromParts('22-03-2026', '12:00:00', '000'));
  assert.equal(core.normalizeYear('69'), 2069);
  assert.equal(core.normalizeYear('70'), 1970);
});

test('wide parser detects epoch column from multiple data rows', () => {
  const core = loadParserCore(['parseTextCore']);
  const rows = ['Дата\tВремя\tмс\tmaybe_epoch\tTAG [bar]'];
  rows.push('22.02.2026\t12:00:00\t000\tbad\t1,0');
  for(let i = 1; i <= 20; i++){
    rows.push('22.02.2026\t12:00:' + String(i).padStart(2, '0') + '\t000\t17741556' + String(i).padStart(8, '0') + '\t' + String(i).replace('.', ','));
  }
  const parsed = core.parseTextCore(rows.join('\n'));
  assert.equal(parsed.e, null);
  assert.equal(parsed.p.length, 1);
  assert.equal(parsed.p[0].tag, 'TAG [bar]');
  assert.equal(parsed.p[0].ec, 3);
  assert.ok(parsed.p[0].data.some(d => d.timeSource === 'epoch'));
});

test('file parsing is bounded to one or two concurrent files', () => {
  const core = loadAppCore(['chooseFileParseConcurrency']);
  assert.equal(core.chooseFileParseConcurrency([]), 0);
  assert.equal(core.chooseFileParseConcurrency([{size: 10}, {size: 20}, {size: 30}]), 2);
  assert.equal(core.chooseFileParseConcurrency([{size: 51 * 1024 * 1024}, {size: 20}]), 1);
});

test('merge policy keeps conflicting same-timestamp values and marks them', () => {
  const core = loadAppCore(
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
  const core = loadAppCore(['stripImportedControlChars', 'cleanCell', 'replaceHeaderTagCell']);
  assert.equal(core.replaceHeaderTagCell('TAG_A [bar]', 'TAG_A [bar]', 'TAG_B [bar]'), 'TAG_B [bar]');
  assert.equal(core.replaceHeaderTagCell('Дата TAG_A [bar]', 'TAG_A [bar]', 'TAG_B [bar]'), 'Дата TAG_B [bar]');
  assert.equal(core.replaceHeaderTagCell('COMMENT TAG_A [bar] COMMENT', 'TAG_A [bar]', 'TAG_B [bar]'), 'COMMENT TAG_A [bar] COMMENT');
});

test('signal kind detection separates binary, step, and analog series', () => {
  const core = loadAppCore(['detectSignalKind']);
  assert.equal(core.detectSignalKind([{val: 0}, {val: 1}, {val: 1}], 'relay'), 'binary');
  assert.equal(core.detectSignalKind([{val: 103.6}, {val: 103.6}, {val: 104.0}], 'TNR Speed/Load Set Point'), 'step');
  assert.equal(core.detectSignalKind([{val: 10.1}, {val: 10.3}, {val: 10.7}, {val: 11.2}], 'temperature'), 'analog');
});

test('quality status normalization accepts common good variants', () => {
  const core = loadAppCore(['isBadQuality']);
  assert.equal(core.isBadQuality(' GOODLOCALOVERRIDE '), false);
  assert.equal(core.isBadQuality('0,0'), false);
  assert.equal(core.isBadQuality('0.00'), false);
  assert.equal(core.isBadQuality(' SUBSTITUTED '), true);
});

test('MinMaxLTTB downsampling keeps endpoints and respects budget', () => {
  const core = loadAppCore(['downsample', 'downsampleMinMax', 'downsampleMinMaxLttb']);
  const x = Array.from({ length: 1000 }, (_, i) => i);
  const y = x.map(i => Math.sin(i / 10) + (i === 500 ? 10 : 0));
  const out = core.downsampleMinMaxLttb(x, y, 80);
  assert.equal(out.x[0], 0);
  assert.equal(out.x[out.x.length - 1], 999);
  assert.ok(out.x.length <= 80);
  assert.ok(out.y.some(v => v > 9));
});

test('smart decoder round-trips Windows-1251 log bytes', () => {
  const parser = loadParserCore([
    'stripImportedControlChars',
    'cleanCell',
    'stripBom',
    'scoreDecodedLog',
    'decodeWithLabel',
    'decodeBytesSmart'
  ]);
  const app = loadAppCore(['toCp1251']);
  const source = 'Дата\tВремя\tмс\tТемпература [°C]\n22.02.2026\t12:00:00\t000\t23,5';
  const decoded = parser.decodeBytesSmart(app.toCp1251(source));
  assert.equal(decoded.encoding, 'windows-1251');
  assert.match(decoded.text, /Температура \[°C\]/);
});

test('smart decoder round-trips UTF-16LE and UTF-16BE log bytes', () => {
  const parser = loadParserCore([
    'stripImportedControlChars',
    'cleanCell',
    'stripBom',
    'scoreDecodedLog',
    'decodeWithLabel',
    'decodeBytesSmart'
  ]);
  const app = loadAppCore(['toUtf16Le', 'encodeTextBytes']);
  const source = 'Дата\tВремя\tмс\tДавление [бар]\n22.02.2026\t12:00:00\t000\t20,5';
  for(const encoding of ['utf-16le', 'utf-16be']){
    const decoded = parser.decodeBytesSmart(app.encodeTextBytes(source, encoding));
    assert.equal(decoded.encoding, encoding);
    assert.match(decoded.text, /Давление \[бар\]/);
  }
});

test('CSV escaping quotes semicolons, quotes, and line breaks', () => {
  const core = loadAppCore(['csvCell', 'rowsToCsv']);
  const csv = core.rowsToCsv([
    ['A', 'B;C', 'D"E', 'F\nG']
  ]);
  assert.equal(csv, 'A;"B;C";"D""E";"F\nG"');
});

test('UTC display formatting is explicit for epoch logs', () => {
  const core = loadAppCore(
    ['pad2', 'effectiveTimeZone', 'dateParts', 'fmtTsExcel', 'timeColumnHeader'],
    "const S = {time:{DISPLAY_TZ:'utc', HAS_EPOCH:true}};"
  );
  const ts = Date.UTC(2026, 0, 2, 3, 4, 5, 6);
  assert.equal(core.fmtTsExcel(ts), '02.01.2026 03:04:05.006');
  assert.equal(core.timeColumnHeader(), 'Дата/Время (UTC)');
});

test('raw-long export branch does not interpolate synthetic values', () => {
  const src = appSource;
  const start = src.indexOf("if(mode === 'raw' || mode === 'raw-long')");
  const end = src.indexOf('/* Optional extra X range', start);
  assert.ok(start > 0 && end > start, 'raw-long branch is found');
  const branch = src.slice(start, end);
  assert.doesNotMatch(branch, /interpY|interpStep|dsDispatch|downsample/);
  assert.doesNotMatch(branch, /for\(const d of p\.data\)/);
  assert.match(branch, /columnarValue\(data, i, 'status'\)/);
});
