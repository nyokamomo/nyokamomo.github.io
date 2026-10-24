import { init } from './pdfium.js';
import { PdfWorkspace } from './workspace.mjs';
const fontFiles={
  'noto-sans-sc':'NotoSansSC-Regular.otf',
  'noto-serif-sc':'NotoSerifSC-Regular.otf',
  'noto-sans-jp':'NotoSansJP-Regular.otf',
  'noto-serif-jp':'NotoSerifJP-Regular.otf',
  'noto-sans-kr':'NotoSansKR-Regular.otf',
  'noto-serif-kr':'NotoSerifKR-Regular.otf'
};
let workspace;const fontBytes=new Map();
async function loadFont(name='noto-sans-sc') {
  if(!fontFiles[name])throw new Error('不支持所选字体。');
  if(!fontBytes.has(name)){const response=await fetch(new URL(`./${fontFiles[name]}`,import.meta.url));if(!response.ok)throw new Error('无法加载所选字体。');fontBytes.set(name,new Uint8Array(await response.arrayBuffer()));}
  return fontBytes.get(name);
}
const ready=(async()=> {
  const response=await fetch(new URL('./pdfium.wasm',import.meta.url));
  if(!response.ok) throw new Error('无法加载 PDF 引擎，请刷新后重试。');
  const e=await init({wasmBinary:await response.arrayBuffer()});e.PDFiumExt_Init();
  workspace=new PdfWorkspace(e,loadFont);
})();
async function dispatch(type,args) {
  await ready;
  return workspace.dispatch(type,args);
}
let queue=Promise.resolve();
self.onmessage=({data})=> {
  queue=queue.then(async()=> {
    try { const result=await dispatch(data.type,data.args??{});const transfers=[];
      if(result.rgba) transfers.push(result.rgba.buffer);if(result.bytes instanceof Uint8Array) transfers.push(result.bytes.buffer);
      self.postMessage({id:data.id,result},transfers);
    } catch(error) { self.postMessage({id:data.id,error:error.message??'操作失败。'}); }
  });
};
