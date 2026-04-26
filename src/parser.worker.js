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
    const hasParserColumns = data && data._columnar && data._ts && data._val;
    const ts = hasParserColumns ? data._ts.slice(0, len) : new Float64Array(len);
    const val = hasParserColumns ? data._val.slice(0, len) : new Float64Array(len);
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
          statusCodes = new Int32Array(len);
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
          epochUs = new Float64Array(len);
          epochUs.fill(NaN);
        }
        epochUs[i] = pointEpochUs;
      }
      if(pointEpochRaw && typeof BigInt64Array === 'function' && typeof BigInt === 'function'){
        if(!epochRaw){
          epochRaw = new BigInt64Array(len);
          epochRawMask = new Uint8Array(len);
        }
        try{
          epochRaw[i] = BigInt(pointEpochRaw);
          epochRawMask[i] = 1;
        }catch(_e){}
      }
      if(pointTimeSource && pointTimeSource !== defaultTimeSource){
        if(!timeSourceCodes){
          timeSourceCodes = new Int32Array(len);
          timeSourceCodes.fill(-1);
        }
        timeSourceCodes[i] = pointTimeSource === 'epoch' ? 0 : 1;
      }
      if(pointSourceFile){
        if(!sourceFileCodes){
          sourceFileCodes = new Int32Array(len);
          sourceFileCodes.fill(-1);
        }
        if(!sourceFileMap.has(pointSourceFile)){
          sourceFileMap.set(pointSourceFile, sourceFileValues.length);
          sourceFileValues.push(pointSourceFile);
        }
        sourceFileCodes[i] = sourceFileMap.get(pointSourceFile);
      }
    }

    const item = {meta: copyParamMeta(param, len), ts, val, statusValues};
    transfer.push(ts.buffer, val.buffer);
    if(statusCodes){ item.statusCodes = statusCodes; transfer.push(statusCodes.buffer); }
    if(epochUs){ item.epochUs = epochUs; transfer.push(epochUs.buffer); }
    if(epochRaw && epochRawMask){ item.epochRaw = epochRaw; item.epochRawMask = epochRawMask; transfer.push(epochRaw.buffer, epochRawMask.buffer); }
    if(timeSourceCodes){ item.timeSourceCodes = timeSourceCodes; item.timeSourceValues = timeSourceValues; transfer.push(timeSourceCodes.buffer); }
    if(sourceFileCodes){ item.sourceFileCodes = sourceFileCodes; item.sourceFileValues = sourceFileValues; transfer.push(sourceFileCodes.buffer); }
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
