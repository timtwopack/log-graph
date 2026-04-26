'use strict';

const TRACE_STATE = new Map();

function downsampleDiscrete(xArr, yArr){
  if(xArr.length <= 2) return {x: xArr, y: yArr};
  const sx = [xArr[0]], sy = [yArr[0]];
  for(let i = 1; i < xArr.length; i++){
    if(yArr[i] !== yArr[i - 1]){
      if(sx[sx.length - 1] !== xArr[i - 1]){
        sx.push(xArr[i - 1]); sy.push(yArr[i - 1]);
      }
      sx.push(xArr[i]); sy.push(yArr[i]);
    }
  }
  if(sx[sx.length - 1] !== xArr[xArr.length - 1]){
    sx.push(xArr[xArr.length - 1]); sy.push(yArr[yArr.length - 1]);
  }
  return {x: sx, y: sy};
}
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
    let avgX = 0, avgY = 0;
    const avgL = s2 - s1;
    for(let j = s1; j < s2; j++){ avgX += xArr[j]; avgY += yArr[j]; }
    avgX /= avgL;
    avgY /= avgL;
    let r1 = Math.floor(i * every) + 1;
    let r2 = Math.floor((i + 1) * every) + 1;
    if(r2 > len) r2 = len;
    let maxA = -1, nextA = r1;
    for(let j2 = r1; j2 < r2; j2++){
      const area = Math.abs((xArr[a] - avgX) * (yArr[j2] - yArr[a]) - (xArr[a] - xArr[j2]) * (avgY - yArr[a]));
      if(area > maxA){ maxA = area; nextA = j2; }
    }
    sx.push(xArr[nextA]); sy.push(yArr[nextA]); a = nextA;
  }
  sx.push(xArr[len - 1]); sy.push(yArr[len - 1]);
  return {x: sx, y: sy};
}
function downsampleMinMax(xArr, yArr, threshold){
  const len = xArr.length;
  if(threshold >= len || threshold <= 2) return {x: xArr, y: yArr};
  const buckets = Math.floor(threshold / 2);
  const every = (len - 2) / buckets;
  const sx = [xArr[0]], sy = [yArr[0]];
  for(let i = 0; i < buckets; i++){
    const s = Math.floor(i * every) + 1;
    const e = Math.min(Math.floor((i + 1) * every) + 1, len);
    if(s >= e) continue;
    let mnI = s, mxI = s;
    for(let j = s + 1; j < e; j++){
      if(yArr[j] < yArr[mnI]) mnI = j;
      if(yArr[j] > yArr[mxI]) mxI = j;
    }
    if(mnI === mxI){ sx.push(xArr[mnI]); sy.push(yArr[mnI]); }
    else if(mnI < mxI){ sx.push(xArr[mnI]); sy.push(yArr[mnI]); sx.push(xArr[mxI]); sy.push(yArr[mxI]); }
    else { sx.push(xArr[mxI]); sy.push(yArr[mxI]); sx.push(xArr[mnI]); sy.push(yArr[mnI]); }
  }
  sx.push(xArr[len - 1]); sy.push(yArr[len - 1]);
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
function downsampleNth(xArr, yArr, threshold){
  const len = xArr.length;
  if(threshold >= len || threshold <= 2) return {x: xArr, y: yArr};
  const step = (len - 1) / (threshold - 1);
  const sx = [], sy = [];
  for(let i = 0; i < threshold; i++){
    const idx = Math.round(i * step);
    sx.push(xArr[idx]); sy.push(yArr[idx]);
  }
  return {x: sx, y: sy};
}
function dsDispatch(xArr, yArr, threshold, alg){
  if(alg === 'minmaxlttb') return downsampleMinMaxLttb(xArr, yArr, threshold);
  if(alg === 'minmax') return downsampleMinMax(xArr, yArr, threshold);
  if(alg === 'nth') return downsampleNth(xArr, yArr, threshold);
  return downsample(xArr, yArr, threshold);
}
function isBadQuality(status){
  const s = String(status == null ? '' : status).trim().toLowerCase().replace(',', '.');
  if(!s) return false;
  const n = Number(s);
  if(Number.isFinite(n) && n === 0) return false;
  if(s === 'good' || s === 'ok' || s === 'valid' || s === 'норма' || s === 'норм' || s === 'goodprovider' || s === 'goodlocaloverride') return false;
  return true;
}
function isStepKind(k){
  return k === 'binary' || k === 'step' || k === 'setpoint';
}
function columnarStatusAt(data, index){
  if(!data || !data.statusCodes || !data.statusValues) return '';
  const code = data.statusCodes[index];
  return code >= 0 ? data.statusValues[code] : '';
}
function filteredXYFromData(data, view){
  if(!data || !data.ts || !data.val){
    return {x: new Float64Array(0), y: new Float64Array(0), length: 0};
  }
  const tsArr = data.ts;
  const valArr = data.val;
  let count = 0;
  for(let i = 0; i < tsArr.length; i++){
    const ts = tsArr[i];
    if(view.tr && (ts < view.tr[0] || ts > view.tr[1])) continue;
    if(view.qualityGoodOnly && isBadQuality(columnarStatusAt(data, i))) continue;
    count++;
  }
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  let out = 0;
  for(let i = 0; i < tsArr.length; i++){
    const ts = tsArr[i];
    if(view.tr && (ts < view.tr[0] || ts > view.tr[1])) continue;
    if(view.qualityGoodOnly && isBadQuality(columnarStatusAt(data, i))) continue;
    x[out] = ts;
    y[out] = valArr[i];
    out++;
  }
  return {x, y, length: count};
}
function traceDataForParam(p){
  if(p.dataColumnar) return p.dataColumnar;
  if(p.dataId && TRACE_STATE.has(p.dataId)) return TRACE_STATE.get(p.dataId);
  return null;
}
function loadTraceState(params, reset){
  if(reset) TRACE_STATE.clear();
  for(const item of params || []){
    if(item && item.id && item.dataColumnar) TRACE_STATE.set(item.id, item.dataColumnar);
  }
  return TRACE_STATE.size;
}
function prepareOne(req){
  const p = req.param;
  const view = req.view;
  const stepSignal = isStepKind(p.signalKind) || !!p.isDiscrete;
  const filtered = filteredXYFromData(traceDataForParam(p), view);
  const xMsFull = filtered.x;
  const yFull = filtered.y;
  const ds = stepSignal ? downsampleDiscrete(xMsFull, yFull) : dsDispatch(xMsFull, yFull, view.maxPts, view.dsAlg);
  let xFinal = ds.x;
  let yFinal = ds.y;
  if(!view.cgaps && xFinal.length > 2){
    const intervals = [];
    for(let i = 1; i < xFinal.length; i++) intervals.push(xFinal[i] - xFinal[i - 1]);
    const sorted = intervals.slice().sort((a, b) => a - b);
    let maxRatio = 0, breakVal = Infinity;
    for(let i = 1; i < sorted.length; i++){
      if(sorted[i - 1] > 0){
        const ratio = sorted[i] / sorted[i - 1];
        if(ratio > maxRatio){ maxRatio = ratio; breakVal = sorted[i]; }
      }
    }
    if(maxRatio >= 10){
      const xGap = [xFinal[0]], yGap = [yFinal[0]];
      for(let i = 1; i < xFinal.length; i++){
        if(xFinal[i] - xFinal[i - 1] >= breakVal){
          xGap.push(Math.round((xFinal[i - 1] + xFinal[i]) / 2));
          yGap.push(null);
        }
        xGap.push(xFinal[i]); yGap.push(yFinal[i]);
      }
      xFinal = xGap; yFinal = yGap;
    }
  }
  const xDisp = view.t0ms !== null ? xFinal.map(x => (x - view.t0ms) / 1000) : xFinal.slice();
  return {
    key: req.key,
    data: {
      name: p.name,
      isDiscrete: stepSignal,
      color: p.color,
      xMs: xMsFull,
      y: yFull,
      xDisp,
      xDispAreMs: view.t0ms === null,
      yDisp: yFinal,
      yOrig: null,
      origLen: filtered.length,
      dispLen: ds.x.length,
      connectgaps: view.cgaps,
      bollinger: null,
      lw: p.lw,
      ld: p.ld,
      lineShape: stepSignal ? 'hv' : 'linear',
      splineSmoothing: undefined
    }
  };
}
self.onmessage = function(e){
  try{
    const msg = e.data || {};
    if(msg.type === 'load'){
      const stored = loadTraceState(msg.params || [], !!msg.reset);
      self.postMessage({type: 'load', requestId: msg.requestId, stored, error: null});
      return;
    }
    if(msg.type === 'clear'){
      TRACE_STATE.clear();
      self.postMessage({type: 'clear', requestId: msg.requestId, stored: 0, error: null});
      return;
    }
    const out = (msg.items || []).map(prepareOne);
    self.postMessage({type: 'prepare', requestId: msg.requestId, items: out, error: null});
  }catch(err){
    self.postMessage({type: 'error', requestId: e.data && e.data.requestId, items: [], error: err && err.message ? err.message : String(err)});
  }
};
