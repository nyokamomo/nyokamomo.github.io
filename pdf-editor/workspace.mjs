import {PdfSession,parsePageRange} from './core.mjs';
import {validateObjects,rotateObjects,encodeBase64,readProject} from './objects.mjs';
import {composePdf} from './export.mjs';
export class PdfWorkspace {
  constructor(engine,fontLoader) {this.base=new PdfSession(engine);this.preview=new PdfSession(engine);this.fontLoader=fontLoader;this.current=null;this.undo=[];this.redo=[];this.composite=null;}
  state() {return {...this.current.meta,pages:this.base.info(),objects:this.current.objects,canUndo:!!this.undo.length,canRedo:!!this.redo.length,bytes:this.current.bytes.length};}
  async open(bytes,objects=[],meta={}) {
    const old=this.current;
    try {const pages=this.base.open(bytes);objects=validateObjects(objects,pages.length);const composite=await composePdf(bytes,objects,this.fontLoader);this.preview.open(composite);this.current={bytes,objects,meta};this.composite=composite;this.undo=[];this.redo=[];return this.state();}
    catch(error) {if(old)this.base.open(old.bytes);else this.base.close();throw error;}
  }
  trim() {
    const estimate=()=>{const bytes=new Set(),images=new Set();let n=0;for(const s of [...this.undo,this.current]){if(!bytes.has(s.bytes)){n+=s.bytes.length;bytes.add(s.bytes);}for(const o of s.objects){n+=(o.text?.length??0)*2+(o.points?.length??0)*48+200;if(o.data&&!images.has(o.data)){images.add(o.data);n+=o.data.length*2;}}}return n;};
    while(this.undo.length&&(this.undo.length>20||estimate()>80*1024*1024))this.undo.shift();
  }
  async composed() {if(!this.composite){this.composite=await composePdf(this.current.bytes,this.current.objects,this.fontLoader);this.preview.open(this.composite);}return this.composite;}
  async dispatch(type,args={}) {
    if(type==='open') {if(args.bytes.length>32*1024*1024)throw new Error('单个 PDF 最多 32 MiB。');return this.open(args.bytes,[],args.meta??{});}
    if(type==='importProject') {const p=readProject(args.value);return this.open(p.bytes,p.objects,p.meta);}
    if(type==='create') {
      const width=Number(args.width),height=Number(args.height);
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<72||height<72||width>14400||height>14400)throw new Error('纸张尺寸无效。');
      const temp=new PdfSession(this.base.e);temp.doc=this.base.e.FPDF_CreateNewDocument();
      try {if(!temp.doc)throw new Error('空白 PDF 创建失败。');const page=this.base.e.FPDFPage_New(temp.doc,0,width,height);if(!page)throw new Error('空白页创建失败。');this.base.e.FPDF_ClosePage(page);return await this.open(temp.save(),[],args.meta??{});}
      finally {temp.close();}
    }
    if(!this.current)throw new Error('请先打开 PDF。');
    if(type==='view'||type==='thumb') {await this.composed();return {...this.preview.render(args.page,type==='thumb'?120:args.width),...(type==='view'?{chars:this.base.chars(args.page),textChars:this.base.textChars(args.page),nativeObjects:this.base.pageObjects(args.page)}:{})};}
    if(type==='project')return {value:{schema:'nyokore.pdf-matrix',version:1,pdf:encodeBase64(this.current.bytes),objects:this.current.objects,meta:args.meta??this.current.meta}};
    if(type==='export') {const bytes=await this.composed();return {bytes:args.range?.trim()?this.preview.exportPages(parsePageRange(args.range,this.base.info().length)):bytes.slice()};}
    if(type==='undo'||type==='redo') {
      const from=type==='undo'?this.undo:this.redo,to=type==='undo'?this.redo:this.undo;
      if(from.length){const next=from.at(-1);this.base.open(next.bytes);to.push(this.current);this.current=from.pop();this.composite=null;}
      return this.state();
    }
    const old=this.current,next={...old};let nativeLayer=null;
    try {
      if(type==='updateElements') {
        const native=args.objects.filter(o=>o.type==='native'),added=args.objects.filter(o=>o.type!=='native');
        if(native.length)next.bytes=this.base.editPageObjects(args.page,{updates:native});
        if(added.some(o=>!old.objects.some(p=>p.id===o.id)))throw new Error('对象已不存在。');
        const changes=new Map(added.map(o=>[o.id,o]));next.objects=old.objects.map(o=>changes.get(o.id)??o);
      }
      else if(type==='deleteElements') {if(args.nativeIds?.length)next.bytes=this.base.editPageObjects(args.page,{remove:args.nativeIds});next.objects=old.objects.filter(o=>!(args.objectIds??[]).includes(o.id));}
      else if(type==='addObjects')next.objects=[...old.objects,...args.objects];
      else if(type==='updateObjects') {const changes=new Map(args.objects.map(o=>[o.id,o]));if(args.objects.some(o=>!old.objects.some(p=>p.id===o.id)))throw new Error('对象已不存在。');next.objects=old.objects.map(o=>changes.get(o.id)??o);}
      else if(type==='deleteObjects')next.objects=old.objects.filter(o=>!args.ids.includes(o.id));
      else if(type==='layer') {
        const ids=new Set(args.ids??[]),nativeIds=[...ids].filter(id=>String(id).startsWith('native:'));
        if(nativeIds.length){next.bytes=this.base.editPageObjects(args.page,{layer:{ids:nativeIds,front:!!args.front}});nativeLayer={page:args.page,count:nativeIds.length,front:!!args.front};}
        const onPage=old.objects.filter(o=>o.page===args.page),elsewhere=old.objects.filter(o=>o.page!==args.page),chosen=onPage.filter(o=>ids.has(o.id)),other=onPage.filter(o=>!ids.has(o.id));
        const place=(o,placement)=>({...o,placement});
        const chosenPlaced=chosen.map(o=>place(o,args.front?'over':'under'));
        const otherPlaced=nativeIds.length?other.map(o=>place(o,args.front?'under':'over')):other;
        next.objects=args.front?[...elsewhere,...otherPlaced,...chosenPlaced]:[...elsewhere,...chosenPlaced,...otherPlaced];
      }
      else if(type==='deleteText')next.bytes=this.base.deleteText(args.page,args.ids);
      else if(type==='replaceText') {next.bytes=this.base.deleteText(args.page,args.ids);next.objects=args.object?[...old.objects,args.object]:old.objects;}
      else if(type==='rotatePages'||type==='removePages') {
        const count=this.base.info().length,ids=[...new Set(args.pages)];
        if(!ids.length||ids.some(i=>!Number.isInteger(i)||i<0||i>=count))throw new Error('请选择有效页面。');
        if(type==='removePages') {if(ids.length>=count)throw new Error('至少保留一页。');for(const i of [...ids].sort((a,b)=>b-a))this.base.e.FPDFPage_Delete(this.base.doc,i);next.objects=old.objects.filter(o=>!ids.includes(o.page)).map(o=>({...o,page:o.page-ids.filter(i=>i<o.page).length}));}
        else {next.objects=old.objects;for(const i of ids){const s=this.base.info()[i];next.objects=rotateObjects(next.objects,i,s);this.base.withPage(i,p=>this.base.e.FPDFPage_SetRotation(p,(this.base.e.FPDFPage_GetRotation(p)+1)%4));}}
        next.bytes=this.base.save();
      }
      else if(type==='rotate') {const oldSize=this.base.info()[args.page];next.objects=rotateObjects(old.objects,args.page,oldSize);next.bytes=this.base.rotate(args.page);}
      else if(type==='removePage') {next.bytes=this.base.removePage(args.page);next.objects=old.objects.filter(o=>o.page!==args.page).map(o=>o.page>args.page?{...o,page:o.page-1}:o);}
      else if(type==='movePage') {
        next.bytes=this.base.movePage(args.page,args.to);
        next.objects=old.objects.map(o=>{let page=o.page;if(page===args.page)page=args.to;else if(args.page<args.to&&page>args.page&&page<=args.to)page--;else if(args.page>args.to&&page>=args.to&&page<args.page)page++;return {...o,page};});
      } else if(type==='duplicate') {
        next.bytes=this.base.duplicate(args.page);next.objects=old.objects.map(o=>o.page>args.page?{...o,page:o.page+1}:o);
        next.objects.push(...old.objects.filter(o=>o.page===args.page).map(o=>({...o,id:crypto.randomUUID(),page:o.page+1})));
      } else if(type==='blank') {next.bytes=this.base.blank(args.page);next.objects=old.objects.map(o=>o.page>args.page?{...o,page:o.page+1}:o);}
      else if(type==='merge') {if(args.bytes.length>32*1024*1024)throw new Error('单个 PDF 最多 32 MiB。');next.bytes=this.base.merge(args.bytes);}
      else throw new Error('未知操作。');
      this.base.open(next.bytes);next.objects=validateObjects(next.objects,this.base.info().length);
      const composite=await composePdf(next.bytes,next.objects,this.fontLoader);this.preview.open(composite);
      this.current=next;this.composite=composite;this.undo.push(old);this.redo=[];this.trim();const state=this.state();
      if(nativeLayer){const natives=this.base.pageObjects(nativeLayer.page);state.nativeSelection=(nativeLayer.front?natives.slice(-nativeLayer.count):natives.slice(0,nativeLayer.count)).map(o=>o.id);}
      return state;
    } catch(error) {this.base.open(old.bytes);this.current=old;this.composite=null;throw error;}
  }
  close() {this.base.close();this.preview.close();}
}
