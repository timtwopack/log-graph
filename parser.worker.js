'use strict';

function stripImportedControlChars(s){
  return String(s == null ? '' : s).replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
}
function cleanCell(s){
  return stripImportedControlChars(s).trim();
}
function stripBom(s){
  return String(s == null ? '' : s).replace(/^\uFEFF/, '');
}
function scoreDecodedLog(text){
  const head = stripBom(text).slice(0, 8192);
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

  const probeLen = Math.min(bytes.length, 4096);
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
  if(String(y).length === 2) return 2000 + n;
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
function timestampFromParts(ds, ts, ms, epochRaw){
  const dm = ds.match(/(\d{2})[.-](\d{2})[.-](\d{4}|\d{2})/);
  if(!dm) return null;
  const tm = ts.match(/(\d{2}):(\d{2}):(\d{2})/);
  if(!tm) return null;
  const year = normalizeYear(dm[3]);
  if(year === null) return null;
  const msv = parseInt(ms, 10) || 0;
  void epochRaw;
  return new Date(year, parseInt(dm[2], 10) - 1, parseInt(dm[1], 10), parseInt(tm[1], 10), parseInt(tm[2], 10), parseInt(tm[3], 10), msv).getTime();
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
function parseTextCore(text){
  const cleaned = stripImportedControlChars(stripBom(text));
  const lines = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(ln => ln.trim() !== '');
  if(lines.length < 3) return {p: [], e: 'Файл слишком короткий'};
  let hi = 0;
  if(lines[0].startsWith('%PAHEADER%')) hi = 1;

  const hp = lines[hi].split('\t');
  const params = [];
  let col = 0;

  while(col < hp.length){
    const h = cleanCell(hp[col]);
    if(!h){ col++; continue; }
    const m = h.match(/^Дата\s+(.+)/);
    if(m && col + 4 < hp.length){
      const tag = cleanCell(m[1]);
      const nextH = cleanCell(hp[col + 1]);
      if(nextH.indexOf('Время') === 0 && nextH.indexOf(tag) !== -1){
        const unitM = tag.match(/\[([^\]]+)\]\s*$/);
        const unit = unitM ? cleanCell(unitM[1]) : '';
        params.push({tag, originalTag: tag, shortName: shortNameFromTag(tag), unit, sourceFile: '', dc: col, tc: col + 1, mc: col + 2, sc: col + 3, ec: -1, vc: col + 4, data: [], cn: '', merged: false, timezone: 'local'});
        col += 5;
        continue;
      }
    }
    col++;
  }
  if(!params.length){
    const h0 = cleanCell(hp[0]);
    const h1 = cleanCell(hp[1]);
    const h2 = cleanCell(hp[2]);
    const isWide = (h0 === 'Дата' || h0 === 'Date') && (h1.startsWith('Время') || h1.startsWith('Time') || h1 === 'Время') && (h2 === 'мс' || h2 === 'ms');
    if(!isWide) return {p: [], e: 'Не найдены группы параметров'};

    let firstValCol = 3;
    let epochCol = -1;
    const h3 = cleanCell(hp[3]).toLowerCase();
    if(h3.indexOf('метка') !== -1 || h3.indexOf('timestamp') !== -1 || h3.indexOf('шаг') !== -1 || h3.indexOf('epoch') !== -1){
      firstValCol = 4;
      epochCol = 3;
    } else {
      for(let si = hi + 1; si < Math.min(hi + 3, lines.length); si++){
        const sln = lines[si];
        if(!sln || !sln.trim()) continue;
        const sp = sln.split('\t');
        const v3 = cleanCell(sp[3]);
        if(/^\d{10,}$/.test(v3)){ firstValCol = 4; epochCol = 3; }
        break;
      }
    }

    for(let vc = firstValCol; vc < hp.length; vc++){
      const raw = cleanCell(hp[vc]);
      if(!raw) continue;
      const unitM = raw.match(/\[([^\]]+)\]\s*$/);
      const unit = unitM ? cleanCell(unitM[1]) : '';
      params.push({tag: raw, originalTag: raw, shortName: shortNameFromTag(raw), unit, sourceFile: '', dc: 0, tc: 1, mc: 2, sc: -1, ec: epochCol, vc, data: [], cn: '', merged: false, _wide: true, timezone: epochCol >= 0 ? 'local+epoch' : 'local'});
    }
    if(!params.length) return {p: [], e: 'Не найдены колонки параметров'};
  }

  for(let i = hi + 1; i < lines.length; i++){
    const pp = lines[i].split('\t');
    for(const pr of params){
      const ds = cleanCell(pp[pr.dc]);
      const ts = cleanCell(pp[pr.tc]);
      const ms = cleanCell(pp[pr.mc]);
      const vs = cleanCell(pp[pr.vc]);
      if(!ds || !ts || !vs) continue;
      const epochRaw = pr.ec >= 0 ? cleanCell(pp[pr.ec]) : '';
      const t = timestampFromParts(ds, ts, ms, epochRaw);
      if(t === null || !Number.isFinite(t)) continue;
      const v = parseFloat(vs.replace(',', '.'));
      if(Number.isNaN(v)) continue;
      const status = pr.sc >= 0 ? cleanCell(pp[pr.sc]) : '';
      const point = status ? {ts: t, val: v, status} : {ts: t, val: v};
      if(epochRaw){
        const epochMs = epochToMs(epochRaw);
        if(epochMs !== null){
          point.epochUs = Math.trunc(epochMs * 1000);
          point.epochRaw = epochRaw;
        }
      }
      pr.data.push(point);
    }
  }
  for(const param of params) param.data.sort((a, b) => a.ts - b.ts);
  return {p: params, e: null};
}

self.onmessage = function(e){
  try{
    const bytes = new Uint8Array(e.data.buffer);
    const decoded = decodeBytesSmart(bytes);
    const parsed = parseTextCore(decoded.text);
    self.postMessage({
      text: decoded.text,
      encoding: decoded.encoding,
      bom: !!decoded.bom,
      headerIdx: headerIndexFromText(decoded.text),
      params: parsed.p,
      error: parsed.e || null
    });
  }catch(err){
    self.postMessage({text: '', encoding: '', headerIdx: 0, params: [], error: err && err.message ? err.message : String(err)});
  }
};
