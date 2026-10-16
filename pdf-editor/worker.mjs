import { init } from './pdfium.js';
import { PdfWorkspace } from './workspace.mjs';
let workspace,fontBytes;
const ready=(async()=> {
  const response=await fetch(new URL('./pdfium.wasm',import.meta.url));
  if(!response.ok) throw new Error('无法加载 PDF 引擎，请刷新后重试。');
  const e=await init({wasmBinary:await response.arrayBuffer()});e.PDFiumExt_Init();
  workspace=new PdfWorkspace(e,async()=>{if(!fontBytes){const f=await fetch(new URL('./NotoSansSC-Regular.ttf',import.meta.url));if(!f.ok)throw new Error('无法加载中文字体。');fontBytes=new Uint8Array(await f.arrayBuffer());}return fontBytes;});
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
