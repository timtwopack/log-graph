'use strict';

const APP_VERSION = '__APP_VERSION__';

/* ===== State namespace =====
   All mutable module-level state lives under S, grouped by concern. Every
   reference in the main script goes through S.<group>.<name>; this is the single
   source of truth. Consts (palette, marker type table, unit conversions) stay
   module-level because they are immutable. */
const S = {
  ui: {
    MODE: 'o',
    XY_MODE: false,
    XY_XPARAM: null,
    RSLIDER: true,
    LT: false,
    MEASURE_ON: false,
    READY: false,
    _colorPickerOpen: false,
    _sidebarVisible: true,
    _busy: false,
    TAG_SEARCH: '',
    /* Per-tag expansion state for the param-row details panel (line style, levels,
       units). Not persisted across sessions — always collapsed on fresh load. */
    _paramExpand: new Set(),
    _paramExpandAll: false
  },
  data: {
    AP: [],
    FN: [],
    SEL: new Set(),
    _fileStore: {},
    QUALITY_GOOD_ONLY: false
  },
  view: {
    CH: 0,
    AXIS_SPACING_PX: 55,
    LW: 1.5,
    LDASH: 'solid',
    CGAPS: true,
    SMOOTH_TYPE: 'none',
    SMOOTH_STR: 30,
    SMOOTH_ORIG: false,
    DS_ALG: 'lttb',
    TR: null,
    TB: null,
    YR: [null, null],
    FONT_SCALE: 1.0
  },
  style: {
    PC: {},
    PW: {},
    PD: {},
    PL: {},
    CTT: {}
  },
  plot: {
    _activePlot: null,
    _allPlots: [],
    _syncingRange: false,
    _savedRange: null,
    _savedYRanges: {},
    _allTraceData: [],
    _plotCache: [],
    _lastRenderSig: null,
    _rt: null
  },
  cursor: {
    _cursorA: null,
    _cursorB: null,
    _valsA: {},
    _valsB: {},
    _draggingCursor: null,
    _justDragged: false
  },
  markers: {
    MARKERS: [],
    MARKER_FILTER: {event:true, warn:true, alarm:true, info:true, custom:true},
    MARKER_SEARCH: '',
    MARKER_ADD_TYPE: null,
    _mid: 0
  },
  zoom: {
    ZOOM_HISTORY: [],
    ZOOM_POINTER: -1,
    _zoomRestoring: false
  },
  t0: {
    T0_MODE: false,
    _t0ms: null
  },
  anomaly: {
    ANOMALY_ON: false
  },
  presets: {
    PRESETS: {}
  },
  runtime: {
    ERRORS: [],
    PERF: [],
    _lastLoadSummary: null
  }
};

/* ===== Marker subsystem — typed markers replacing the old free-text annotations ===== */
const MARKER_TYPES = {
  event: {color: '#34d399', label: 'Событие',     icon: '●', dash: 'solid'},
  warn:  {color: '#facc15', label: 'Предупр.',    icon: '▲', dash: 'solid'},
  alarm: {color: '#f87171', label: 'Авария',      icon: '⚠', dash: 'solid'},
  info:  {color: '#38bdf8', label: 'Заметка',     icon: 'ℹ', dash: 'dash'},
  custom:{color: '#a78bfa', label: 'Своя',        icon: '◆', dash: 'dot'}
};

/* Zoom history — back/forward stack; ZOOM_MAX is the history cap, the stack lives in S.zoom. */
const ZOOM_MAX = 40;

/* ===== Unit conversion registry =====
   Key = source unit (exact match against p.unit). Value = array of possible targets
   with conversion function. Conversions modify p.data in-place — symmetric pairs
   let the user undo by clicking the reverse conversion. */
const UNIT_CONVERSIONS = {
  '°C':  [{to: '°F', fn: v => v * 9/5 + 32}, {to: 'K', fn: v => v + 273.15}],
  'C':   [{to: '°F', fn: v => v * 9/5 + 32}, {to: 'K', fn: v => v + 273.15}],
  '°F':  [{to: '°C', fn: v => (v - 32) * 5/9}, {to: 'K', fn: v => (v - 32) * 5/9 + 273.15}],
  'F':   [{to: '°C', fn: v => (v - 32) * 5/9}, {to: 'K', fn: v => (v - 32) * 5/9 + 273.15}],
  'K':   [{to: '°C', fn: v => v - 273.15}, {to: '°F', fn: v => (v - 273.15) * 9/5 + 32}],
  'bar': [{to: 'psi', fn: v => v * 14.5038}, {to: 'kPa', fn: v => v * 100}, {to: 'MPa', fn: v => v / 10}],
  'бар': [{to: 'psi', fn: v => v * 14.5038}, {to: 'кПа', fn: v => v * 100}, {to: 'МПа', fn: v => v / 10}],
  'psi': [{to: 'bar', fn: v => v / 14.5038}, {to: 'kPa', fn: v => v * 6.89476}],
  'kPa': [{to: 'bar', fn: v => v / 100}, {to: 'psi', fn: v => v / 6.89476}, {to: 'MPa', fn: v => v / 1000}],
  'кПа': [{to: 'бар', fn: v => v / 100}, {to: 'psi', fn: v => v / 6.89476}, {to: 'МПа', fn: v => v / 1000}],
  'MPa': [{to: 'bar', fn: v => v * 10}, {to: 'kPa', fn: v => v * 1000}],
  'МПа': [{to: 'бар', fn: v => v * 10}, {to: 'кПа', fn: v => v * 1000}],
  'Hz':  [{to: 'kHz', fn: v => v / 1000}, {to: 'об/мин', fn: v => v * 60}],
  'Гц':  [{to: 'кГц', fn: v => v / 1000}, {to: 'об/мин', fn: v => v * 60}],
  'kHz': [{to: 'Hz', fn: v => v * 1000}],
  'кГц': [{to: 'Гц', fn: v => v * 1000}],
  'rpm': [{to: 'Hz', fn: v => v / 60}],
  'об/мин': [{to: 'Гц', fn: v => v / 60}],
  'W':   [{to: 'kW', fn: v => v / 1000}, {to: 'MW', fn: v => v / 1e6}],
  'kW':  [{to: 'W', fn: v => v * 1000}, {to: 'MW', fn: v => v / 1000}],
  'MW':  [{to: 'kW', fn: v => v * 1000}, {to: 'W', fn: v => v * 1e6}],
  'Вт':  [{to: 'кВт', fn: v => v / 1000}, {to: 'МВт', fn: v => v / 1e6}],
  'кВт': [{to: 'Вт', fn: v => v * 1000}, {to: 'МВт', fn: v => v / 1000}],
  'МВт': [{to: 'кВт', fn: v => v * 1000}],
  'm':   [{to: 'ft', fn: v => v * 3.28084}, {to: 'km', fn: v => v / 1000}],
  'ft':  [{to: 'm', fn: v => v / 3.28084}],
  'km':  [{to: 'm', fn: v => v * 1000}],
  'м':   [{to: 'фут', fn: v => v * 3.28084}, {to: 'км', fn: v => v / 1000}],
  'km/h':[{to: 'mph', fn: v => v / 1.60934}, {to: 'm/s', fn: v => v / 3.6}],
  'm/s': [{to: 'km/h', fn: v => v * 3.6}, {to: 'mph', fn: v => v * 2.23694}]
};

/* Plotly.react fast path: when the chart structure (mode, params, slider, theme)
   is unchanged we skip purge+newPlot and swap traces/layout via Plotly.react.
   S.plot._plotCache stores per-chart refs so the fast path can rebuild specs and reuse divs. */

const PAL = ["#22d3ee","#f472b6","#a78bfa","#34d399","#fb923c","#facc15","#f87171","#60a5fa","#c084fc","#4ade80","#e879f9","#38bdf8","#fbbf24","#818cf8","#2dd4bf","#fb7185","#a3e635","#f97316","#67e8f9","#d946ef"];
const MAX_PTS = 5000;
const WEBGL_THRESHOLD = 2000; /* use WebGL for traces above this many points — much faster zoom/pan */
const MAX_INPUT_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_STORED_TEXT_BYTES = 25 * 1024 * 1024;
const TRACE_WORKER_MAX_CLONE_POINTS = 250000;
const MAX_SESSION_JSON_BYTES = 180 * 1024 * 1024;
const MAX_SESSION_PARAMS = 3000;
const MAX_SESSION_POINTS = 12_000_000;
const MAX_MARKERS_IMPORT = 10000;
const MAX_MARKER_TEXT = 1000;

const fi = document.getElementById('fi');
fi.addEventListener('change', e => {
  hf(e.target.files);
  e.target.value = '';
});

function $(id){ return document.getElementById(id); }
function wireStaticUi(){
  const actionHandlers = {
    'toggle-sidebar': () => togSidebar(),
    'toggle-help': () => togHelp(),
    'toggle-theme': () => togTheme(),
    'toggle-measure': () => togMeasure(),
    'zoom-back': () => zoomBack(),
    'zoom-forward': () => zoomForward(),
    'toggle-export-menu': () => togExportMenu(),
    'export-csv': el => { exportCSV(el.dataset.mode, el.dataset.encoding); closeExportMenu(); },
    'export-png': () => { exportPNG(); closeExportMenu(); },
    'toggle-session-menu': () => togSessionMenu(),
    'save-session': () => { saveSession(); closeSessionMenu(); },
    'export-session': () => { exportSessionToFile(); closeSessionMenu(); },
    'import-session': () => { importSessionFromFile(); closeSessionMenu(); },
    'export-diagnostics': () => { exportDiagnostics(); closeSessionMenu(); },
    'open-files': () => $('fi').click(),
    'reset-all': () => resetAll(),
    'save-preset': () => savePreset(),
    'select-all': () => selAll(),
    'select-none': () => selNone(),
    'reset-time-range': () => rstTR(),
    'export-markers-json': () => exportMarkersJSON(),
    'import-markers': () => importMarkersClick(),
    'export-markers-csv': () => exportMarkersCSV(),
    'toggle-add-marker': () => togAddMarker(),
    'clear-markers': () => clearAllMarkers(),
    'set-display-mode': el => setM(el.dataset.mode),
    'set-plot-mode': el => setPlotMode(el.dataset.mode),
    'toggle-connect-gaps': () => togCgaps(),
    'toggle-range-slider': () => togRslider(),
    'toggle-quality-filter': () => togQualityFilter(),
    'set-smooth': el => setSmooth(el.dataset.mode),
    'toggle-smooth-original': () => togSmoothOrig(),
    'set-downsample': el => setDS(el.dataset.mode),
    'toggle-anomaly': () => togAnomaly(),
    'toggle-t0': () => togT0(),
    'reset-t0': () => resetT0(),
    'reset-y': () => rstY(),
    'clear-cursors': () => clearCursors()
  };
  const inputHandlers = {
    'tag-search': el => setTagSearch(el.value),
    'height': el => setH(el.value),
    'axis-spacing': el => setAxisSpacing(el.value),
    'font-scale': el => setFontScale(el.value),
    'time-range': () => onTR(),
    'manual-x-range': () => onMXR(),
    'marker-search': el => setMarkerSearch(el.value),
    'smooth-strength': el => setSmoothStr(el.value),
    'y-range': () => onYR()
  };
  const changeHandlers = {
    'xy-param': el => setXYParam(el.value),
    'render': () => render()
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if(!el) return;
    const handler = actionHandlers[el.dataset.action];
    if(!handler) return;
    e.preventDefault();
    handler(el, e);
  });
  document.addEventListener('input', e => {
    const el = e.target;
    const handler = inputHandlers[el && el.dataset ? el.dataset.input : ''];
    if(handler) handler(el, e);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    const handler = changeHandlers[el && el.dataset ? el.dataset.change : ''];
    if(handler) handler(el, e);
  });

  const ca = $('ca');
  if(ca){
    ca.addEventListener('drop', onDrop);
    ca.addEventListener('dragover', onDgOv);
    ca.addEventListener('dragleave', onDgLv);
  }
}
function pad2(n){ return String(n).padStart(2, '0'); }
function pn(p){ return p.cn || p.shortName || p.tag; }
function gc(p){ return S.style.PC[p.tag] || PAL[0]; }
function ft(ts){
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function ff(ts){
  const d = new Date(ts);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function localISO(ms){
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
/* Absolute ms → value suitable for Plotly xaxis (ISO string for date axis, seconds for T=0 linear axis). */
function msToAxis(ms){
  return S.t0._t0ms !== null ? (ms - S.t0._t0ms) / 1000 : localISO(ms);
}
/* Plotly xaxis.range value → absolute ms. Handles date strings and T=0 seconds. */
function axisToMs(v){
  if(S.t0._t0ms !== null){
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? S.t0._t0ms + n * 1000 : NaN;
  }
  return new Date(v).getTime();
}
function getAct(){
  return S.data.AP.filter(p => S.data.SEL.has(p.tag) && p.data.length);
}
function isBadQuality(status){
  const s = String(status == null ? '' : status).trim().toLowerCase().replace(',', '.');
  if(!s) return false;
  const n = Number(s);
  if(Number.isFinite(n) && n === 0) return false;
  if(s === 'good' || s === 'ok' || s === 'valid' || s === 'норма' || s === 'норм' || s === 'goodprovider' || s === 'goodlocaloverride') return false;
  if(s === '1' || s.indexOf('bad') !== -1 || s.indexOf('invalid') !== -1 || s.indexOf('fault') !== -1 || s.indexOf('substitut') !== -1 || s.indexOf('подмен') !== -1 || s.indexOf('ошиб') !== -1 || s.indexOf('авар') !== -1) return true;
  return true;
}
function _isArrayIndex(prop){
  if(typeof prop === 'symbol') return false;
  const s = String(prop);
  if(!/^(0|[1-9]\d*)$/.test(s)) return false;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0;
}
function _newCodeArray(len){
  const out = new Int32Array(len);
  out.fill(-1);
  return out;
}
function _cloneFloatArray(values, len, emptyValue){
  const out = new Float64Array(len);
  if(emptyValue !== undefined) out.fill(emptyValue);
  if(values){
    const n = Math.min(len, values.length);
    for(let i = 0; i < n; i++){
      const v = Number(values[i]);
      out[i] = Number.isFinite(v) ? v : (emptyValue !== undefined ? emptyValue : NaN);
    }
  }
  return out;
}
function _cloneBoolArray(values, len){
  const out = new Uint8Array(len);
  if(values){
    const n = Math.min(len, values.length);
    for(let i = 0; i < n; i++) out[i] = values[i] ? 1 : 0;
  }
  return out;
}
function _codeColumnGet(cols, name, index){
  const codes = cols[name + 'Codes'];
  const values = cols[name + 'Values'];
  if(!codes || !values) return undefined;
  const code = codes[index];
  return code >= 0 ? values[code] : undefined;
}
function _codeColumnSet(cols, name, index, value){
  if(value == null || value === ''){
    _codeColumnDelete(cols, name, index);
    return;
  }
  if(!cols[name + 'Codes']) cols[name + 'Codes'] = _newCodeArray(cols.length);
  if(!cols[name + 'Values']) cols[name + 'Values'] = [];
  const values = cols[name + 'Values'];
  const s = String(value);
  let code = values.indexOf(s);
  if(code < 0){ code = values.length; values.push(s); }
  cols[name + 'Codes'][index] = code;
}
function _codeColumnDelete(cols, name, index){
  if(cols[name + 'Codes']) cols[name + 'Codes'][index] = -1;
}
function _floatColumnGet(cols, name, index){
  const arr = cols[name];
  if(!arr) return undefined;
  const value = arr[index];
  return Number.isFinite(value) ? value : undefined;
}
function _floatColumnSet(cols, name, index, value){
  if(value == null || value === '' || !Number.isFinite(Number(value))){
    _floatColumnDelete(cols, name, index);
    return;
  }
  if(!cols[name]){
    cols[name] = new Float64Array(cols.length);
    cols[name].fill(NaN);
  }
  cols[name][index] = Number(value);
}
function _floatColumnDelete(cols, name, index){
  if(cols[name]) cols[name][index] = NaN;
}
function createColumnarPoint(data, index){
  const cols = data._cols;
  const handler = {
    get(_target, prop){
      if(prop === 'ts') return cols.ts[index];
      if(prop === 'val') return cols.val[index];
      if(prop === 'status') return _codeColumnGet(cols, 'status', index);
      if(prop === 'epochUs') return _floatColumnGet(cols, 'epochUs', index);
      if(prop === 'epochRaw') return _codeColumnGet(cols, 'epochRaw', index);
      if(prop === 'timeSource') return _codeColumnGet(cols, 'timeSource', index);
      if(prop === 'sourceFile') return _codeColumnGet(cols, 'sourceFile', index);
      if(prop === 'rawVal') return _floatColumnGet(cols, 'rawVal', index);
      if(prop === 'mergeConflict') return !!(cols.mergeConflict && cols.mergeConflict[index]);
      return undefined;
    },
    set(_target, prop, value){
      if(prop === 'ts'){ cols.ts[index] = Number(value); return true; }
      if(prop === 'val'){ cols.val[index] = Number(value); return true; }
      if(prop === 'status'){ _codeColumnSet(cols, 'status', index, value); return true; }
      if(prop === 'epochUs'){ _floatColumnSet(cols, 'epochUs', index, value); return true; }
      if(prop === 'epochRaw'){ _codeColumnSet(cols, 'epochRaw', index, value); return true; }
      if(prop === 'timeSource'){ _codeColumnSet(cols, 'timeSource', index, value); return true; }
      if(prop === 'sourceFile'){ _codeColumnSet(cols, 'sourceFile', index, value); return true; }
      if(prop === 'rawVal'){ _floatColumnSet(cols, 'rawVal', index, value); return true; }
      if(prop === 'mergeConflict'){
        if(!cols.mergeConflict) cols.mergeConflict = new Uint8Array(cols.length);
        cols.mergeConflict[index] = value ? 1 : 0;
        return true;
      }
      return true;
    },
    deleteProperty(_target, prop){
      if(prop === 'status'){ _codeColumnDelete(cols, 'status', index); return true; }
      if(prop === 'epochUs'){ _floatColumnDelete(cols, 'epochUs', index); return true; }
      if(prop === 'epochRaw'){ _codeColumnDelete(cols, 'epochRaw', index); return true; }
      if(prop === 'timeSource'){ _codeColumnDelete(cols, 'timeSource', index); return true; }
      if(prop === 'sourceFile'){ _codeColumnDelete(cols, 'sourceFile', index); return true; }
      if(prop === 'rawVal'){ _floatColumnDelete(cols, 'rawVal', index); return true; }
      if(prop === 'mergeConflict'){ if(cols.mergeConflict) cols.mergeConflict[index] = 0; return true; }
      return true;
    },
    ownKeys(){
      const keys = ['ts', 'val'];
      for(const name of ['status', 'epochUs', 'epochRaw', 'timeSource', 'sourceFile', 'rawVal', 'mergeConflict']){
        const value = handler.get(null, name);
        if(value !== undefined && value !== false) keys.push(name);
      }
      return keys;
    },
    getOwnPropertyDescriptor(_target, prop){
      if(handler.ownKeys().includes(String(prop))) return {enumerable: true, configurable: true};
      return undefined;
    }
  };
  return new Proxy({}, handler);
}
function createColumnarData(input){
  const len = input && input.ts ? input.ts.length : 0;
  const cols = {
    length: len,
    ts: input && input.ts instanceof Float64Array ? input.ts : _cloneFloatArray(input && input.ts, len),
    val: input && input.val instanceof Float64Array ? input.val : _cloneFloatArray(input && input.val, len)
  };
  for(const name of ['status', 'epochRaw', 'timeSource', 'sourceFile']){
    const codes = input && input[name + 'Codes'];
    const values = input && input[name + 'Values'];
    if(codes && values){
      cols[name + 'Codes'] = codes instanceof Int32Array ? codes : Int32Array.from(codes);
      cols[name + 'Values'] = Array.from(values);
    }
  }
  if(input && input.epochUs) cols.epochUs = input.epochUs instanceof Float64Array ? input.epochUs : _cloneFloatArray(input.epochUs, len, NaN);
  if(input && input.rawVal) cols.rawVal = input.rawVal instanceof Float64Array ? input.rawVal : _cloneFloatArray(input.rawVal, len, NaN);
  if(input && input.mergeConflict) cols.mergeConflict = input.mergeConflict instanceof Uint8Array ? input.mergeConflict : _cloneBoolArray(input.mergeConflict, len);
  const api = {
    _columnar: true,
    _cols: cols,
    get length(){ return cols.length; },
    at(index){ return this[index < 0 ? cols.length + index : index]; },
    getPoint(index){ return index >= 0 && index < cols.length ? createColumnarPoint(api, index) : undefined; },
    setPoint(index, point){
      if(index < 0 || index >= cols.length || !point) return;
      cols.ts[index] = Number(point.ts);
      cols.val[index] = Number(point.val);
      for(const name of ['status', 'epochRaw', 'timeSource', 'sourceFile']){
        if(point[name] !== undefined) _codeColumnSet(cols, name, index, point[name]);
      }
      if(point.epochUs !== undefined) _floatColumnSet(cols, 'epochUs', index, point.epochUs);
      if(point.rawVal !== undefined) _floatColumnSet(cols, 'rawVal', index, point.rawVal);
      if(point.mergeConflict !== undefined){
        if(!cols.mergeConflict) cols.mergeConflict = new Uint8Array(cols.length);
        cols.mergeConflict[index] = point.mergeConflict ? 1 : 0;
      }
    },
    toArray(){ return Array.from(this); },
    map(fn, thisArg){ const out = new Array(cols.length); for(let i = 0; i < cols.length; i++) out[i] = fn.call(thisArg, this[i], i, this); return out; },
    filter(fn, thisArg){ const out = []; for(let i = 0; i < cols.length; i++){ const p = this[i]; if(fn.call(thisArg, p, i, this)) out.push(p); } return out; },
    some(fn, thisArg){ for(let i = 0; i < cols.length; i++){ if(fn.call(thisArg, this[i], i, this)) return true; } return false; },
    every(fn, thisArg){ for(let i = 0; i < cols.length; i++){ if(!fn.call(thisArg, this[i], i, this)) return false; } return true; },
    forEach(fn, thisArg){ for(let i = 0; i < cols.length; i++) fn.call(thisArg, this[i], i, this); },
    reduce(fn, initial){ let i = 0; let acc = initial; if(arguments.length < 2){ if(!cols.length) throw new TypeError('Reduce of empty columnar data'); acc = this[0]; i = 1; } for(; i < cols.length; i++) acc = fn(acc, this[i], i, this); return acc; },
    slice(start, end){ return this.toArray().slice(start, end); },
    concat(){ return this.toArray().concat(...Array.from(arguments).map(arg => isColumnarData(arg) ? arg.toArray() : arg)); },
    [Symbol.iterator]: function*(){ for(let i = 0; i < cols.length; i++) yield this[i]; }
  };
  return new Proxy(api, {
    get(target, prop, receiver){
      if(_isArrayIndex(prop)) return target.getPoint(Number(prop));
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value){
      if(_isArrayIndex(prop)){ target.setPoint(Number(prop), value); return true; }
      return Reflect.set(target, prop, value);
    }
  });
}
function isColumnarData(data){
  return !!(data && data._columnar === true && data._cols);
}
function columnarDataFromPoints(points){
  const arr = Array.from(points || []);
  const data = createColumnarData({
    ts: new Float64Array(arr.length),
    val: new Float64Array(arr.length)
  });
  for(let i = 0; i < arr.length; i++) data.setPoint(i, arr[i]);
  return data;
}
function columnarDataFromSeries(x, y, extras){
  const len = Math.min((x && x.length) || 0, (y && y.length) || 0);
  const data = createColumnarData({
    ts: _cloneFloatArray(x, len),
    val: _cloneFloatArray(y, len)
  });
  extras = extras || {};
  for(let i = 0; i < len; i++){
    if(extras.status && extras.status[i]) data[i].status = extras.status[i];
    if(extras.epochUs && extras.epochUs[i] != null) data[i].epochUs = extras.epochUs[i];
    if(extras.rawVal && extras.rawVal[i] != null) data[i].rawVal = extras.rawVal[i];
    if(extras.timeSource && extras.timeSource[i]) data[i].timeSource = extras.timeSource[i];
    if(extras.mergeConflict && extras.mergeConflict[i]) data[i].mergeConflict = true;
    if(extras.sourceFile && extras.sourceFile[i]) data[i].sourceFile = extras.sourceFile[i];
  }
  return data;
}
function ensureColumnarParam(param){
  if(param && Array.isArray(param.data)) param.data = columnarDataFromPoints(param.data);
  return param;
}
function hasBadQuality(data){
  return data.some(d => isBadQuality(d.status));
}
function signalKindOf(p){
  if(!p) return 'analog';
  if(p.signalKind) return p.signalKind;
  return p.isDiscrete ? 'binary' : 'analog';
}
function isStepSignal(p){
  const k = signalKindOf(p);
  return k === 'binary' || k === 'step' || k === 'setpoint';
}
function filt(data){
  return data.filter(d => {
    if(S.view.TR && (d.ts < S.view.TR[0] || d.ts > S.view.TR[1])) return false;
    if(S.data.QUALITY_GOOD_ONLY && isBadQuality(d.status)) return false;
    return true;
  });
}
function showErr(message){
  const e = $('err');
  e.textContent = message;
  e.style.display = 'block';
  clearTimeout(showErr._timer);
  showErr._timer = setTimeout(() => { e.style.display = 'none'; }, 6500);
}
function hideErr(){
  $('err').style.display = 'none';
}
function recordError(source, error){
  const item = {
    ts: Date.now(),
    source: String(source || 'runtime'),
    message: error && error.message ? error.message : String(error || ''),
    stack: error && error.stack ? String(error.stack).slice(0, 4000) : ''
  };
  S.runtime.ERRORS.push(item);
  if(S.runtime.ERRORS.length > 100) S.runtime.ERRORS.shift();
  try{ console.error('[PA-GRAPH]', item.source, item.message, error); }catch(_e){}
}
function recordPerf(name, startMs, extra){
  const dur = Math.round((performance.now() - startMs) * 10) / 10;
  const item = Object.assign({ts: Date.now(), name, ms: dur}, extra || {});
  S.runtime.PERF.push(item);
  if(S.runtime.PERF.length > 200) S.runtime.PERF.shift();
  return item;
}
function exportDiagnostics(){
  const payload = {
    exportedAt: new Date().toISOString(),
    version: APP_VERSION,
    files: S.data.FN.slice(),
    params: S.data.AP.map(p => ({
      tag: p.tag,
      points: p.data.length,
      unit: p.unit || '',
      rawUnit: p.rawUnit || '',
      signalKind: signalKindOf(p),
      timeSource: p.timeSource || p.timezone || 'local',
      sourceFile: p.sourceFile || '',
      badQuality: p.data.filter(d => isBadQuality(d.status)).length,
      mergeConflicts: p.data.filter(d => d.mergeConflict).length
    })),
    lastLoadSummary: S.runtime._lastLoadSummary,
    perf: S.runtime.PERF.slice(),
    errors: S.runtime.ERRORS.slice(),
    userAgent: navigator.userAgent,
    storage: null
  };
  const finish = info => {
    payload.storage = info || null;
    downloadBytes(new TextEncoder().encode(JSON.stringify(payload, null, 2)), 'pagraph_diagnostics_' + fileTS() + '.json', 'application/json');
  };
  if(navigator.storage && navigator.storage.estimate){
    navigator.storage.estimate().then(finish).catch(() => finish(null));
  } else {
    finish(null);
  }
}
window.addEventListener('error', ev => recordError('window.error', ev.error || ev.message));
window.addEventListener('unhandledrejection', ev => recordError('unhandledrejection', ev.reason));
function setBusy(flag, text){
  S.ui._busy = !!flag;
  $('bopen').disabled = S.ui._busy;
  $('bopen').textContent = S.ui._busy ? (text || 'Загрузка...') : (S.data.AP.some(p => p.data.length) ? '+ Файл' : 'Открыть');
}
function thm(){
  return S.ui.LT
    ? {pbg:'#ffffff',pgrid:'rgba(0,0,0,0.07)',pline:'#cbd5e1',pfont:'#475569',phbg:'#ffffff',phbrd:'#cbd5e1',phfont:'#1e293b',rsbg:'#f1f5f9'}
    : {pbg:'#0d1117',pgrid:'rgba(255,255,255,0.05)',pline:'#1e293b',pfont:'#64748b',phbg:'#111827',phbrd:'#334155',phfont:'#e2e8f0',rsbg:'#0a0e18'};
}
function escapeFilenameForDownload(name){
  return name.replace(/[^\w.-]+/g, '_');
}
function fmtAxisVal(v){
  if(v === null || v === undefined || !isFinite(v)) return '—';
  if(v === 0) return '0';
  const a = Math.abs(v);
  let s;
  if(a >= 1e5) s = v.toExponential(2);
  else if(a >= 1000) s = v.toFixed(0);
  else if(a >= 100) s = v.toFixed(1);
  else if(a >= 10) s = v.toFixed(2);
  else if(a >= 1) s = v.toFixed(3);
  else if(a >= 0.01) s = v.toFixed(4);
  else s = v.toExponential(2);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function attachMSlider(box, pd, params, leftOffset){
  if(!pd || !box) return;
  const slider = document.createElement('div');
  slider.className = 'mslider';
  if(leftOffset > 0){
    slider.style.marginLeft = (leftOffset * 100).toFixed(3) + '%';
  }
  const thumb = document.createElement('div');
  thumb.className = 'mslider-thumb';
  const hL = document.createElement('div');
  hL.className = 'mslider-handle l';
  const hR = document.createElement('div');
  hR.className = 'mslider-handle r';
  thumb.appendChild(hL);
  thumb.appendChild(hR);
  slider.appendChild(thumb);
  box.appendChild(slider);

  /* Full data range (X bounds) */
  const getBounds = () => {
    if(S.view.TB && S.view.TB[0] !== undefined && S.view.TB[1] > S.view.TB[0]) return [S.view.TB[0], S.view.TB[1]];
    try{
      const r = pd._fullLayout.xaxis.range;
      return [axisToMs(r[0]), axisToMs(r[1])];
    }catch(_e){ return null; }
  };
  const getView = () => {
    try{
      const r = pd._fullLayout.xaxis.range;
      return [axisToMs(r[0]), axisToMs(r[1])];
    }catch(_e){ return null; }
  };

  /* Reflect current xaxis view into thumb position */
  const sync = () => {
    const b = getBounds();
    const v = getView();
    if(!b || !v) return;
    const span = b[1] - b[0];
    if(span <= 0) return;
    let lo = Math.max(0, Math.min(100, (v[0] - b[0]) / span * 100));
    let hi = Math.max(0, Math.min(100, (v[1] - b[0]) / span * 100));
    if(hi - lo < 0.2) hi = lo + 0.2;
    thumb.style.left = lo + '%';
    thumb.style.width = (hi - lo) + '%';
  };

  /* Drag logic — use Pointer Events with capture, no document listeners */
  let drag = null;
  let rafQueued = false;
  const commit = (fast) => {
    const b = getBounds();
    if(!b) return;
    const leftPct = parseFloat(thumb.style.left) || 0;
    const widthPct = parseFloat(thumb.style.width) || 100;
    const rightPct = Math.min(100, leftPct + widthPct);
    const newMin = b[0] + leftPct / 100 * (b[1] - b[0]);
    const newMax = b[0] + rightPct / 100 * (b[1] - b[0]);
    const doIt = () => {
      try{ Plotly.relayout(pd, {'xaxis.range': [msToAxis(newMin), msToAxis(newMax)]}); }catch(_e){}
    };
    if(fast) doIt();
    else if(!rafQueued){
      rafQueued = true;
      requestAnimationFrame(() => { rafQueued = false; doIt(); });
    }
  };

  const startDrag = (el, mode) => e => {
    e.preventDefault();
    e.stopPropagation();
    try{ el.setPointerCapture(e.pointerId); }catch(_e){}
    drag = {
      el, mode, pid: e.pointerId,
      startX: e.clientX,
      sliderWidth: slider.clientWidth,
      startLeft: parseFloat(thumb.style.left) || 0,
      startWidth: parseFloat(thumb.style.width) || 100
    };
  };
  const onMove = e => {
    if(!drag || drag.pid !== e.pointerId) return;
    const deltaPct = (e.clientX - drag.startX) / drag.sliderWidth * 100;
    let newLeft = drag.startLeft;
    let newWidth = drag.startWidth;
    if(drag.mode === 'pan'){
      newLeft = Math.max(0, Math.min(100 - drag.startWidth, drag.startLeft + deltaPct));
    } else if(drag.mode === 'resizeL'){
      const limit = drag.startLeft + drag.startWidth - 0.5;
      newLeft = Math.max(0, Math.min(limit, drag.startLeft + deltaPct));
      newWidth = drag.startWidth - (newLeft - drag.startLeft);
    } else if(drag.mode === 'resizeR'){
      newWidth = Math.max(0.5, Math.min(100 - drag.startLeft, drag.startWidth + deltaPct));
    }
    thumb.style.left = newLeft + '%';
    thumb.style.width = newWidth + '%';
    commit(false);
  };
  const onEnd = e => {
    if(!drag || drag.pid !== e.pointerId) return;
    try{ drag.el.releasePointerCapture(e.pointerId); }catch(_e){}
    drag = null;
    commit(true);
  };
  thumb.addEventListener('pointerdown', e => {
    if(e.target === hL || e.target === hR) return;
    startDrag(thumb, 'pan')(e);
  });
  hL.addEventListener('pointerdown', startDrag(hL, 'resizeL'));
  hR.addEventListener('pointerdown', startDrag(hR, 'resizeR'));
  [thumb, hL, hR].forEach(el => {
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  });

  /* Click on empty track — jump the thumb center there */
  slider.addEventListener('pointerdown', e => {
    if(e.target !== slider) return;
    const rect = slider.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width * 100;
    const width = parseFloat(thumb.style.width) || 100;
    const newLeft = Math.max(0, Math.min(100 - width, pct - width / 2));
    thumb.style.left = newLeft + '%';
    commit(true);
  });

  /* Sync thumb when user zooms/pans the chart itself */
  pd.on('plotly_relayout', evt => {
    if(evt && Object.keys(evt).every(k => k.indexOf('annotations') === 0)) return;
    sync();
  });

  setTimeout(sync, 80);
}

function attachRangeLabels(pd, axisDescs, baseAnnots){
  if(!pd || !axisDescs || !axisDescs.length) return;
  let updating = false;
  let installed = false;
  let currentBase = baseAnnots;
  let startIdx = currentBase.length;
  const lastText = {};
  const bgColor = () => S.ui.LT ? 'rgba(255,255,255,0.9)' : 'rgba(13,17,23,0.88)';

  /* Initial install: add range label annotations to the array once */
  /* Index of each axis's range labels in layout.annotations, used to match a click
     to its axis/end so we know which range to edit. Rebuilt on every install(). */
  pd._rangeAnns = [];

  const install = () => {
    if(!pd._fullLayout || !pd.parentNode) return;
    const annots = currentBase.slice();
    startIdx = currentBase.length;
    const bg = bgColor();
    pd._rangeAnns = [];
    axisDescs.forEach((d, di) => {
      const ya = pd._fullLayout[d.yaKey];
      const mn = (ya && ya.range) ? ya.range[0] : null;
      const mx = (ya && ya.range) ? ya.range[1] : null;
      const mnTxt = fmtAxisVal(mn);
      const mxTxt = fmtAxisVal(mx);
      lastText[di + 'max'] = mxTxt;
      lastText[di + 'min'] = mnTxt;
      const xa = d.xanchor || 'right';
      /* Range labels sit OUTSIDE the plot area via pixel-based yshift (below).
         Top label: above the highest Y tick (just below the unit label).
         Bottom label: below the X axis tick labels, tucked into the bottom margin.
         captureevents + plotly_clickannotation handler (installed below) lets the
         user click either label to edit the corresponding axis bound inline. */
      const topIdx = annots.length;
      annots.push({
        x: d.axisPos, xref:'paper', y: 1, yref:'paper',
        yshift: 2,
        text: mxTxt, showarrow: false,
        font: {color: d.color, size: _fs(12)},
        xanchor: xa, yanchor: 'bottom',
        bgcolor: bg, borderpad: 2, captureevents: true
      });
      const botIdx = annots.length;
      annots.push({
        x: d.axisPos, xref:'paper', y: 0, yref:'paper',
        yshift: -24,
        text: mnTxt, showarrow: false,
        font: {color: d.color, size: _fs(12)},
        xanchor: xa, yanchor: 'top',
        bgcolor: bg, borderpad: 2, captureevents: true
      });
      pd._rangeAnns.push({topIdx, botIdx, yaKey: d.yaKey, color: d.color});
    });
    updating = true;
    const p = Plotly.relayout(pd, {annotations: annots});
    const done = () => { installed = true; setTimeout(() => { updating = false; }, 40); };
    if(p && p.then) p.then(done, done); else done();
  };

  /* Live updates: patch only the text fields of existing range annotations.
     Path-based relayout avoids a full layout/trace recalc — much lighter than
     replacing the whole annotations array on every scroll tick. */
  const updateTexts = () => {
    if(!pd._fullLayout || !pd.parentNode) return;
    const updates = {};
    let changed = false;
    axisDescs.forEach((d, di) => {
      const ya = pd._fullLayout[d.yaKey];
      if(!ya || !ya.range) return;
      const mxTxt = fmtAxisVal(ya.range[1]);
      const mnTxt = fmtAxisVal(ya.range[0]);
      if(lastText[di + 'max'] !== mxTxt){
        updates['annotations[' + (startIdx + di * 2) + '].text'] = mxTxt;
        lastText[di + 'max'] = mxTxt;
        changed = true;
      }
      if(lastText[di + 'min'] !== mnTxt){
        updates['annotations[' + (startIdx + di * 2 + 1) + '].text'] = mnTxt;
        lastText[di + 'min'] = mnTxt;
        changed = true;
      }
    });
    if(!changed) return;
    updating = true;
    const p = Plotly.relayout(pd, updates);
    const done = () => setTimeout(() => { updating = false; }, 40);
    if(p && p.then) p.then(done, done); else done();
  };

  /* Fast path (Plotly.react) wipes our inserted range labels because layout.annotations
     is replaced wholesale. This hook lets _renderChart re-install them against the new base. */
  pd._reinstallRangeLabels = (newBaseAnnots, newAxisDescs) => {
    currentBase = newBaseAnnots || currentBase;
    if(newAxisDescs) axisDescs = newAxisDescs;
    installed = false;
    Object.keys(lastText).forEach(k => delete lastText[k]);
    setTimeout(install, 20);
  };

  setTimeout(install, 60);
  pd.on('plotly_relayout', evt => {
    if(updating) return;
    /* Ignore echoes of our own annotation-only relayout */
    if(evt){
      const keys = Object.keys(evt);
      if(keys.length && keys.every(k => k.indexOf('annotations') === 0)) return;
    }
    clearTimeout(pd._rlTimer);
    pd._rlTimer = setTimeout(() => {
      if(!installed) install(); else updateTexts();
    }, 160);
  });

  /* Click on a range label → inline editor for that axis bound. */
  pd.on('plotly_clickannotation', ev => {
    if(!pd._rangeAnns) return;
    for(const r of pd._rangeAnns){
      if(ev.index === r.topIdx || ev.index === r.botIdx){
        showRangeEditor(pd, ev.index);
        return;
      }
    }
  });
}

/* Inline axis-bound editor: positions a small input on top of the clicked range
   annotation. Enter commits, Esc cancels, click-outside cancels. Applies via
   Plotly.relayout so the single axis updates and the rest of the plot stays put. */
function showRangeEditor(pd, annIdx){
  if(!pd._rangeAnns) return;
  let ra = null, isTop = false;
  for(const r of pd._rangeAnns){
    if(r.topIdx === annIdx){ ra = r; isTop = true; break; }
    if(r.botIdx === annIdx){ ra = r; isTop = false; break; }
  }
  if(!ra) return;
  const ax = pd._fullLayout && pd._fullLayout[ra.yaKey];
  if(!ax || !ax.range) return;
  const curVal = isTop ? ax.range[1] : ax.range[0];

  const annEls = pd.querySelectorAll('.annotation');
  const g = annEls[annIdx];
  if(!g) return;
  const textEl = g.querySelector('text');
  if(!textEl) return;
  const box = textEl.getBoundingClientRect();

  const prev = document.querySelector('.range-edit');
  if(prev) prev.remove();

  const inp = document.createElement('input');
  inp.className = 'range-edit';
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.value = Number(curVal).toPrecision(6).replace(/\.?0+$/, '');
  inp.style.borderColor = ra.color;
  inp.style.left = (box.left - 6) + 'px';
  inp.style.top = (box.top - 3) + 'px';

  let done = false;
  const cleanup = () => {
    if(done) return;
    done = true;
    if(inp.parentNode) inp.remove();
    document.removeEventListener('mousedown', onOutside, true);
  };
  const apply = () => {
    const v = parseFloat(inp.value.replace(',', '.'));
    if(!isFinite(v)){ cleanup(); return; }
    const rng = [ax.range[0], ax.range[1]];
    if(isTop) rng[1] = v; else rng[0] = v;
    if(rng[0] >= rng[1]){ cleanup(); return; }
    cleanup();
    const updates = {};
    updates[ra.yaKey + '.range'] = rng;
    updates[ra.yaKey + '.autorange'] = false;
    Plotly.relayout(pd, updates);
  };
  const onOutside = e => {
    if(inp.contains(e.target)) return;
    cleanup();
  };

  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if(e.key === 'Enter'){ e.preventDefault(); apply(); }
    else if(e.key === 'Escape'){ e.preventDefault(); cleanup(); }
  });

  document.body.appendChild(inp);
  requestAnimationFrame(() => {
    inp.select();
    document.addEventListener('mousedown', onOutside, true);
  });
}

function togTheme(){
  S.ui.LT = !S.ui.LT;
  document.body.classList.toggle('light', S.ui.LT);
  $('bthm').textContent = S.ui.LT ? '🌙' : '☀';
  render();
}
function togHelp(){
  const m = $('helpmod');
  if(!m) return;
  m.classList.toggle('vis');
}
function togExportMenu(){
  const dd = $('ddexp');
  const was = dd.classList.contains('open');
  closeSessionMenu();
  dd.classList.toggle('open', !was);
}
function closeExportMenu(){ $('ddexp').classList.remove('open'); }
function togSessionMenu(){
  const dd = $('ddsession');
  const was = dd.classList.contains('open');
  closeExportMenu();
  renderSessionSlots();
  dd.classList.toggle('open', !was);
}
function closeSessionMenu(){ $('ddsession').classList.remove('open'); }
/* Close any open dropdown when clicking outside. */
document.addEventListener('click', e => {
  if(!e.target.closest('#ddexp')) closeExportMenu();
  if(!e.target.closest('#ddsession')) closeSessionMenu();
});
function togRslider(){
  S.ui.RSLIDER = !S.ui.RSLIDER;
  const btn = $('brs');
  if(btn) btn.className = 'b' + (S.ui.RSLIDER ? ' on' : '');
  render();
}
function togSidebar(){
  S.ui._sidebarVisible = !S.ui._sidebarVisible;
  const s = $('side');
  if(S.ui._sidebarVisible){
    s.classList.remove('collapsed');
    s.classList.add('vis');
  }else{
    s.classList.add('collapsed');
    s.classList.remove('vis');
  }
  setTimeout(() => {
    const plots = document.querySelectorAll('.plotdiv');
    for(const plot of plots){
      try{ Plotly.Plots.resize(plot); }catch(_e){}
    }
  }, 250);
}
function togMeasure(){
  S.ui.MEASURE_ON = !S.ui.MEASURE_ON;
  $('bmarkers').className = 'b' + (S.ui.MEASURE_ON ? ' on' : '');
  if(!S.ui.MEASURE_ON) clearCursors();
  /* Keep Plotly's dragmode = 'zoom' regardless of MEASURE_ON. A capture-phase mousedown
     (installed in attachEvents) intercepts plot-area drags in MEASURE_ON so they never
     reach Plotly's zoom-box code. Keeping dragmode alive preserves Y-axis drag — that
     handler lives on a separate axis-tick element, not on .nsewdrag. */
  S.plot._allPlots.forEach(p => { try{ Plotly.relayout(p, {dragmode: 'zoom'}); }catch(_e){} });
}
function clearCursors(){
  S.cursor._cursorA = null;
  S.cursor._cursorB = null;
  S.cursor._valsA = {};
  S.cursor._valsB = {};
  refreshCursors();
  updateCursorPanel();
}
function cursorShapes(){
  return [
    {type:'line',xref:'x',yref:'paper',x0:0,x1:0,y0:0,y1:1,line:{color:'rgba(56,189,248,0.8)',width:2},visible:false},
    {type:'line',xref:'x',yref:'paper',x0:0,x1:0,y0:0,y1:1,line:{color:'rgba(248,113,113,0.8)',width:2},visible:false},
    {type:'rect',xref:'x',yref:'paper',x0:0,x1:0,y0:0,y1:1,fillcolor:'rgba(100,100,200,0.1)',line:{width:0},visible:false}
  ];
}
function refreshCursors(){
  if(!S.plot._allPlots.length) return;
  const u = {};
  if(S.cursor._cursorA !== null){
    const aL = msToAxis(S.cursor._cursorA);
    u['shapes[0].x0'] = aL;
    u['shapes[0].x1'] = aL;
    u['shapes[0].visible'] = true;
  }else{
    u['shapes[0].visible'] = false;
  }
  if(S.cursor._cursorB !== null){
    const bL = msToAxis(S.cursor._cursorB);
    u['shapes[1].x0'] = bL;
    u['shapes[1].x1'] = bL;
    u['shapes[1].visible'] = true;
  }else{
    u['shapes[1].visible'] = false;
  }
  if(S.cursor._cursorA !== null && S.cursor._cursorB !== null){
    u['shapes[2].x0'] = msToAxis(Math.min(S.cursor._cursorA, S.cursor._cursorB));
    u['shapes[2].x1'] = msToAxis(Math.max(S.cursor._cursorA, S.cursor._cursorB));
    u['shapes[2].visible'] = true;
  }else{
    u['shapes[2].visible'] = false;
  }
  S.plot._allPlots.forEach(pd => {
    try{ Plotly.relayout(pd, u); }catch(_e){}
  });
}

function interpY(xArr, yArr, xVal){
  if(!xArr.length) return null;
  if(xVal <= xArr[0]) return yArr[0];
  if(xVal >= xArr[xArr.length - 1]) return yArr[yArr.length - 1];
  let lo = 0;
  let hi = xArr.length - 1;
  while(hi - lo > 1){
    const m = (lo + hi) >> 1;
    if(xArr[m] <= xVal) lo = m;
    else hi = m;
  }
  const dx = xArr[hi] - xArr[lo];
  if(dx === 0) return yArr[lo];
  const t = (xVal - xArr[lo]) / dx;
  return yArr[lo] + t * (yArr[hi] - yArr[lo]);
}
/* Step interpolation (last known value) — for discrete signals */
function interpStep(xArr, yArr, xVal){
  if(!xArr.length) return null;
  if(xVal <= xArr[0]) return yArr[0];
  if(xVal >= xArr[xArr.length - 1]) return yArr[yArr.length - 1];
  let lo = 0;
  let hi = xArr.length - 1;
  while(hi - lo > 1){
    const m = (lo + hi) >> 1;
    if(xArr[m] <= xVal) lo = m;
    else hi = m;
  }
  return yArr[lo];
}
/* Escape HTML-sensitive characters before handing user text to Plotly annotations/hovertext —
   Plotly renders a subset of HTML in those fields, so imported marker/session text could
   otherwise inject tags. */
function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function stripImportedControlChars(s){
  return String(s == null ? '' : s).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
}
function cleanCell(s){
  return stripImportedControlChars(s).trim();
}
/* Encode string as Windows-1251 bytes (legacy Excel mode; UTF-8 BOM is the default export). */
function toCp1251(str){
  const out = [];
  const pushAscii = s => {
    for(let j = 0; j < s.length; j++) out.push(s.charCodeAt(j) & 0x7F);
  };
  for(let i = 0; i < str.length; i++){
    const c = str.charCodeAt(i);
    if(c < 0x80) out.push(c);
    else if(c >= 0x410 && c <= 0x44F) out.push(c - 0x350); /* Russian А-я */
    else if(c === 0x401) out.push(0xA8); /* Ё */
    else if(c === 0x451) out.push(0xB8); /* ё */
    else if(c === 0x2116) out.push(0xB9); /* № */
    else if(c === 0x00AB) out.push(0xAB); /* « */
    else if(c === 0x00BB) out.push(0xBB); /* » */
    else if(c === 0x2014) out.push(0x97); /* — em dash */
    else if(c === 0x2013) out.push(0x96); /* – en dash */
    else if(c === 0x2018) out.push(0x91);
    else if(c === 0x2019) out.push(0x92);
    else if(c === 0x201C) out.push(0x93);
    else if(c === 0x201D) out.push(0x94);
    else if(c === 0x2026) out.push(0x85); /* … */
    else if(c === 0x00A0) out.push(0x20);
    else if(c === 0x00B0) out.push(0xB0); /* ° */
    else if(c === 0x00B1) out.push(0xB1); /* ± */
    else if(c === 0x00B5) out.push(0xB5); /* µ */
    else if(c === 0x00D7) pushAscii('*'); /* × is not representable in Windows-1251 */
    else if(c === 0x00F7) pushAscii('/'); /* ÷ is not representable in Windows-1251 */
    else if(c === 0x0394) pushAscii('Delta');
    else if(c === 0x03A9) pushAscii('Ohm');
    else out.push(63); /* '?' for unsupported */
  }
  return new Uint8Array(out);
}
function toUtf16Le(str, bom){
  const off = bom ? 2 : 0;
  const out = new Uint8Array(str.length * 2 + off);
  if(bom){ out[0] = 0xFF; out[1] = 0xFE; }
  for(let i = 0; i < str.length; i++){
    const c = str.charCodeAt(i);
    out[off + i * 2] = c & 0xFF;
    out[off + i * 2 + 1] = c >> 8;
  }
  return out;
}
function encodeTextBytes(text, encoding){
  const enc = String(encoding || 'utf-8-bom').toLowerCase();
  if(enc === 'windows-1251' || enc === 'cp1251') return toCp1251(text);
  if(enc === 'utf-16le') return toUtf16Le(text, true);
  if(enc === 'utf-16be'){
    const le = toUtf16Le(text, false);
    const out = new Uint8Array(le.length + 2);
    out[0] = 0xFE; out[1] = 0xFF;
    for(let i = 0; i < le.length; i += 2){
      out[i + 2] = le[i + 1];
      out[i + 3] = le[i];
    }
    return out;
  }
  const body = new TextEncoder().encode(text);
  if(enc === 'utf-8-bom'){
    const out = new Uint8Array(body.length + 3);
    out.set([0xEF, 0xBB, 0xBF], 0);
    out.set(body, 3);
    return out;
  }
  return body;
}
function csvCell(v){
  const s = String(v == null ? '' : v);
  if(/[;"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function rowsToCsv(rows){
  return rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}
function downloadBytes(bytes, filename, type){
  const blob = new Blob([bytes], {type: type || 'application/octet-stream'});
  downloadBlob(blob, filename);
}
function downloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
}
function downloadCsv(csvText, filename, encoding){
  const enc = encoding || 'utf-8-bom';
  const type = enc === 'windows-1251' ? 'text/csv;charset=windows-1251' : 'text/csv;charset=utf-8';
  downloadBytes(encodeTextBytes(csvText, enc), filename, type);
}
function valsAtX(xMs){
  const v = {};
  S.plot._allTraceData.forEach(tr => {
    const val = interpY(tr.xMs, tr.y, xMs);
    if(val !== null) v[tr.name] = val;
  });
  return v;
}
function rangeStats(xMs1, xMs2){
  const x0 = Math.min(xMs1, xMs2);
  const x1 = Math.max(xMs1, xMs2);
  const stats = {};
  S.plot._allTraceData.forEach(tr => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for(let i = 0; i < tr.xMs.length; i++){
      const ts = tr.xMs[i];
      if(ts < x0 || ts > x1) continue;
      const v = tr.y[i];
      if(v < min) min = v;
      if(v > max) max = v;
      sum += v;
      n++;
    }
    if(n){
      stats[tr.name] = {min, max, avg: sum / n, n};
    }
  });
  return stats;
}
function updateCursorPanel(){
  const panel = $('cpanel');
  const body = $('cp-body');
  body.textContent = '';
  if(!S.ui.MEASURE_ON || !S.plot._allTraceData.length || (S.cursor._cursorA === null && S.cursor._cursorB === null)){
    panel.className = '';
    return;
  }
  panel.className = 'vis';
  const parts = [];
  if(S.cursor._cursorA !== null) parts.push('▸A ' + ff(S.cursor._cursorA));
  if(S.cursor._cursorB !== null) parts.push('◆B ' + ff(S.cursor._cursorB));
  $('cp-times').textContent = parts.join('   ');
  $('cp-dt').textContent = (S.cursor._cursorA !== null && S.cursor._cursorB !== null) ? 'Δt = ' + (Math.abs(S.cursor._cursorA - S.cursor._cursorB) / 1000).toFixed(1) + 'с' : '';
  const rs = (S.cursor._cursorA !== null && S.cursor._cursorB !== null) ? rangeStats(S.cursor._cursorA, S.cursor._cursorB) : null;

  S.plot._allTraceData.forEach(tr => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = tr.name;
    nameCell.style.color = tr.color;
    nameCell.style.fontWeight = '600';

    const av = S.cursor._valsA[tr.name];
    const bv = S.cursor._valsB[tr.name];

    const aCell = document.createElement('td');
    aCell.textContent = av !== undefined ? av.toFixed(3) : '—';
    aCell.style.color = '#38bdf8';

    const bCell = document.createElement('td');
    bCell.textContent = bv !== undefined ? bv.toFixed(3) : '—';
    bCell.style.color = '#f87171';

    const dCell = document.createElement('td');
    dCell.textContent = (av !== undefined && bv !== undefined) ? (bv - av).toFixed(3) : '—';
    dCell.style.color = '#a78bfa';
    dCell.style.fontWeight = '600';

    const minCell = document.createElement('td');
    const maxCell = document.createElement('td');
    const avgCell = document.createElement('td');

    if(rs && rs[tr.name]){
      minCell.textContent = rs[tr.name].min.toFixed(2);
      maxCell.textContent = rs[tr.name].max.toFixed(2);
      avgCell.textContent = rs[tr.name].avg.toFixed(2);
    }else{
      minCell.textContent = '—';
      maxCell.textContent = '—';
      avgCell.textContent = '—';
    }

    row.append(nameCell, aCell, bCell, dCell, minCell, maxCell, avgCell);
    body.appendChild(row);
  });
}

function detectSignalKind(data, tag){
  if(data.length < 2) return 'analog';
  const sample = data.length > 5000 ? data.slice(0, 5000) : data;
  let allBinary = true;
  const uniq = new Set();
  let changes = 0;
  for(let i = 0; i < sample.length; i++){
    const v = sample[i].val;
    if(v !== 0 && v !== 1) allBinary = false;
    if(uniq.size <= 64) uniq.add(v);
    if(i > 0 && v !== sample[i - 1].val) changes++;
  }
  if(allBinary) return 'binary';
  const name = String(tag || '').toLowerCase();
  if(/set\s*point|setpoint|tnr|позици|положени|клапан|valve|state|mode|cmd|command|устав/.test(name)) return 'step';
  if(uniq.size > 0 && uniq.size <= 12 && changes / Math.max(1, sample.length - 1) < 0.08) return 'step';
  return 'analog';
}
function detectDiscrete(data, tag){
  return detectSignalKind(data, tag) === 'binary';
}

/* Discrete downsampling: keep only value-change points + neighbors */
function downsampleDiscrete(xArr, yArr){
  if(xArr.length <= 2) return {x: xArr, y: yArr};
  const sx = [xArr[0]], sy = [yArr[0]];
  for(let i = 1; i < xArr.length; i++){
    if(yArr[i] !== yArr[i-1]){
      if(sx[sx.length-1] !== xArr[i-1]){
        sx.push(xArr[i-1]); sy.push(yArr[i-1]);
      }
      sx.push(xArr[i]); sy.push(yArr[i]);
    }
  }
  if(sx[sx.length-1] !== xArr[xArr.length-1]){
    sx.push(xArr[xArr.length-1]); sy.push(yArr[yArr.length-1]);
  }
  return {x: sx, y: sy};
}

/* LTTB downsampling */
function downsample(xArr, yArr, threshold){
  const len = xArr.length;
  if(threshold >= len || threshold <= 2) return {x: xArr, y: yArr};
  const sx = [xArr[0]];
  const sy = [yArr[0]];
  const every = (len - 2) / (threshold - 2);
  let a = 0;
  for(let i = 0; i < threshold - 2; i++){
    let s1 = Math.floor((i + 1) * every) + 1;
    let s2 = Math.floor((i + 2) * every) + 1;
    if(s2 > len) s2 = len;
    let avgX = 0;
    let avgY = 0;
    const avgL = s2 - s1;
    for(let j = s1; j < s2; j++){
      avgX += xArr[j];
      avgY += yArr[j];
    }
    avgX /= avgL;
    avgY /= avgL;
    let r1 = Math.floor(i * every) + 1;
    let r2 = Math.floor((i + 1) * every) + 1;
    if(r2 > len) r2 = len;
    let maxA = -1;
    let nextA = r1;
    for(let j2 = r1; j2 < r2; j2++){
      const area = Math.abs((xArr[a] - avgX) * (yArr[j2] - yArr[a]) - (xArr[a] - xArr[j2]) * (avgY - yArr[a]));
      if(area > maxA){
        maxA = area;
        nextA = j2;
      }
    }
    sx.push(xArr[nextA]);
    sy.push(yArr[nextA]);
    a = nextA;
  }
  sx.push(xArr[len - 1]);
  sy.push(yArr[len - 1]);
  return {x: sx, y: sy};
}

/* Min-Max downsampling: keep min and max Y per bucket — preserves true peaks/valleys */
function downsampleMinMax(xArr, yArr, threshold){
  const len = xArr.length;
  if(threshold >= len || threshold <= 2) return {x: xArr, y: yArr};
  const buckets = Math.floor(threshold / 2); /* each bucket gives 2 points */
  const every = (len - 2) / buckets;
  const sx = [xArr[0]];
  const sy = [yArr[0]];
  for(let i = 0; i < buckets; i++){
    const s = Math.floor(i * every) + 1;
    const e = Math.min(Math.floor((i + 1) * every) + 1, len);
    if(s >= e) continue;
    let mnI = s, mxI = s;
    for(let j = s + 1; j < e; j++){
      if(yArr[j] < yArr[mnI]) mnI = j;
      if(yArr[j] > yArr[mxI]) mxI = j;
    }
    /* Push in time order */
    if(mnI === mxI){
      sx.push(xArr[mnI]); sy.push(yArr[mnI]);
    } else if(mnI < mxI){
      sx.push(xArr[mnI]); sy.push(yArr[mnI]);
      sx.push(xArr[mxI]); sy.push(yArr[mxI]);
    } else {
      sx.push(xArr[mxI]); sy.push(yArr[mxI]);
      sx.push(xArr[mnI]); sy.push(yArr[mnI]);
    }
  }
  sx.push(xArr[len - 1]);
  sy.push(yArr[len - 1]);
  return {x: sx, y: sy};
}
function downsampleMinMaxLttb(xArr, yArr, threshold){
  const len = xArr.length;
  if(threshold >= len || threshold <= 2) return {x: xArr, y: yArr};
  const preThreshold = Math.min(len, Math.max(threshold * 4, threshold + 2));
  if(preThreshold >= len) return downsample(xArr, yArr, threshold);
  const pre = downsampleMinMax(xArr, yArr, preThreshold);
  return downsample(pre.x, pre.y, threshold);
}

/* Every-Nth downsampling: simple decimation */
function downsampleNth(xArr, yArr, threshold){
  const len = xArr.length;
  if(threshold >= len || threshold <= 2) return {x: xArr, y: yArr};
  const step = (len - 1) / (threshold - 1);
  const sx = [], sy = [];
  for(let i = 0; i < threshold; i++){
    const idx = Math.round(i * step);
    sx.push(xArr[idx]);
    sy.push(yArr[idx]);
  }
  return {x: sx, y: sy};
}

/* Dispatch to selected algorithm */
function dsDispatch(xArr, yArr, threshold){
  if(S.view.DS_ALG === 'minmaxlttb') return downsampleMinMaxLttb(xArr, yArr, threshold);
  if(S.view.DS_ALG === 'minmax') return downsampleMinMax(xArr, yArr, threshold);
  if(S.view.DS_ALG === 'nth') return downsampleNth(xArr, yArr, threshold);
  return downsample(xArr, yArr, threshold);
}

function setDS(alg){
  S.view.DS_ALG = alg;
  ['dsLttb','dsMinmaxLttb','dsMinmax','dsNth'].forEach(id => { $(id).className = 'b'; });
  const map = {lttb:'dsLttb', minmaxlttb:'dsMinmaxLttb', minmax:'dsMinmax', nth:'dsNth'};
  if(map[alg]) $(map[alg]).className = 'b on';
  render();
}

function shortNameFromTag(tag){
  let shortName = tag;
  const plcM = tag.match(/^(\S+)\s+(\S+)/);
  if(plcM){
    const dotParts = plcM[1].split('.');
    shortName = dotParts.length > 1 ? dotParts[dotParts.length - 1] : plcM[2];
  } else {
    const dotParts = tag.split('.');
    if(dotParts.length > 1){
      const lastDot = dotParts[dotParts.length - 1];
      const spIdx = lastDot.indexOf(' ');
      shortName = spIdx > 0 ? lastDot.substring(0, spIdx) : lastDot;
    }
  }
  return shortName.length > 20 ? shortName.substring(0, 20) : shortName;
}
function ensureParamColor(p){
  if(p && p.tag && !S.style.PC[p.tag]) S.style.PC[p.tag] = PAL[Object.keys(S.style.PC).length % PAL.length];
}
function mergeParsedParams(params, ex){
  params.forEach(ensureColumnarParam);
  if(ex) ex.forEach(ensureColumnarParam);
  params.forEach(ensureParamColor);
  if(!ex || !ex.length) return {p: params, e: null, conflicts: 0};

  const em = {};
  for(const item of ex) em[item.tag] = item;
  const mg = [];
  const used = {};

  for(const pr2 of params){
    if(em[pr2.tag]){
      const ep = em[pr2.tag];
      used[pr2.tag] = true;
      const c2 = ep.data.map(point => ({point, sourceFile: ep.sourceFile})).concat(pr2.data.map(point => ({point, sourceFile: pr2.sourceFile})));
      const seen = new Set();
      const d2 = [];
      for(const wrapped of c2){
        const item = wrapped.point;
        const key = item.ts + '_' + item.val + '_' + (item.status || '');
        if(seen.has(key)) continue;
        seen.add(key);
        const copy = Object.assign({}, item);
        if(!copy.sourceFile && wrapped.sourceFile) copy.sourceFile = wrapped.sourceFile;
        delete copy.mergeConflict;
        d2.push(copy);
      }
      d2.sort((a, b) => a.ts - b.ts);
      let conflictGroups = 0;
      const byTs = new Map();
      for(const item of d2){
        const key = String(item.ts);
        if(!byTs.has(key)) byTs.set(key, []);
        byTs.get(key).push(item);
      }
      for(const group of byTs.values()){
        if(group.length < 2) continue;
        const signatures = new Set(group.map(item => item.val + '_' + (item.status || '')));
        if(signatures.size < 2) continue;
        conflictGroups++;
        group.forEach(item => { item.mergeConflict = true; });
      }
      const files = Array.from(new Set([ep.sourceFile, pr2.sourceFile].filter(Boolean)));
      mg.push(Object.assign({}, ep, {
        unit: ep.unit || pr2.unit || '',
        sourceFile: files.join(', '),
        dc: ep.dc, tc: ep.tc, mc: ep.mc, sc: ep.sc, ec: ep.ec,
        vc: ep.vc,
        data: columnarDataFromPoints(d2),
        merged: true,
        timezone: ep.timezone || pr2.timezone || 'local',
        timeSource: ep.timeSource || pr2.timeSource || ep.timezone || pr2.timezone || 'local',
        mergeConflicts: conflictGroups
      }));
    }else{
      mg.push(pr2);
    }
  }
  for(const oldItem of ex){
    if(!used[oldItem.tag]) mg.push(oldItem);
  }
  return {p: mg, e: null, conflicts: mg.reduce((sum, p) => sum + (p.mergeConflicts || 0), 0)};
}
function inflateWorkerParams(data){
  if(Array.isArray(data && data.params)) return data.params.map(ensureColumnarParam);
  const packed = data && Array.isArray(data.paramsColumnar) ? data.paramsColumnar : [];
  return packed.map(item => {
    const meta = Object.assign({}, item.meta || {});
    delete meta.length;
    const parsedData = createColumnarData({
      ts: item.ts || new Float64Array(0),
      val: item.val || new Float64Array(0),
      statusCodes: item.statusCodes || null,
      statusValues: item.statusValues || [],
      timeSourceCodes: item.timeSourceCodes || null,
      timeSourceValues: item.timeSourceValues || [],
      sourceFileCodes: item.sourceFileCodes || null,
      sourceFileValues: item.sourceFileValues || [],
      epochUs: item.epochUs || null
    });
    if(item.epochRaw && item.epochRawMask){
      for(let i = 0; i < parsedData.length; i++){
        if(item.epochRawMask[i]) parsedData[i].epochRaw = String(item.epochRaw[i]);
      }
    }
    meta.data = parsedData;
    return meta;
  });
}
async function parseFilePayload(file){
  if(file.size > MAX_INPUT_FILE_BYTES){
    throw new Error('файл слишком большой: ' + Math.round(file.size / 1024 / 1024) + ' МБ');
  }
  if(location.protocol === 'file:'){
    throw new Error('приложение нужно запускать через статический сервер: используйте serve-local.ps1 или dist/server');
  }
  if(typeof Worker !== 'function'){
    throw new Error('браузер не поддерживает Web Workers; парсинг доступен только через parser.worker.js');
  }

  const keepText = file.size <= MAX_STORED_TEXT_BYTES;
  return await new Promise((resolve, reject) => {
    const worker = new Worker('parser.worker.js');
    const cleanup = () => {
      try{ worker.terminate(); }catch(_e){}
    };
    const timeoutMs = Math.min(30 * 60 * 1000, Math.max(120000, Math.ceil(file.size / (10 * 1024 * 1024)) * 1000));
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('таймаут парсинга файла'));
    }, timeoutMs);
    worker.onmessage = ev => {
      clearTimeout(timer);
      cleanup();
      const data = ev.data || {};
      if(data.error) reject(new Error(data.error));
      else resolve({file, text: data.text || '', textStored: keepText && typeof data.text === 'string', encoding: data.encoding, bom: !!data.bom, headerIdx: data.headerIdx, params: inflateWorkerParams(data)});
    };
    worker.onerror = ev => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(ev.message || 'ошибка parser worker'));
    };
    if(typeof file.stream === 'function'){
      worker.postMessage({file, keepText});
    }else{
      file.arrayBuffer()
        .then(buffer => worker.postMessage({buffer, keepText}, [buffer]))
        .catch(err => {
          clearTimeout(timer);
          cleanup();
          reject(err);
        });
    }
  });
}
function chooseFileParseConcurrency(files){
  const arr = Array.from(files || []);
  if(!arr.length) return 0;
  const largeThreshold = 50 * 1024 * 1024;
  return arr.some(file => file.size >= largeThreshold) ? 1 : Math.min(2, arr.length);
}
async function parseFilesBounded(files){
  const arr = Array.from(files || []);
  const limit = chooseFileParseConcurrency(arr);
  const loaded = new Array(arr.length);
  let next = 0;
  let done = 0;

  async function runOne(){
    while(next < arr.length){
      const idx = next++;
      const file = arr[idx];
      setBusy(true, 'Чтение ' + (idx + 1) + '/' + arr.length + '...');
      try{
        const parsed = await parseFilePayload(file);
        loaded[idx] = Object.assign(parsed, {error: null});
      }catch(e){
        loaded[idx] = {file, text: '', encoding: '', headerIdx: 0, params: [], error: e};
      }finally{
        done++;
        setBusy(true, 'Обработано ' + done + '/' + arr.length + '...');
      }
    }
  }

  const workers = [];
  for(let i = 0; i < limit; i++) workers.push(runOne());
  await Promise.all(workers);
  return loaded;
}
async function precomputeTraceCacheForParams(params){
  if(location.protocol === 'file:' || typeof Worker !== 'function' || !params || !params.length) return;
  if(S.view.SMOOTH_TYPE !== 'none' || S.anomaly.ANOMALY_ON) return;
  const started = performance.now();
  const rawPointCount = params.reduce((sum, p) => sum + ((p.data && p.data.length) || 0), 0);
  if(rawPointCount > TRACE_WORKER_MAX_CLONE_POINTS){
    recordPerf('trace-precompute-skip-large', started, {params: params.length, points: rawPointCount});
    return;
  }
  const items = params.filter(p => p.data && p.data.length).map(p => ({
    key: _ptdKey(p),
    param: {
      name: pn(p),
      signalKind: signalKindOf(p),
      isDiscrete: isStepSignal(p),
      color: gc(p),
      lw: S.style.PW[p.tag] || S.view.LW,
      ld: S.style.PD[p.tag] || S.view.LDASH,
      data: isColumnarData(p.data) ? p.data.toArray() : p.data
    },
    view: {
      tr: S.view.TR ? S.view.TR.slice() : null,
      qualityGoodOnly: S.data.QUALITY_GOOD_ONLY,
      dsAlg: S.view.DS_ALG,
      maxPts: MAX_PTS,
      cgaps: S.view.CGAPS,
      t0ms: S.t0._t0ms !== null ? S.t0._t0ms : null
    }
  }));
  if(!items.length) return;
  try{
    const out = await new Promise((resolve, reject) => {
      const worker = new Worker('trace.worker.js');
      const cleanup = () => { try{ worker.terminate(); }catch(_e){} };
      const timer = setTimeout(() => { cleanup(); reject(new Error('таймаут trace worker')); }, 60000);
      worker.onmessage = ev => {
        clearTimeout(timer);
        cleanup();
        const data = ev.data || {};
        if(data.error) reject(new Error(data.error));
        else resolve(data.items || []);
      };
      worker.onerror = ev => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(ev.message || 'ошибка trace worker'));
      };
      worker.postMessage({items});
    });
    for(const item of out){
      if(!item || !item.key || !item.data) continue;
      if(item.data.xDispAreMs) item.data.xDisp = item.data.xDisp.map(ms => new Date(ms));
      delete item.data.xDispAreMs;
      _ptdCache.set(item.key, item.data);
    }
    _ptdEvict();
    recordPerf('trace-precompute-worker', started, {params: out.length});
  }catch(e){
    recordError('trace-precompute-worker', e);
  }
}

async function hf(fileList){
  hideErr();
  clearTraceCache();
  resetZoomHistory();
  const files = Array.from(fileList || []);
  if(!files.length) return;
  const loadStart = performance.now();

  setBusy(true, 'Чтение и парсинг...');
  try{
    const loaded = await parseFilesBounded(files);

    let nextAP = S.data.AP.slice();
    const acceptedNames = [];
    const warnings = [];

    for(const item of loaded){
      if(item.error){
        recordError('file-load:' + item.file.name, item.error);
        warnings.push(item.file.name + ': ошибка чтения файла');
        continue;
      }
      for(const p of item.params){
        p.sourceFile = item.file.name;
      }
      const res = mergeParsedParams(item.params, nextAP);
      if(res.e){
        warnings.push(item.file.name + ': ' + res.e);
        continue;
      }
      if(res.conflicts){
        warnings.push(item.file.name + ': merge-конфликты по одинаковым tag+timestamp: ' + res.conflicts);
      }
      /* Store file text for later saving */
      S.data._fileStore[item.file.name] = { text: item.text || '', textStored: !!item.textStored, headerIdx: item.headerIdx || 0, encoding: item.encoding || 'utf-8', bom: !!item.bom };
      if(!item.textStored){
        warnings.push(item.file.name + ': raw-text не хранится в памяти, сохранение файла с переименованными тегами отключено');
      }
      /* Set sourceFile on newly parsed params */
      for(const p of res.p){
        if(!p.sourceFile) p.sourceFile = item.file.name;
      }
      nextAP = res.p;
      acceptedNames.push(item.file.name);
      if(item.encoding && item.encoding !== 'utf-8'){
        warnings.push(item.file.name + ': кодировка ' + item.encoding);
      }
    }

    S.data.AP = nextAP;
    S.data.FN = S.data.FN.concat(acceptedNames);

    /* Don't restore old zoom when new files added — new data may extend the range */
    S.plot._savedRange = null;

    if(!S.data.SEL.size){
      const first = S.data.AP.filter(p => p.data.length);
      for(let j = 0; j < Math.min(3, first.length); j++){
        S.data.SEL.add(first[j].tag);
      }
    }

    /* Auto-detect signal kind; user can override it per parameter. */
    S.data.AP.forEach(p => {
      if(!p.signalKind) p.signalKind = detectSignalKind(p.data, p.tag);
      p.isDiscrete = isStepSignal(p);
    });

    await precomputeTraceCacheForParams(S.data.AP.filter(p => S.data.SEL.has(p.tag)));

    updAll();

    if(warnings.length){
      showErr(warnings.slice(0, 3).join(' | ') + (warnings.length > 3 ? ' ...' : ''));
    }
    S.runtime._lastLoadSummary = recordPerf('load-files', loadStart, {
      files: files.length,
      accepted: acceptedNames.length,
      params: S.data.AP.length,
      points: S.data.AP.reduce((sum, p) => sum + p.data.length, 0),
      warnings: warnings.length
    });
  }catch(e){
    recordError('hf', e);
    showErr('Ошибка загрузки: ' + (e && e.message ? e.message : e));
  }finally{
    setBusy(false);
  }
}

function onDrop(e){
  e.preventDefault();
  const d = $('dz');
  if(d) d.classList.remove('dg');
  hf(e.dataTransfer.files);
}
function onDgOv(e){
  e.preventDefault();
  const d = $('dz');
  if(d) d.classList.add('dg');
}
function onDgLv(){
  const d = $('dz');
  if(d) d.classList.remove('dg');
}

function setM(m){
  S.ui.MODE = m;
  $('bovr').className = 'b' + (m === 'o' ? ' on' : '');
  $('bspl').className = 'b' + (m === 's' ? ' on' : '');
  render();
}
function togCgaps(){
  S.view.CGAPS = !S.view.CGAPS;
  $('bcg').className = 'b' + (S.view.CGAPS ? ' on' : '');
  render();
}
function togQualityFilter(){
  S.data.QUALITY_GOOD_ONLY = !S.data.QUALITY_GOOD_ONLY;
  const b = $('bqgood');
  if(b) b.className = 'b' + (S.data.QUALITY_GOOD_ONLY ? ' on' : '');
  clearTraceCache();
  updSide();
  render();
}

/* ===== XY SCATTER MODE ===== */
function setPlotMode(m){
  S.ui.XY_MODE = (m === 'xy');
  $('bts').className = 'b' + (!S.ui.XY_MODE ? ' on' : '');
  $('bxy').className = 'b' + (S.ui.XY_MODE ? ' on' : '');
  $('xysec').style.display = S.ui.XY_MODE ? 'block' : 'none';
  $('bovr').style.display = S.ui.XY_MODE ? 'none' : '';
  $('bspl').style.display = S.ui.XY_MODE ? 'none' : '';
  if(S.ui.XY_MODE) updateXYSelect();
  render();
}
function updateXYSelect(){
  const sel = $('xysel');
  sel.textContent = '';
  const act = getAct();
  act.forEach(p => {
    const o = document.createElement('option');
    o.value = p.tag;
    o.textContent = pn(p);
    if(p.tag === S.ui.XY_XPARAM) o.selected = true;
    sel.appendChild(o);
  });
  if(!S.ui.XY_XPARAM && act.length) S.ui.XY_XPARAM = act[0].tag;
  if(act.length && !act.find(p => p.tag === S.ui.XY_XPARAM)) S.ui.XY_XPARAM = act[0].tag;
}
function setXYParam(tag){
  S.ui.XY_XPARAM = tag;
  render();
}

/* Match Y-parameter data to X-parameter by nearest timestamp within tolerance */
function prepareXYData(xParam, yParams){
  const xData = filt(xParam.data);
  if(!xData.length) return [];

  /* Build sorted X timestamps + values */
  const xTs = xData.map(d => d.ts);
  const xVl = xData.map(d => d.val);

  /* Tolerance: median gap between consecutive X timestamps, x3 */
  let gaps = [];
  for(let i = 1; i < xTs.length && i < 200; i++) gaps.push(xTs[i] - xTs[i-1]);
  gaps.sort((a,b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1000;
  const tol = Math.max(medianGap * 3, 500); /* at least 500ms */

  return yParams.map(yP => {
    const yData = filt(yP.data);
    const pairs = []; /* {xv, yv, ts} */
    let xi = 0;
    for(let yi = 0; yi < yData.length; yi++){
      const yt = yData[yi].ts;
      /* Advance xi to closest to yt */
      while(xi < xTs.length - 1 && Math.abs(xTs[xi+1] - yt) < Math.abs(xTs[xi] - yt)) xi++;
      if(Math.abs(xTs[xi] - yt) <= tol){
        pairs.push({xv: xVl[xi], yv: yData[yi].val, ts: xTs[xi]});
      }
    }
    /* Sort by X value for clean characteristic curve */
    pairs.sort((a,b) => a.xv - b.xv);
    return {
      name: pn(yP),
      tag: yP.tag,
      color: gc(yP),
      x: pairs.map(p => p.xv),
      y: pairs.map(p => p.yv),
      ts: pairs.map(p => p.ts),
      lw: S.style.PW[yP.tag] || S.view.LW,
      ld: S.style.PD[yP.tag] || S.view.LDASH,
      pointCount: pairs.length
    };
  });
}

function buildXYSpec(params, pd, h){
  const T = thm();
  const xParam = S.data.AP.find(p => p.tag === S.ui.XY_XPARAM);
  if(!xParam) return null;
  const yParams = params.filter(p => p.tag !== S.ui.XY_XPARAM);
  if(!yParams.length) return null;

  const xyData = prepareXYData(xParam, yParams);
  const xName = pn(xParam) + (xParam.unit ? ' [' + xParam.unit + ']' : '');
  const yUnit = (yParams.length === 1 && yParams[0].unit) ? yParams[0].unit : '';
  const yName = yParams.length === 1 ? pn(yParams[0]) + (yUnit ? ' [' + yUnit + ']' : '') : '';

  const traces = [];
  let totalPts = 0;
  xyData.forEach(d => {
    if(!d.pointCount) return;
    totalPts += d.pointCount;
    traces.push({
      x: d.x, y: d.y, name: d.name,
      type: d.pointCount > WEBGL_THRESHOLD ? 'scattergl' : 'scatter',
      mode: 'lines+markers',
      line:{color:d.color, width:d.lw, dash:d.ld, shape:'linear'},
      marker:{size:3, color:d.color},
      hovertemplate: xName+': %{x:.4g}<br>'+d.name+': %{y:.4g}<extra></extra>'
    });

    const lv = S.style.PL[d.tag];
    if(lv && (lv.hi !== null || lv.lo !== null)){
      const xOOB = [], yOOB = [];
      for(let i = 0; i < d.x.length; i++){
        const v = d.y[i];
        const out = (lv.hi !== null && v > lv.hi) || (lv.lo !== null && v < lv.lo);
        if(out){ xOOB.push(d.x[i]); yOOB.push(v); }
      }
      if(xOOB.length){
        traces.push({x:xOOB, y:yOOB, name:d.name+' (!)',
          type:'scatter', mode:'markers',
          marker:{size:6, color:'#f87171', opacity:0.9, symbol:'x'},
          showlegend:false, hoverinfo:'skip'});
      }
    }
  });

  if(!traces.length) return null;

  const layout = {
    paper_bgcolor:T.pbg, plot_bgcolor:T.pbg,
    font:{family:"'JetBrains Mono',monospace", color:T.pfont, size:_fs(14)},
    margin:{l:66, r:10, t:42, b:58},
    legend:{orientation:'h', x:0, xanchor:'left', y:1, yanchor:'top', bgcolor:'rgba(0,0,0,0)', font:{size:_fs(13)}},
    xaxis:{title:{text:xName, font:{size:_fs(13)}}, gridcolor:T.pgrid, linecolor:T.pline, tickcolor:T.pline, tickfont:{size:_fs(13)}},
    yaxis:{title:yName?{text:yName, font:{size:_fs(13)}}:undefined, gridcolor:T.pgrid, linecolor:T.pline, tickcolor:T.pline, zeroline:false, tickfont:{size:_fs(13)}},
    hovermode:'closest', dragmode:'zoom',
    height:h, autosize:true,
    shapes:[], annotations:[]
  };

  yParams.forEach(yP => {
    const lv = S.style.PL[yP.tag];
    if(!lv) return;
    if(lv.hi !== null){
      layout.shapes.push({type:'line', xref:'paper', yref:'y', x0:0, x1:1, y0:lv.hi, y1:lv.hi,
        line:{color:'#f87171', width:1.5, dash:'dash'}});
    }
    if(lv.lo !== null){
      layout.shapes.push({type:'line', xref:'paper', yref:'y', x0:0, x1:1, y0:lv.lo, y1:lv.lo,
        line:{color:'#38bdf8', width:1.5, dash:'dash'}});
    }
  });

  const cfg = {responsive:true, displaylogo:false, scrollZoom:true,
    toImageButtonOptions:{format:'png', width:1920, height:Math.max(h,400), scale:2, filename:'xy_'+fileTS()}};

  const yColor = (yParams.length === 1) ? (S.style.PC[yParams[0].tag] || PAL[0]) : T.pfont;
  const axisDescs = [{yaKey:'yaxis', axisPos:0, color:yColor, xanchor:'left'}];

  return {traces, layout, cfg, traceData:[], ptsText: totalPts + ' pts', axisDescs, xParam, yParams, xName, yName};
}

function mkChartXY(ct, params){
  const xParam = S.data.AP.find(p => p.tag === S.ui.XY_XPARAM);
  if(!xParam) return;
  const yParams = params.filter(p => p.tag !== S.ui.XY_XPARAM);
  if(!yParams.length) return;
  const xName = pn(xParam) + (xParam.unit ? ' [' + xParam.unit + ']' : '');
  const yUnit = (yParams.length === 1 && yParams[0].unit) ? yParams[0].unit : '';
  const yName = yParams.length === 1 ? pn(yParams[0]) + (yUnit ? ' [' + yUnit + ']' : '') : '';
  const placeholder = yName ? (yName + ' = f(' + xName + ')') : (xName + ' vs ...');

  const h0 = calcH(1);
  const {box, pd, ptsSpan} = _createChartBox(ct, '__xy', '', placeholder, h0);
  const cache = {kind:'xy', box, pd, ptsSpan, params:params.slice(), chartCount:1, h:h0};
  S.plot._plotCache.push(cache);
  _renderChart(cache, true);
}

/* ===== SMOOTHING ===== */
function setSmooth(type){
  S.view.SMOOTH_TYPE = type;
  ['smNone','smSpline','smMavg','smEma','smGauss','smSg'].forEach(id => { $(id).className = 'b'; });
  const map = {none:'smNone', spline:'smSpline', mavg:'smMavg', ema:'smEma', gauss:'smGauss', sg:'smSg'};
  if(map[type]) $(map[type]).className = 'b on';
  $('smoothSliderSec').style.display = type === 'none' ? 'none' : 'block';
  updateSmoothDetail();
  render();
}
function setSmoothStr(v){
  S.view.SMOOTH_STR = parseInt(v, 10);
  $('smlbl').textContent = 'Сила: ' + v;
  updateSmoothDetail();
  render();
}
function togSmoothOrig(){
  S.view.SMOOTH_ORIG = !S.view.SMOOTH_ORIG;
  $('smOrig').className = 'b' + (S.view.SMOOTH_ORIG ? ' on' : '');
  render();
}
function smoothParams(){
  const s = S.view.SMOOTH_STR;
  switch(S.view.SMOOTH_TYPE){
    case 'spline': return {smoothing: 0.1 + (s / 100) * 1.2};
    case 'mavg': {
      let w = Math.round(3 + (s / 100) * 98);
      if(w % 2 === 0) w++;
      return {window: w, label: 'Окно: ' + w};
    }
    case 'ema': {
      const alpha = 0.9 - (s / 100) * 0.88;
      return {alpha, label: 'α: ' + alpha.toFixed(3)};
    }
    case 'gauss': {
      const sigma = 0.5 + (s / 100) * 14.5;
      let w = Math.round(sigma * 3) * 2 + 1;
      if(w < 3) w = 3;
      return {sigma, window: w, label: 'σ: ' + sigma.toFixed(1) + ' окно: ' + w};
    }
    case 'sg': {
      let w = Math.round(5 + (s / 100) * 96);
      if(w % 2 === 0) w++;
      if(w < 5) w = 5;
      const order = w <= 5 ? 2 : (s > 70 ? 2 : 3);
      return {window: w, order, label: 'Окно: ' + w + ' порядок: ' + order};
    }
    default: return {};
  }
}
function updateSmoothDetail(){
  const sp = smoothParams();
  const el = $('smdetail');
  if(!el) return;
  if(S.view.SMOOTH_TYPE === 'spline') el.textContent = 'Plotly spline, smoothing: ' + (sp.smoothing||0).toFixed(2);
  else if(sp.label) el.textContent = sp.label;
  else el.textContent = '';
}

/* --- Smoothing algorithms ---
   Nulls in `y` mark real session gaps (inserted by the render path). Smoothers must
   treat them as segment breaks — not as zeros — otherwise averages pull to zero across
   gap boundaries and EMA drags a phantom value across them. Helper runs `smoothOne`
   on each maximal non-null run and re-inserts the nulls in their original slots. */
function smoothBySegments(y, smoothOne){
  const n = y.length;
  const out = new Array(n);
  let i = 0;
  while(i < n){
    if(y[i] === null){ out[i] = null; i++; continue; }
    let j = i;
    while(j < n && y[j] !== null) j++;
    const seg = y.slice(i, j);
    const sm = smoothOne(seg);
    for(let k = 0; k < sm.length; k++) out[i + k] = sm[k];
    i = j;
  }
  return out;
}

function smoothMovingAvg(y, window){
  return smoothBySegments(y, seg => {
    const n = seg.length;
    if(n < window) return seg.slice();
    const out = new Array(n);
    const half = (window - 1) / 2;
    let sum = 0;
    for(let i = 0; i < n; i++){
      sum += seg[i];
      if(i >= window) sum -= seg[i - window];
      if(i >= window - 1) out[i - Math.floor(half)] = sum / window;
    }
    for(let i = 0; i < Math.floor(half); i++) out[i] = seg[i];
    for(let i = n - Math.ceil(half); i < n; i++) out[i] = seg[i];
    return out;
  });
}

function smoothEMA(y, alpha){
  return smoothBySegments(y, seg => {
    const n = seg.length;
    if(!n) return [];
    const out = new Array(n);
    out[0] = seg[0];
    for(let i = 1; i < n; i++){
      out[i] = alpha * seg[i] + (1 - alpha) * out[i-1];
    }
    return out;
  });
}

function smoothGauss(y, sigma, window){
  const n = y.length;
  if(n < 3) return y.slice();
  const half = Math.floor(window / 2);
  /* Build kernel */
  const kernel = new Array(window);
  let ksum = 0;
  for(let i = 0; i < window; i++){
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    ksum += kernel[i];
  }
  for(let i = 0; i < window; i++) kernel[i] /= ksum;

  const out = new Array(n);
  for(let i = 0; i < n; i++){
    if(y[i] === null){ out[i] = null; continue; }
    let s = 0, w = 0;
    for(let j = -half; j <= half; j++){
      const idx = i + j;
      if(idx < 0 || idx >= n || y[idx] === null) continue;
      s += y[idx] * kernel[j + half];
      w += kernel[j + half];
    }
    out[i] = w > 0 ? s / w : y[i];
  }
  return out;
}

function smoothSavitzkyGolay(y, window, order){
  const n = y.length;
  if(n < window) return y.slice();
  const half = Math.floor(window / 2);

  /* Build Vandermonde matrix and solve for convolution coefficients */
  /* For each point, fit polynomial of given order to window-sized neighborhood */
  /* Pre-compute coefficients for centered window */
  const coeffs = sgCoeffs(window, order);

  const out = new Array(n);
  for(let i = 0; i < n; i++){
    if(y[i] === null){ out[i] = null; continue; }
    if(i < half || i >= n - half){
      out[i] = y[i]; /* edge: keep original */
      continue;
    }
    let s = 0;
    for(let j = -half; j <= half; j++){
      const v = y[i + j];
      s += (v === null ? y[i] : v) * coeffs[j + half];
    }
    out[i] = s;
  }
  return out;
}

function sgCoeffs(window, order){
  const half = Math.floor(window / 2);
  const m = order + 1;
  /* Build J matrix (Vandermonde) */
  const J = [];
  for(let i = -half; i <= half; i++){
    const row = [];
    for(let j = 0; j < m; j++) row.push(Math.pow(i, j));
    J.push(row);
  }
  /* (JᵀJ)⁻¹ Jᵀ — first row gives smoothing coefficients */
  const JT = transpose(J);
  const JTJ = matMul(JT, J);
  const JTJinv = matInv(JTJ);
  if(!JTJinv) return new Array(window).fill(1 / window); /* fallback */
  const C = matMul(JTJinv, JT);
  return C[0]; /* first row = smoothing (0th derivative) */
}

function transpose(M){
  const rows = M.length, cols = M[0].length;
  const T = [];
  for(let j = 0; j < cols; j++){
    const r = [];
    for(let i = 0; i < rows; i++) r.push(M[i][j]);
    T.push(r);
  }
  return T;
}

function matMul(A, B){
  const rA = A.length, cA = A[0].length, cB = B[0].length;
  const C = [];
  for(let i = 0; i < rA; i++){
    const row = new Array(cB).fill(0);
    for(let j = 0; j < cB; j++){
      for(let k = 0; k < cA; k++) row[j] += A[i][k] * B[k][j];
    }
    C.push(row);
  }
  return C;
}

function matInv(M){
  const n = M.length;
  const A = M.map(r => r.slice());
  const I = [];
  for(let i = 0; i < n; i++){
    const row = new Array(n).fill(0);
    row[i] = 1;
    I.push(row);
  }
  for(let c = 0; c < n; c++){
    let maxR = c;
    for(let r = c+1; r < n; r++){
      if(Math.abs(A[r][c]) > Math.abs(A[maxR][c])) maxR = r;
    }
    [A[c], A[maxR]] = [A[maxR], A[c]];
    [I[c], I[maxR]] = [I[maxR], I[c]];
    const piv = A[c][c];
    if(Math.abs(piv) < 1e-12) return null;
    for(let j = 0; j < n; j++){ A[c][j] /= piv; I[c][j] /= piv; }
    for(let r = 0; r < n; r++){
      if(r === c) continue;
      const f = A[r][c];
      for(let j = 0; j < n; j++){ A[r][j] -= f * A[c][j]; I[r][j] -= f * I[c][j]; }
    }
  }
  return I;
}

function applySmoothing(yArr){
  if(S.view.SMOOTH_TYPE === 'none' || S.view.SMOOTH_TYPE === 'spline') return yArr;
  const sp = smoothParams();
  switch(S.view.SMOOTH_TYPE){
    case 'mavg': return smoothMovingAvg(yArr, sp.window);
    case 'ema': return smoothEMA(yArr, sp.alpha);
    case 'gauss': return smoothGauss(yArr, sp.sigma, sp.window);
    case 'sg': return smoothSavitzkyGolay(yArr, sp.window, sp.order);
    default: return yArr;
  }
}

function calcH(chartCount){
  if(S.view.CH > 0) return S.view.CH;
  /* Auto: fill available viewport minus per-chart chrome AND fixed bottom UI.
     Bottom UI = rangeslider (~28px) when RSLIDER is on, stats summary (~28px), and
     cpanel header/padding (~12px). Without this reservation the slider ends up
     below the fold and forces the user to scroll. */
  const ca = $('ca');
  if(!ca) return 500;
  const n = chartCount || 1;
  const perChartChrome = 42; /* title bar + border + inner padding */
  const bottomReserved = (S.ui.RSLIDER ? 30 : 0) + 30; /* slider + stats summary row */
  const available = ca.clientHeight - bottomReserved - 8;
  const perChart = Math.floor((available - n * perChartChrome) / n);
  return Math.max(230, perChart);
}
function setH(v){
  const n = parseInt(v, 10);
  if(n === 0){
    S.view.CH = 0;
  } else {
    S.view.CH = n;
  }
  updateHeightLabel();
  render();
}
/* Keep the sidebar height label in sync with the current auto-computed value.
   Called from setH, from the window-resize handler, and at the end of _render so
   the user always sees "Высота: авто (N px)" with the real N for the current
   chart count / viewport. */
function updateHeightLabel(){
  const lbl = $('hlbl');
  if(!lbl) return;
  if(S.view.CH === 0){
    const n = Math.max(1, getAct().length);
    const h = calcH(n);
    lbl.textContent = 'Высота: авто (' + h + 'px)';
  } else {
    lbl.textContent = 'Высота: ' + S.view.CH + 'px';
  }
}
function setAxisSpacing(v){
  S.view.AXIS_SPACING_PX = parseInt(v, 10);
  $('axslbl').textContent = 'Расст. осей Y: ' + S.view.AXIS_SPACING_PX + 'px';
  render();
}
function setFontScale(v){
  const pct = parseInt(v, 10);
  S.view.FONT_SCALE = Math.max(0.5, Math.min(3, pct / 100));
  $('fsslbl').textContent = 'Шрифт графика: ' + pct + '%';
  render();
}
/* Scale a base font size by the user's FONT_SCALE (rounded to nearest int because
   Plotly renders non-integer font-size with subpixel anti-aliasing that looks fuzzy). */
function _fs(base){ return Math.max(1, Math.round(base * (S.view.FONT_SCALE || 1))); }
function selAll(){
  S.data.AP.forEach(p => { if(p.data.length) S.data.SEL.add(p.tag); });
  updSide();
  render();
}
function selNone(){
  S.data.SEL.clear();
  S.data.QUALITY_GOOD_ONLY = false;
  updSide();
  render();
}
function togP(tag){
  if(S.data.SEL.has(tag)) S.data.SEL.delete(tag);
  else S.data.SEL.add(tag);
  updSide();
  render();
}
function renP(tag, nm){
  const p = S.data.AP.find(x => x.tag === tag);
  if(p) p.cn = nm;
}
function onColorInput(tag, val, sw){
  S.style.PC[tag] = val;
  sw.style.background = val;
}
function onColorChange(tag, val){
  S.style.PC[tag] = val;
  S.ui._colorPickerOpen = false;
  render();
}
function onTR(){
  const f = parseInt($('tfr').value, 10);
  const t = parseInt($('tto').value, 10);
  if(Number.isNaN(f) || Number.isNaN(t) || f >= t) return;
  $('tfv').textContent = ft(f);
  $('ttv').textContent = ft(t);
  $('xfm').value = ft(f);
  $('xtm').value = ft(t);
  /* Zoom all plots without re-rendering */
  const r = [localISO(f), localISO(t)];
  S.plot._allPlots.forEach(pd => {
    try{ Plotly.relayout(pd, {'xaxis.range': r}); }catch(_e){}
  });
}
function onMXR(){
  if(!S.view.TB) return;
  function ps(s, fb){
    const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if(!m) return fb;
    const d = new Date(fb);
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), 0);
    return d.getTime();
  }
  const f = ps($('xfm').value.trim(), S.view.TB[0]);
  const t = ps($('xtm').value.trim(), S.view.TB[1]);
  if(f >= t) return;
  $('tfr').value = f;
  $('tto').value = t;
  $('tfv').textContent = ft(f);
  $('ttv').textContent = ft(t);
  /* Zoom all plots */
  const r = [localISO(f), localISO(t)];
  S.plot._allPlots.forEach(pd => {
    try{ Plotly.relayout(pd, {'xaxis.range': r}); }catch(_e){}
  });
}
/* Sync the sidebar «От/До» slider, its readout, and the hh:mm:ss inputs from
   the plot's current xaxis.range so any Plotly-driven zoom/pan (box zoom, wheel,
   double-click reset, minimap drag, zoom history) stays reflected in the sidebar. */
function syncTimeSliderFromPlot(pd){
  if(!pd || !pd._fullLayout || !S.view.TB) return;
  if(S.view._sliderSyncFromPlot) return; /* don't fight user's own slider motion */
  let lo, hi;
  try{
    const xa = pd._fullLayout.xaxis;
    if(!xa || !xa.range) return;
    if(xa.autorange){ lo = S.view.TB[0]; hi = S.view.TB[1]; }
    else { lo = axisToMs(xa.range[0]); hi = axisToMs(xa.range[1]); }
  }catch(_e){ return; }
  if(!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return;
  /* Clamp to full data bounds so the slider thumb never overshoots its track. */
  lo = Math.max(lo, S.view.TB[0]);
  hi = Math.min(hi, S.view.TB[1]);
  S.view._sliderSyncFromPlot = true;
  try{
    const tfr = $('tfr'); const tto = $('tto');
    if(tfr) tfr.value = Math.round(lo);
    if(tto) tto.value = Math.round(hi);
    const tfv = $('tfv'); const ttv = $('ttv');
    if(tfv) tfv.textContent = ft(lo);
    if(ttv) ttv.textContent = ft(hi);
    const xfm = $('xfm'); const xtm = $('xtm');
    if(xfm) xfm.value = ft(lo);
    if(xtm) xtm.value = ft(hi);
  }finally{
    S.view._sliderSyncFromPlot = false;
  }
}
function rstTR(){
  $('xfm').value = '';
  $('xtm').value = '';
  if(S.view.TB){
    $('tfr').value = S.view.TB[0];
    $('tto').value = S.view.TB[1];
    $('tfv').textContent = ft(S.view.TB[0]);
    $('ttv').textContent = ft(S.view.TB[1]);
  }
  /* Reset zoom to full range */
  S.plot._allPlots.forEach(pd => {
    try{ Plotly.relayout(pd, {'xaxis.autorange': true}); }catch(_e){}
  });
}
function onYR(){
  const a = $('ymn').value.trim();
  const b = $('ymx').value.trim();
  S.view.YR[0] = a === '' ? null : parseFloat(a.replace(',', '.'));
  S.view.YR[1] = b === '' ? null : parseFloat(b.replace(',', '.'));
  if(S.view.YR[0] !== null && Number.isNaN(S.view.YR[0])) S.view.YR[0] = null;
  if(S.view.YR[1] !== null && Number.isNaN(S.view.YR[1])) S.view.YR[1] = null;
  render();
}
function rstY(){
  S.view.YR = [null, null];
  $('ymn').value = '';
  $('ymx').value = '';
  render();
}
function resetAll(){
  clearTraceCache();
  resetZoomHistory();
  S.data.AP = [];
  S.data.FN = [];
  S.data.SEL.clear();
  S.view.TR = null;
  S.view.TB = null;
  S.view.YR = [null, null];
  S.style.CTT = {};
  S.style.PC = {};
  S.style.PW = {};
  S.style.PD = {};
  S.style.PL = {};
  S.cursor._cursorA = null;
  S.cursor._cursorB = null;
  S.cursor._valsA = {};
  S.cursor._valsB = {};
  S.plot._activePlot = null;
  S.plot._allTraceData = [];
  S.data._fileStore = {};
  /* Note: MARKERS are NOT cleared on data reset — they persist across sessions.
     User can remove them individually via the sidebar or clear via localStorage. */
  S.t0._t0ms = null;
  S.anomaly.ANOMALY_ON = false;
  S.t0.T0_MODE = false;
  S.markers.MARKER_ADD_TYPE = null;
  document.body.classList.remove('addcursor');
  if($('addhint')) $('addhint').classList.remove('vis');
  S.ui.XY_MODE = false;
  S.ui.XY_XPARAM = null;
  S.view.DS_ALG = 'lttb';
  S.view.SMOOTH_TYPE = 'none';
  S.view.SMOOTH_STR = 30;
  S.view.SMOOTH_ORIG = false;
  $('banom').className = 'b';
  $('bt0').className = 'b';
  $('bts').className = 'b on';
  $('bxy').className = 'b';
  if($('bqgood')) $('bqgood').className = 'b';
  $('xysec').style.display = 'none';
  $('bovr').style.display = '';
  $('bspl').style.display = '';
  $('smOrig').className = 'b';
  ['smNone','smSpline','smMavg','smEma','smGauss','smSg'].forEach(id => { $(id).className = 'b'; });
  $('smNone').className = 'b on';
  $('smoothSliderSec').style.display = 'none';
  ['dsLttb','dsMinmax','dsNth'].forEach(id => { $(id).className = 'b'; });
  $('dsLttb').className = 'b on';
  $('smsl').value = 30;
  $('smlbl').textContent = 'Сила: 30';
  $('anomsec').style.display = 'none';
  $('t0sec').style.display = 'none';
  $('t0info').textContent = 'Не установлено';
  $('ymn').value = '';
  $('ymx').value = '';
  $('cpanel').className = '';
  updAll();
}

/* Format timestamp for Excel: "ДД.ММ.ГГГГ чч:мм:сс.ммм" — Russian Excel auto-detects as datetime.
   NOTE: ms separator MUST be '.', not ',' — comma is the decimal sep in RU locale and would break datetime parsing. */
function fmtTsExcel(ts){
  const d = new Date(ts);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear()
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/* Format number for Excel (RU locale): dot → comma, no thousand separator */
function fmtNumExcel(v){
  if(v === null || v === undefined || v === '' || Number.isNaN(v)) return '';
  return String(v).replace('.', ',');
}

function exportCSV(mode, encoding){
  /* mode: raw-long (original points), aligned (interpolated wide), thin, visible */
  const act = getAct();
  if(!act.length) return;

  if(mode === 'raw' || mode === 'raw-long'){
    const rows = [['Дата/Время', 'Epoch µs', 'Источник времени', 'Тег', 'Имя', 'Значение', 'Ед. изм.', 'Raw значение', 'Raw ед. изм.', 'Статус', 'Merge conflict', 'Файл', 'Кодировка']];
    const rawRows = [];
    for(const p of act){
      for(const d of p.data){
        rawRows.push({
          ts: d.ts,
          row: [
            fmtTsExcel(d.ts),
            d.epochRaw || (d.epochUs != null ? String(d.epochUs) : ''),
            d.timeSource || p.timeSource || p.timezone || 'local',
            p.tag,
            pn(p),
            fmtNumExcel(d.val),
            p.unit || '',
            d.rawVal !== undefined ? fmtNumExcel(d.rawVal) : '',
            p.rawUnit || '',
            d.status || '',
            d.mergeConflict ? 'yes' : '',
            d.sourceFile || p.sourceFile || '',
            d.sourceFile && S.data._fileStore[d.sourceFile] ? (S.data._fileStore[d.sourceFile].encoding || '') : (p.sourceFile && S.data._fileStore[p.sourceFile] ? (S.data._fileStore[p.sourceFile].encoding || '') : '')
          ]
        });
      }
    }
    if(!rawRows.length){ showErr('Нет данных для экспорта'); return; }
    rawRows.sort((a, b) => a.ts - b.ts);
    rawRows.forEach(r => rows.push(r.row));
    const suffix = encoding === 'windows-1251' ? '_сырой_cp1251' : '_сырой_long';
    downloadCsv(rowsToCsv(rows), 'log_export' + suffix + '_' + fileTS() + '.csv', encoding || 'utf-8-bom');
    return;
  }

  /* Optional extra X range from current Plotly zoom (mode='visible' only) */
  let visibleRange = null;
  if(mode === 'visible'){
    const pd = S.plot._activePlot || (S.plot._allPlots && S.plot._allPlots[0]);
    try{
      const xa = pd && pd._fullLayout && pd._fullLayout.xaxis;
      if(xa && xa.range){
        if(xa.type === 'date'){
          visibleRange = [new Date(xa.range[0]).getTime(), new Date(xa.range[1]).getTime()];
        } else if(S.t0._t0ms !== null){
          /* T=0 mode: range is in seconds from T=0 anchor */
          visibleRange = [S.t0._t0ms + Number(xa.range[0]) * 1000, S.t0._t0ms + Number(xa.range[1]) * 1000];
        }
      }
    }catch(_e){}
    if(!visibleRange){ showErr('Не удалось определить видимый диапазон (только для режима «Время»)'); return; }
  }

  /* Per-param series */
  const series = act.map(p => {
    let data = filt(p.data);
    if(visibleRange) data = data.filter(d => d.ts >= visibleRange[0] && d.ts <= visibleRange[1]);
    if(mode === 'thin'){
      const x = data.map(d => d.ts);
      const y = data.map(d => d.val);
      const ds = isStepSignal(p) ? downsampleDiscrete(x, y) : dsDispatch(x, y, MAX_PTS);
      data = ds.x.map((t, i) => ({ts: t, val: ds.y[i]}));
    }
    return {
      param: p,
      xArr: data.map(d => d.ts),
      yArr: data.map(d => d.val),
      isDiscrete: isStepSignal(p),
      signalKind: signalKindOf(p)
    };
  }).filter(s => s.xArr.length > 0);

  if(!series.length){ showErr('Нет данных для экспорта'); return; }

  /* Union of timestamps across all series — empty cells where a param has no data.
     Works cleanly even when params cover different, non-overlapping time windows. */
  const tsSet = new Set();
  series.forEach(s => { s.xArr.forEach(t => tsSet.add(t)); });
  const sorted = Array.from(tsSet).sort((a, b) => a - b);

  /* Header built from `series` (the filtered list) — NOT `act` — so header and
     per-row cells stay aligned when some selected param has no points in range. */
  const header = ['Дата/Время'];
  series.forEach(s => {
    const nm = pn(s.param);
    header.push(s.param.unit ? (nm + ' [' + s.param.unit + ']') : nm);
  });
  const rows = [header];

  sorted.forEach(ts => {
    const row = [fmtTsExcel(ts)];
    series.forEach(s => {
      /* Empty cell if this timestamp is outside the param's own data range — avoids fake extrapolation */
      if(ts < s.xArr[0] || ts > s.xArr[s.xArr.length - 1]){
        row.push('');
      } else {
        const v = s.isDiscrete ? interpStep(s.xArr, s.yArr, ts) : interpY(s.xArr, s.yArr, ts);
        row.push(fmtNumExcel(v));
      }
    });
    rows.push(row);
  });

  const suffix = mode === 'thin' ? '_прореж' : (mode === 'visible' ? '_видимое' : '_выровн');
  downloadCsv(rowsToCsv(rows), 'log_export' + suffix + '_' + fileTS() + '.csv', encoding || 'utf-8-bom');
}

function fileTS(){
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
}

async function exportPNG(){
  if(!S.plot._allPlots.length || !window.Plotly) return;
  const ts = fileTS();
  const act = getAct();
  /* Helper: temporarily tweak layout for export, then restore */
  async function withExportLayout(pd, titleName, fn){
    const tweaks = {'xaxis.rangeslider.visible':false};
    const savedTop = (pd._fullLayout && pd._fullLayout.margin) ? pd._fullLayout.margin.t : 64;
    const restore = {'xaxis.rangeslider.visible': false, 'margin.t': savedTop};
    if(titleName){
      /* Title just above the graph — unit labels (yshift=26 → occupy y ≈ [plot_top-40, plot_top-26])
         sit neatly below the title. Using paper y=1 + yshift=66 pins the title baseline
         at fixed pixel distance above the plot regardless of plot height. */
      tweaks['title.text'] = titleName;
      tweaks['title.font.size'] = _fs(15);
      tweaks['title.x'] = 0.5;
      tweaks['title.xanchor'] = 'center';
      tweaks['title.y'] = 1;
      tweaks['title.yref'] = 'paper';
      tweaks['title.yanchor'] = 'bottom';
      tweaks['title.pad'] = {t: 0, b: 8};
      /* Plotly title yshift is not supported; bump margin.t so title+unit labels both fit. */
      tweaks['margin.t'] = 72;
      restore['title.text'] = '';
    }
    await Plotly.relayout(pd, tweaks);
    try{ await fn(); }finally{ await Plotly.relayout(pd, restore); }
  }
  try{
    const expH = calcH(act.length);
    if(S.ui.MODE === 'o' || S.ui.XY_MODE){
      const titleName = S.style.CTT[S.ui.XY_MODE?'__xy':'__ov'] || act.map(p => pn(p)).join(', ');
      const fname = (titleName || 'graph').replace(/[^a-zA-Zа-яА-Я0-9_.-]/g,'') + '_' + ts;
      await withExportLayout(S.plot._allPlots[0], titleName, async () => {
        await Plotly.downloadImage(S.plot._allPlots[0], {format:'png', width:1920, height:Math.max(expH, 400), filename:fname});
      });
    } else if(S.ui.MODE === 's' && S.plot._allPlots.length === 1){
      const tk = act[0] ? act[0].tag : '';
      const titleName = (tk && S.style.CTT[tk]) ? S.style.CTT[tk] : (act[0] ? pn(act[0]) : '');
      const fname = (titleName || 'graph').replace(/[^a-zA-Zа-яА-Я0-9_.-]/g,'') + '_' + ts;
      await withExportLayout(S.plot._allPlots[0], titleName, async () => {
        await Plotly.downloadImage(S.plot._allPlots[0], {format:'png', width:1920, height:Math.max(expH, 400), filename:fname});
      });
    } else {
      setBusy(true, 'Экспорт...');
      const imgW = 1920, perH = Math.max(expH, 300);
      const scale = 2;
      const titleH = 40;
      const images = [];
      for(let i = 0; i < S.plot._allPlots.length; i++){
        const pd = S.plot._allPlots[i];
        const titleName = act[i] ? (S.style.CTT[act[i].tag] || pn(act[i])) : '';
        await withExportLayout(pd, titleName, async () => {
          const url = await Plotly.toImage(pd, {format:'png', width:imgW, height:perH, scale:scale});
          images.push(url);
        });
      }
      const names = act.map(p => (S.style.CTT[p.tag]) ? S.style.CTT[p.tag] : pn(p));
      const canvas = document.createElement('canvas');
      canvas.width = imgW * scale;
      canvas.height = (perH * scale + titleH) * images.length;
      const ctx = canvas.getContext('2d');
      const _T = thm();
      for(let i = 0; i < images.length; i++){
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = images[i]; });
        const yOff = i * (perH * scale + titleH);
        ctx.fillStyle = _T.pbg;
        ctx.fillRect(0, yOff, canvas.width, titleH);
        if(names[i]){
          ctx.fillStyle = _T.pfont;
          ctx.font = 'bold 24px JetBrains Mono, monospace';
          ctx.textBaseline = 'middle';
          ctx.fillText(names[i], 20, yOff + titleH / 2);
        }
        ctx.drawImage(img, 0, yOff + titleH);
      }
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'график_' + ts + '.png';
      a.click();
      setBusy(false);
    }
  }catch(e){
    setBusy(false);
    showErr('Не удалось экспортировать PNG: ' + (e && e.message ? e.message : 'неизвестная ошибка'));
  }
}

/* Save file with modified tags/descriptions */
/* Move a value in an object-map from oldKey to newKey (no-op if oldKey missing or keys equal). */
function _moveKey(mapObj, oldKey, newKey){
  if(!mapObj || oldKey === newKey) return;
  if(Object.prototype.hasOwnProperty.call(mapObj, oldKey)){
    if(!Object.prototype.hasOwnProperty.call(mapObj, newKey)){
      mapObj[newKey] = mapObj[oldKey];
    }
    delete mapObj[oldKey];
  }
}
/* Propagate a tag rename across every tag-keyed structure in S so selection, colors,
   styling, levels, markers and saved Y ranges stay consistent after the rename. */
function renameTagEverywhere(oldTag, newTag){
  if(!oldTag || !newTag || oldTag === newTag) return;
  _moveKey(S.style.PC,  oldTag, newTag);
  _moveKey(S.style.PW,  oldTag, newTag);
  _moveKey(S.style.PD,  oldTag, newTag);
  _moveKey(S.style.PL,  oldTag, newTag);
  _moveKey(S.style.CTT, oldTag, newTag);
  _moveKey(S.plot._savedYRanges || {}, oldTag, newTag);
  if(S.data.SEL.has(oldTag)){
    S.data.SEL.delete(oldTag);
    S.data.SEL.add(newTag);
  }
  S.markers.MARKERS.forEach(m => { if(m.tag === oldTag) m.tag = newTag; });
}

function replaceHeaderTagCell(cell, oldTag, newTag){
  const cleaned = cleanCell(cell);
  if(cleaned === oldTag) return newTag;
  const grouped = cleaned.match(/^(Дата|Date|Время|Time)\s+(.+)$/i);
  if(grouped && grouped[2] === oldTag) return grouped[1] + ' ' + newTag;
  return cell;
}

function saveFile(filename){
  const fd = S.data._fileStore[filename];
  if(!fd){ showErr('Нет данных файла: ' + filename); return; }
  if(!fd.textStored || !fd.text){ showErr('Исходный текст файла не хранится в памяти для больших логов'); return; }

  /* Gather pending renames so the user sees exactly what will be written back. */
  const paramsFromFile = S.data.AP.filter(p => String(p.sourceFile || '').split(',').map(s => s.trim()).includes(filename));
  const renames = paramsFromFile
    .map(p => ({p, oldTag: p.originalTag, newTag: (p.cn && p.cn !== p.originalTag) ? p.cn : null}))
    .filter(r => r.newTag);

  if(!renames.length){
    showErr('В файле нет изменённых тегов для сохранения');
    return;
  }

  const preview = renames.map(r => '  ' + r.oldTag + ' → ' + r.newTag).join('\n');
  if(!confirm('Сохранить ' + filename + ' с заменой тегов:\n\n' + preview + '\n\nКомментарии перезапишут исходные теги в файле. Продолжить?')){
    return;
  }

  const lines = fd.text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const hi = fd.headerIdx;
  let headerCells = String(lines[hi] || '').split('\t');

  for(const r of renames){
    const {p, oldTag, newTag} = r;
    headerCells = headerCells.map(cell => replaceHeaderTagCell(cell, oldTag, newTag));

    /* Migrate all state BEFORE mutating p.tag/p.originalTag so the old keys are still findable. */
    renameTagEverywhere(oldTag, newTag);

    p.originalTag = newTag;
    p.tag = newTag;
    p.cn = '';
    const dotParts = newTag.split('.');
    if(dotParts.length > 1){
      const lastDot = dotParts[dotParts.length - 1];
      const spIdx = lastDot.indexOf(' ');
      p.shortName = spIdx > 0 ? lastDot.substring(0, spIdx) : lastDot;
    } else {
      p.shortName = newTag;
    }
  }

  lines[hi] = headerCells.join('\t');
  const newText = lines.join('\n');

  /* Update stored text */
  S.data._fileStore[filename] = { text: newText, textStored: true, headerIdx: hi, encoding: fd.encoding || 'utf-8', bom: !!fd.bom };

  /* Download the modified file */
  let enc = fd.encoding || 'utf-8';
  if(enc === 'utf-8' && fd.bom) enc = 'utf-8-bom';
  const type = enc === 'windows-1251' ? 'text/plain;charset=windows-1251' : 'text/plain;charset=utf-8';
  downloadBytes(encodeTextBytes(newText, enc), filename, type);
}

function updAll(){
  const hd = S.data.AP.some(p => p.data.length);
  $('sdot').className = 'dot' + (hd ? ' on' : '');
  $('bopen').textContent = S.ui._busy ? 'Загрузка...' : (hd ? '+ Файл' : 'Открыть');
  $('bopen').className = hd ? 'b' : 'b ac';
  $('brst').style.display = hd ? 'inline-block' : 'none';

  const fl = $('fls');
  fl.textContent = '';
  S.data.FN.forEach(name => {
    const span = document.createElement('span');
    span.className = 'ftag';
    span.textContent = name;
    fl.appendChild(span);
    /* Save button per file */
    if(S.data._fileStore[name] && S.data._fileStore[name].textStored){
      const saveBtn = document.createElement('button');
      saveBtn.className = 'b s';
      saveBtn.textContent = '💾';
      saveBtn.title = 'Сохранить ' + name + ' с изменёнными тегами';
      saveBtn.style.cssText = 'margin-left:2px;padding:2px 6px;font-size:11px';
      saveBtn.addEventListener('click', () => saveFile(name));
      fl.appendChild(saveBtn);
    }
  });

  const mc = S.data.AP.filter(p => p.merged).length;
  if(mc){
    const merged = document.createElement('span');
    merged.className = 'mtag';
    merged.textContent = '⟷ ' + mc;
    fl.appendChild(merged);
  }

  if(hd && S.ui._sidebarVisible) $('side').className = 'vis';
  updSide();
  $('dz').style.display = hd ? 'none' : 'flex';
  updTB();
  render();
}

function updSide(){
  if(S.ui._colorPickerOpen) return;
  const valid = S.data.AP.filter(p => p.data.length);
  /* Tag search: case-insensitive match against tag / shortName / custom name / unit */
  const q = S.ui.TAG_SEARCH || '';
  const filtered = q
    ? valid.filter(p => {
        const s = ((p.tag || '') + '\n' + (p.shortName || '') + '\n' + (p.cn || '') + '\n' + (p.unit || '')).toLowerCase();
        return s.indexOf(q) !== -1;
      })
    : valid;
  $('pcnt').textContent = 'Параметры (' + filtered.length + (q ? ' / ' + valid.length : '') + ')';
  const list = $('plist');
  list.textContent = '';

  filtered.forEach(p => {
    const on = S.data.SEL.has(p.tag);
    const c = gc(p);

    const d = document.createElement('div');
    d.className = 'pi' + (on ? ' on' : '');
    d.addEventListener('click', ev => {
      if(ev.target.tagName === 'INPUT' || ev.target.tagName === 'BUTTON' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'OPTION') return;
      /* Shift-click = solo: show only this param (quick focus mode) */
      if(ev.shiftKey){
        S.data.SEL = new Set([p.tag]);
        render();
        updSide();
        return;
      }
      togP(p.tag);
    });

    const swatch = document.createElement('div');
    swatch.className = 'pc';
    swatch.style.background = c;

    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = c;
    colorIn.addEventListener('click', ev => ev.stopPropagation());
    colorIn.addEventListener('focus', () => { S.ui._colorPickerOpen = true; });
    colorIn.addEventListener('input', ev => {
      ev.stopPropagation();
      onColorInput(p.tag, ev.target.value, swatch);
    });
    colorIn.addEventListener('change', ev => {
      ev.stopPropagation();
      onColorChange(p.tag, ev.target.value);
    });
    colorIn.addEventListener('blur', () => { S.ui._colorPickerOpen = false; });
    swatch.appendChild(colorIn);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';

    /* Two-line layout:
         Row 1: big clickable tag label (>= ⅓ of row width) + ▸/▾ expand toggle.
         Row 2: comment input (full width) — shows extracted parenthetical comment
                from the tag if the user hasn't set their own.
       The tag label is intentionally generous so clicking toggles param selection
       reliably — previous single-row cramped this click target to ~20px wide. */
    const tagLbl = document.createElement('span');
    /* padding-left:4px matches the comment input below so their text lines up. */
    tagLbl.style.cssText = 'flex:1 1 0;min-width:0;font-size:14px;font-weight:700;opacity:0.92;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 0 3px 4px';
    tagLbl.textContent = p.shortName || p.tag;
    tagLbl.title = p.tag + ' (клик — добавить / убрать с графика)';

    /* Extract parenthetical comment from the full tag as the default placeholder.
       Example: "PLC01.TURB.AI.DWATT DWATT ( Generator Watts )" → "Generator Watts". */
    const extractedComment = (() => {
      const m = (p.tag || '').match(/\(\s*([^()]+?)\s*\)\s*$/);
      return m ? m[1].trim() : '';
    })();

    const nameIn = document.createElement('input');
    nameIn.className = 'pn';
    nameIn.value = p.cn || '';
    nameIn.placeholder = extractedComment || 'комментарий…';
    /* flex:2 + min-width:0 leaves the right ⅓ of the row for the click-through pad,
       so the user can still toggle the param on/off by clicking near the right edge
       even when the comment field would otherwise swallow every pixel. */
    nameIn.style.cssText = 'flex:2 1 0;min-width:0;max-width:none;margin:0;padding:2px 4px';
    nameIn.title = (extractedComment
      ? ('Комментарий / новое имя тега (по умолчанию «' + extractedComment + '» из тега)')
      : 'Комментарий / новое имя тега — показывается в легенде; при «💾 Сохранить файл» заменяет исходный тег.');
    nameIn.addEventListener('click', ev => ev.stopPropagation());
    nameIn.addEventListener('input', ev => {
      ev.stopPropagation();
      renP(p.tag, ev.target.value);
    });

    /* Row 1: tag label (big click target) + expand toggle. */
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:6px';
    topRow.appendChild(tagLbl);
    const expBtn = document.createElement('button');
    expBtn.style.cssText = 'flex:0 0 auto;padding:0 5px;font-size:13px;cursor:pointer;background:transparent;border:1px solid rgba(128,128,128,0.25);border-radius:3px;color:inherit;opacity:0.6;line-height:1.4;font-family:inherit';
    const expanded = S.ui._paramExpandAll || S.ui._paramExpand.has(p.tag);
    expBtn.textContent = expanded ? '▾' : '▸';
    expBtn.title = 'Стиль / уровни / единицы · ' + p.data.length + ' точек' + (p.sourceFile ? (' · ' + p.sourceFile) : '');
    expBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      if(S.ui._paramExpand.has(p.tag)) S.ui._paramExpand.delete(p.tag);
      else S.ui._paramExpand.add(p.tag);
      updSide();
    });
    topRow.appendChild(expBtn);
    info.appendChild(topRow);

    /* Row 2: comment input + click-through pad (right ⅓). The pad is a plain div —
       no stopPropagation, so its click bubbles to .pi's toggle handler. Giving it
       flex:1 against nameIn's flex:2 guarantees a 33% click strip on every width. */
    const commentRow = document.createElement('div');
    commentRow.style.cssText = 'display:flex;align-items:center;gap:0;margin-top:2px';
    commentRow.appendChild(nameIn);
    const clickPad = document.createElement('div');
    clickPad.style.cssText = 'flex:1 1 0;align-self:stretch;cursor:pointer';
    clickPad.title = 'Клик — добавить / убрать с графика';
    commentRow.appendChild(clickPad);
    info.appendChild(commentRow);

    /* Collapsible sub-controls — everything below only shown when `expanded` is true. */
    const detailsBox = document.createElement('div');
    detailsBox.style.cssText = 'display:' + (expanded ? 'block' : 'none');

    /* Details meta line: length, merged/discrete markers, source file. */
    const meta = document.createElement('div');
    meta.className = 'pm';
    meta.style.cssText = 'margin-top:3px';
    const mergedLbl = p.merged ? ' · ⟷ N ф.' : '';
    const discreteLbl = isStepSignal(p) ? ' · ⎍ ' + signalKindOf(p) : '';
    const srcLabel = p.sourceFile ? ' · ' + p.sourceFile : '';
    meta.textContent = p.data.length + ' точек' + mergedLbl + discreteLbl + srcLabel;
    meta.title = 'Полный тег: ' + p.tag + (p.sourceFile ? '\nФайл: ' + p.sourceFile : '');
    detailsBox.appendChild(meta);

    const kindCtrl = document.createElement('div');
    kindCtrl.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:3px;flex-wrap:wrap';
    const kindLbl = document.createElement('span');
    kindLbl.style.cssText = 'font-size:10px;opacity:0.5;white-space:nowrap';
    kindLbl.textContent = 'Сигнал:';
    const kindSel = document.createElement('select');
    kindSel.className = 'ai';
    kindSel.style.cssText = 'font-size:11px;padding:2px 4px;max-width:150px';
    [
      ['analog', 'Analog'],
      ['binary', 'Binary 0/1'],
      ['step', 'Step'],
      ['setpoint', 'Setpoint']
    ].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      kindSel.appendChild(o);
    });
    kindSel.value = signalKindOf(p);
    kindSel.title = 'Тип сигнала влияет на интерполяцию, сглаживание, статистику и прореживание';
    kindSel.addEventListener('click', ev => ev.stopPropagation());
    kindSel.addEventListener('change', ev => {
      ev.stopPropagation();
      p.signalKind = ev.target.value;
      p.isDiscrete = isStepSignal(p);
      clearTraceCache();
      updSide();
      render();
    });
    kindCtrl.appendChild(kindLbl);
    kindCtrl.appendChild(kindSel);
    if(hasBadQuality(p.data)){
      const qBadge = document.createElement('span');
      qBadge.style.cssText = 'font-size:10px;color:#facc15;opacity:0.85';
      qBadge.textContent = 'status';
      qBadge.title = 'В ряду есть точки с non-good status';
      kindCtrl.appendChild(qBadge);
    }
    detailsBox.appendChild(kindCtrl);

    /* Per-param line style: compact row with dash type + width +/- */
    const lineCtrl = document.createElement('div');
    lineCtrl.style.cssText = 'display:flex;gap:3px;align-items:center;margin-top:3px;flex-wrap:wrap';

    /* Dash type mini-buttons */
    const dashes = [{v:'solid',l:'━'},{v:'dash',l:'╌'},{v:'dot',l:'···'},{v:'dashdot',l:'─·'},{v:'longdash',l:'──'}];
    dashes.forEach(o => {
      const btn = document.createElement('button');
      btn.textContent = o.l;
      const isActive = (S.style.PD[p.tag]||S.view.LDASH) === o.v;
      btn.style.cssText = 'font-size:12px;padding:2px 5px;border-radius:2px;cursor:pointer;border:1px solid '
        + (isActive ? 'rgba(34,211,238,0.6)' : 'rgba(128,128,128,0.25)')
        + ';background:' + (isActive ? 'rgba(34,211,238,0.15)' : 'rgba(128,128,128,0.05)')
        + ';color:' + (isActive ? '#22d3ee' : 'inherit') + ';font-family:inherit;line-height:1';
      btn.title = o.v;
      btn.addEventListener('click', ev => { ev.stopPropagation(); S.style.PD[p.tag] = o.v; render(); });
      lineCtrl.appendChild(btn);
    });

    /* Spacer */
    const sp2 = document.createElement('span');
    sp2.style.cssText = 'width:4px;flex-shrink:0';
    lineCtrl.appendChild(sp2);

    /* Width: - value + */
    const curW = S.style.PW[p.tag] || S.view.LW;
    const wMinus = document.createElement('button');
    wMinus.textContent = '−';
    wMinus.style.cssText = 'font-size:12px;padding:1px 6px;border-radius:2px;cursor:pointer;border:1px solid rgba(128,128,128,0.25);background:rgba(128,128,128,0.05);color:inherit;font-family:inherit;line-height:1.2';
    wMinus.addEventListener('click', ev => { ev.stopPropagation(); S.style.PW[p.tag] = Math.max(0.5, (S.style.PW[p.tag]||S.view.LW) - 0.5); render(); });

    const wLabel = document.createElement('span');
    wLabel.style.cssText = 'font-size:11px;opacity:0.65;min-width:18px;text-align:center';
    wLabel.textContent = curW;

    const wPlus = document.createElement('button');
    wPlus.textContent = '+';
    wPlus.style.cssText = 'font-size:12px;padding:1px 6px;border-radius:2px;cursor:pointer;border:1px solid rgba(128,128,128,0.25);background:rgba(128,128,128,0.05);color:inherit;font-family:inherit;line-height:1.2';
    wPlus.addEventListener('click', ev => { ev.stopPropagation(); S.style.PW[p.tag] = Math.min(5, (S.style.PW[p.tag]||S.view.LW) + 0.5); render(); });

    lineCtrl.appendChild(wMinus);
    lineCtrl.appendChild(wLabel);
    lineCtrl.appendChild(wPlus);

    detailsBox.appendChild(lineCtrl);

    /* Per-param level limits: Lo / Hi inputs */
    const lvlCtrl = document.createElement('div');
    lvlCtrl.style.cssText = 'display:flex;gap:3px;align-items:center;margin-top:3px;flex-wrap:wrap';

    const lvlLbl = document.createElement('span');
    lvlLbl.style.cssText = 'font-size:10px;opacity:0.5;white-space:nowrap';
    lvlLbl.textContent = 'Уровни:';

    function commitLevel(tag, field, val){
      if(!S.style.PL[tag]) S.style.PL[tag] = {hi:null, lo:null};
      S.style.PL[tag][field] = (val === '' || isNaN(parseFloat(val))) ? null : parseFloat(val);
      render();
    }

    const loIn = document.createElement('input');
    loIn.className = 'ai';
    loIn.type = 'text';
    loIn.inputMode = 'decimal';
    loIn.placeholder = 'Lo';
    loIn.style.cssText = 'width:68px;font-size:11px;padding:2px 4px';
    loIn.value = (S.style.PL[p.tag] && S.style.PL[p.tag].lo !== null) ? S.style.PL[p.tag].lo : '';
    loIn.addEventListener('change', ev => { ev.stopPropagation(); commitLevel(p.tag, 'lo', ev.target.value); });
    loIn.addEventListener('keydown', ev => { if(ev.key === 'Enter'){ ev.stopPropagation(); commitLevel(p.tag, 'lo', ev.target.value); }});

    const hiIn = document.createElement('input');
    hiIn.className = 'ai';
    hiIn.type = 'text';
    hiIn.inputMode = 'decimal';
    hiIn.placeholder = 'Hi';
    hiIn.style.cssText = 'width:68px;font-size:11px;padding:2px 4px';
    hiIn.value = (S.style.PL[p.tag] && S.style.PL[p.tag].hi !== null) ? S.style.PL[p.tag].hi : '';
    hiIn.addEventListener('change', ev => { ev.stopPropagation(); commitLevel(p.tag, 'hi', ev.target.value); });
    hiIn.addEventListener('keydown', ev => { if(ev.key === 'Enter'){ ev.stopPropagation(); commitLevel(p.tag, 'hi', ev.target.value); }});

    lvlCtrl.appendChild(lvlLbl);
    lvlCtrl.appendChild(loIn);
    lvlCtrl.appendChild(hiIn);

    /* Unit input — shown above Y axis in overlay/split modes. Group the label
       and input in an inline flex container so flex-wrap treats the pair as a
       single unit and never splits "Ед:" from the textbox onto separate lines. */
    const unitGroup = document.createElement('span');
    unitGroup.style.cssText = 'display:inline-flex;align-items:center;gap:3px;flex:0 0 auto';
    const unitLbl = document.createElement('span');
    unitLbl.style.cssText = 'font-size:11px;opacity:0.65;white-space:nowrap';
    unitLbl.textContent = 'Ед:';
    const unitIn = document.createElement('input');
    unitIn.className = 'ai';
    unitIn.type = 'text';
    unitIn.placeholder = '—';
    unitIn.style.cssText = 'width:60px;font-size:12px;padding:2px 4px';
    unitIn.value = p.unit || '';
    unitIn.title = 'Единица измерения (отображается над осью Y)';
    unitIn.addEventListener('click', ev => ev.stopPropagation());
    const commitUnit = ev => {
      ev.stopPropagation();
      const v = ev.target.value.trim();
      if(v === (p.unit || '')) return;
      p.unit = v;
      render();
    };
    unitIn.addEventListener('change', commitUnit);
    unitIn.addEventListener('keydown', ev => {
      if(ev.key === 'Enter'){
        ev.stopPropagation();
        commitUnit(ev);
        ev.target.blur();
      }
    });
    unitGroup.appendChild(unitLbl);
    unitGroup.appendChild(unitIn);

    /* Unit convert button — only visible if current unit has known conversions */
    if(p.unit && UNIT_CONVERSIONS[p.unit]){
      const ucBtn = document.createElement('button');
      ucBtn.className = 'ucbtn';
      ucBtn.textContent = '⇌';
      const opts = UNIT_CONVERSIONS[p.unit];
      ucBtn.title = 'Конвертировать: ' + opts.map(o => p.unit + '→' + o.to).join(', ');
      ucBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        const rect = ucBtn.getBoundingClientRect();
        showConvertMenu(rect.left, rect.bottom + 2, p);
      });
      unitGroup.appendChild(ucBtn);
    }
    lvlCtrl.appendChild(unitGroup);

    detailsBox.appendChild(lvlCtrl);
    info.appendChild(detailsBox);

    d.appendChild(swatch);
    d.appendChild(info);
    list.appendChild(d);
  });
  if(S.ui.XY_MODE) updateXYSelect();
}

function updTB(){
  let mn = Infinity;
  let mx = -Infinity;
  S.data.AP.forEach(p => {
    if(!S.data.SEL.has(p.tag) || !p.data.length) return;
    if(p.data[0].ts < mn) mn = p.data[0].ts;
    if(p.data[p.data.length - 1].ts > mx) mx = p.data[p.data.length - 1].ts;
  });
  if(mn < Infinity){
    S.view.TB = [mn, mx];
    $('tsec').style.display = 'block';
    $('tsl').textContent = ff(mn);
    $('tel').textContent = ff(mx);
    const fr = $('tfr');
    const to = $('tto');
    fr.min = mn;
    fr.max = mx;
    fr.step = Math.max(1000, Math.floor((mx - mn) / 1000));
    fr.value = mn;
    to.min = mn;
    to.max = mx;
    to.step = Math.max(1000, Math.floor((mx - mn) / 1000));
    to.value = mx;
    $('tfv').textContent = ft(mn);
    $('ttv').textContent = ft(mx);
  }else{
    S.view.TB = null;
    $('tsec').style.display = 'none';
  }
}

function render(){
  if(S.ui._colorPickerOpen) return;
  clearTimeout(S.plot._rt);
  S.plot._rt = setTimeout(_render, 80);
}

function _rebuildStats(ct, act){
  const existing = ct.querySelector('details');
  if(existing) existing.remove();
  mkStats(ct, act);
  const cp = $('cpanel');
  const statsEl = ct.querySelector('details');
  if(cp && statsEl && cp.parentNode === ct) ct.insertBefore(cp, statsEl);
}

function _render(){
  if(!S.ui.READY) return;
  const renderStart = performance.now();

  const ct = $('ch');
  const act = getAct();
  const es = $('es');

  if(!S.data.AP.some(p => p.data.length)){
    ct.style.display = 'none';
    es.style.display = 'none';
    $('dz').style.display = 'flex';
    $('cpanel').className = '';
    /* No data → cached plots can't survive: clear so next render goes slow path. */
    S.plot._plotCache = [];
    S.plot._lastRenderSig = null;
    return;
  }

  $('dz').style.display = 'none';

  if(!act.length){
    ct.style.display = 'none';
    es.style.display = 'flex';
    $('cpanel').className = '';
    S.plot._plotCache = [];
    S.plot._lastRenderSig = null;
    return;
  }

  const sig = _computeRenderSig(act);
  const canFastPath = sig === S.plot._lastRenderSig
    && S.plot._plotCache.length > 0
    && S.plot._plotCache.every(c => c.pd && ct.contains(c.pd));

  if(canFastPath){
    /* Fast path: same structure → reuse divs, Plotly.react per chart. uirevision keeps zoom. */
    es.style.display = 'none';
    ct.style.display = 'block';
    S.plot._plotCache.forEach(c => _renderChart(c, false));
    _rebuildStats(ct, act);
    updSide();
    updateHeightLabel();
    recordPerf('render-fast', renderStart, {charts: S.plot._plotCache.length, params: act.length});
    return;
  }

  /* Slow path: purge + newPlot (structure changed or first render). */
  /* Save X zoom range from any active plot */
  if(S.plot._allPlots.length){
    for(const pd of S.plot._allPlots){
      try{
        const r = pd._fullLayout.xaxis.range;
        if(r && r[0] !== undefined) { S.plot._savedRange = [r[0], r[1]]; break; }
      }catch(e){}
    }
  } else if(S.plot._activePlot && S.plot._activePlot._fullLayout){
    try{ const r=S.plot._activePlot._fullLayout.xaxis.range; S.plot._savedRange=[r[0],r[1]]; }catch(e){}
  }

  /* Save Y ranges keyed by param tag so adding/removing a trend preserves the
     manual Y zoom (or the user's zoom-rect) on every axis that still exists. */
  if(!S.plot._savedYRanges) S.plot._savedYRanges = {};
  for(const c of S.plot._plotCache){
    try{
      const fl = c.pd && c.pd._fullLayout;
      if(!fl) continue;
      if(c.kind === 'overlay'){
        c.params.forEach((p, idx) => {
          const yaKey = idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1);
          const ax = fl[yaKey];
          if(ax && ax.range && !ax.autorange) S.plot._savedYRanges[p.tag] = [ax.range[0], ax.range[1]];
        });
      } else if(c.kind === 'single'){
        const ax = fl.yaxis;
        if(ax && ax.range && !ax.autorange) S.plot._savedYRanges[c.params[0].tag] = [ax.range[0], ax.range[1]];
      } else if(c.kind === 'xy'){
        const ax = fl.yaxis;
        if(ax && ax.range && !ax.autorange) S.plot._savedYRanges['__xy'] = [ax.range[0], ax.range[1]];
      }
    }catch(_e){}
  }
  const oldA = S.cursor._cursorA;
  const oldB = S.cursor._cursorB;

  es.style.display = 'none';
  ct.style.display = 'block';
  /* Force layout reflow so calcH reads correct ca.clientHeight */
  void ct.offsetHeight;

  const oldP = ct.querySelectorAll('.plotdiv');
  oldP.forEach(plot => {
    try{ if(plot._middleClickCleanup) plot._middleClickCleanup(); }catch(_e){}
    try{ Plotly.purge(plot); }catch(_e){}
  });
  /* Rescue cpanel before clearing — it may have been moved into ct */
  const cpanel = $('cpanel');
  if(cpanel && cpanel.parentNode === ct){
    $('ca').appendChild(cpanel);
  }
  ct.textContent = '';

  S.cursor._valsA = {};
  S.cursor._valsB = {};
  S.plot._allTraceData = [];
  S.plot._activePlot = null;
  S.plot._allPlots = [];
  S.plot._plotCache = [];
  S.plot._lastRenderSig = sig;
  if(cpanel) cpanel.className = '';

  if(S.ui.XY_MODE){
    mkChartXY(ct, act);
  } else if(S.ui.MODE === 'o'){
    mkChartOverlay(ct, act);
  } else {
    S.plot._syncingRange = true; /* prevent sync during initial creation */
    act.forEach(p => mkChartSingle(ct, p, act.length));
    setTimeout(() => { S.plot._syncingRange = false; }, 800);
  }

  mkStats(ct, act);
  /* Move cpanel into chart area, before stats */
  const cpAfter = $('cpanel');
  const statsEl = ct.querySelector('details');
  if(cpAfter && statsEl) ct.insertBefore(cpAfter, statsEl);
  else if(cpAfter) ct.appendChild(cpAfter);
  /* Restore X zoom + per-tag Y ranges after plots are built. */
  const yRanges = S.plot._savedYRanges || {};
  S.plot._savedYRanges = {};
  const hasYRanges = Object.keys(yRanges).length > 0;
  if(S.plot._savedRange || hasYRanges){
    const sr = S.plot._savedRange;
    S.plot._savedRange = null;
    setTimeout(() => {
      if(!S.plot._allPlots.length) return;
      S.plot._syncingRange = true;
      if(sr){
        S.plot._allPlots.forEach(pd => {
          try{ Plotly.relayout(pd, {'xaxis.range': [sr[0], sr[1]]}); }catch(e){}
        });
      }
      /* Apply per-tag Y ranges keyed to the new plot structure (tags may be reordered). */
      for(const c of S.plot._plotCache){
        const updates = {};
        if(c.kind === 'overlay'){
          c.params.forEach((p, idx) => {
            const yaKey = idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1);
            if(yRanges[p.tag]){
              updates[yaKey + '.range'] = yRanges[p.tag];
              updates[yaKey + '.autorange'] = false;
            }
          });
        } else if(c.kind === 'single'){
          const p = c.params[0];
          if(yRanges[p.tag]){
            updates['yaxis.range'] = yRanges[p.tag];
            updates['yaxis.autorange'] = false;
          }
        } else if(c.kind === 'xy'){
          if(yRanges['__xy']){
            updates['yaxis.range'] = yRanges['__xy'];
            updates['yaxis.autorange'] = false;
          }
        }
        if(Object.keys(updates).length){
          try{ Plotly.relayout(c.pd, updates); }catch(_e){}
        }
      }
      setTimeout(() => { S.plot._syncingRange = false; }, 600);
    }, 500);
  }

  S.cursor._cursorA = oldA;
  S.cursor._cursorB = oldB;

  /* Refresh sidebar so per-param dash/width buttons reflect current state */
  updSide();
  updateHeightLabel();
  recordPerf('render-slow', renderStart, {charts: S.plot._plotCache.length, params: act.length});
}

function xMsFromPixel(pd, clientX){
  const rect = pd.getBoundingClientRect();
  const xa = pd._fullLayout.xaxis;
  const plotX = clientX - rect.left - xa._offset;
  const ratio = plotX / xa._length;
  const r0 = axisToMs(xa.range[0]);
  const r1 = axisToMs(xa.range[1]);
  return r0 + ratio * (r1 - r0);
}

function xPixelFromMs(pd, ms){
  const xa = pd._fullLayout.xaxis;
  const r0 = axisToMs(xa.range[0]);
  const r1 = axisToMs(xa.range[1]);
  return xa._offset + ((ms - r0) / (r1 - r0)) * xa._length;
}

function showSnapDot(pd, pt){
  const dot = $('snapdot');
  const lbl = $('snaplabel');
  if(!dot || !pt) return;
  try {
    const s = 1;
    const rect = pd.getBoundingClientRect();
    const xa = pd._fullLayout.xaxis;
    const yaId = pt.data.yaxis || 'y';
    const yaKey = yaId === 'y' ? 'yaxis' : 'yaxis' + yaId.slice(1);
    const ya = pd._fullLayout[yaKey];
    if(!ya) return;
    const xPx = rect.left + (xa._offset + xa.l2p(xa.d2l(pt.x))) * s;
    const yPx = rect.top + (ya._offset + ya.l2p(ya.d2l(pt.y))) * s;
    const color = pt.data.line ? pt.data.line.color : '#fff';
    dot.style.left = xPx + 'px';
    dot.style.top = yPx + 'px';
    dot.style.background = color;
    dot.style.display = 'block';
    lbl.style.left = (xPx + 10) + 'px';
    lbl.style.top = (yPx - 14) + 'px';
    lbl.textContent = pt.data.name + ': ' + (typeof pt.y === 'number' ? pt.y.toFixed(3) : pt.y);
    lbl.style.display = 'block';
  } catch(e) {}
}

function hideSnapDot(){
  const dot = $('snapdot');
  const lbl = $('snaplabel');
  if(dot) dot.style.display = 'none';
  if(lbl) lbl.style.display = 'none';
}

/* Middle-mouse-button pan — dragmode toggle strategy.
   Instead of a custom range-math handler (which panned only the nearest Y-axis in
   overlay mode), we flip Plotly's own dragmode: pressing the wheel button swaps
   dragmode → 'pan' so the user's LMB-drag becomes a proper pan (all X AND every Y
   stay linked). Releasing the wheel button restores 'zoom'. This lets the user
   alternate between box-zoom and pan without visiting a menu. */
function attachMiddleClickPan(pd){
  let savedDragmode = null;
  let zoomClearTimer = null;

  const setMode = mode => {
    try{ Plotly.relayout(pd, {dragmode: mode}); }catch(_e){}
  };
  const clearZoomBox = () => {
    /* If Plotly rendered half a zoom-selection before we intercepted, purge it. */
    const zl = pd.querySelector('.zoomlayer');
    if(!zl) return;
    zl.querySelectorAll('rect').forEach(r => {
      r.setAttribute('width', 0);
      r.setAttribute('height', 0);
    });
  };

  const onDown = e => {
    if(e.button !== 1) return;
    if(!pd._fullLayout) return;
    /* Prevent the browser's auto-scroll cursor AND any upstream middle-click
       handlers (e.g. links would open in a new tab). */
    e.preventDefault();
    e.stopPropagation();
    if(savedDragmode === null){
      savedDragmode = pd._fullLayout.dragmode || 'zoom';
    }
    setMode('pan');
    document.body.style.cursor = 'grab';
    clearZoomBox();
    /* Tick cursor to grabbing on next LMB press so the user sees they're panning. */
    zoomClearTimer = setInterval(clearZoomBox, 40);
  };
  const onUp = e => {
    if(e.button !== 1) return;
    if(savedDragmode === null) return;
    setMode(savedDragmode);
    savedDragmode = null;
    document.body.style.cursor = '';
    if(zoomClearTimer){ clearInterval(zoomClearTimer); zoomClearTimer = null; }
  };
  /* Handle edge cases: mouse leaves window mid-pan, tab loses focus, etc. */
  const onWindowBlur = () => {
    if(savedDragmode === null) return;
    setMode(savedDragmode);
    savedDragmode = null;
    document.body.style.cursor = '';
    if(zoomClearTimer){ clearInterval(zoomClearTimer); zoomClearTimer = null; }
  };

  const onAux = e => { if(e.button === 1) e.preventDefault(); };
  pd.addEventListener('mousedown', onDown, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', onWindowBlur);
  /* Block the auto-scroll mark-and-paste behaviour the browser does on middle. */
  pd.addEventListener('auxclick', onAux);

  /* Expose cleanup so the render path can drop our window listeners when the div
     is purged — otherwise every re-render piles another pair of closures onto window. */
  pd._middleClickCleanup = () => {
    try{ pd.removeEventListener('mousedown', onDown, true); }catch(_e){}
    try{ window.removeEventListener('mouseup', onUp, true); }catch(_e){}
    try{ window.removeEventListener('blur', onWindowBlur); }catch(_e){}
    try{ pd.removeEventListener('auxclick', onAux); }catch(_e){}
    if(zoomClearTimer){ clearInterval(zoomClearTimer); zoomClearTimer = null; }
  };
}

function attachEvents(pd, traceData){
  S.plot._activePlot = pd;
  S.plot._allPlots.push(pd);
  /* Accumulate trace data across all charts (split mode) */
  traceData.forEach(td => {
    if(!S.plot._allTraceData.find(t => t.name === td.name)) S.plot._allTraceData.push(td);
  });

  /* Middle-click pan: drag with the mouse wheel button to pan the plot even while
     Plotly's dragmode is "zoom" (box-zoom). We run our own panning on X and Y so
     the user doesn't need to swap modes to jog around. */
  attachMiddleClickPan(pd);

  /* Snap dot: show colored circle on nearest trace point */
  pd.on('plotly_hover', ev => {
    if(!ev.points || !ev.points.length) return;
    showSnapDot(pd, ev.points[0]);
  });
  pd.on('plotly_unhover', () => { hideSnapDot(); });

  /* Click handler: annotations → T=0 → markers (priority order) */
  pd.on('plotly_click', ev => {
    if(!ev.points || !ev.points.length) return;
    S.plot._activePlot = pd;
    const xMs = axisToMs(ev.points[0].x);
    if(!Number.isFinite(xMs)) return;

    /* T=0 mode: set alignment point */
    if(S.t0.T0_MODE && S.t0._t0ms === null){
      setT0(xMs);
      return;
    }
    /* Marker add-mode: next click creates a typed marker at clicked timestamp.
       Auto-link to the nearest trace (Plotly already picked the closest point for us). */
    if(S.markers.MARKER_ADD_TYPE){
      const type = S.markers.MARKER_ADD_TYPE;
      togAddMarker(); /* exit add-mode first (clears UI) */
      let tag = null, linkedName = '';
      if(ev.points && ev.points[0] && ev.points[0].data && ev.points[0].data.name){
        const traceName = ev.points[0].data.name;
        /* Skip synthetic traces (markers/bollinger/OOB/origs) — only user params */
        if(traceName.indexOf('marker-dot') !== 0 && traceName.indexOf(' (') === -1){
          const linked = S.data.AP.find(pp => pn(pp) === traceName);
          if(linked){ tag = linked.tag; linkedName = ' → ' + (linked.shortName || linked.tag); }
        }
      }
      const promptLabel = MARKER_TYPES[type].label + linkedName + ' — текст (можно оставить пустым):';
      const text = prompt(promptLabel, '');
      if(text === null) return; /* user cancelled */
      addMarker(xMs, type, text, tag);
      return;
    }
    /* Cursor A/B measurement mode */
    if(!S.ui.MEASURE_ON || S.cursor._draggingCursor) return;
    if(S.cursor._justDragged){ S.cursor._justDragged = false; return; }
    if(S.cursor._cursorA === null){
      S.cursor._cursorA = xMs; S.cursor._valsA = valsAtX(xMs);
    } else if(S.cursor._cursorB === null){
      S.cursor._cursorB = xMs; S.cursor._valsB = valsAtX(xMs);
    } else {
      S.cursor._cursorB = xMs; S.cursor._valsB = valsAtX(xMs);
    }
    refreshCursors();
    updateCursorPanel();
  });

  /* Zoom history — capture user-initiated range changes (X or Y, works in all modes).
     A relayout event for any axis range / autorange triggers a full-state push so
     zoom-back restores both X AND Y zoom. Debounced so a single drag-resize of two
     axes doesn't write two entries. */
  pd.on('plotly_relayout', rd => {
    if(S.zoom._zoomRestoring || S.plot._syncingRange) return;
    const keys = Object.keys(rd);
    const touched = keys.some(k => /^(xaxis|yaxis\d*)\.(range(\[[01]\])?|autorange)$/.test(k));
    if(!touched) return;
    clearTimeout(pd._zoomPushTimer);
    pd._zoomPushTimer = setTimeout(pushZoomEntry, 90);
  });

  /* Sync X axis range across all plots in split mode */
  pd.on('plotly_relayout', rd => {
    if(S.plot._syncingRange || S.ui.MODE !== 's') return;
    let newRange = null;
    if(rd['xaxis.range[0]'] && rd['xaxis.range[1]']){
      newRange = [rd['xaxis.range[0]'], rd['xaxis.range[1]']];
    } else if(rd['xaxis.range']){
      newRange = rd['xaxis.range'];
    } else if(rd['xaxis.autorange']){
      newRange = null;
    } else { return; }
    S.plot._syncingRange = true;
    S.plot._allPlots.forEach(other => {
      if(other === pd) return;
      try{
        if(newRange) Plotly.relayout(other, {'xaxis.range': newRange});
        else Plotly.relayout(other, {'xaxis.autorange': true});
      }catch(_e){}
    });
    /* Keep guard for 500ms to absorb async echo events */
    setTimeout(() => { S.plot._syncingRange = false; }, 500);
  });

  /* Mirror plot X-range changes back to the sidebar «От/До» slider + time inputs
     so box-zoom, wheel-zoom, double-click reset, zoom history and marker jumps all
     keep the sidebar in sync with what the chart actually shows. */
  pd.on('plotly_relayout', rd => {
    const touchedX = Object.keys(rd).some(k => /^xaxis\.(range(\[[01]\])?|autorange)$/.test(k));
    if(!touchedX) return;
    syncTimeSliderFromPlot(pd);
  });

  /* Draggable markers: mousedown near a cursor line starts drag */
  const plotArea = pd.querySelector('.nsewdrag') || pd;
  const GRAB_PX = 20;

  function nearestCursor(clientX){
    const rect = pd.getBoundingClientRect();
    let which = null, best = GRAB_PX;
    if(S.cursor._cursorA !== null){
      try{
        const d = Math.abs(clientX - rect.left - xPixelFromMs(pd, S.cursor._cursorA));
        if(d < best){ best = d; which = 'A'; }
      }catch(_e){}
    }
    if(S.cursor._cursorB !== null){
      try{
        const d = Math.abs(clientX - rect.left - xPixelFromMs(pd, S.cursor._cursorB));
        if(d < best){ best = d; which = 'B'; }
      }catch(_e){}
    }
    return which;
  }

  /* Cursor style feedback on hover near marker. Listen on pd (not plotArea) so the
     hover hint still shows up even if Plotly intercepts hover on its own overlay. */
  pd.addEventListener('mousemove', e => {
    if(!S.ui.MEASURE_ON || S.cursor._draggingCursor || (S.cursor._cursorA === null && S.cursor._cursorB === null)) {
      if(pd.style.cursor === 'ew-resize') pd.style.cursor = '';
      return;
    }
    pd.style.cursor = nearestCursor(e.clientX) ? 'ew-resize' : '';
  });

  /* In MEASURE_ON, intercept ALL left-button mousedowns on the plot-area drag layer
     (.nsewdrag) in capture phase. This is the element Plotly attaches its zoom/pan
     drag listeners to, so stopping propagation here prevents zoom-box/pan from ever
     starting. Axis-tick drag lives on .xdrag/.ydrag/etc — separate elements — so
     Y-axis drag still works normally. Two sub-cases:
       1. Near an existing cursor → start drag-cursor
       2. Otherwise → remember the click point; the document mouseup handler places
          a new cursor at that X if no significant movement occurred.
     Runs on pd in capture phase; we re-check the target so we don't intercept
     legend/axis/modebar clicks. */
  pd.addEventListener('mousedown', e => {
    if(e.button !== 0) return;
    if(!S.ui.MEASURE_ON) return;
    /* Only act on the plot-area drag layer, not on axis-tick / legend / modebar. */
    const inArea = plotArea && (e.target === plotArea || plotArea.contains(e.target));
    if(!inArea) return;
    const which = (S.cursor._cursorA !== null || S.cursor._cursorB !== null) ? nearestCursor(e.clientX) : null;
    if(which){
      S.cursor._draggingCursor = which;
    } else {
      /* Arm a pending-click so mouseup can place a new cursor if the user didn't drag. */
      S.cursor._pendingClick = {x: e.clientX, y: e.clientY, pd};
    }
    S.plot._activePlot = pd;
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
  }, true);

  /* Restore cursors after re-render */
  setTimeout(() => {
    if(S.cursor._cursorA !== null) S.cursor._valsA = valsAtX(S.cursor._cursorA);
    if(S.cursor._cursorB !== null) S.cursor._valsB = valsAtX(S.cursor._cursorB);
    refreshCursors();
    updateCursorPanel();
  }, 0);
}

/* Global drag handlers */
document.addEventListener('mousemove', e => {
  if(!S.cursor._draggingCursor || !S.plot._activePlot) return;
  const xMs = xMsFromPixel(S.plot._activePlot, e.clientX);
  if(S.cursor._draggingCursor === 'A'){
    S.cursor._cursorA = xMs; S.cursor._valsA = valsAtX(xMs);
  } else {
    S.cursor._cursorB = xMs; S.cursor._valsB = valsAtX(xMs);
  }
  refreshCursors();
  updateCursorPanel();
});
document.addEventListener('mouseup', e => {
  if(S.cursor._draggingCursor){
    S.cursor._justDragged = true;
    S.cursor._draggingCursor = null;
    /* Clear flag after a tick so only the immediate click is ignored */
    setTimeout(() => { S.cursor._justDragged = false; }, 200);
    return;
  }
  /* Pending "click to place cursor" from the MEASURE_ON capture-phase mousedown.
     If the user didn't drag far, treat it as a click and place A/B at that X. */
  const pc = S.cursor._pendingClick;
  if(pc && S.ui.MEASURE_ON){
    S.cursor._pendingClick = null;
    const dx = Math.abs(e.clientX - pc.x);
    const dy = Math.abs(e.clientY - pc.y);
    if(dx > 4 || dy > 4) return; /* it was a drag attempt — ignore */
    let xMs = NaN;
    try{ xMs = xMsFromPixel(pc.pd, e.clientX); }catch(_e){}
    if(!Number.isFinite(xMs)) return;
    /* T=0 anchor-setting click still wins over measurement placement. */
    if(S.t0.T0_MODE && S.t0._t0ms === null){ setT0(xMs); return; }
    if(S.markers.MARKER_ADD_TYPE){ return; /* marker add uses plotly_click on trace */ }
    if(S.cursor._cursorA === null){
      S.cursor._cursorA = xMs; S.cursor._valsA = valsAtX(xMs);
    } else if(S.cursor._cursorB === null){
      S.cursor._cursorB = xMs; S.cursor._valsB = valsAtX(xMs);
    } else {
      S.cursor._cursorB = xMs; S.cursor._valsB = valsAtX(xMs);
    }
    refreshCursors();
    updateCursorPanel();
  } else {
    S.cursor._pendingClick = null;
  }
});

/* ===== MARKER SUBSYSTEM =====
   Typed markers (events, warnings, alarms, notes) replace the old free-text annotations.
   Storage: MARKERS[] → localStorage('loggraph_markers'). Auto-migrates legacy
   'loggraph_annotations' entries as type='info' on first load. */

function newMarkerId(){ return ++S.markers._mid; }

function saveMarkersLocal(){
  try{ localStorage.setItem('loggraph_markers', JSON.stringify(S.markers.MARKERS)); }catch(_e){}
}
function loadMarkersLocal(){
  try{
    const s = localStorage.getItem('loggraph_markers');
    if(s){
      const arr = JSON.parse(s);
      if(Array.isArray(arr)){
        S.markers.MARKERS = arr.map(m => {
          const id = (m.id && typeof m.id === 'number') ? m.id : newMarkerId();
          if(id > S.markers._mid) S.markers._mid = id;
          return {
            id,
            type: MARKER_TYPES[m.type] ? m.type : 'info',
            ts: +m.ts,
            text: String(m.text || ''),
            tag: m.tag || null,
            createdAt: m.createdAt || Date.now()
          };
        }).filter(m => isFinite(m.ts));
      }
    }
  }catch(_e){ S.markers.MARKERS = []; }
  /* One-shot migration from old free-text annotations */
  try{
    const old = localStorage.getItem('loggraph_annotations');
    if(old){
      const arr = JSON.parse(old);
      if(Array.isArray(arr) && arr.length){
        arr.forEach(a => {
          if(!a || !isFinite(+a.x)) return;
          S.markers.MARKERS.push({id: newMarkerId(), type: 'info', ts: +a.x,
                        text: String(a.text || ''), tag: null, createdAt: Date.now()});
        });
        saveMarkersLocal();
      }
      localStorage.removeItem('loggraph_annotations');
    }
  }catch(_e){}
}

function getVisibleMarkers(){
  const q = (S.markers.MARKER_SEARCH || '').toLowerCase();
  return S.markers.MARKERS.filter(m => {
    if(!S.markers.MARKER_FILTER[m.type]) return false;
    if(q && (m.text || '').toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

function addMarker(ts, type, text, tag){
  const t = MARKER_TYPES[type] ? type : 'info';
  S.markers.MARKERS.push({id: newMarkerId(), type: t, ts: +ts,
                text: String(text || ''), tag: tag || null, createdAt: Date.now()});
  S.markers.MARKERS.sort((a, b) => a.ts - b.ts);
  saveMarkersLocal();
  render();
  renderMarkersList();
}
function delMarker(id){
  const i = S.markers.MARKERS.findIndex(m => m.id === id);
  if(i < 0) return;
  S.markers.MARKERS.splice(i, 1);
  saveMarkersLocal();
  render();
  renderMarkersList();
}
function editMarkerText(id){
  const m = S.markers.MARKERS.find(x => x.id === id);
  if(!m) return;
  const t = prompt('Текст маркера:', m.text);
  if(t === null) return;
  m.text = t;
  saveMarkersLocal();
  render();
  renderMarkersList();
}
function jumpToMarker(id){
  const m = S.markers.MARKERS.find(x => x.id === id);
  if(!m || !S.plot._allPlots.length) return;
  const pd = S.plot._activePlot || S.plot._allPlots[0];
  try{
    const r = pd._fullLayout.xaxis.range;
    const lo = axisToMs(r[0]);
    const hi = axisToMs(r[1]);
    const span = hi - lo;
    const newLo = m.ts - span / 2;
    const newHi = m.ts + span / 2;
    S.plot._allPlots.forEach(other => {
      try{ Plotly.relayout(other, {'xaxis.range': [msToAxis(newLo), msToAxis(newHi)]}); }catch(_e){}
    });
  }catch(_e){}
}

/* Filters: click type chip to toggle visibility */
function togMarkerFilter(type){
  S.markers.MARKER_FILTER[type] = !S.markers.MARKER_FILTER[type];
  renderMarkerFilters();
  renderMarkersList();
  render();
}
function setMarkerSearch(v){
  S.markers.MARKER_SEARCH = (v || '').trim();
  renderMarkersList();
  render();
}

/* Add-mode: set type, next plot click creates marker at clicked timestamp */
function togAddMarker(){
  const sel = $('maddtype');
  if(S.markers.MARKER_ADD_TYPE){
    S.markers.MARKER_ADD_TYPE = null;
    document.body.classList.remove('addcursor');
    $('addhint').classList.remove('vis');
    $('maddbtn').className = 'b';
    $('maddbtn').textContent = '+ Поставить';
    return;
  }
  const type = sel ? sel.value : 'event';
  S.markers.MARKER_ADD_TYPE = MARKER_TYPES[type] ? type : 'event';
  document.body.classList.add('addcursor');
  const cfg = MARKER_TYPES[S.markers.MARKER_ADD_TYPE];
  $('addhint').innerHTML = cfg.icon + ' Клик по графику — поставить маркер «' + cfg.label + '» · Esc = отменить';
  $('addhint').classList.add('vis');
  $('maddbtn').className = 'b on';
  $('maddbtn').textContent = '✕ Отменить';
}

/* Export / Import */
function exportMarkersJSON(){
  if(!S.markers.MARKERS.length){ showErr('Нет маркеров для экспорта'); return; }
  const blob = new Blob([JSON.stringify(S.markers.MARKERS, null, 2)], {type: 'application/json'});
  downloadBlob(blob, 'markers_' + fileTS() + '.json');
}
function exportMarkersCSV(){
  if(!S.markers.MARKERS.length){ showErr('Нет маркеров для экспорта'); return; }
  const rows = [['Время', 'Тип', 'Текст']];
  S.markers.MARKERS.forEach(m => {
    const t = (MARKER_TYPES[m.type] || {}).label || m.type;
    const text = (m.text || '').replace(/[\r\n]+/g, ' ');
    rows.push([fmtTsExcel(m.ts), t, text]);
  });
  downloadCsv(rowsToCsv(rows), 'markers_' + fileTS() + '.csv', 'utf-8-bom');
}
function importMarkersClick(){ $('mimport').click(); }

/* Bulk delete with confirmation */
function clearAllMarkers(){
  if(!S.markers.MARKERS.length){ showErr('Нет маркеров для удаления'); return; }
  if(!confirm('Удалить ВСЕ маркеры (' + S.markers.MARKERS.length + ')?\nДействие необратимо.')) return;
  S.markers.MARKERS = [];
  saveMarkersLocal();
  render();
  renderMarkersList();
}

/* Auto-generate warn/alarm markers from Lo/Hi level violations on selected params.
   One marker per contiguous violation cluster, placed at the peak-deviation timestamp. */
/* Keyboard nav: jump to prev/next visible marker relative to current xaxis center */
function jumpMarkerByDir(direction){
  if(!S.plot._allPlots.length) return;
  const pd = S.plot._activePlot || S.plot._allPlots[0];
  let centerMs = null;
  try{
    const r = pd._fullLayout.xaxis.range;
    centerMs = (axisToMs(r[0]) + axisToMs(r[1])) / 2;
  }catch(_e){ return; }
  const vis = getVisibleMarkers();
  if(!vis.length) return;
  let target = null;
  if(direction === 'next'){
    /* smallest ts strictly greater than center */
    for(const m of vis){ if(m.ts > centerMs && (!target || m.ts < target.ts)) target = m; }
  } else {
    /* largest ts strictly less than center */
    for(const m of vis){ if(m.ts < centerMs && (!target || m.ts > target.ts)) target = m; }
  }
  if(target) jumpToMarker(target.id);
}

/* UI renderers — called from updSide after data changes */
function renderMarkerFilters(){
  const host = $('mfilters');
  if(!host) return;
  host.textContent = '';
  /* count per type */
  const counts = {};
  Object.keys(MARKER_TYPES).forEach(t => counts[t] = 0);
  S.markers.MARKERS.forEach(m => { if(counts[m.type] !== undefined) counts[m.type]++; });
  Object.keys(MARKER_TYPES).forEach(type => {
    const cfg = MARKER_TYPES[type];
    const chip = document.createElement('span');
    chip.className = 'mchip' + (S.markers.MARKER_FILTER[type] ? ' on' : '');
    chip.style.borderColor = cfg.color;
    chip.style.color = cfg.color;
    chip.title = cfg.label + ' (клик — скрыть/показать)';
    const ic = document.createElement('span'); ic.className = 'mchip-icon'; ic.textContent = cfg.icon;
    const lbl = document.createElement('span'); lbl.textContent = cfg.label;
    const cnt = document.createElement('span'); cnt.className = 'mchip-count'; cnt.textContent = counts[type];
    chip.appendChild(ic); chip.appendChild(lbl); chip.appendChild(cnt);
    chip.addEventListener('click', () => togMarkerFilter(type));
    host.appendChild(chip);
  });
}
function renderMarkerAddSelect(){
  const sel = $('maddtype');
  if(!sel) return;
  if(sel.options.length) return; /* already built */
  Object.keys(MARKER_TYPES).forEach(type => {
    const cfg = MARKER_TYPES[type];
    const o = document.createElement('option');
    o.value = type;
    o.textContent = cfg.icon + ' ' + cfg.label;
    sel.appendChild(o);
  });
}
function renderMarkersList(){
  renderMarkerFilters();
  const list = $('mlist');
  const cnt = $('mcount');
  if(cnt) cnt.textContent = S.markers.MARKERS.length;
  if(!list) return;
  list.textContent = '';
  const vis = getVisibleMarkers();
  if(!vis.length){
    const em = document.createElement('div');
    em.className = 'mempty';
    em.textContent = S.markers.MARKERS.length ? 'Нет маркеров по текущим фильтрам' : 'Маркеров пока нет';
    list.appendChild(em);
    return;
  }
  vis.forEach(m => {
    const cfg = MARKER_TYPES[m.type] || MARKER_TYPES.info;
    const row = document.createElement('div');
    row.className = 'mitem';
    row.title = 'Клик — перейти · двойной клик — изменить текст';

    const ic = document.createElement('div');
    ic.className = 'mitem-icon';
    ic.textContent = cfg.icon;
    ic.style.color = cfg.color;

    const body = document.createElement('div');
    body.className = 'mitem-body';
    const time = document.createElement('div');
    time.className = 'mitem-time';
    let timeText = fmtTsExcel(m.ts);
    if(m.tag){
      const linked = S.data.AP.find(ap => ap.tag === m.tag);
      if(linked){
        const nm = linked.cn || linked.shortName || linked.tag;
        timeText += ' · ⟶ ' + (nm.length > 14 ? nm.slice(0, 14) + '…' : nm);
      }
    }
    time.textContent = timeText;
    const txt = document.createElement('div');
    txt.className = 'mitem-text' + (m.text ? '' : ' empty');
    txt.textContent = m.text || '(без текста)';
    body.appendChild(time);
    body.appendChild(txt);

    const del = document.createElement('div');
    del.className = 'mitem-del';
    del.textContent = '✕';
    del.title = 'Удалить';
    del.addEventListener('click', ev => { ev.stopPropagation(); delMarker(m.id); });

    row.addEventListener('click', () => jumpToMarker(m.id));
    row.addEventListener('dblclick', () => editMarkerText(m.id));

    row.appendChild(ic);
    row.appendChild(body);
    row.appendChild(del);
    list.appendChild(row);
  });
}

/* Append dot-traces for tagged markers — a colored circle on the linked param's line
   at the marker's timestamp. Skipped if marker is outside the param's data range. */
function appendMarkerDotTraces(traces, params){
  if(!params || !params.length) return;
  const tagged = getVisibleMarkers().filter(m => m.tag);
  if(!tagged.length) return;
  tagged.forEach(m => {
    const pIdx = params.findIndex(pp => pp.tag === m.tag);
    if(pIdx < 0) return;
    const p = params[pIdx];
    const data = p.data;
    if(!data || !data.length) return;
    if(m.ts < data[0].ts || m.ts > data[data.length - 1].ts) return;
    const xArr = data.map(d => d.ts);
    const yArr = data.map(d => d.val);
    const y = isStepSignal(p) ? interpStep(xArr, yArr, m.ts) : interpY(xArr, yArr, m.ts);
    if(y === null || !isFinite(y)) return;
    const cfg = MARKER_TYPES[m.type] || MARKER_TYPES.info;
    const xDisp = S.t0._t0ms !== null ? (m.ts - S.t0._t0ms) / 1000 : new Date(m.ts);
    const yaxisName = pIdx === 0 ? 'y' : 'y' + (pIdx + 1);
    traces.push({
      x: [xDisp],
      y: [y],
      type: 'scatter',
      mode: 'markers',
      yaxis: yaxisName,
      marker: {size: 12, color: cfg.color, symbol: 'circle', line: {color: '#ffffff', width: 2}},
      showlegend: false,
      hoverinfo: 'text',
      hovertext: cfg.icon + (m.text ? ' ' + escapeHtml(m.text) : ''),
      name: 'marker-dot-' + m.id
    });
  });
}

/* Shapes for Plotly — vertical lines + text labels for visible markers */
function buildMarkerShapes(){
  return getVisibleMarkers().map(m => {
    const cfg = MARKER_TYPES[m.type] || MARKER_TYPES.info;
    const xVal = S.t0._t0ms !== null ? (m.ts - S.t0._t0ms) / 1000 : localISO(m.ts);
    return {
      type:'line', xref:'x', yref:'paper', x0:xVal, x1:xVal, y0:0, y1:1,
      line:{color: cfg.color, width: 1.5, dash: cfg.dash || 'solid'}
    };
  });
}
function buildMarkerAnnotations(){
  return getVisibleMarkers().map(m => {
    const cfg = MARKER_TYPES[m.type] || MARKER_TYPES.info;
    const xVal = S.t0._t0ms !== null ? (m.ts - S.t0._t0ms) / 1000 : localISO(m.ts);
    const label = cfg.icon + (m.text ? ' ' + escapeHtml(m.text) : '');
    return {
      x: xVal, xref:'x', y: 0.98, yref:'paper',
      text: label, showarrow: false,
      font: {size: _fs(11), color: '#fff'},
      bgcolor: cfg.color, borderpad: 3, borderwidth: 0,
      xanchor: 'left', yanchor: 'top', textangle: -45,
      captureevents: false
    };
  });
}

/* Wire session-file import (hidden file input added to the header dropdown) */
if($('sessionImport')){
  $('sessionImport').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    _handleSessionFileImport(f);
  });
}

/* Wire import file input (created at top of body) */
if($('mimport')){
  $('mimport').addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    if(file.size > 10 * 1024 * 1024){
      showErr('Файл маркеров слишком большой');
      e.target.value = '';
      return;
    }
    file.text().then(text => {
      try{
        const arr = JSON.parse(text);
        if(!Array.isArray(arr)){ showErr('JSON должен быть массивом маркеров'); return; }
        S.markers.MARKERS = S.markers.MARKERS.concat(sanitizeMarkersArray(arr).map(m => Object.assign({}, m, {id: newMarkerId()})));
        S.markers.MARKERS.sort((a, b) => a.ts - b.ts);
        saveMarkersLocal();
        render();
        renderMarkersList();
      }catch(ex){ showErr('Ошибка чтения JSON: ' + ex.message); }
    });
    e.target.value = '';
  });
}

/* ===== ZOOM HISTORY =====
   Captures user-initiated xaxis.range changes (wheel zoom, box zoom, slider drag,
   autorange reset) so user can undo/redo navigation. Skipped during internal restores
   and split-mode sync. */
function _normZoomRange(r){
  if(!r || r.length < 2) return null;
  const toMs = v => {
    if(v instanceof Date) return v.getTime();
    if(typeof v === 'number') return S.t0._t0ms !== null ? (S.t0._t0ms + v * 1000) : v;
    const d = new Date(v);
    return isFinite(d.getTime()) ? d.getTime() : null;
  };
  const r0 = toMs(r[0]);
  const r1 = toMs(r[1]);
  if(r0 === null || r1 === null) return null;
  return {r0, r1};
}
/* Capture a full zoom-state snapshot from the live plots:
     {r0, r1}       — X range in absolute ms (normalised through _normZoomRange)
     {y: {tag: [lo, hi]}} — per-param Y ranges with autorange=false
   Returns null when no plot has a readable X range yet. */
function captureZoomState(){
  if(!S.plot._plotCache.length) return null;
  const e = {r0: null, r1: null, y: {}};
  let foundX = false;
  for(const c of S.plot._plotCache){
    const fl = c.pd && c.pd._fullLayout;
    if(!fl) continue;
    if(!foundX && fl.xaxis && fl.xaxis.range){
      const n = _normZoomRange(fl.xaxis.range);
      if(n){ e.r0 = n.r0; e.r1 = n.r1; foundX = true; }
    }
    if(c.kind === 'overlay'){
      c.params.forEach((p, idx) => {
        const yaKey = idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1);
        const ax = fl[yaKey];
        if(ax && ax.range && !ax.autorange) e.y[p.tag] = [ax.range[0], ax.range[1]];
      });
    } else if(c.kind === 'single'){
      const ax = fl.yaxis;
      if(ax && ax.range && !ax.autorange) e.y[c.params[0].tag] = [ax.range[0], ax.range[1]];
    } else if(c.kind === 'xy'){
      const ax = fl.yaxis;
      if(ax && ax.range && !ax.autorange) e.y['__xy'] = [ax.range[0], ax.range[1]];
    }
  }
  return foundX ? e : null;
}
function _zoomEntriesEqual(a, b){
  if(!a || !b) return false;
  if(Math.abs(a.r0 - b.r0) > 500 || Math.abs(a.r1 - b.r1) > 500) return false;
  const ak = Object.keys(a.y || {});
  const bk = Object.keys(b.y || {});
  if(ak.length !== bk.length) return false;
  for(const k of ak){
    const av = a.y[k], bv = b.y && b.y[k];
    if(!bv) return false;
    if(Math.abs(av[0] - bv[0]) > 1e-9 || Math.abs(av[1] - bv[1]) > 1e-9) return false;
  }
  return true;
}
function pushZoomEntry(){
  if(S.zoom._zoomRestoring || S.plot._syncingRange) return;
  const e = captureZoomState();
  if(!e) return;
  /* Dedup against current entry */
  if(S.zoom.ZOOM_POINTER >= 0){
    const cur = S.zoom.ZOOM_HISTORY[S.zoom.ZOOM_POINTER];
    if(_zoomEntriesEqual(cur, e)) return;
  }
  /* Drop forward history — user branched from here */
  if(S.zoom.ZOOM_POINTER < S.zoom.ZOOM_HISTORY.length - 1){
    S.zoom.ZOOM_HISTORY = S.zoom.ZOOM_HISTORY.slice(0, S.zoom.ZOOM_POINTER + 1);
  }
  S.zoom.ZOOM_HISTORY.push(e);
  if(S.zoom.ZOOM_HISTORY.length > ZOOM_MAX) S.zoom.ZOOM_HISTORY.shift();
  S.zoom.ZOOM_POINTER = S.zoom.ZOOM_HISTORY.length - 1;
  updateZoomButtons();
}
/* Apply a zoom-state snapshot: restore X range on every plot, then per-tag Y ranges
   on matching axes. Tags not in the snapshot fall back to Y-autorange so returning
   to an older state doesn't carry stale manual zooms from a later entry. */
function applyZoomRange(e){
  if(!S.plot._allPlots.length || !e) return;
  S.zoom._zoomRestoring = true;
  S.plot._allPlots.forEach(pd => {
    try{
      Plotly.relayout(pd, {'xaxis.range': [msToAxis(e.r0), msToAxis(e.r1)]});
    }catch(_e){}
  });
  for(const c of S.plot._plotCache){
    const updates = {};
    const applyFor = (yaKey, tag) => {
      if(e.y && e.y[tag]){
        updates[yaKey + '.range'] = e.y[tag];
        updates[yaKey + '.autorange'] = false;
      } else {
        updates[yaKey + '.autorange'] = true;
      }
    };
    if(c.kind === 'overlay'){
      c.params.forEach((p, idx) => applyFor(idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1), p.tag));
    } else if(c.kind === 'single'){
      applyFor('yaxis', c.params[0].tag);
    } else if(c.kind === 'xy'){
      applyFor('yaxis', '__xy');
    }
    if(Object.keys(updates).length){
      try{ Plotly.relayout(c.pd, updates); }catch(_e){}
    }
  }
  setTimeout(() => { S.zoom._zoomRestoring = false; }, 400);
}
/* Reset every X/Y axis to autorange — used as the implicit "home" state when the
   user presses zoom-back from the first recorded entry. */
function applyZoomHome(){
  if(!S.plot._allPlots.length) return;
  S.zoom._zoomRestoring = true;
  for(const c of S.plot._plotCache){
    const updates = {'xaxis.autorange': true};
    if(c.kind === 'overlay'){
      c.params.forEach((p, idx) => {
        const yaKey = idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1);
        updates[yaKey + '.autorange'] = true;
      });
    } else {
      updates['yaxis.autorange'] = true;
    }
    try{ Plotly.relayout(c.pd, updates); }catch(_e){}
  }
  setTimeout(() => { S.zoom._zoomRestoring = false; }, 400);
}
function zoomBack(){
  /* Going back from entry 0 lands on the implicit home (autorange everywhere).
     POINTER is allowed to dip to -1 to represent this state. */
  if(S.zoom.ZOOM_POINTER < 0) return;
  S.zoom.ZOOM_POINTER--;
  if(S.zoom.ZOOM_POINTER < 0){
    applyZoomHome();
  } else {
    applyZoomRange(S.zoom.ZOOM_HISTORY[S.zoom.ZOOM_POINTER]);
  }
  updateZoomButtons();
}
function zoomForward(){
  if(S.zoom.ZOOM_POINTER >= S.zoom.ZOOM_HISTORY.length - 1) return;
  S.zoom.ZOOM_POINTER++;
  applyZoomRange(S.zoom.ZOOM_HISTORY[S.zoom.ZOOM_POINTER]);
  updateZoomButtons();
}
function resetZoomHistory(){
  S.zoom.ZOOM_HISTORY = [];
  S.zoom.ZOOM_POINTER = -1;
  updateZoomButtons();
}
function updateZoomButtons(){
  const back = $('bzback');
  const fwd = $('bzfwd');
  /* Back enabled whenever there is ANY recorded entry — POINTER=0 means user can
     still go "home" (autorange) via one more back press. */
  if(back) back.disabled = S.zoom.ZOOM_POINTER < 0;
  if(fwd) fwd.disabled = S.zoom.ZOOM_POINTER >= S.zoom.ZOOM_HISTORY.length - 1;
}

/* ===== UNIT CONVERSION ===== */
function applyUnitConversion(p, target, fn){
  if(!p || !p.data || !p.data.length) return;
  const from = p.unit || '';
  const revertingToRaw = p.rawUnit && target === p.rawUnit;
  const msg = revertingToRaw
    ? 'Вернуть «' + (p.cn || p.shortName || p.tag) + '» к исходной единице ' + target + '?\n\nБудут восстановлены сохранённые raw-значения без повторного пересчёта.'
    : 'Конвертировать «' + (p.cn || p.shortName || p.tag) + '»\nиз ' + from + ' в ' + target + '?\n\nИсходные raw-значения будут сохранены для точного возврата.';
  if(!confirm(msg)) return;
  if(!p.rawUnit){
    p.rawUnit = from;
    for(const d of p.data){
      if(d.rawVal === undefined) d.rawVal = d.val;
    }
    if(S.style.PL[p.tag]){
      p.rawLevels = {
        lo: S.style.PL[p.tag].lo,
        hi: S.style.PL[p.tag].hi
      };
    }
  }
  for(let i = 0; i < p.data.length; i++){
    if(revertingToRaw && p.data[i].rawVal !== undefined) p.data[i].val = p.data[i].rawVal;
    else p.data[i].val = fn(p.data[i].val);
  }
  if(S.style.PL[p.tag]){
    if(revertingToRaw && p.rawLevels){
      S.style.PL[p.tag].lo = p.rawLevels.lo;
      S.style.PL[p.tag].hi = p.rawLevels.hi;
    } else {
      if(S.style.PL[p.tag].lo !== null) S.style.PL[p.tag].lo = fn(S.style.PL[p.tag].lo);
      if(S.style.PL[p.tag].hi !== null) S.style.PL[p.tag].hi = fn(S.style.PL[p.tag].hi);
    }
  }
  p.unit = target;
  if(revertingToRaw){
    for(const d of p.data) delete d.rawVal;
    delete p.rawUnit;
    delete p.rawLevels;
  }
  clearTraceCache();
  updSide();
  render();
}
function showConvertMenu(x, y, p){
  const opts = UNIT_CONVERSIONS[p.unit];
  if(!opts || !opts.length) return;
  const m = $('umenu');
  m.textContent = '';
  opts.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'umenu-item';
    item.textContent = (p.unit || '?') + ' → ' + opt.to;
    item.addEventListener('click', () => {
      m.classList.remove('vis');
      applyUnitConversion(p, opt.to, opt.fn);
    });
    m.appendChild(item);
  });
  /* Clamp position to viewport */
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = 180, h = opts.length * 26 + 8;
  const px = Math.min(x, vw - w - 8);
  const py = Math.min(y, vh - h - 8);
  m.style.left = px + 'px';
  m.style.top = py + 'px';
  m.classList.add('vis');
}
document.addEventListener('click', e => {
  const m = $('umenu');
  if(!m) return;
  if(!m.classList.contains('vis')) return;
  if(e.target.closest('.umenu') || e.target.classList.contains('ucbtn')) return;
  m.classList.remove('vis');
});

/* ===== TAG SEARCH ===== */
function setTagSearch(v){
  S.ui.TAG_SEARCH = (v || '').trim().toLowerCase();
  updSide();
}

/* ===== VIEW PRESETS ===== */
function snapshotState(){
  return {
    sel: Array.from(S.data.SEL),
    mode: S.ui.MODE, xy: S.ui.XY_MODE, xyParam: S.ui.XY_XPARAM,
    smooth: S.view.SMOOTH_TYPE, smoothStr: S.view.SMOOTH_STR, smoothOrig: S.view.SMOOTH_ORIG,
    ds: S.view.DS_ALG, cgaps: S.view.CGAPS, rslider: S.ui.RSLIDER,
    qualityGoodOnly: S.data.QUALITY_GOOD_ONLY,
    anomaly: S.anomaly.ANOMALY_ON, t0: S.t0._t0ms,
    height: S.view.CH, axisSpacing: S.view.AXIS_SPACING_PX, fontScale: S.view.FONT_SCALE,
    yr: S.view.YR.slice(), tr: S.view.TR ? S.view.TR.slice() : null,
    colors: Object.assign({}, S.style.PC), widths: Object.assign({}, S.style.PW), dashes: Object.assign({}, S.style.PD)
  };
}
function applyState(s){
  if(!s) return;
  S.data.SEL = new Set(s.sel || []);
  S.ui.MODE = s.mode || 'o';
  S.ui.XY_MODE = !!s.xy;
  S.ui.XY_XPARAM = s.xyParam || null;
  S.view.SMOOTH_TYPE = s.smooth || 'none';
  S.view.SMOOTH_STR = s.smoothStr || 30;
  S.view.SMOOTH_ORIG = !!s.smoothOrig;
  S.view.DS_ALG = s.ds || 'lttb';
  S.view.CGAPS = s.cgaps !== false;
  S.ui.RSLIDER = s.rslider !== false;
  S.data.QUALITY_GOOD_ONLY = !!s.qualityGoodOnly;
  if($('bqgood')) $('bqgood').className = 'b' + (S.data.QUALITY_GOOD_ONLY ? ' on' : '');
  S.anomaly.ANOMALY_ON = !!s.anomaly;
  S.t0._t0ms = s.t0 != null ? s.t0 : null;
  S.view.CH = s.height || 0;
  S.view.AXIS_SPACING_PX = s.axisSpacing || 55;
  S.view.FONT_SCALE = s.fontScale || 1;
  S.view.YR = s.yr || [null, null];
  S.view.TR = s.tr || null;
  if(s.colors) Object.assign(S.style.PC, s.colors);
  if(s.widths) Object.assign(S.style.PW, s.widths);
  if(s.dashes) Object.assign(S.style.PD, s.dashes);
  /* Reflect into UI buttons */
  $('bovr').className = 'b' + (S.ui.MODE === 'o' ? ' on' : '');
  $('bspl').className = 'b' + (S.ui.MODE === 's' ? ' on' : '');
  $('bcg').className = 'b' + (S.view.CGAPS ? ' on' : '');
  $('brs').className = 'b' + (S.ui.RSLIDER ? ' on' : '');
  setSmooth(S.view.SMOOTH_TYPE);
  $('smsl').value = S.view.SMOOTH_STR;
  $('smlbl').textContent = 'Сила: ' + S.view.SMOOTH_STR;
  setDS(S.view.DS_ALG);
  $('hsl').value = S.view.CH;
  $('hlbl').textContent = S.view.CH === 0 ? 'Высота: авто' : ('Высота: ' + S.view.CH + 'px');
  $('axsl').value = S.view.AXIS_SPACING_PX;
  $('axslbl').textContent = 'Расст. осей Y: ' + S.view.AXIS_SPACING_PX + 'px';
  const fsPct = Math.round((S.view.FONT_SCALE || 1) * 100);
  $('fssl').value = fsPct;
  $('fsslbl').textContent = 'Шрифт графика: ' + fsPct + '%';
  if(S.anomaly.ANOMALY_ON) $('banom').className = 'b on';
  $('anomsec').style.display = S.anomaly.ANOMALY_ON ? 'block' : 'none';
  $('t0sec').style.display = S.t0._t0ms !== null ? 'block' : 'none';
  if(S.t0._t0ms !== null) $('t0info').textContent = 'T=0: ' + ff(S.t0._t0ms);
  updSide();
  render();
}
function savePresetsLocal(){
  try{ localStorage.setItem('loggraph_presets', JSON.stringify(S.presets.PRESETS)); }catch(_e){}
}
function loadPresetsLocal(){
  try{
    const s = localStorage.getItem('loggraph_presets');
    if(s) S.presets.PRESETS = JSON.parse(s) || {};
  }catch(_e){ S.presets.PRESETS = {}; }
}
function savePreset(){
  if(!S.data.AP.length){ showErr('Сначала загрузите данные'); return; }
  const name = prompt('Название пресета:', 'Вид ' + (Object.keys(S.presets.PRESETS).length + 1));
  if(!name) return;
  S.presets.PRESETS[name] = snapshotState();
  savePresetsLocal();
  renderPresetsList();
}
function loadPreset(name){
  const s = S.presets.PRESETS[name];
  if(!s) return;
  applyState(s);
}
function deletePreset(name){
  delete S.presets.PRESETS[name];
  savePresetsLocal();
  renderPresetsList();
}
function renderPresetsList(){
  const host = $('presets-list');
  if(!host) return;
  host.textContent = '';
  const names = Object.keys(S.presets.PRESETS);
  if(!names.length){
    const em = document.createElement('div');
    em.style.cssText = 'font-size:11px;opacity:0.5;font-style:italic;padding:3px 2px';
    em.textContent = 'Нет сохранённых видов';
    host.appendChild(em);
    return;
  }
  names.forEach(name => {
    const row = document.createElement('div');
    row.className = 'preset-row';
    const nm = document.createElement('div');
    nm.className = 'preset-name';
    nm.textContent = name;
    nm.title = 'Клик — применить';
    nm.addEventListener('click', () => loadPreset(name));
    const del = document.createElement('div');
    del.className = 'preset-del';
    del.textContent = '✕';
    del.title = 'Удалить';
    del.addEventListener('click', ev => { ev.stopPropagation(); deletePreset(name); });
    row.appendChild(nm);
    row.appendChild(del);
    host.appendChild(row);
  });
}

/* ===== Session save/load =====
   Sessions live in IndexedDB (key path 'name' on an object store called 'sessions'
   inside the 'pagraph' database). IDB is used instead of localStorage because
   browser quotas on IDB are typically 50%+ of free disk, while localStorage caps
   at ~5 MB which is easily exceeded by real-world logs (≥100k points × multiple
   parameters). Sessions stored under the old localStorage key `pagraph_sessions`
   are auto-migrated on first save/load (see migrateSessionsFromLocalStorage). */
const SESSION_KEY = 'pagraph_sessions'; /* legacy localStorage key — read-only, migration source */
const SESSION_DB = 'pagraph';
const SESSION_STORE = 'sessions';
let _sessionDbPromise = null;
function openSessionDb(){
  if(_sessionDbPromise) return _sessionDbPromise;
  _sessionDbPromise = new Promise((resolve, reject) => {
    if(!window.indexedDB){ reject(new Error('IndexedDB недоступен в этом браузере')); return; }
    const req = indexedDB.open(SESSION_DB, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(SESSION_STORE)){
        db.createObjectStore(SESSION_STORE, {keyPath: 'name'});
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => { _sessionDbPromise = null; reject(e.target.error); };
    req.onblocked = () => reject(new Error('IDB заблокирован другой вкладкой'));
  });
  return _sessionDbPromise;
}
async function idbSaveSession(name, payload){
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, 'readwrite');
    tx.objectStore(SESSION_STORE).put({name, savedAt: payload.savedAt || Date.now(), payload});
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IDB put failed'));
    tx.onabort = () => reject(tx.error || new Error('IDB transaction aborted'));
  });
}
async function idbLoadSession(name){
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, 'readonly');
    const req = tx.objectStore(SESSION_STORE).get(name);
    req.onsuccess = () => resolve(req.result ? req.result.payload : null);
    req.onerror = () => reject(req.error);
  });
}
async function idbListSessions(){
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, 'readonly');
    const req = tx.objectStore(SESSION_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbDeleteSession(name){
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, 'readwrite');
    tx.objectStore(SESSION_STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
/* One-time migration: read the old localStorage blob, copy each entry into IDB,
   then drop the blob. Idempotent — running it again is a no-op because the key
   is already gone. Failures fall through silently so the user doesn't see noise
   about legacy storage on a fresh install. */
async function migrateSessionsFromLocalStorage(){
  try{
    const raw = localStorage.getItem(SESSION_KEY);
    if(!raw) return;
    const legacy = JSON.parse(raw) || {};
    const names = Object.keys(legacy);
    if(!names.length){ localStorage.removeItem(SESSION_KEY); return; }
    for(const name of names){
      try{ await idbSaveSession(name, legacy[name]); }catch(_e){}
    }
    localStorage.removeItem(SESSION_KEY);
  }catch(_e){}
}
function cleanImportString(v, maxLen){
  return stripImportedControlChars(String(v == null ? '' : v)).slice(0, maxLen || 500);
}
function sanitizeMarkersArray(markers){
  if(!Array.isArray(markers)) return [];
  if(markers.length > MAX_MARKERS_IMPORT) throw new Error('слишком много маркеров: ' + markers.length);
  const out = [];
  for(const m of markers){
    if(!m || !Number.isFinite(+m.ts)) continue;
    out.push({
      id: Number.isFinite(+m.id) ? +m.id : newMarkerId(),
      type: MARKER_TYPES[m.type] ? m.type : 'info',
      ts: +m.ts,
      text: cleanImportString(m.text || '', MAX_MARKER_TEXT),
      tag: m.tag ? cleanImportString(m.tag, 500) : null,
      createdAt: Number.isFinite(+m.createdAt) ? +m.createdAt : Date.now()
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
function validateSessionPayload(payload){
  if(!payload || typeof payload !== 'object' || !Array.isArray(payload.ap)){
    throw new Error('нет массива ap');
  }
  if(payload.ap.length > MAX_SESSION_PARAMS){
    throw new Error('слишком много параметров: ' + payload.ap.length);
  }

  let totalPoints = 0;
  const ap = payload.ap.map((p, idx) => {
    if(!p || typeof p !== 'object') throw new Error('параметр #' + (idx + 1) + ' не является объектом');
    const tag = cleanImportString(p.tag || p.originalTag || ('param_' + idx), 800);
    if(!tag) throw new Error('пустой tag у параметра #' + (idx + 1));
    const out = Object.assign({}, p, {
      tag,
      originalTag: cleanImportString(p.originalTag || tag, 800),
      shortName: cleanImportString(p.shortName || shortNameFromTag(tag), 120),
      cn: cleanImportString(p.cn || '', 800),
      unit: cleanImportString(p.unit || '', 80),
      signalKind: ['analog', 'binary', 'step', 'setpoint'].includes(p.signalKind) ? p.signalKind : (p.isDiscrete ? 'binary' : 'analog'),
      rawUnit: cleanImportString(p.rawUnit || '', 80),
      rawLevels: p.rawLevels && typeof p.rawLevels === 'object'
        ? {lo: Number.isFinite(+p.rawLevels.lo) ? +p.rawLevels.lo : null, hi: Number.isFinite(+p.rawLevels.hi) ? +p.rawLevels.hi : null}
        : null,
      sourceFile: cleanImportString(p.sourceFile || '', 260),
      timezone: cleanImportString(p.timezone || 'local', 32),
      timeSource: cleanImportString(p.timeSource || p.timezone || 'local', 32),
      mergeConflicts: Number.isFinite(+p.mergeConflicts) ? +p.mergeConflicts : 0,
      merged: !!p.merged,
      isDiscrete: isStepSignal(p)
    });

    if(Array.isArray(p.x) && Array.isArray(p.y)){
      const len = Math.min(p.x.length, p.y.length);
      totalPoints += len;
      if(totalPoints > MAX_SESSION_POINTS) throw new Error('слишком много точек в сессии');
      const hasStatus = Array.isArray(p.st);
      const hasEpoch = Array.isArray(p.ep);
      const hasRaw = Array.isArray(p.rv);
      const hasTimeSource = Array.isArray(p.tsrc);
      const hasMergeConflict = Array.isArray(p.mc);
      out.x = [];
      out.y = [];
      if(hasStatus) out.st = [];
      if(hasEpoch) out.ep = [];
      if(hasRaw) out.rv = [];
      if(hasTimeSource) out.tsrc = [];
      if(hasMergeConflict) out.mc = [];
      for(let i = 0; i < len; i++){
        const ts = Number(p.x[i]);
        const val = Number(p.y[i]);
        if(!Number.isFinite(ts) || !Number.isFinite(val)) continue;
        out.x.push(ts);
        out.y.push(val);
        if(hasStatus) out.st.push(cleanImportString(p.st[i] || '', 120));
        if(hasEpoch){
          const ep = p.ep[i] == null ? null : Number(p.ep[i]);
          out.ep.push(Number.isFinite(ep) ? ep : null);
        }
        if(hasRaw){
          const rv = p.rv[i] == null ? null : Number(p.rv[i]);
          out.rv.push(Number.isFinite(rv) ? rv : null);
        }
        if(hasTimeSource) out.tsrc.push(cleanImportString(p.tsrc[i] || '', 32));
        if(hasMergeConflict) out.mc.push(!!p.mc[i]);
      }
    } else if(Array.isArray(p.data) || isColumnarData(p.data)){
      const data = [];
      totalPoints += p.data.length;
      if(totalPoints > MAX_SESSION_POINTS) throw new Error('слишком много точек в сессии');
      for(const d of p.data){
        if(!d) continue;
        const ts = Number(d.ts);
        const val = Number(d.val);
        if(!Number.isFinite(ts) || !Number.isFinite(val)) continue;
        const status = cleanImportString(d.status || '', 120);
        const point = status ? {ts, val, status} : {ts, val};
        if(d.epochUs != null && Number.isFinite(Number(d.epochUs))) point.epochUs = Number(d.epochUs);
        if(d.rawVal !== undefined && Number.isFinite(Number(d.rawVal))) point.rawVal = Number(d.rawVal);
        if(d.timeSource) point.timeSource = cleanImportString(d.timeSource, 32);
        if(d.mergeConflict) point.mergeConflict = true;
        data.push(point);
      }
      out.data = data;
    } else {
      out.x = [];
      out.y = [];
    }
    return out;
  });

  return Object.assign({}, payload, {
    v: Number.isFinite(+payload.v) ? +payload.v : 1,
    savedAt: Number.isFinite(+payload.savedAt) ? +payload.savedAt : Date.now(),
    ap,
    fn: Array.isArray(payload.fn) ? payload.fn.map(f => cleanImportString(f, 260)).filter(Boolean).slice(0, 2000) : [],
    markers: sanitizeMarkersArray(payload.markers || []),
    markerFilter: Object.assign({event:true,warn:true,alarm:true,info:true,custom:true}, payload.markerFilter || {})
  });
}
async function ensurePersistentStorage(){
  try{
    if(!navigator.storage || !navigator.storage.persist || !navigator.storage.persisted) return false;
    if(await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  }catch(_e){
    return false;
  }
}
function snapshotSession(){
  /* Compact serialisation: flatten each param's [{ts,val},...] into parallel numeric
     x/y arrays. JSON object keys ("ts"/"val") are dropped for every sample, cutting
     payload size by roughly half. fileStore (raw file text, used only for 💾 save-with-
     renamed-tags) is NOT saved — users who need it can reopen the original file. */
  return {
    savedAt: Date.now(),
    v: 2,
    ap: S.data.AP.map(p => {
      const out = {
        tag: p.tag, shortName: p.shortName, cn: p.cn, unit: p.unit,
        isDiscrete: isStepSignal(p),
        signalKind: signalKindOf(p),
        sourceFile: p.sourceFile, originalTag: p.originalTag,
        merged: !!p.merged,
        rawUnit: p.rawUnit || '',
        rawLevels: p.rawLevels || null,
        timezone: p.timezone || 'local',
        timeSource: p.timeSource || p.timezone || 'local',
        mergeConflicts: p.mergeConflicts || p.data.filter(d => d.mergeConflict).length,
        x: p.data.map(d => d.ts),
        y: p.data.map(d => d.val)
      };
      if(p.data.some(d => d.status)) out.st = p.data.map(d => d.status || '');
      if(p.data.some(d => d.epochUs != null)) out.ep = p.data.map(d => d.epochUs != null ? d.epochUs : null);
      if(p.data.some(d => d.rawVal !== undefined)) out.rv = p.data.map(d => d.rawVal !== undefined ? d.rawVal : null);
      if(p.data.some(d => d.timeSource)) out.tsrc = p.data.map(d => d.timeSource || '');
      if(p.data.some(d => d.mergeConflict)) out.mc = p.data.map(d => !!d.mergeConflict);
      return out;
    }),
    fn: S.data.FN.slice(),
    view: snapshotState(),
    levels: JSON.parse(JSON.stringify(S.style.PL || {})),
    titles: JSON.parse(JSON.stringify(S.style.CTT || {})),
    markers: S.markers.MARKERS.slice(),
    markerFilter: Object.assign({}, S.markers.MARKER_FILTER),
    cursorA: S.cursor._cursorA,
    cursorB: S.cursor._cursorB,
    t0ms: S.t0._t0ms,
    anomalyOn: S.anomaly.ANOMALY_ON,
    markersOn: S.ui.MEASURE_ON,
    lightTheme: S.ui.LT,
    /* Live zoom state (X range + per-tag Y ranges) captured from the running plots.
       Applied in loadSession after the post-render settling timer so Plotly has
       finished autorange before we clamp ranges back. */
    zoomState: (typeof captureZoomState === 'function') ? captureZoomState() : null
  };
}
async function saveSession(){
  if(!S.data.AP.length){ showErr('Нет данных для сохранения'); return; }
  await migrateSessionsFromLocalStorage();
  await ensurePersistentStorage();
  const defaultName = (S.data.FN[0] || 'Сессия') + ' · ' + new Date().toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
  const name = prompt('Название сессии:', defaultName);
  if(!name) return;
  try{
    const existing = await idbLoadSession(name);
    if(existing && !confirm('Сессия «' + name + '» уже существует. Перезаписать?')) return;
    const payload = snapshotSession();
    await idbSaveSession(name, payload);
    renderSessionSlots();
  }catch(e){
    const msg = (e && e.name === 'QuotaExceededError')
      ? 'Квота хранилища браузера превышена. Удалите старые сессии или освободите место на диске.'
      : (e && e.message) || 'неизвестная ошибка';
    showErr('Не удалось сохранить сессию: ' + msg);
  }
}
async function loadSession(name){
  await migrateSessionsFromLocalStorage();
  let s = null;
  try{ s = await idbLoadSession(name); }
  catch(e){ showErr('Ошибка чтения сессии: ' + (e.message || e.name)); return; }
  if(!s){ showErr('Сессия не найдена: ' + name); return; }
  try{ s = validateSessionPayload(s); }
  catch(e){ showErr('Сессия повреждена или слишком большая: ' + (e.message || e)); return; }
  if(S.data.AP.length && !confirm('Загрузить сессию «' + name + '»? Текущие данные будут заменены.')) return;
  /* Reset current state without touching presets/sessions (they live in localStorage). */
  clearTraceCache();
  resetZoomHistory();
  /* Reconstruct each param's data array. v2 sessions store parallel x/y arrays to
     shrink localStorage; older sessions (pre-v2) have a `data` field of objects. */
  S.data.AP = (s.ap || []).map(p => {
    const out = Object.assign({}, p);
    if(Array.isArray(p.x) && Array.isArray(p.y)){
      const len = Math.min(p.x.length, p.y.length);
      out.data = columnarDataFromSeries(p.x.slice(0, len), p.y.slice(0, len), {
        status: Array.isArray(p.st) ? p.st : null,
        epochUs: Array.isArray(p.ep) ? p.ep : null,
        rawVal: Array.isArray(p.rv) ? p.rv : null,
        timeSource: Array.isArray(p.tsrc) ? p.tsrc : null,
        mergeConflict: Array.isArray(p.mc) ? p.mc : null
      });
      delete out.x; delete out.y; delete out.st; delete out.ep; delete out.rv; delete out.tsrc; delete out.mc;
    } else if(Array.isArray(p.data)){
      out.data = columnarDataFromPoints(p.data);
    } else if(!isColumnarData(p.data)){
      out.data = columnarDataFromPoints([]);
    }
    out.signalKind = ['analog', 'binary', 'step', 'setpoint'].includes(out.signalKind) ? out.signalKind : (out.isDiscrete ? 'binary' : 'analog');
    out.isDiscrete = out.signalKind !== 'analog';
    return out;
  });
  S.data.FN = (s.fn || []).slice();
  /* fileStore is no longer persisted (cost-benefit); saving files with renamed tags
     after a session load requires re-opening the original source file. */
  S.data._fileStore = s.fileStore || {};
  S.style.PL = s.levels || {};
  S.style.CTT = s.titles || {};
  S.markers.MARKERS = s.markers || [];
  S.markers.MARKER_FILTER = Object.assign({event:true,warn:true,alarm:true,info:true,custom:true}, s.markerFilter || {});
  S.cursor._cursorA = s.cursorA != null ? s.cursorA : null;
  S.cursor._cursorB = s.cursorB != null ? s.cursorB : null;
  S.t0._t0ms = s.t0ms != null ? s.t0ms : null;
  S.anomaly.ANOMALY_ON = !!s.anomalyOn;
  S.ui.MEASURE_ON = !!s.markersOn;
  S.ui.READY = true;
  /* Theme toggle if saved theme differs */
  if(!!s.lightTheme !== S.ui.LT){ togTheme(); }
  /* Rebuild filename chips header */
  const fls = $('fls');
  if(fls){
    fls.textContent = '';
    S.data.FN.forEach(f => {
      const ft = document.createElement('span');
      ft.className = 'ftag';
      ft.textContent = f;
      fls.appendChild(ft);
    });
  }
  if(S.data.AP.length){
    $('brst').style.display = '';
    $('bopen').textContent = '+ Файл';
  }
  applyState(s.view || {});
  renderMarkerFilters();
  renderMarkerAddSelect();
  renderMarkersList();
  closeSessionMenu();
  /* Restore live zoom AFTER the render-debounce completes AND after the slow-path's
     own 500ms "restore saved range" timer. Otherwise autorange-on-newPlot wipes the
     range we just set. 900ms covers render(80ms) + mk*(40ms) + newPlot(async ~200ms)
     + _savedRange restore (500ms) with comfortable headroom. */
  if(s.zoomState){
    setTimeout(() => {
      try{ applyZoomRange(s.zoomState); }catch(_e){}
    }, 900);
  }
}
/* Sanitize a user-supplied filename so it works across filesystems. Drops anything
   that isn't a letter/digit/basic punctuation; collapses whitespace to underscores. */
function _safeFilename(raw){
  return String(raw || '').trim()
    .replace(/[^A-Za-zА-Яа-я0-9 _.-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'session';
}
/* Gzip-compress a UTF-8 string via the built-in CompressionStream API (Chromium,
   Firefox 113+, Safari 16.4+). Typical compression ratio on repetitive numeric
   JSON is 30-50x — a 60 MB raw payload lands at ~1.5 MB. */
async function _gzipString(str){
  if(typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([str], {type: 'text/plain'}).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
async function _gunzipBlob(blob){
  if(typeof DecompressionStream === 'undefined') return null;
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/* Portable session files: download a .pagraph.json.gz the user can archive or copy
   to another machine. The raw JSON is deterministic so identical data round-trips.
   Gzipped by default (falls back to plain JSON if the browser lacks CompressionStream).
   Import accepts gzipped (.gz) AND plain .json, v1 and v2 payloads. */
async function exportSessionToFile(){
  if(!S.data.AP.length){ showErr('Нет данных для экспорта'); return; }
  const payload = snapshotSession();
  const defaultStem = _safeFilename((S.data.FN[0] || 'session').replace(/\.[^.]+$/, ''));
  const askedName = prompt('Имя файла сессии (без расширения):', defaultStem + '_' + fileTS());
  if(askedName === null) return; /* cancelled */
  const stem = _safeFilename(askedName);
  const json = JSON.stringify(payload);
  let blob, filename;
  const gz = await _gzipString(json);
  if(gz){
    blob = gz;
    filename = stem + '.pagraph.json.gz';
  } else {
    blob = new Blob([json], {type: 'application/json'});
    filename = stem + '.pagraph.json';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
}
function importSessionFromFile(){
  const fi = $('sessionImport');
  if(!fi) return;
  fi.value = '';
  fi.click();
}
async function _handleSessionFileImport(file){
  if(!file) return;
  if(file.size > MAX_SESSION_JSON_BYTES){
    showErr('Файл сессии слишком большой: ' + Math.round(file.size / 1024 / 1024) + ' МБ');
    return;
  }
  let payload = null;
  try{
    let text;
    if(/\.gz$/i.test(file.name)){
      text = await _gunzipBlob(file);
      if(text === null) throw new Error('браузер не поддерживает gzip');
    } else {
      /* Try plain text first; if it starts with gzip magic bytes we decompress anyway. */
      const buf = new Uint8Array(await file.arrayBuffer());
      if(buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b){
        text = await _gunzipBlob(new Blob([buf]));
      } else {
        text = new TextDecoder().decode(buf);
      }
    }
    if(text && text.length > MAX_SESSION_JSON_BYTES){
      throw new Error('распакованная сессия слишком большая');
    }
    payload = JSON.parse(text);
    payload = validateSessionPayload(payload);
  }catch(e){
    showErr('Не удалось прочитать файл сессии: ' + (e.message || 'формат невалиден'));
    return;
  }
  /* Save into IDB under a safe name derived from the file stem so the user sees it
     in the dropdown AND can re-load it without re-importing. */
  const stem = file.name.replace(/\.pagraph\.json\.gz$/i, '').replace(/\.pagraph\.json$/i, '').replace(/\.json\.gz$/i, '').replace(/\.json$/i, '').replace(/\.gz$/i, '');
  let targetName = stem || ('Импорт ' + new Date().toLocaleString('ru-RU'));
  try{
    const existing = await idbLoadSession(targetName);
    if(existing && !confirm('Сессия «' + targetName + '» уже есть в браузере. Перезаписать?')){
      targetName = targetName + ' (' + Date.now().toString().slice(-5) + ')';
    }
    await idbSaveSession(targetName, payload);
  }catch(e){
    showErr('Не удалось записать сессию в браузер: ' + (e.message || e.name));
    return;
  }
  await loadSession(targetName);
}

async function deleteSession(name){
  if(!confirm('Удалить сессию «' + name + '»?')) return;
  try{ await idbDeleteSession(name); }
  catch(e){ showErr('Не удалось удалить сессию: ' + (e.message || e.name)); return; }
  renderSessionSlots();
}
async function renderSessionSlots(){
  const host = $('sessionslots');
  if(!host) return;
  host.textContent = '';
  /* Show a placeholder immediately; IDB query is async but normally instant. */
  const loading = document.createElement('div');
  loading.style.cssText = 'padding:8px 14px;font-size:12px;opacity:0.45';
  loading.textContent = '…';
  host.appendChild(loading);

  await migrateSessionsFromLocalStorage();
  let records = [];
  try{ records = await idbListSessions(); }
  catch(e){
    host.textContent = '';
    const em = document.createElement('div');
    em.style.cssText = 'padding:8px 14px;font-size:12px;color:#f87171';
    em.textContent = 'Ошибка IndexedDB: ' + (e.message || e.name);
    host.appendChild(em);
    return;
  }
  host.textContent = '';
  records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  if(!records.length){
    const em = document.createElement('div');
    em.style.cssText = 'padding:8px 14px;font-size:12px;opacity:0.55;font-style:italic';
    em.textContent = 'Нет сохранённых сессий';
    host.appendChild(em);
    return;
  }
  records.forEach(rec => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:3px;padding:2px 6px 2px 10px';
    const bt = document.createElement('button');
    bt.className = 'ddi';
    /* width:auto + min-width:0 override the 100% default on .ddi so flex layout
       actually proportions the two buttons instead of letting the close button claim
       the whole row. Without min-width:0 the text-overflow ellipsis never kicks in. */
    bt.style.cssText = 'flex:1 1 auto;padding:6px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:auto;min-width:0';
    const ts = rec.savedAt ? new Date(rec.savedAt).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : '';
    bt.textContent = rec.name;
    bt.title = ts ? ('Сохранено: ' + ts) : rec.name;
    bt.addEventListener('click', () => loadSession(rec.name));
    const del = document.createElement('button');
    del.className = 'ddi';
    del.style.cssText = 'flex:0 0 auto;padding:6px 10px;color:#f87171;width:auto';
    del.textContent = '✕';
    del.title = 'Удалить';
    del.addEventListener('click', ev => { ev.stopPropagation(); deleteSession(rec.name); });
    row.appendChild(bt);
    row.appendChild(del);
    host.appendChild(row);
  });
}

/* ===== ANOMALY DETECTION (Bollinger Bands) ===== */
function togAnomaly(){
  S.anomaly.ANOMALY_ON = !S.anomaly.ANOMALY_ON;
  $('banom').className = 'b' + (S.anomaly.ANOMALY_ON ? ' on' : '');
  $('anomsec').style.display = S.anomaly.ANOMALY_ON ? 'block' : 'none';
  render();
}
function computeBollinger(yArr, window, k){
  const n = yArr.length;
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const mid = new Array(n).fill(null);
  const outliers = new Array(n).fill(false);
  if(n < window) return {upper, lower, mid, outliers};
  let sum = 0, sumSq = 0;
  for(let i = 0; i < window; i++){ sum += yArr[i]; sumSq += yArr[i]*yArr[i]; }
  for(let i = window; i <= n; i++){
    const avg = sum / window;
    const variance = sumSq / window - avg * avg;
    const std = Math.sqrt(Math.max(0, variance));
    const idx = i - 1;
    mid[idx] = avg;
    upper[idx] = avg + k * std;
    lower[idx] = avg - k * std;
    if(yArr[idx] > upper[idx] || yArr[idx] < lower[idx]) outliers[idx] = true;
    if(i < n){
      sum += yArr[i] - yArr[i - window];
      sumSq += yArr[i]*yArr[i] - yArr[i - window]*yArr[i - window];
    }
  }
  return {upper, lower, mid, outliers};
}

/* ===== T=0 COMPARISON ===== */
function togT0(){
  S.t0.T0_MODE = !S.t0.T0_MODE;
  $('bt0').className = 'b' + (S.t0.T0_MODE ? ' on' : '');
  $('t0sec').style.display = S.t0.T0_MODE ? 'block' : 'none';
  if(!S.t0.T0_MODE && S.t0._t0ms !== null){
    /* Already have T=0, keep it until reset */
  }
}
function setT0(ms){
  S.t0._t0ms = ms;
  $('t0info').textContent = 'T=0: ' + ff(ms);
  render();
}
function resetT0(){
  S.t0._t0ms = null;
  $('t0info').textContent = 'Не установлено';
  render();
}

/* LRU-ish memoization for prepareTraceData. Heavy work (filt → downsample → smooth → gap detect → Bollinger)
   is re-run on every render today. Cache by the config tuple that actually affects the output.
   Cleared on new data load (hf()), reset, or when a param's data length changes. */
const _ptdCache = new Map();
const _PTD_MAX = 64;
function _ptdKey(p){
  const trKey = S.view.TR ? (S.view.TR[0] + '_' + S.view.TR[1]) : 'all';
  const anomKey = S.anomaly.ANOMALY_ON ? ('A' + ($('anomW') ? $('anomW').value : '20') + '_' + ($('anomK') ? $('anomK').value : '2')) : 'NA';
  return p.tag + '|' + p.data.length + '|' + trKey + '|' + S.view.SMOOTH_TYPE + '|' + S.view.SMOOTH_STR + '|'
       + S.view.DS_ALG + '|' + MAX_PTS + '|' + S.view.CGAPS + '|' + (S.t0._t0ms !== null ? S.t0._t0ms : 'NT0') + '|'
       + anomKey + '|' + signalKindOf(p) + '|' + (S.data.QUALITY_GOOD_ONLY ? 'QGOOD' : 'QALL');
}
function _ptdEvict(){
  /* Map iteration is insertion order — drop the oldest until under limit */
  while(_ptdCache.size > _PTD_MAX){
    const firstKey = _ptdCache.keys().next().value;
    _ptdCache.delete(firstKey);
  }
}
function clearTraceCache(){ _ptdCache.clear(); }

function prepareTraceData(p){
  const key = _ptdKey(p);
  const hit = _ptdCache.get(key);
  if(hit){
    /* Refresh insertion order so LRU keeps hot entries */
    _ptdCache.delete(key);
    _ptdCache.set(key, hit);
    /* Style props (color/width/dash) may change independently — refresh them without re-computing data */
    hit.color = gc(p);
    hit.lw = S.style.PW[p.tag] || S.view.LW;
    hit.ld = S.style.PD[p.tag] || S.view.LDASH;
    return hit;
  }
  const result = _prepareTraceDataImpl(p);
  _ptdCache.set(key, result);
  _ptdEvict();
  return result;
}
function _prepareTraceDataImpl(p){
  const c = gc(p);
  const data = filt(p.data);
  const xMsFull = [];
  const yFull = [];
  for(const item of data){
    xMsFull.push(item.ts);
    yFull.push(item.val);
  }
  const stepSignal = isStepSignal(p);
  const ds = stepSignal ? downsampleDiscrete(xMsFull, yFull) : dsDispatch(xMsFull, yFull, MAX_PTS);

  /* When CGAPS is off, insert nulls at genuine session gaps to break the line.
     Uses "natural break" detection: sort intervals, find the biggest ratio jump.
     If ratio >= 10, it's a real gap between sessions. If < 10, data is just irregular. */
  let xFinal = ds.x;
  let yFinal = ds.y;
  if(!S.view.CGAPS && xFinal.length > 2){
    const intervals = [];
    for(let i = 1; i < xFinal.length; i++){
      intervals.push({dt: xFinal[i] - xFinal[i-1], idx: i});
    }
    const sorted = intervals.map(v => v.dt).sort((a,b) => a - b);
    const n = sorted.length;

    /* Find biggest ratio jump between consecutive sorted intervals */
    let maxRatio = 0;
    let breakVal = Infinity;
    for(let i = 1; i < n; i++){
      if(sorted[i-1] > 0){
        const ratio = sorted[i] / sorted[i-1];
        if(ratio > maxRatio){
          maxRatio = ratio;
          breakVal = sorted[i];
        }
      }
    }

    /* Only break if there's a genuine gap (ratio >= 10) */
    if(maxRatio >= 10){
      const xGap = [xFinal[0]];
      const yGap = [yFinal[0]];
      for(let i = 1; i < xFinal.length; i++){
        if(xFinal[i] - xFinal[i-1] >= breakVal){
          xGap.push(new Date((xFinal[i-1] + xFinal[i]) / 2));
          yGap.push(null);
        }
        xGap.push(xFinal[i]);
        yGap.push(yFinal[i]);
      }
      xFinal = xGap;
      yFinal = yGap;
    }
  }

  /* T=0 mode: convert X to relative seconds */
  let xDisp;
  if(S.t0._t0ms !== null){
    xDisp = xFinal.map(x => {
      const ms = x instanceof Date ? x.getTime() : x;
      return (ms - S.t0._t0ms) / 1000; /* seconds from T=0 */
    });
  } else {
    xDisp = xFinal.map(x => x instanceof Date ? x : new Date(x));
  }

  /* Bollinger bands — computed per non-null segment so session gaps don't feed
     zeros into the rolling mean/variance and fake outliers at the boundaries. */
  let bollinger = null;
  if(S.anomaly.ANOMALY_ON){
    const w = parseInt($('anomW').value) || 20;
    const k = parseFloat($('anomK').value) || 2;
    const n = yFinal.length;
    const upper = new Array(n).fill(null);
    const lower = new Array(n).fill(null);
    const mid   = new Array(n).fill(null);
    const outliers = new Array(n).fill(false);
    let i = 0;
    while(i < n){
      if(yFinal[i] === null){ i++; continue; }
      let j = i;
      while(j < n && yFinal[j] !== null) j++;
      const seg = yFinal.slice(i, j);
      const b = computeBollinger(seg, w, k);
      for(let r = 0; r < seg.length; r++){
        upper[i + r] = b.upper[r];
        lower[i + r] = b.lower[r];
        mid[i + r]   = b.mid[r];
        outliers[i + r] = b.outliers[r];
      }
      i = j;
    }
    bollinger = {upper, lower, mid, outliers};
  }

  /* Apply smoothing (skip for discrete signals) */
  const yOrig = yFinal;
  const ySmoothed = stepSignal ? yFinal : applySmoothing(yFinal);
  const lineShape = stepSignal ? 'hv' : (S.view.SMOOTH_TYPE === 'spline' ? 'spline' : 'linear');
  const splineSmoothing = (!stepSignal && S.view.SMOOTH_TYPE === 'spline') ? smoothParams().smoothing : undefined;

  return {
    name: pn(p),
    isDiscrete: stepSignal,
    color: c,
    xMs: xMsFull,
    y: yFull,
    xDisp,
    yDisp: ySmoothed,
    yOrig: (S.view.SMOOTH_TYPE !== 'none' && S.view.SMOOTH_TYPE !== 'spline') ? yOrig : null,
    origLen: data.length,
    dispLen: ds.x.length,
    connectgaps: S.view.CGAPS,
    bollinger,
    lw: S.style.PW[p.tag] || S.view.LW,
    ld: S.style.PD[p.tag] || S.view.LDASH,
    lineShape,
    splineSmoothing,
    traceType: ds.x.length > WEBGL_THRESHOLD ? 'scattergl' : 'scatter'
  };
}

function createPlotError(target, error){
  const dbg = document.createElement('div');
  dbg.className = 'dbg';
  dbg.textContent = 'Plotly error: ' + (error && error.message ? error.message : 'неизвестная ошибка');
  target.textContent = '';
  target.appendChild(dbg);
}

/* ===== Plotly.react fast path helpers =====
   _createChartBox builds the per-chart DOM shell reused by all modes (overlay/single/XY).
   build*Spec functions are pure: given params + a plot div, return {traces, layout, cfg, ...}.
   _renderChart dispatches: newPlot on first call, Plotly.react on subsequent same-sig renders. */
function _createChartBox(ct, tkey, defaultVal, placeholder, h){
  const box = document.createElement('div');
  box.className = 'cb';
  const tr = document.createElement('div');
  tr.className = 'cbt';
  const inp = document.createElement('input');
  inp.value = S.style.CTT[tkey] || defaultVal || '';
  inp.placeholder = placeholder || '';
  inp.addEventListener('input', e => { S.style.CTT[tkey] = e.target.value; });
  tr.appendChild(inp);
  const pd = document.createElement('div');
  pd.className = 'plotdiv';
  pd.style.cssText = 'width:100%;height:' + h + 'px;';
  box.appendChild(tr);
  box.appendChild(pd);
  ct.appendChild(box);
  const ptsSpan = document.createElement('span');
  ptsSpan.className = 'pts';
  tr.appendChild(ptsSpan);
  return {box, tr, inp, pd, ptsSpan};
}

function _computeRenderSig(act){
  /* Factors that would change the DOM structure — any of these → slow (purge+newPlot) path.
     Smoothing/colors/level lines/markers/anomaly/T0 are NOT here: Plotly.react diffs them cheaply. */
  return [
    S.ui.MODE,
    S.ui.XY_MODE ? 'xy' : 'no',
    S.ui.XY_MODE ? S.ui.XY_XPARAM : '',
    act.map(p => p.tag).join(','),
    S.ui.RSLIDER ? 1 : 0,
    S.ui.LT ? 1 : 0
  ].join('|');
}

function buildOverlaySpec(params, pd, h){
  const T = thm();
  const n = params.length;
  const containerW = (pd.clientWidth || (pd.parentNode && pd.parentNode.clientWidth) || 1000);
  /* AXIS_SPACING_PX is the desired gap between adjacent Y-axes (and between the
     leftmost Y-axis and the plot edge) in screen pixels. Compute paper width
     relative to the *plot area* (container minus left/right margin), so the
     actual screen spacing matches the slider value. */
  const L_MARGIN = 8;
  const R_MARGIN = 40; /* room for the rightmost X-axis tick label to not collide with edge */
  const plotW = Math.max(200, containerW - L_MARGIN - R_MARGIN);
  const AX_W = S.view.AXIS_SPACING_PX / plotW;
  const domainLeft = Math.min(n * AX_W, 0.5);
  const perAxis = domainLeft / Math.max(n, 1);
  const traces = [];
  const traceData = [];
  let totalPts = 0, totalDisp = 0;

  const layout = {
    paper_bgcolor:T.pbg, plot_bgcolor:T.pbg,
    font:{family:"'JetBrains Mono',monospace", color:T.pfont, size:_fs(14)},
    /* t=64 leaves enough top margin for stacked unit label + range-max label (both
       positioned via yshift so they stay at fixed pixel offsets regardless of plot height).
       r=40 prevents the rightmost X-axis tick "23:59:59" from clipping the plot edge. */
    margin:{l:L_MARGIN, r:R_MARGIN, t:64, b:44},
    /* Legend starts a fixed pixel gap to the RIGHT of the last Y-axis (domainLeft).
       Paper-coord offset computed from current plotW so the gap stays visually
       constant across window widths. */
    legend:{orientation:'h', x: Math.min(domainLeft + 18/plotW, 0.95), xanchor:'left', y:1, yanchor:'top', bgcolor:'rgba(0,0,0,0)', font:{size:_fs(13)}},
    xaxis:{gridcolor:T.pgrid, linecolor:T.pline, tickcolor:T.pline, tickfont:{size:_fs(13)}, type:S.t0._t0ms!==null?'linear':'date', tickformat:'%d.%m.%Y %H:%M:%S', showspikes:false, rangeslider:{visible:false}, domain:[domainLeft, 1], title:S.t0._t0ms!==null?{text:'Секунды от T=0',font:{size:_fs(13)}}:undefined},
    hovermode:'closest', hoverdistance:30,
    hoverlabel:{bgcolor:'rgba(0,0,0,0)', bordercolor:'rgba(0,0,0,0)', font:{size:1, color:'rgba(0,0,0,0)'}},
    dragmode:'zoom', /* always 'zoom' — MEASURE_ON handled by our capture-phase mousedown */
    height:h, autosize:true,
    shapes:cursorShapes(), annotations:[]
  };

  params.forEach((p, idx) => {
    const td = prepareTraceData(p);
    traceData.push(td);
    totalPts += td.origLen;
    totalDisp += td.dispLen;

    const yaxisName = idx === 0 ? 'y' : 'y' + (idx + 1);
    const lineObj = {color:td.color, width:td.lw, dash:td.ld, shape:td.lineShape};
    if(td.splineSmoothing !== undefined) lineObj.smoothing = td.splineSmoothing;
    traces.push({
      x: td.xDisp, y: td.yDisp, name: td.name, type: td.traceType, yaxis: yaxisName,
      hovertemplate:' <extra></extra>', connectgaps: S.view.CGAPS,
      mode: 'lines', line: lineObj, marker:{size:3, color:td.color}
    });

    if(S.view.SMOOTH_ORIG && td.yOrig){
      traces.push({
        x: td.xDisp, y: td.yOrig, name: td.name + ' (исх.)',
        type: td.traceType, yaxis: yaxisName,
        hoverinfo: 'skip', connectgaps: S.view.CGAPS,
        mode: 'lines', line:{color:td.color, width:0.7, dash:'dot', shape:'linear'},
        opacity: 0.3, showlegend: false
      });
    }

    const yaKey = idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1);
    /* Axis lives at the RIGHT edge of its own AXIS_SPACING_PX-wide slot so its
       tick labels (which extend leftward) fit in the preceding slot or margin.
       With this layout, gap(leftEdge → axis[0]) = gap(axis[i-1] → axis[i]) = AXIS_SPACING_PX. */
    const axisPos = (idx + 1) * perAxis;
    const ya = {
      tickfont:{color:td.color, size:_fs(13)},
      gridcolor:idx === 0 ? T.pgrid : 'rgba(0,0,0,0)',
      linecolor:td.color, tickcolor:td.color,
      zeroline:false, fixedrange:false,
      showgrid:idx === 0, side:'left', anchor:'free', position:axisPos,
      showticklabels:true, showline:true, ticks:'outside', ticklen:2
    };
    if(idx > 0) ya.overlaying = 'y';
    layout[yaKey] = ya;

    if(td.bollinger){
      const b = td.bollinger;
      traces.push({x:td.xDisp, y:b.upper, name:td.name+' +σ', type:'scatter', yaxis:yaxisName,
        mode:'lines', line:{color:td.color, width:0.5, dash:'dot'}, showlegend:false, hoverinfo:'skip'});
      traces.push({x:td.xDisp, y:b.lower, name:td.name+' -σ', type:'scatter', yaxis:yaxisName,
        mode:'lines', line:{color:td.color, width:0.5, dash:'dot'}, fill:'tonexty',
        fillcolor:td.color+'15', showlegend:false, hoverinfo:'skip'});
    }

    const lv = S.style.PL[p.tag];
    if(lv && (lv.hi !== null || lv.lo !== null)){
      if(lv.hi !== null){
        layout.shapes.push({type:'line', xref:'paper', yref:yaxisName, x0:0, x1:1, y0:lv.hi, y1:lv.hi,
          line:{color:'#f87171', width:1.5, dash:'dash'}});
      }
      if(lv.lo !== null){
        layout.shapes.push({type:'line', xref:'paper', yref:yaxisName, x0:0, x1:1, y0:lv.lo, y1:lv.lo,
          line:{color:'#38bdf8', width:1.5, dash:'dash'}});
      }
      const xOOB = [], yOOB = [];
      let wasOOB = false;
      for(let i = 0; i < td.xDisp.length; i++){
        const v = td.yDisp[i];
        if(v === null){
          if(wasOOB){ xOOB.push(null); yOOB.push(null); }
          wasOOB = false;
          continue;
        }
        const out = (lv.hi !== null && v > lv.hi) || (lv.lo !== null && v < lv.lo);
        if(out){
          if(!wasOOB && i > 0 && td.yDisp[i-1] !== null){
            xOOB.push(td.xDisp[i-1]); yOOB.push(td.yDisp[i-1]);
          }
          xOOB.push(td.xDisp[i]); yOOB.push(v);
          wasOOB = true;
        } else {
          if(wasOOB){
            xOOB.push(td.xDisp[i]); yOOB.push(v);
            xOOB.push(null); yOOB.push(null);
          }
          wasOOB = false;
        }
      }
      traces.push({x:xOOB, y:yOOB, name:td.name+' (!)', type:td.traceType, yaxis:yaxisName,
        mode:'lines', line:{color:'#f87171', width:td.lw+1, dash:'solid'},
        connectgaps:false, showlegend:false, hoverinfo:'skip'});
    }
  });

  params.forEach((p, idx) => {
    if(!p.unit) return;
    const axisPos = (idx + 1) * perAxis;
    /* Pixel-based yshift keeps the unit label at a fixed offset above the plot top
       regardless of plot height — the paper-coord approach (y=1.085) drifted off-screen
       for tall plots or was hidden under the top margin for short ones. */
    layout.annotations.push({
      x: axisPos, xref:'paper', y: 1, yref:'paper',
      yshift: 26,
      text: '[' + p.unit + ']', showarrow: false,
      font: {color: S.style.PC[p.tag] || PAL[0], size: _fs(12)},
      xanchor: 'right', yanchor: 'bottom'
    });
  });

  const mShapes = buildMarkerShapes();
  const mAnnots = buildMarkerAnnotations();
  if(mShapes.length){
    layout.shapes = (layout.shapes||[]).concat(mShapes);
    layout.annotations = layout.annotations.concat(mAnnots);
  }
  appendMarkerDotTraces(traces, params);

  const axisDescs = params.map((p, idx) => ({
    yaKey: idx === 0 ? 'yaxis' : 'yaxis' + (idx + 1),
    axisPos: (idx + 1) * perAxis,
    color: S.style.PC[p.tag] || PAL[0],
    xanchor: 'right'
  }));

  const cfg = {responsive:true, displaylogo:false, scrollZoom:true,
    toImageButtonOptions:{format:'png', width:1920, height:Math.max(h,400), scale:2, filename:'graph_'+fileTS()}};

  const ptsText = totalPts + ' pts' + (totalDisp < totalPts ? ' (⚡' + totalDisp + ')' : '');

  return {traces, layout, cfg, traceData, ptsText, axisDescs, domainLeft};
}

/* buildSingleSpec / buildXYSpec defined inline before their mk* wrappers below. */

function _renderChart(cache, isNew){
  const chartCount = cache.chartCount || 1;
  const spec = cache.kind === 'overlay' ? buildOverlaySpec(cache.params, cache.pd, cache.h)
             : cache.kind === 'single'  ? buildSingleSpec(cache.params[0], cache.pd, cache.h)
             : /*xy*/                     buildXYSpec(cache.params, cache.pd, cache.h);
  if(!spec){
    /* XY mode: no matching points — show diagnostic inside the plot div (first render only). */
    if(cache.kind === 'xy' && isNew){
      const dbg = document.createElement('div');
      dbg.className = 'dbg';
      dbg.textContent = 'Нет совпадений по меткам времени между X-параметром и Y-параметрами. Проверьте, что параметры из одного файла/периода.';
      cache.pd.appendChild(dbg);
    }
    return;
  }
  cache.ptsSpan.textContent = spec.ptsText;
  /* uirevision preserves legend visibility / selections. In this Plotly build it does NOT
     preserve axis ranges when the new layout lacks them — we copy ranges manually below. */
  if(!cache.uirev) cache.uirev = 'u' + Math.random().toString(36).slice(2, 10);
  spec.layout.uirevision = cache.uirev;

  /* Fast path: preserve user-zoomed axis ranges. Read current ranges from the live plot
     and apply to the new spec before Plotly.react, otherwise zoom is reset to autorange. */
  if(!isNew && cache.pd._fullLayout){
    const fl = cache.pd._fullLayout;
    if(fl.xaxis && fl.xaxis.range && !fl.xaxis.autorange){
      spec.layout.xaxis = Object.assign({}, spec.layout.xaxis, {
        range: fl.xaxis.range.slice(),
        autorange: false
      });
    }
    /* Per-axis Y preservation (overlay can have yaxis/yaxis2/yaxis3/...) */
    Object.keys(fl).forEach(k => {
      if(!/^yaxis\d*$/.test(k)) return;
      const ax = fl[k];
      if(ax && ax.range && !ax.autorange && spec.layout[k]){
        spec.layout[k] = Object.assign({}, spec.layout[k], {
          range: ax.range.slice(),
          autorange: false
        });
      }
    });
  }

  const apply = async () => {
    try{
      /* Recompute height now that DOM is fully settled (first render) or viewport may have changed. */
      const hNow = calcH(chartCount);
      if(hNow !== cache.h){
        spec.layout.height = hNow;
        cache.pd.style.height = hNow + 'px';
        cache.h = hNow;
      }
      if(isNew){
        await Plotly.newPlot(cache.pd, spec.traces, spec.layout, spec.cfg);
        try{ Plotly.Plots.resize(cache.pd); }catch(_e){}
      } else {
        await Plotly.react(cache.pd, spec.traces, spec.layout, spec.cfg);
      }
      if(isNew){
        if(cache.kind === 'xy'){
          S.plot._activePlot = cache.pd;
          if(!S.plot._allPlots.includes(cache.pd)) S.plot._allPlots.push(cache.pd);
        } else {
          attachEvents(cache.pd, spec.traceData);
        }
        attachRangeLabels(cache.pd, spec.axisDescs, (spec.layout.annotations || []).slice());
        if(S.ui.RSLIDER && cache.kind === 'overlay'){
          attachMSlider(cache.box, cache.pd, cache.params, spec.domainLeft);
        } else if(S.ui.RSLIDER && cache.kind === 'single' && cache.isLast){
          attachMSlider(cache.box, cache.pd, cache.params, 0);
        }
      } else {
        /* Fast path: re-install range labels (Plotly.react wipes layout.annotations extensions). */
        if(cache.pd._reinstallRangeLabels){
          cache.pd._reinstallRangeLabels((spec.layout.annotations || []).slice(), spec.axisDescs);
        }
        /* Keep _allTraceData coherent with fresh smoothing/downsampled arrays. */
        if(cache.kind !== 'xy' && spec.traceData){
          spec.traceData.forEach(td => {
            const i = S.plot._allTraceData.findIndex(t => t.name === td.name);
            if(i >= 0) S.plot._allTraceData[i] = td; else S.plot._allTraceData.push(td);
          });
        }
        if(!S.plot._allPlots.includes(cache.pd)) S.plot._allPlots.push(cache.pd);
        S.plot._activePlot = cache.pd;
        /* Plotly.react ships layout.shapes = cursorShapes() (3 entries, visible:false),
           which resets any active A/B cursor positions. Re-apply live cursor state. */
        refreshCursors();
      }
    }catch(e){
      createPlotError(cache.pd, e);
      console.error(e);
    }
  };
  if(isNew) setTimeout(apply, 40);
  else apply();
}

function mkChartOverlay(ct, params){
  const h0 = calcH(1);
  const {box, pd, ptsSpan} = _createChartBox(ct, '__ov', '', 'Название...', h0);
  const cache = {kind:'overlay', box, pd, ptsSpan, params:params.slice(), chartCount:1, h:h0};
  S.plot._plotCache.push(cache);
  _renderChart(cache, true);
}

function buildSingleSpec(p, pd, h){
  const T = thm();
  const td = prepareTraceData(p);

  const lineObj2 = {color:td.color, width:td.lw, dash:td.ld, shape:td.lineShape};
  if(td.splineSmoothing !== undefined) lineObj2.smoothing = td.splineSmoothing;
  const traces = [{
    x: td.xDisp, y: td.yDisp, name: td.name, type: td.traceType,
    hovertemplate:' <extra></extra>', connectgaps: S.view.CGAPS,
    mode: 'lines', line: lineObj2, marker:{size:3, color:td.color}
  }];

  if(S.view.SMOOTH_ORIG && td.yOrig){
    traces.push({
      x: td.xDisp, y: td.yOrig, name: td.name + ' (исх.)',
      type: td.traceType, hoverinfo: 'skip', connectgaps: S.view.CGAPS,
      mode: 'lines', line:{color:td.color, width:0.7, dash:'dot', shape:'linear'},
      opacity: 0.3, showlegend: false
    });
  }

  const ya = {gridcolor:T.pgrid, linecolor:T.pline, tickcolor:T.pline, tickfont:{size:_fs(13)}, zeroline:false, fixedrange:false};
  if(S.view.YR[0] !== null || S.view.YR[1] !== null){
    if(td.y.length){
      let dMn = Infinity, dMx = -Infinity;
      for(const v of td.y){ if(v < dMn) dMn = v; if(v > dMx) dMx = v; }
      const pad = (dMx - dMn) * 0.05 || 1;
      ya.range = [S.view.YR[0] !== null ? S.view.YR[0] : dMn - pad, S.view.YR[1] !== null ? S.view.YR[1] : dMx + pad];
      ya.autorange = false;
    }
  }

  const layout = {
    paper_bgcolor:T.pbg, plot_bgcolor:T.pbg,
    font:{family:"'JetBrains Mono',monospace", color:T.pfont, size:_fs(14)},
    /* r=40 keeps the rightmost X-tick label (full datetime) off the right edge. */
    margin:{l:62, r:40, t:64, b:44},
    legend:{orientation:'h', x:0, xanchor:'left', y:1, yanchor:'top', bgcolor:'rgba(0,0,0,0)', font:{size:_fs(13)}},
    xaxis:{gridcolor:T.pgrid, linecolor:T.pline, tickcolor:T.pline, tickfont:{size:_fs(13)}, type:S.t0._t0ms!==null?'linear':'date', tickformat:'%d.%m.%Y %H:%M:%S', showspikes:false, rangeslider:{visible:false}, title:S.t0._t0ms!==null?{text:'Секунды от T=0',font:{size:_fs(13)}}:undefined},
    yaxis:ya,
    hovermode:'closest', hoverdistance:30,
    hoverlabel:{bgcolor:'rgba(0,0,0,0)', bordercolor:'rgba(0,0,0,0)', font:{size:1, color:'rgba(0,0,0,0)'}},
    dragmode:'zoom', /* always 'zoom' — MEASURE_ON handled by our capture-phase mousedown */
    height:h, autosize:true,
    shapes:cursorShapes(), annotations:[]
  };

  if(p.unit){
    layout.annotations.push({
      x: 0, xref:'paper', y: 1, yref:'paper',
      yshift: 26,
      text: '[' + p.unit + ']', showarrow: false,
      font: {color: S.style.PC[p.tag] || PAL[0], size: _fs(12)},
      xanchor: 'left', yanchor: 'bottom'
    });
  }

  if(td.bollinger){
    const b = td.bollinger;
    traces.push({x:td.xDisp, y:b.upper, name:td.name+' +σ', type:'scatter',
      mode:'lines', line:{color:td.color, width:0.5, dash:'dot'}, showlegend:false, hoverinfo:'skip'});
    traces.push({x:td.xDisp, y:b.lower, name:td.name+' -σ', type:'scatter',
      mode:'lines', line:{color:td.color, width:0.5, dash:'dot'}, fill:'tonexty',
      fillcolor:td.color+'15', showlegend:false, hoverinfo:'skip'});
  }

  const lv = S.style.PL[p.tag];
  if(lv && (lv.hi !== null || lv.lo !== null)){
    if(lv.hi !== null){
      layout.shapes.push({type:'line', xref:'paper', yref:'y', x0:0, x1:1, y0:lv.hi, y1:lv.hi,
        line:{color:'#f87171', width:1.5, dash:'dash'}});
    }
    if(lv.lo !== null){
      layout.shapes.push({type:'line', xref:'paper', yref:'y', x0:0, x1:1, y0:lv.lo, y1:lv.lo,
        line:{color:'#38bdf8', width:1.5, dash:'dash'}});
    }
    const xOOB = [], yOOB = [];
    let wasOOB = false;
    for(let i = 0; i < td.xDisp.length; i++){
      const v = td.yDisp[i];
      if(v === null){
        if(wasOOB){ xOOB.push(null); yOOB.push(null); }
        wasOOB = false;
        continue;
      }
      const out = (lv.hi !== null && v > lv.hi) || (lv.lo !== null && v < lv.lo);
      if(out){
        if(!wasOOB && i > 0 && td.yDisp[i-1] !== null){
          xOOB.push(td.xDisp[i-1]); yOOB.push(td.yDisp[i-1]);
        }
        xOOB.push(td.xDisp[i]); yOOB.push(v);
        wasOOB = true;
      } else {
        if(wasOOB){
          xOOB.push(td.xDisp[i]); yOOB.push(v);
          xOOB.push(null); yOOB.push(null);
        }
        wasOOB = false;
      }
    }
    traces.push({x:xOOB, y:yOOB, name:td.name+' (!)', type:td.traceType,
      mode:'lines', line:{color:'#f87171', width:td.lw+1, dash:'solid'},
      connectgaps:false, showlegend:false, hoverinfo:'skip'});
  }

  const mShapesSng = buildMarkerShapes();
  if(mShapesSng.length){
    layout.shapes = (layout.shapes||[]).concat(mShapesSng);
    layout.annotations = (layout.annotations||[]).concat(buildMarkerAnnotations());
  }
  appendMarkerDotTraces(traces, [p]);

  const tagClean = td.name.replace(/[^a-zA-Zа-яА-Я0-9_.-]/g,'');
  const cfg = {responsive:true, displaylogo:false, scrollZoom:true,
    toImageButtonOptions:{format:'png', width:1920, height:Math.max(h,400), scale:2, filename:tagClean+'_'+fileTS()}};

  const axisDescs = [{yaKey:'yaxis', axisPos:0, color:S.style.PC[p.tag] || PAL[0], xanchor:'left'}];
  const ptsText = td.origLen + ' pts' + (td.dispLen < td.origLen ? ' (⚡' + td.dispLen + ')' : '');

  return {traces, layout, cfg, traceData:[td], ptsText, axisDescs};
}

function mkChartSingle(ct, p, chartCount){
  const h0 = calcH(chartCount || 1);
  const {box, pd, ptsSpan} = _createChartBox(ct, p.tag, pn(p), 'Название...', h0);
  const idx = S.plot._plotCache.filter(c => c.kind === 'single').length;
  const cache = {
    kind:'single', box, pd, ptsSpan,
    params:[p], chartCount: chartCount || 1, h:h0,
    isLast: idx === ((chartCount || 1) - 1)
  };
  S.plot._plotCache.push(cache);
  _renderChart(cache, true);
}

function mkStats(ct, act){
  const det = document.createElement('details');
  det.style.marginTop = '4px';

  const sum = document.createElement('summary');
  sum.className = 'stog';
  sum.textContent = 'Статистика (общая)';
  det.appendChild(sum);

  const w = document.createElement('div');
  w.className = 'sw';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  const headers = ['Тег', 'Имя', 'Точек', 'Min', 'Max', 'Avg', 'Δ', 'Начало', 'Конец'];
  const headRow = document.createElement('tr');
  headers.forEach(x => {
    const th = document.createElement('th');
    th.textContent = x;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  act.forEach(p => {
    const data = filt(p.data);
    if(!data.length) return;

    const row = document.createElement('tr');
    let cells;

    if(isStepSignal(p)){
      /* Discrete stats: switches, states, time in each state */
      let switches = 0;
      const stateTime = {};
      const uniqVals = new Set();
      for(let i = 0; i < data.length; i++){
        uniqVals.add(data[i].val);
        if(i > 0 && data[i].val !== data[i-1].val) switches++;
        if(i < data.length - 1){
          const dt = data[i+1].ts - data[i].ts;
          stateTime[data[i].val] = (stateTime[data[i].val] || 0) + dt;
        }
      }
      const totalMs = data[data.length-1].ts - data[0].ts;
      const stateStr = Object.entries(stateTime)
        .sort((a,b) => b[1] - a[1])
        .map(([v, ms]) => v + ':' + (totalMs > 0 ? (ms / totalMs * 100).toFixed(0) + '%' : '—'))
        .join(' ');
      cells = [
        p.shortName || p.tag,
        p.cn || '—',
        String(data.length),
        '⎍ ' + uniqVals.size + ' сост.',
        switches + ' перекл.',
        stateStr,
        '',
        ff(data[0].ts),
        ff(data[data.length - 1].ts)
      ];
    } else {
      /* Analog stats: min, max, avg, delta */
      let mn = Infinity, mx = -Infinity, sumVal = 0;
      for(const item of data){
        if(item.val < mn) mn = item.val;
        if(item.val > mx) mx = item.val;
        sumVal += item.val;
      }
      const avg = sumVal / data.length;
      cells = [
        p.shortName || p.tag,
        p.cn || '—',
        String(data.length),
        mn.toFixed(3),
        mx.toFixed(3),
        avg.toFixed(3),
        (mx - mn).toFixed(3),
        ff(data[0].ts),
        ff(data[data.length - 1].ts)
      ];
    }

    cells.forEach((value, idx) => {
      const td = document.createElement('td');
      td.textContent = value;
      if(idx === 0) td.title = p.tag;
      if(!isStepSignal(p)){
        if(idx === 2) td.style.color = '#22d3ee';
        if(idx === 3) td.style.color = '#34d399';
        if(idx === 4) td.style.color = '#f87171';
        if(idx === 5) td.style.color = '#facc15';
        if(idx === 6) td.style.color = '#a78bfa';
      } else {
        if(idx === 2) td.style.color = '#22d3ee';
        if(idx === 3) td.style.color = '#a78bfa';
        if(idx === 4) td.style.color = '#fb923c';
        if(idx === 5){ td.style.fontSize = '9px'; td.style.opacity = '0.7'; }
      }
      if(idx === 7 || idx === 8){
        td.style.fontSize = '9px';
        td.style.opacity = '0.4';
      }
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  w.appendChild(table);
  det.appendChild(w);
  ct.appendChild(det);
}

/* Help modal: F1 opens, Esc closes (takes priority over marker Esc) */
document.addEventListener('keydown', e => {
  if(e.key === 'F1'){
    e.preventDefault();
    togHelp();
    return;
  }
  if(e.key === 'Escape'){
    const m = $('helpmod');
    if(m && m.classList.contains('vis')){
      e.preventDefault();
      e.stopPropagation();
      togHelp();
      return;
    }
    /* Cancel pending marker add-mode */
    if(S.markers.MARKER_ADD_TYPE){
      e.preventDefault();
      togAddMarker();
    }
  }
});

document.addEventListener('keydown', e => {
  if($('helpmod') && $('helpmod').classList.contains('vis')) return;
  if(!S.ui.MEASURE_ON || !S.plot._activePlot || e.target.tagName === 'INPUT') return;
  let r0;
  let r1;
  try{
    const r = S.plot._activePlot._fullLayout.xaxis.range;
    r0 = axisToMs(r[0]);
    r1 = axisToMs(r[1]);
  }catch(_ex){
    return;
  }
  const step = (r1 - r0) / 60;
  if(e.key === 'ArrowRight'){
    e.preventDefault();
    if(S.cursor._cursorB === null && S.cursor._cursorA !== null) S.cursor._cursorB = S.cursor._cursorA;
    if(S.cursor._cursorB === null) S.cursor._cursorB = (r0 + r1) / 2;
    S.cursor._cursorB = Math.min(S.cursor._cursorB + step, r1);
    S.cursor._valsB = valsAtX(S.cursor._cursorB);
    refreshCursors();
    updateCursorPanel();
  }else if(e.key === 'ArrowLeft'){
    e.preventDefault();
    if(S.cursor._cursorB === null && S.cursor._cursorA !== null) S.cursor._cursorB = S.cursor._cursorA;
    if(S.cursor._cursorB === null) S.cursor._cursorB = (r0 + r1) / 2;
    S.cursor._cursorB = Math.max(S.cursor._cursorB - step, r0);
    S.cursor._valsB = valsAtX(S.cursor._cursorB);
    refreshCursors();
    updateCursorPanel();
  }else if(e.key === '=' || e.key === '+'){
    e.preventDefault();
    const c = S.cursor._cursorB || S.cursor._cursorA || (r0 + r1) / 2;
    const h2 = (r1 - r0) / 2 * 0.75;
    Plotly.relayout(S.plot._activePlot, {'xaxis.range':[msToAxis(c - h2), msToAxis(c + h2)]});
  }else if(e.key === '-'){
    e.preventDefault();
    const c2 = S.cursor._cursorB || S.cursor._cursorA || (r0 + r1) / 2;
    const h3 = (r1 - r0) / 2 * 1.33;
    Plotly.relayout(S.plot._activePlot, {'xaxis.range':[msToAxis(c2 - h3), msToAxis(c2 + h3)]});
  }else if(e.key === 'Escape'){
    clearCursors();
  }
});

/* Marker navigation: [ = previous visible marker, ] = next. Works in any mode,
   respects current filters/search. Ignored when typing into inputs. */
document.addEventListener('keydown', e => {
  if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if($('helpmod') && $('helpmod').classList.contains('vis')) return;
  if(e.key === '[' || e.key === ']'){
    if(!S.plot._allPlots.length || !S.markers.MARKERS.length) return;
    e.preventDefault();
    jumpMarkerByDir(e.key === ']' ? 'next' : 'prev');
    return;
  }
  /* Zoom history — Alt+← / Alt+→ */
  if(e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){
    if(!S.plot._allPlots.length) return;
    e.preventDefault();
    if(e.key === 'ArrowLeft') zoomBack(); else zoomForward();
  }
});

(function(){
  wireStaticUi();
  S.ui.READY = true;
  loadMarkersLocal();
  loadPresetsLocal();
  renderMarkerAddSelect();
  renderMarkerFilters();
  renderMarkersList();
  renderPresetsList();
  updateHeightLabel();
  /* Re-render on window resize when height is auto */
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    /* Re-render on resize when:
         - auto-height (CH === 0), OR
         - overlay mode with multiple params (pixel-based Y-axis spacing depends on container width) */
    const needsRerender = (S.view.CH === 0) || (S.ui.MODE === 'o' && !S.ui.XY_MODE && getAct().length > 1);
    if(!needsRerender) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => { render(); }, 200);
  });
  const ld = $('loader');
  const st = $('lst');
  st.textContent = 'Готово!';
  setTimeout(() => {
    ld.classList.add('done');
    setTimeout(() => { ld.remove(); }, 500);
  }, 200);
})();
