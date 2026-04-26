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
function packParamsForTransfer(params){
  const packed = [];
  const transfer = [];
  for(const param of params || []){
    const data = param.data || [];
    const len = data.length;
    const ts = new Float64Array(len);
    const val = new Float64Array(len);
    let statusCodes = null;
    const statusValues = [];
    const statusMap = new Map();
    let epochUs = null;
    let epochRaw = null;
    let epochRawMask = null;
    let timeSourceCodes = null;
    const defaultTimeSource = param.timeSource || param.timezone || 'local';

    for(let i = 0; i < len; i++){
      const point = data[i];
      ts[i] = point.ts;
      val[i] = point.val;
      if(point.status){
        if(!statusCodes){
          statusCodes = new Int32Array(len);
          statusCodes.fill(-1);
        }
        if(!statusMap.has(point.status)){
          statusMap.set(point.status, statusValues.length);
          statusValues.push(point.status);
        }
        statusCodes[i] = statusMap.get(point.status);
      }
      if(point.epochUs != null){
        if(!epochUs){
          epochUs = new Float64Array(len);
          epochUs.fill(NaN);
        }
        epochUs[i] = point.epochUs;
      }
      if(point.epochRaw && typeof BigInt64Array === 'function' && typeof BigInt === 'function'){
        if(!epochRaw){
          epochRaw = new BigInt64Array(len);
          epochRawMask = new Uint8Array(len);
        }
        try{
          epochRaw[i] = BigInt(point.epochRaw);
          epochRawMask[i] = 1;
        }catch(_e){}
      }
      if(point.timeSource && point.timeSource !== defaultTimeSource){
        if(!timeSourceCodes) timeSourceCodes = new Uint8Array(len);
        timeSourceCodes[i] = point.timeSource === 'epoch' ? 1 : 2;
      }
    }

    const item = {meta: copyParamMeta(param, len), ts, val, statusValues};
    transfer.push(ts.buffer, val.buffer);
    if(statusCodes){ item.statusCodes = statusCodes; transfer.push(statusCodes.buffer); }
    if(epochUs){ item.epochUs = epochUs; transfer.push(epochUs.buffer); }
    if(epochRaw && epochRawMask){ item.epochRaw = epochRaw; item.epochRawMask = epochRawMask; transfer.push(epochRaw.buffer, epochRawMask.buffer); }
    if(timeSourceCodes){ item.timeSourceCodes = timeSourceCodes; transfer.push(timeSourceCodes.buffer); }
    packed.push(item);
  }
  return {paramsColumnar: packed, transfer};
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
      error: result.error
    }, packed.transfer);
  }).catch(err => {
    self.postMessage({text: '', encoding: '', headerIdx: 0, paramsColumnar: [], error: err && err.message ? err.message : String(err)});
  });
};
