// PDFium adapter. No document bytes leave the caller's device.
export class PdfSession {
  constructor(engine) { this.e = engine; this.doc = 0; this.data = 0; }
  alloc(size) { const ptr=this.e.pdfium.wasmExports.malloc(size);if(!ptr&&size>0)throw new Error('PDF 编辑内存不足，请使用较小的文件。');return ptr; }
  free(ptr) { this.e.pdfium.wasmExports.free(ptr); }
  open(bytes) {
    const data = this.alloc(bytes.length);
    this.e.pdfium.HEAPU8.set(bytes, data);
    const doc = this.e.FPDF_LoadMemDocument(data, bytes.length, '');
    if (!doc) { this.free(data); throw new Error('无法打开 PDF。暂不支持加密、损坏或需要密码的文件。'); }
    try {
      const count = this.e.FPDF_GetPageCount(doc);
      if (count < 1 || count > 300) throw new Error('请使用 1–300 页的 PDF。');
      if (this.e.EPDF_IsEncrypted(doc)) throw new Error('暂不编辑加密 PDF，请先用原软件另存未加密副本。');
      if (this.e.FPDF_GetSignatureCount(doc)) throw new Error('此 PDF 含证书数字签名。请使用未签名副本，避免破坏签名。');
      for(let i=0;i<count;i++) {
        const page=this.e.FPDF_LoadPage(doc,i);
        if(!page)throw new Error('此 PDF 含无法读取的页面。');
        try {const w=this.e.FPDF_GetPageWidth(page),h=this.e.FPDF_GetPageHeight(page);if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw new Error('此 PDF 含无效页面尺寸，无法编辑。');}
        finally {this.e.FPDF_ClosePage(page);}
      }
    } catch (error) { this.e.FPDF_CloseDocument(doc); this.free(data); throw error; }
    this.close(); this.doc = doc; this.data = data;
    return this.info();
  }
  close() { if (this.doc) this.e.FPDF_CloseDocument(this.doc); if (this.data) this.free(this.data); this.doc = this.data = 0; }
  withPage(index, fn) {
    if (!this.doc || !Number.isInteger(index) || index < 0 || index >= this.e.FPDF_GetPageCount(this.doc)) throw new Error('页面不存在。');
    const page = this.e.FPDF_LoadPage(this.doc, index);
    if (!page) throw new Error('此页面无法读取。');
    try { return fn(page); } finally { this.e.FPDF_ClosePage(page); }
  }
  info() {
    return Array.from({length: this.e.FPDF_GetPageCount(this.doc)}, (_, i) => this.withPage(i, p => {
      const width=this.e.FPDF_GetPageWidth(p),height=this.e.FPDF_GetPageHeight(p);
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) throw new Error('此 PDF 含无效页面尺寸，无法编辑。');
      return {width,height,rotation:this.e.FPDFPage_GetRotation(p)};
    }));
  }
  chars(index) {
    return this.withPage(index, page => {
      const text = this.e.FPDFText_LoadPage(page), box = this.alloc(32), out = this.alloc(8), result = [];
      try {
        const w = Math.round(this.e.FPDF_GetPageWidth(page) * 10), h = Math.round(this.e.FPDF_GetPageHeight(page) * 10);
        const point = (x, y) => {
          if (!this.e.FPDF_PageToDevice(page, 0, 0, w, h, 0, x, y, out, out + 4)) throw new Error('无法转换页面坐标。');
          return [this.e.pdfium.getValue(out, 'i32') / w, this.e.pdfium.getValue(out + 4, 'i32') / h];
        };
        const count = this.e.FPDFText_CountChars(text);
        if (count > 60000) throw new Error('此页文字过多，请拆分文档后重试。');
        for (let i = 0; i < count; i++) {
          const unicode = this.e.FPDFText_GetUnicode(text, i);
          if (!unicode || unicode > 0x10ffff || this.e.FPDFText_IsGenerated(text, i) === 1) continue;
          const value = String.fromCodePoint(unicode);
          if (!value.trim() || !this.e.FPDFText_GetCharBox(text, i, box, box + 8, box + 16, box + 24)) continue;
          const [l, r, b, t] = [0, 8, 16, 24].map(n => this.e.pdfium.getValue(box + n, 'double'));
          if (r <= l || t <= b) continue;
          const points = [point(l,b),point(l,t),point(r,b),point(r,t)];
          const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
          const fontSize=this.e.FPDFText_GetFontSize(text,i);
          result.push({ id: i, value, raw: [l,t,r,b], ...(Number.isFinite(fontSize)&&fontSize>0?{fontSize}:{}), x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) });
        }
        return result;
      } finally { if (text) this.e.FPDFText_ClosePage(text); this.free(box); this.free(out); }
    });
  }
  render(index, maxWidth = 1200) {
    return this.withPage(index, page => {
      const w0 = this.e.FPDF_GetPageWidth(page), h0 = this.e.FPDF_GetPageHeight(page);
      const scale = Math.min(maxWidth / w0, 2200 / h0, Math.sqrt(4000000 / (w0*h0)));
      const width = Math.max(1, Math.round(w0 * scale)), height = Math.max(1, Math.round(h0 * scale));
      const bitmap = this.e.FPDFBitmap_Create(width, height, 1);
      if (!bitmap) throw new Error('页面预览内存不足。');
      try {
        this.e.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        this.e.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 1);
        const ptr = this.e.FPDFBitmap_GetBuffer(bitmap), stride = this.e.FPDFBitmap_GetStride(bitmap);
        const source = this.e.pdfium.HEAPU8, rgba = new Uint8ClampedArray(width*height*4);
        for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
          const a = ptr+y*stride+x*4, z=(y*width+x)*4;
          rgba[z]=source[a+2]; rgba[z+1]=source[a+1]; rgba[z+2]=source[a]; rgba[z+3]=source[a+3];
        }
        return { width, height, rgba };
      } finally { this.e.FPDFBitmap_Destroy(bitmap); }
    });
  }
  textChars(index) {
    return this.withPage(index,page=>{const t=this.e.FPDFText_LoadPage(page);try{const count=this.e.FPDFText_CountChars(t);if(count>60000)throw new Error('此页文字过多。');return Array.from({length:count},(_,id)=>{const n=this.e.FPDFText_GetUnicode(t,id);return {id,value:n&&n<=0x10ffff?String.fromCodePoint(n):''};});}finally{if(t)this.e.FPDFText_ClosePage(t);}});
  }
  pageObjects(index) {
    return this.withPage(index,page=>{
      const e=this.e,ptr=this.alloc(128),result=[],scale=1000000,W=e.FPDF_GetPageWidth(page),H=e.FPDF_GetPageHeight(page);
      const point=(x,y)=>{if(!e.FPDF_PageToDevice(page,0,0,scale,scale,0,x,y,ptr+112,ptr+116))throw new Error('无法读取原有元素的位置。');return[e.pdfium.getValue(ptr+112,'i32')/scale,e.pdfium.getValue(ptr+116,'i32')/scale];};
      // Lengths and angles must use equal physical units on both axes. Only
      // normalize the finished frame for the percentage-based editor overlay.
      const frame=quad=>{const points=quad.map(([x,y])=>point(x,y)),[ll,,ur,ul]=points,cx=points.reduce((n,p)=>n+p[0],0)/4,cy=points.reduce((n,p)=>n+p[1],0)/4,dx=(ur[0]-ul[0])*W,dy=(ur[1]-ul[1])*H,width=Math.hypot(dx,dy)/W,height=Math.hypot((ll[0]-ul[0])*W,(ll[1]-ul[1])*H)/H,rotation=Math.atan2(dy,dx)*180/Math.PI;return{x:cx-width/2,y:cy-height/2,width:Math.max(.00001,width),height:Math.max(.00001,height),rotation};};
      const transformedFrame=(obj,kind)=>{
        if(e.FPDFPageObj_GetRotatedBounds(obj,ptr+64)){const q=Array.from({length:8},(_,i)=>e.pdfium.getValue(ptr+64+i*4,'float'));return frame([[q[0],q[1]],[q[2],q[3]],[q[4],q[5]],[q[6],q[7]]]);}
        if(!e.FPDFPageObj_GetMatrix(obj,ptr+32))return null;const m=Array.from({length:6},(_,i)=>e.pdfium.getValue(ptr+32+i*4,'float'));let local=null;
        if(kind===2){const points=[];for(let j=0;j<e.FPDFPath_CountSegments(obj);j++){const segment=e.FPDFPath_GetPathSegment(obj,j);if(segment&&e.FPDFPathSegment_GetPoint(segment,ptr,ptr+4))points.push([e.pdfium.getValue(ptr,'float'),e.pdfium.getValue(ptr+4,'float')]);}if(points.length){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);local=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}}
        if(kind===5){const bounds=[];for(let j=0;j<e.FPDFFormObj_CountObjects(obj);j++){const child=e.FPDFFormObj_GetObject(obj,j);if(child&&e.FPDFPageObj_GetBounds(child,ptr,ptr+4,ptr+8,ptr+12))bounds.push([0,4,8,12].map(n=>e.pdfium.getValue(ptr+n,'float')));}if(bounds.length)local=[Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))];}
        if(!local)return null;const [l,b,r,t]=local,apply=(x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];return frame([apply(l,b),apply(r,b),apply(r,t),apply(l,t)]);
      };
      try {
        const count=e.FPDFPage_CountObjects(page);if(count>20000)throw new Error('此页包含过多图形，请拆分后编辑。');
        for(let i=0;i<count;i++){
          const obj=e.FPDFPage_GetObject(page,i),kind=e.FPDFPageObj_GetType(obj);
          if(![1,2,3,4,5].includes(kind)||!e.FPDFPageObj_GetBounds(obj,ptr,ptr+4,ptr+8,ptr+12))continue;
          const [l,b,r,t]=[0,4,8,12].map(n=>e.pdfium.getValue(ptr+n,'float')),corners=[point(l,b),point(l,t),point(r,b),point(r,t)],xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),axis={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(.00001,Math.max(...xs)-Math.min(...xs)),height:Math.max(.00001,Math.max(...ys)-Math.min(...ys)),rotation:0},geometry=transformedFrame(obj,kind)??axis;
          const readColor=fn=>{if(!fn(obj,ptr+16,ptr+20,ptr+24,ptr+28))return null;const c=[16,20,24,28].map(n=>e.pdfium.getValue(ptr+n,'i32'));return{color:'#'+c.slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join(''),opacity:c[3]/255};};
          let fill=null,stroke=null,size=1;
          if(kind===2){if(e.FPDFPath_GetDrawMode(obj,ptr+32,ptr+36)){if(e.pdfium.getValue(ptr+32,'i32'))fill=readColor(e.FPDFPageObj_GetFillColor);if(e.pdfium.getValue(ptr+36,'i32'))stroke=readColor(e.FPDFPageObj_GetStrokeColor);}if(e.FPDFPageObj_GetStrokeWidth(obj,ptr+40))size=e.pdfium.getValue(ptr+40,'float');}
          result.push({id:`native:${i}`,page:index,type:'native',nativeIndex:i,nativeType:({1:'text',2:'path',3:'image',4:'shading',5:'group'})[kind],...geometry,size,color:fill?.color??stroke?.color??'#28343e',opacity:fill?.opacity??stroke?.opacity??1,fill,stroke});
        }
        return result;
      } finally {this.free(ptr);}
    });
  }
  editPageObjects(index,{updates=[],remove=[],layer=null}={}) {
    const before=new Map(this.pageObjects(index).map(o=>[o.id,o])),layerIds=layer?.ids??[],ids=[...updates.map(o=>o.id),...remove,...layerIds];
    if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!before.has(id)))throw new Error('原有元素已改变，请重新选择。');
    this.withPage(index,page=>{
      const e=this.e,ptr=this.alloc(16),scale=1000000,W=e.FPDF_GetPageWidth(page),H=e.FPDF_GetPageHeight(page);
      const toPage=(x,y)=>{if(!e.FPDF_DeviceToPage(page,0,0,scale,scale,0,Math.round(x*scale),Math.round(y*scale),ptr,ptr+8))throw new Error('无法转换原有元素坐标。');return[e.pdfium.getValue(ptr,'double'),e.pdfium.getValue(ptr+8,'double')];};
      try {
        // P maps displayed page points (not 0–1 coordinates) back to PDF space.
        // Conjugating a rotation in a normalized square stretches rectangular pages.
        const p0=toPage(0,0),px=toPage(1,0),py=toPage(0,1),P=[(px[0]-p0[0])/W,(px[1]-p0[1])/W,(py[0]-p0[0])/H,(py[1]-p0[1])/H,...p0],inverse=invertMatrix(P);
        for(const next of updates){
          const old=before.get(next.id);for(const key of ['x','y','width','height','rotation'])if(!Number.isFinite(next[key])||Math.abs(next[key])>3&&key!=='rotation'||key==='rotation'&&Math.abs(next[key])>36000)throw new Error('原有元素尺寸或旋转角度无效。');if(next.width<=0||next.height<=0)throw new Error('原有元素尺寸必须大于零。');
          const obj=e.FPDFPage_GetObject(page,old.nativeIndex),sx=next.width/old.width,sy=next.height/old.height,oldCx=(old.x+old.width/2)*W,oldCy=(old.y+old.height/2)*H,newCx=(next.x+next.width/2)*W,newCy=(next.y+next.height/2)*H,oldAngle=old.rotation*Math.PI/180,newAngle=next.rotation*Math.PI/180,oldInverse=[Math.cos(oldAngle),-Math.sin(oldAngle),Math.sin(oldAngle),Math.cos(oldAngle),0,0],nextRotate=[Math.cos(newAngle),Math.sin(newAngle),-Math.sin(newAngle),Math.cos(newAngle),0,0];
          const delta=multiplyMatrix([1,0,0,1,newCx,newCy],multiplyMatrix(nextRotate,multiplyMatrix([sx,0,0,sy,0,0],multiplyMatrix(oldInverse,[1,0,0,1,-oldCx,-oldCy])))),matrix=multiplyMatrix(multiplyMatrix(P,delta),inverse);
          if(matrix.some((v,i)=>Math.abs(v-[1,0,0,1,0,0][i])>.000001)){e.FPDFPageObj_Transform(obj,...matrix);if(old.nativeType!=='group'&&old.nativeType!=='shading')e.FPDFPageObj_TransformClipPath(obj,...matrix);}
          if(old.nativeType==='path'){
            for(const [key,fn] of [['fill',e.FPDFPageObj_SetFillColor],['stroke',e.FPDFPageObj_SetStrokeColor]]){const value=next[key];if(!old[key]||!value)continue;if(!/^#[0-9a-f]{6}$/i.test(value.color)||!Number.isFinite(value.opacity)||value.opacity<0||value.opacity>1)throw new Error('图形颜色无效。');if(!fn(obj,...[1,3,5].map(n=>parseInt(value.color.slice(n,n+2),16)),Math.round(value.opacity*255)))throw new Error('无法修改图形颜色。');}
            if(old.stroke){if(!Number.isFinite(next.size)||next.size<0||next.size>160)throw new Error('图形线宽无效。');if(!e.FPDFPageObj_SetStrokeWidth(obj,next.size))throw new Error('无法修改图形线宽。');}
          }
        }
        if(layerIds.length){
          const handles=layerIds.map(id=>e.FPDFPage_GetObject(page,before.get(id).nativeIndex));
          for(const obj of handles)if(!e.FPDFPage_RemoveObject(page,obj))throw new Error('无法调整原有元素层级。');
          if(layer.front){
            for(const obj of handles)if(!e.FPDFPage_InsertObjectAtIndex(page,obj,e.FPDFPage_CountObjects(page)))throw new Error('无法将原有元素置于顶层。');
          }else{
            for(let i=0;i<handles.length;i++)if(!e.FPDFPage_InsertObjectAtIndex(page,handles[i],i))throw new Error('无法将原有元素置于底层。');
          }
        }
        // Resolve handles before removal so object indices cannot drift mid-operation.
        const handles=remove.map(id=>e.FPDFPage_GetObject(page,before.get(id).nativeIndex));
        for(const obj of handles){if(!e.FPDFPage_RemoveObject(page,obj))throw new Error('无法删除原有元素。');e.FPDFPageObj_Destroy(obj);}
        if(!e.FPDFPage_GenerateContent(page))throw new Error('无法保存原有元素修改。');
      } finally {this.free(ptr);}
    });
    return this.save();
  }
  deleteText(index, ids) {
    const selected = this.chars(index).filter(c => ids.includes(c.id));
    if (!selected.length) throw new Error('请先选择要删除的已有文字。');
    this.withPage(index, page => {
      // Small rectangles inside each glyph avoid adjoining characters. The engine
      // removes whole intersecting glyphs, recurses into Forms and leaves images.
      const ptr = this.alloc(selected.length * 32);
      try {
        selected.forEach((c,i) => {
          const [l,t,r,b] = c.raw, dx=(r-l)*0.2, dy=(t-b)*0.2;
          const values=[l+dx,t-dy,r-dx,t-dy,l+dx,b+dy,r-dx,b+dy];
          values.forEach((v,j) => this.e.pdfium.setValue(ptr+i*32+j*4,v,'float'));
        });
        if (!this.e.EPDFText_RedactInQuads(page, ptr, selected.length, true, false) || !this.e.FPDFPage_GenerateContent(page)) throw new Error('此 PDF 无法可靠删除所选文字，未保存此次操作。');
      } finally { this.free(ptr); }
    });
    return this.save();
  }
  save() {
    const writer = this.e.PDFiumExt_OpenFileWriter(); let ptr=0;
    try {
      if (!this.e.PDFiumExt_SaveAsCopy(this.doc, writer)) throw new Error('PDF 导出失败。');
      const size=this.e.PDFiumExt_GetFileWriterSize(writer);
      if (!size || size>64*1024*1024) throw new Error('导出文件超过 64 MiB，建议拆分文档。');
      ptr=this.alloc(size); this.e.PDFiumExt_GetFileWriterData(writer,ptr,size);
      return this.e.pdfium.HEAPU8.slice(ptr,ptr+size);
    } finally { if(ptr) this.free(ptr); this.e.PDFiumExt_CloseFileWriter(writer); }
  }
  rotate(index) { this.withPage(index,p=>this.e.FPDFPage_SetRotation(p,(this.e.FPDFPage_GetRotation(p)+1)%4)); return this.save(); }
  removePage(index) {
    this.withPage(index,()=>{});
    if(this.e.FPDF_GetPageCount(this.doc)<=1) throw new Error('至少保留一页。');
    this.e.FPDFPage_Delete(this.doc,index); return this.save();
  }
  movePage(index,to) {
    const count=this.e.FPDF_GetPageCount(this.doc);
    if(!Number.isInteger(to)||to<0||to>=count) throw new Error('页面位置无效。');
    this.withPage(index,()=>{});
    const ptr=this.alloc(4);
    try { this.e.pdfium.setValue(ptr,index,'i32'); if(!this.e.FPDF_MovePages(this.doc,ptr,1,to)) throw new Error('调整页面顺序失败。'); }
    finally { this.free(ptr); }
    return this.save();
  }
  exportPages(indices) {
    const count=this.e.FPDF_GetPageCount(this.doc);
    if(!indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=count)) throw new Error('导出页码无效。');
    const temp=new PdfSession(this.e);temp.doc=this.e.FPDF_CreateNewDocument();
    try {
      for(let n=0;n<indices.length;n++) if(!this.e.FPDF_ImportPages(temp.doc,this.doc,String(indices[n]+1),n)) throw new Error('页面导出失败。');
      return temp.save();
    } finally { temp.close(); }
  }
  merge(bytes) {
    const temp=new PdfSession(this.e);
    try {
      const pages=temp.open(bytes), count=this.e.FPDF_GetPageCount(this.doc);
      if(count+pages.length>300) throw new Error('合并后最多 300 页。');
      if(!this.e.FPDF_ImportPages(this.doc,temp.doc,'',count)) throw new Error('合并失败。');
      return this.save();
    } finally { temp.close(); }
  }
  duplicate(index) {
    const bytes=this.exportPages([index]),temp=new PdfSession(this.e);
    try {
      if(this.e.FPDF_GetPageCount(this.doc)>=300) throw new Error('最多 300 页。');
      temp.open(bytes);
      if(!this.e.FPDF_ImportPages(this.doc,temp.doc,'1',index+1)) throw new Error('复制页面失败。');
      return this.save();
    } finally { temp.close(); }
  }
  blank(index) {
    if(this.info().length>=300)throw new Error('最多 300 页。');const size=this.info()[index];if(!size)throw new Error('页面不存在。');
    const page=this.e.FPDFPage_New(this.doc,index+1,size.width,size.height);if(!page)throw new Error('空白页创建失败。');this.e.FPDF_ClosePage(page);return this.save();
  }
}

function multiplyMatrix(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function invertMatrix(m){const d=m[0]*m[3]-m[1]*m[2];if(Math.abs(d)<1e-12)throw new Error('页面坐标无效。');return[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}

export function selectChars(chars, rect) {
  return chars.filter(c => c.x+c.width/2 >= rect.x && c.x+c.width/2 <= rect.x+rect.width && c.y+c.height/2 >= rect.y && c.y+c.height/2 <= rect.y+rect.height).map(c => c.id);
}

export function parsePageRange(value,count) {
  if(!value.trim()) return Array.from({length:count},(_,i)=>i);
  const pages=[];
  for(const part of value.replaceAll('，',',').split(',')) {
    const match=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if(!match) throw new Error('页码格式示例：1-3, 5。');
    const start=Number(match[1]),end=Number(match[2]??match[1]);
    if(start<1||end>count||start>end) throw new Error(`页码应在 1–${count} 内，范围从小到大。`);
    for(let n=start;n<=end;n++) if(!pages.includes(n-1)) pages.push(n-1);
  }
  return pages;
}
