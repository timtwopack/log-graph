'use strict';

importScripts('parser-core.js');

const Parser = self.LogGraphParser;

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
    self.postMessage({
      text: result.text,
      encoding: result.encoding,
      bom: result.bom,
      headerIdx: result.headerIdx,
      params: result.params,
      error: result.error
    });
  }).catch(err => {
    self.postMessage({text: '', encoding: '', headerIdx: 0, params: [], error: err && err.message ? err.message : String(err)});
  });
};
