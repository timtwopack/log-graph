'use strict';

importScripts('parser-core.js');

const Parser = self.LogGraphParser;

function copyParamMeta(param, length){
  const meta = {};
  for(const key of Object.keys(param)){
    if(key === 'data') continue;
    meta[key] = param[key];
  }
  meta.length = length;
  return meta;
}
function canUseSharedBuffers(){
  return typeof SharedArrayBuffer === 'function' && !!self.crossOriginIsolated;
}
function makeTypedArray(Ctor, length, shared){
  if(shared) return new Ctor(new SharedArrayBuffer(length * Ctor.BYTES_PER_ELEMENT));
  return new Ctor(length);
}
function copyFloat64(values, length, shared, emptyValue){
  const out = makeTypedArray(Float64Array, length, shared);
  if(emptyValue !== undefined) out.fill(emptyValue);
  if(values){
    const n = Math.min(length, values.length);
    if(values.subarray) out.set(values.subarray(0, n));
    else for(let i = 0; i < n; i++) out[i] = Number(values[i]);
  }
  return out;
}
function addTransfer(transfer, array){
  if(!array || !array.buffer) return;
  if(typeof SharedArrayBuffer === 'function' && array.buffer instanceof SharedArrayBuffer) return;
  transfer.push(array.buffer);
}
function packParamsForTransfer(params){
  const packed = [];
  const transfer = [];
  const shared = canUseSharedBuffers();
  for(const param of params || []){
    const data = param.data || [];
    const len = data.length;
    const hasParserColumns = data && data._columnar && data._ts && data._val;
    const ts = hasParserColumns ? copyFloat64(data._ts, len, shared) : makeTypedArray(Float64Array, len, shared);
    const val = hasParserColumns ? copyFloat64(data._val, len, shared) : makeTypedArray(Float64Array, len, shared);
    let statusCodes = null;
    const statusValues = [];
    const statusMap = new Map();
    let epochUs = null;
    let epochRaw = null;
    let epochRawMask = null;
    let timeSourceCodes = null;
    const timeSourceValues = ['epoch', 'local'];
    let sourceFileCodes = null;
    const sourceFileValues = [];
    const sourceFileMap = new Map();
    const defaultTimeSource = param.timeSource || param.timezone || 'local';

    for(let i = 0; i < len; i++){
      const point = hasParserColumns ? null : data[i];
      const status = hasParserColumns ? data._status[i] : point.status;
      const pointEpochUs = hasParserColumns ? data._epochUs[i] : point.epochUs;
      const pointEpochRaw = hasParserColumns ? data._epochRaw[i] : point.epochRaw;
      const pointTimeSource = hasParserColumns ? data._timeSource[i] : point.timeSource;
      const pointSourceFile = hasParserColumns ? '' : point.sourceFile;
      if(!hasParserColumns){
        ts[i] = point.ts;
        val[i] = point.val;
      }
      if(status){
        if(!statusCodes){
          statusCodes = makeTypedArray(Int32Array, len, shared);
          statusCodes.fill(-1);
        }
        if(!statusMap.has(status)){
          statusMap.set(status, statusValues.length);
          statusValues.push(status);
        }
        statusCodes[i] = statusMap.get(status);
      }
      if(pointEpochUs != null && Number.isFinite(pointEpochUs)){
        if(!epochUs){
          epochUs = makeTypedArray(Float64Array, len, shared);
          epochUs.fill(NaN);
        }
        epochUs[i] = pointEpochUs;
      }
      if(pointEpochRaw && typeof BigInt64Array === 'function' && typeof BigInt === 'function'){
        if(!epochRaw){
          epochRaw = makeTypedArray(BigInt64Array, len, shared);
          epochRawMask = makeTypedArray(Uint8Array, len, shared);
        }
        try{
          epochRaw[i] = BigInt(pointEpochRaw);
          epochRawMask[i] = 1;
        }catch(_e){}
      }
      if(pointTimeSource && pointTimeSource !== defaultTimeSource){
        if(!timeSourceCodes){
          timeSourceCodes = makeTypedArray(Int32Array, len, shared);
          timeSourceCodes.fill(-1);
        }
        timeSourceCodes[i] = pointTimeSource === 'epoch' ? 0 : 1;
      }
      if(pointSourceFile){
        if(!sourceFileCodes){
          sourceFileCodes = makeTypedArray(Int32Array, len, shared);
          sourceFileCodes.fill(-1);
        }
        if(!sourceFileMap.has(pointSourceFile)){
          sourceFileMap.set(pointSourceFile, sourceFileValues.length);
          sourceFileValues.push(pointSourceFile);
        }
        sourceFileCodes[i] = sourceFileMap.get(pointSourceFile);
      }
    }

    const item = {meta: copyParamMeta(param, len), ts, val, statusValues, sharedBuffers: shared};
    addTransfer(transfer, ts);
    addTransfer(transfer, val);
    if(statusCodes){ item.statusCodes = statusCodes; addTransfer(transfer, statusCodes); }
    if(epochUs){ item.epochUs = epochUs; addTransfer(transfer, epochUs); }
    if(epochRaw && epochRawMask){ item.epochRaw = epochRaw; item.epochRawMask = epochRawMask; addTransfer(transfer, epochRaw); addTransfer(transfer, epochRawMask); }
    if(timeSourceCodes){ item.timeSourceCodes = timeSourceCodes; item.timeSourceValues = timeSourceValues; addTransfer(transfer, timeSourceCodes); }
    if(sourceFileCodes){ item.sourceFileCodes = sourceFileCodes; item.sourceFileValues = sourceFileValues; addTransfer(transfer, sourceFileCodes); }
    packed.push(item);
  }
  return {paramsColumnar: packed, transfer, sharedBuffers: shared};
}

async function parseFileStream(file, keepText){
  const sampleSize = Math.min(file.size, 65536);
  const sampleBytes = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
  const sniff = Parser.decodeBytesSmart(sampleBytes);
  const encoding = sniff.encoding || 'utf-8';
  const state = Parser.createParseState();
  const textParts = [];
  let tail = '';
  const reader = file.stream().getReader();
  const decoder = new TextDecoder(encoding);
  const consumeText = value => {
    if(!value) return;
    if(keepText) textParts.push(value);
    const chunk = tail + value;
    const lines = chunk.split('\n');
    tail = lines.pop();
    for(const line of lines) Parser.processLogLine(state, line);
  };
  while(true){
    const {value, done} = await reader.read();
    if(done) break;
    consumeText(decoder.decode(value, {stream: true}));
  }
  consumeText(decoder.decode());
  if(tail) Parser.processLogLine(state, tail);
  const parsed = Parser.finishParseState(state);
  return {text: textParts.join(''), encoding, bom: !!sniff.bom, headerIdx: state.headerIdx, params: parsed.p, error: parsed.e || null};
}

function parseBuffer(buffer, keepText){
  const bytes = new Uint8Array(buffer);
  const decoded = Parser.decodeBytesSmart(bytes);
  const parsed = Parser.parseTextCore(decoded.text);
  return {
    text: keepText ? decoded.text : '',
    encoding: decoded.encoding,
    bom: !!decoded.bom,
    headerIdx: Parser.headerIndexFromText(decoded.text),
    params: parsed.p,
    error: parsed.e || null
  };
}

self.onmessage = function(e){
  Promise.resolve().then(async () => {
    const keepText = !!e.data.keepText;
    const result = e.data.file && typeof e.data.file.stream === 'function'
      ? await parseFileStream(e.data.file, keepText)
      : parseBuffer(e.data.buffer, keepText);
    const packed = packParamsForTransfer(result.params);
    self.postMessage({
      text: result.text,
      encoding: result.encoding,
      bom: result.bom,
      headerIdx: result.headerIdx,
      paramsColumnar: packed.paramsColumnar,
      sharedBuffers: packed.sharedBuffers,
      error: result.error
    }, packed.transfer);
  }).catch(err => {
    self.postMessage({text: '', encoding: '', headerIdx: 0, paramsColumnar: [], error: err && err.message ? err.message : String(err)});
  });
};
