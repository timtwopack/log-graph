'use strict';

importScripts('parser-core.js');

const Parser = self.LogGraphParser;

self.onmessage = function(e){
  try{
    const bytes = new Uint8Array(e.data.buffer);
    const decoded = Parser.decodeBytesSmart(bytes);
    const parsed = Parser.parseTextCore(decoded.text);
    self.postMessage({
      text: decoded.text,
      encoding: decoded.encoding,
      bom: !!decoded.bom,
      headerIdx: Parser.headerIndexFromText(decoded.text),
      params: parsed.p,
      error: parsed.e || null
    });
  }catch(err){
    self.postMessage({text: '', encoding: '', headerIdx: 0, params: [], error: err && err.message ? err.message : String(err)});
  }
};
