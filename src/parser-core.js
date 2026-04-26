'use strict';

function stripImportedControlChars(s){
  return String(s == null ? '' : s).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
}
function cleanCell(s){
  return stripImportedControlChars(s).trim();
}
function trimCell(s){
  return String(s == null ? '' : s).trim();
}
function stripBom(s){
  return String(s == null ? '' : s).replace(/^\uFEFF/, '');
}
function scoreDecodedLog(text){
  const head = stripBom(text).slice(0, 65536);
  let score = 0;
  if(head.indexOf('\uFFFD') !== -1) score -= 50;
  const nulCount = (head.match(/\0/g) || []).length;
  if(nulCount) score -= Math.min(40, nulCount * 2);
  if(head.indexOf('%PAHEADER%') !== -1) score += 12;
  if(/\b(Дата|Date)\t(Время|Time)/.test(head)) score += 12;
  if(/\t/.test(head)) score += 2;
  if(/[А-Яа-яЁё]/.test(head)) score += 2;
  if(/\[[^\]]+\]/.test(head)) score += 1;
  return score;
}
function decodeWithLabel(bytes, label, fatal){
  try{
    const text = new TextDecoder(label, {fatal: !!fatal}).decode(bytes);
    return {text: stripBom(text), encoding: label, score: scoreDecodedLog(text)};
  }catch(_e){
    return null;
  }
}
function decodeBytesSmart(bytes){
  if(bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF){
    const r = decodeWithLabel(bytes.subarray(3), 'utf-8', true);
    if(r) return Object.assign(r, {bom: true});
  }
  if(bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE){
    const r = decodeWithLabel(bytes.subarray(2), 'utf-16le', false);
    if(r) return Object.assign(r, {bom: true});
  }
  if(bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF){
    const r = decodeWithLabel(bytes.subarray(2), 'utf-16be', false);
    if(r) return Object.assign(r, {bom: true});
  }

  const probeLen = Math.min(bytes.length, 65536);
  let evenNul = 0, oddNul = 0;
  for(let i = 0; i < probeLen; i++){
    if(bytes[i] === 0) (i % 2 === 0 ? evenNul++ : oddNul++);
  }

  const candidates = [];
  if(oddNul > evenNul * 2) candidates.push(['utf-16le', false]);
  if(evenNul > oddNul * 2) candidates.push(['utf-16be', false]);
  candidates.push(['utf-8', true], ['windows-1251', false], ['utf-16le', false], ['utf-16be', false]);

  let best = null;
  const seen = new Set();
  for(const [enc, fatal] of candidates){
    if(seen.has(enc)) continue;
    seen.add(enc);
    const r = decodeWithLabel(bytes, enc, fatal);
    if(!r) continue;
    if(!best || r.score > best.score) best = r;
  }
  if(best && best.score > -20) return Object.assign(best, {bom: false});
  throw new Error('не удалось определить кодировку');
}
function normalizeYear(y){
  const n = parseInt(y, 10);
  if(Number.isNaN(n)) return null;
  if(String(y).length === 2) return n < 70 ? 2000 + n : 1900 + n;
  return n;
}
function epochToMs(raw){
  const s = String(raw || '').trim();
  if(!/^-?\d{10,19}$/.test(s)) return null;
  const n = Number(s);
  if(!Number.isFinite(n)) return null;
  if(Math.abs(n) >= 1e15) return Math.trunc(n / 1000);
  if(Math.abs(n) >= 1e12) return Math.trunc(n);
  return Math.trunc(n * 1000);
}
function wallClockTimestampFromParts(ds, ts, ms){
  const dm = ds.match(/(\d{2})[.-](\d{2})[.-](\d{4}|\d{2})/);
  if(!dm) return null;
  const tm = ts.match(/(\d{2}):(\d{2}):(\d{2})/);
  if(!tm) return null;
  const year = normalizeYear(dm[3]);
  if(year === null) return null;
  const msv = parseInt(ms, 10) || 0;
  return new Date(year, parseInt(dm[2], 10) - 1, parseInt(dm[1], 10), parseInt(tm[1], 10), parseInt(tm[2], 10), parseInt(tm[3], 10), msv).getTime();
}
function timestampFromParts(ds, ts, ms, epochRaw){
  const epochMs = epochToMs(epochRaw);
  if(epochMs !== null) return epochMs;
  return wallClockTimestampFromParts(ds, ts, ms);
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
function headerIndexFromText(text){
  const first = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')[0] || '';
  return first.startsWith('%PAHEADER%') ? 1 : 0;
}
function createParseState(){
  return {
    nonEmptyLines: 0,
    headerIdx: 0,
    headerParsed: false,
    params: [],
    pendingWideRows: [],
    error: null
  };
}
function isEpochRaw(raw){
  return /^\d{10,19}$/.test(trimCell(raw));
}
function chooseEpochColumnFromRows(rows, firstCol, maxCol){
  let bestCol = -1;
  let bestScore = 0;
  const rowCount = rows.length;
  if(!rowCount) return -1;
  for(let col = firstCol; col <= maxCol; col++){
    let score = 0;
    for(const row of rows){
      if(isEpochRaw(row[col])) score++;
    }
    if(score > bestScore){ bestScore = score; bestCol = col; }
  }
  const minScore = rowCount <= 2 ? 1 : Math.ceil(rowCount * 0.6);
  return bestScore >= minScore ? bestCol : -1;
}
function initParamsFromHeader(state, headerLine){
  const hp = headerLine.split('\t');
  const params = [];
  let col = 0;

  while(col < hp.length){
    const h = cleanCell(hp[col]);
    if(!h){ col++; continue; }
    const m = h.match(/^(?:Дата|Date)\s+(.+)/i);
    if(m && col + 4 < hp.length){
      const tag = cleanCell(m[1]);
      const nextH = cleanCell(hp[col + 1]);
      if(/^(?:Время|Time)(?:\s|$)/i.test(nextH) && nextH.indexOf(tag) !== -1){
        const unitM = tag.match(/\[([^\]]+)\]\s*$/);
        const unit = unitM ? cleanCell(unitM[1]) : '';
        params.push({tag, originalTag: tag, shortName: shortNameFromTag(tag), unit, sourceFile: '', dc: col, tc: col + 1, mc: col + 2, sc: col + 3, ec: -1, vc: col + 4, data: [], cn: '', merged: false, timezone: 'local', timeSource: 'local', _sorted: true, _lastTs: null});
        col += 5;
        continue;
      }
    }
    col++;
  }
  if(params.length){
    state.params = params;
    state.headerParsed = true;
    return;
  }

  const h0 = cleanCell(hp[0]);
  const h1 = cleanCell(hp[1]);
  const h2 = cleanCell(hp[2]);
  const isWide = (h0 === 'Дата' || h0 === 'Date') && (h1.startsWith('Время') || h1.startsWith('Time') || h1 === 'Время') && (h2 === 'мс' || h2 === 'ms');
  if(!isWide){
    state.error = 'Не найдены группы параметров';
    return;
  }

  let firstValCol = 3;
  let epochCol = -1;
  const h3 = cleanCell(hp[3]).toLowerCase();
  if(h3.indexOf('метка') !== -1 || h3.indexOf('timestamp') !== -1 || h3.indexOf('шаг') !== -1 || h3.indexOf('epoch') !== -1){
    firstValCol = 4;
    epochCol = 3;
  }

  for(let vc = firstValCol; vc < hp.length; vc++){
    const raw = cleanCell(hp[vc]);
    if(!raw) continue;
    const unitM = raw.match(/\[([^\]]+)\]\s*$/);
    const unit = unitM ? cleanCell(unitM[1]) : '';
    params.push({tag: raw, originalTag: raw, shortName: shortNameFromTag(raw), unit, sourceFile: '', dc: 0, tc: 1, mc: 2, sc: -1, ec: epochCol, vc, data: [], cn: '', merged: false, _wide: true, timezone: epochCol >= 0 ? 'epoch' : 'local', timeSource: epochCol >= 0 ? 'epoch' : 'local', _sorted: true, _lastTs: null});
  }
  if(!params.length){
    state.error = 'Не найдены колонки параметров';
    return;
  }
  state.params = params;
  state.headerParsed = true;
}
function maybeResolveWideEpochColumn(state, force){
  if(!state.params.length || !state.params[0]._wide || state.params[0].ec >= 0) return;
  if(!force && state.pendingWideRows.length < 20) return;
  const maxCol = Math.min(5, Math.max(...state.pendingWideRows.map(row => row.length - 1)));
  const epochCol = chooseEpochColumnFromRows(state.pendingWideRows, 3, maxCol);
  if(epochCol >= 0){
    state.params = state.params.filter(p => p.vc > epochCol);
    for(const p of state.params){
      p.ec = epochCol;
      p.timezone = 'epoch';
      p.timeSource = 'epoch';
    }
  }
  const rows = state.pendingWideRows;
  state.pendingWideRows = [];
  for(const row of rows) parseDataColumnsIntoParams(state, row);
}
function pushPoint(pr, point){
  if(pr._lastTs !== null && point.ts < pr._lastTs) pr._sorted = false;
  pr._lastTs = point.ts;
  pr.data.push(point);
}
function parseDataColumnsIntoParams(state, pp){
  for(const pr of state.params){
    const ds = trimCell(pp[pr.dc]);
    const ts = trimCell(pp[pr.tc]);
    const ms = trimCell(pp[pr.mc]);
    const vs = trimCell(pp[pr.vc]);
    if(!ds || !ts || !vs) continue;
    const epochRaw = pr.ec >= 0 ? trimCell(pp[pr.ec]) : '';
    const t = timestampFromParts(ds, ts, ms, epochRaw);
    if(t === null || !Number.isFinite(t)) continue;
    const v = parseFloat(vs.replace(',', '.'));
    if(Number.isNaN(v)) continue;
    const status = pr.sc >= 0 ? trimCell(pp[pr.sc]) : '';
    const point = status ? {ts: t, val: v, status} : {ts: t, val: v};
    if(epochRaw){
      const epochMs = epochToMs(epochRaw);
      if(epochMs !== null){
        point.epochUs = Math.trunc(epochMs * 1000);
        point.epochRaw = epochRaw;
        point.timeSource = 'epoch';
      }else{
        point.timeSource = 'local';
      }
    }else{
      point.timeSource = 'local';
    }
    pushPoint(pr, point);
  }
}
function processLogLine(state, rawLine){
  if(state.error) return;
  const line = stripBom(String(rawLine == null ? '' : rawLine).replace(/\r$/, ''));
  if(line.trim() === '') return;
  if(state.nonEmptyLines === 0 && line.startsWith('%PAHEADER%')){
    state.headerIdx = 1;
    state.nonEmptyLines++;
    return;
  }
  if(!state.headerParsed){
    initParamsFromHeader(state, line);
    state.nonEmptyLines++;
    return;
  }
  const pp = line.split('\t');
  if(state.params.length && state.params[0]._wide && state.params[0].ec < 0 && state.pendingWideRows.length < 20){
    state.pendingWideRows.push(pp);
    maybeResolveWideEpochColumn(state);
  }else{
    parseDataColumnsIntoParams(state, pp);
  }
  state.nonEmptyLines++;
}
function finishParseState(state){
  if(state.nonEmptyLines < 3) return {p: [], e: 'Файл слишком короткий'};
  if(state.error) return {p: [], e: state.error};
  if(!state.headerParsed || !state.params.length) return {p: [], e: 'Не найдены колонки параметров'};
  if(state.pendingWideRows.length){
    maybeResolveWideEpochColumn(state, true);
    const rows = state.pendingWideRows;
    state.pendingWideRows = [];
    for(const row of rows) parseDataColumnsIntoParams(state, row);
  }
  for(const param of state.params){
    if(!param._sorted) param.data.sort((a, b) => a.ts - b.ts);
    delete param._sorted;
    delete param._lastTs;
  }
  return {p: state.params, e: null};
}
function parseLinesCore(lines){
  const state = createParseState();
  for(const line of lines) processLogLine(state, line);
  return finishParseState(state);
}
function parseTextCore(text){
  const source = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return parseLinesCore(source.split('\n'));
}

self.LogGraphParser = {
  stripImportedControlChars,
  cleanCell,
  stripBom,
  scoreDecodedLog,
  decodeWithLabel,
  decodeBytesSmart,
  normalizeYear,
  epochToMs,
  wallClockTimestampFromParts,
  timestampFromParts,
  shortNameFromTag,
  headerIndexFromText,
  createParseState,
  processLogLine,
  finishParseState,
  parseLinesCore,
  parseTextCore
};
