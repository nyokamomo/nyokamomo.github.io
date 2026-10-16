import {PDFDocument,StandardFonts,rgb,pushGraphicsState,popGraphicsState,concatTransformationMatrix,setGraphicsState,setLineCap,setLineJoin,setDashPattern,restoreDashPattern,moveTo,lineTo,appendBezierCurve,appendQuadraticCurve,closePath,setLineWidth,setFillingColor,setStrokingColor,fill as fillPath,stroke as strokePath,fillAndStroke} from './pdf-lib.js';
import fontkit from './fontkit.js';
import {arrowHeadSegments,filledArrowShape,lineDashPattern,textSegments} from './objects.mjs';
function color(hex) {return rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));}
function quadraticGeometry(points,w,h) {
  if(points.length!==3)return null;
  const start={x:points[0][0]*w,y:points[0][1]*h},bend={x:points[1][0]*w,y:points[1][1]*h},end={x:points[2][0]*w,y:points[2][1]*h},control={x:2*bend.x-(start.x+end.x)/2,y:2*bend.y-(start.y+end.y)/2};
  return{start,bend,end,control};
}
function quadraticAt({start,control,end},t) {const inverse=1-t;return{x:inverse*inverse*start.x+2*inverse*t*control.x+t*t*end.x,y:inverse*inverse*start.y+2*inverse*t*control.y+t*t*end.y};}
function quadraticStrokeOperators(curve,strokeColor,width,dash,stop=1) {
  const control=stop<1?{x:curve.start.x+(curve.control.x-curve.start.x)*stop,y:curve.start.y+(curve.control.y-curve.start.y)*stop}:curve.control,end=stop<1?quadraticAt(curve,stop):curve.end,operators=[setStrokingColor(strokeColor),setLineWidth(width)];
  const first={x:curve.start.x+(control.x-curve.start.x)*2/3,y:curve.start.y+(control.y-curve.start.y)*2/3},second={x:end.x+(control.x-end.x)*2/3,y:end.y+(control.y-end.y)*2/3};
  if(dash)operators.push(setDashPattern(dash,0));operators.push(moveTo(curve.start.x,curve.start.y),appendBezierCurve(first.x,first.y,second.x,second.y,end.x,end.y),strokePath());if(dash)operators.push(restoreDashPattern());return operators;
}
function arrowHeadForCurve(curve,w,h,lineWidth,variant) {
  const start=[curve.start.x/w,curve.start.y/h],control=[curve.control.x/w,curve.control.y/h],end=[curve.end.x/w,curve.end.y/h];
  if(variant==='arrow-both'||variant==='arrow-dashed-both')return[...arrowHeadSegments(control,end,w,h,lineWidth,1,'arrow-end'),...arrowHeadSegments(control,start,w,h,lineWidth,1,'arrow-end')];
  return arrowHeadSegments(control,end,w,h,lineWidth,1,variant);
}
function roundedPolygon(points,radius) {
  const corners=points.map((point,i)=>{const previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length],incoming=Math.hypot(previous.x-point.x,previous.y-point.y),outgoing=Math.hypot(next.x-point.x,next.y-point.y),distance=Math.min(radius,incoming/2,outgoing/2);return{point,in:{x:point.x+(previous.x-point.x)*distance/incoming,y:point.y+(previous.y-point.y)*distance/incoming},out:{x:point.x+(next.x-point.x)*distance/outgoing,y:point.y+(next.y-point.y)*distance/outgoing}};});
  const operators=[moveTo(corners[0].out.x,corners[0].out.y)];
  for(let step=1;step<=corners.length;step++){const corner=corners[step%corners.length];operators.push(lineTo(corner.in.x,corner.in.y),appendQuadraticCurve(corner.point.x,corner.point.y,corner.out.x,corner.out.y));}
  return[...operators,closePath()];
}
function drawShape(page,o,w,h) {
  const fill=o.fill?.color,stroke=o.stroke?.color;if(!fill&&!stroke)return;
  const paints={...(fill?{color:color(fill)}:{}),...(stroke?{borderColor:color(stroke),borderWidth:o.size}:{})};
  if(o.shape==='ellipse'){page.drawEllipse({x:w/2,y:h/2,xScale:w/2,yScale:h/2,...paints});return;}
  const radius=Math.min(o.cornerRadius??0,w/2,h/2);
  if(o.shape==='rectangle'&&!radius){page.drawRectangle({x:0,y:0,width:w,height:h,...paints});return;}
  const points=o.shape==='triangle'?[{x:w/2,y:0},{x:w,y:h},{x:0,y:h}]:[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}],operators=[setLineJoin(1)];
  if(fill)operators.push(setFillingColor(color(fill)));if(stroke)operators.push(setStrokingColor(color(stroke)),setLineWidth(o.size));operators.push(...roundedPolygon(points,radius),fill&&stroke?fillAndStroke():fill?fillPath():strokePath());page.pushOperators(...operators);
}
export function wrapText(text,font,size,width) {
  const lines=[];
  for(const paragraph of text.split('\n')) {let line='';for(const ch of paragraph){if(line&&font.widthOfTextAtSize(line+ch,size)>width){lines.push(line);line=ch;}else line+=ch;}lines.push(line);}
  return lines;
}
export async function composePdf(bytes,objects,fontBytes) {
  if(!objects.length)return bytes.slice();
  const doc=await PDFDocument.load(bytes);doc.registerFontkit(fontkit);const fonts=new Map(),images=new Map(),pages=doc.getPages(),originalContents=new Map();
  for(const page of pages){page.node.normalize();originalContents.set(page,[...(page.node.Contents()?.asArray?.()??[])]);}
  const standardFont={
    sans:StandardFonts.Helvetica,'sans-bold':StandardFonts.HelveticaBold,'sans-italic':StandardFonts.HelveticaOblique,
    serif:StandardFonts.TimesRoman,'serif-bold':StandardFonts.TimesRomanBold,'serif-italic':StandardFonts.TimesRomanItalic,
    mono:StandardFonts.Courier,'mono-bold':StandardFonts.CourierBold,'mono-italic':StandardFonts.CourierOblique
  };
  async function font(name,forceCjk=false) {
    const key=forceCjk?'cjk':name;
    // This Noto font contains composite outlines that fontkit's subset writer
    // drops. Embed the complete font once per PDF so every CJK glyph renders.
    if(!fonts.has(key))fonts.set(key,key==='cjk'?await doc.embedFont(await fontBytes(),{subset:false}):await doc.embedFont(standardFont[key]??StandardFonts.Helvetica));
    return fonts.get(key);
  }
  async function drawObject(o) {
    const page=doc.getPage(o.page),box=page.getCropBox(),r=((page.getRotation().angle%360)+360)%360;
    const W=r%180?box.height:box.width,H=r%180?box.width:box.height;
    const matrix=r===90?[0,1,1,0,box.x,box.y]:r===180?[-1,0,0,1,box.x+box.width,box.y]:r===270?[0,-1,-1,0,box.x+box.width,box.y+box.height]:[1,0,0,-1,box.x,box.y+box.height];
    const x=o.x*W,y=o.y*H,w=o.width*W,h=o.height*H,a=o.rotation*Math.PI/180;
    const gs=page.node.newExtGState('MatrixOpacity',doc.context.obj({Type:'ExtGState',ca:o.opacity,CA:o.opacity}));
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(...matrix),setGraphicsState(gs),concatTransformationMatrix(1,0,0,1,x+w/2,y+h/2),concatTransformationMatrix(Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0),concatTransformationMatrix(1,0,0,1,-w/2,-h/2));
    if(o.type==='text') {
      const items=[];
      for(const segment of textSegments(o))for(const ch of segment.text){const fontKey=/[^\x20-\x7e\n]/.test(ch)?'cjk':segment.font;items.push({ch,font:await font(segment.font,fontKey==='cjk'),fontKey,size:segment.size,color:segment.color});}
      const lines=[];let line=[],lineWidth=0;
      for(const item of items){if(item.ch==='\n'){lines.push(line);line=[];lineWidth=0;continue;}const width=item.font.widthOfTextAtSize(item.ch,item.size);if(line.length&&lineWidth+width>w){lines.push(line);line=[];lineWidth=0;}line.push({...item,width});lineWidth+=width;}lines.push(line);
      const heights=lines.map(line=>Math.max(o.size,...line.map(item=>item.size))*1.3),total=heights.reduce((sum,value)=>sum+value,0);
      if(total>h+.01)throw new Error('文字框高度不足，请增高文字框或减小字号后导出。');
      let top=0;
      for(let i=0;i<lines.length;i++) {
        const line=lines[i],tw=line.reduce((sum,item)=>sum+item.width,0),tx=o.align==='center'?(w-tw)/2:o.align==='right'?w-tw:0,baseline=top+heights[i]/1.3;let cursor=tx,group=null;
        for(const item of line){const key=`${item.fontKey}|${item.size}|${item.color}`;if(!group||group.key!==key){if(group){page.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,-1,group.x,baseline));page.drawText(group.text,{x:0,y:0,size:group.size,font:group.font,color:color(group.color)});page.pushOperators(popGraphicsState());}group={key,x:cursor,text:item.ch,size:item.size,font:item.font,color:item.color};}else group.text+=item.ch;cursor+=item.width;}
        if(group){page.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,-1,group.x,baseline));page.drawText(group.text,{x:0,y:0,size:group.size,font:group.font,color:color(group.color)});page.pushOperators(popGraphicsState());}
        top+=heights[i];
      }
    } else if(o.type==='image') {
      if(!images.has(o.data))images.set(o.data,o.data.startsWith('data:image/png;')?await doc.embedPng(o.data):await doc.embedJpg(o.data));
      page.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,-1,0,h));page.drawImage(images.get(o.data),{x:0,y:0,width:w,height:h});page.pushOperators(popGraphicsState());
    } else if(o.type==='shape') {
      drawShape(page,o,w,h);
    } else if(o.type==='rect'||o.type==='highlight') {
      page.drawRectangle({x:0,y:0,width:w,height:h,...(o.type==='highlight'?{color:color(o.color)}:{borderColor:color(o.color),borderWidth:o.size})});
    } else {
      page.pushOperators(setLineCap(1),setLineJoin(1));
      const points=o.points??[[0,0],[1,1]],curve=o.type==='arrow'?quadraticGeometry(points,w,h):null,headFrom=curve?[curve.control.x/w,curve.control.y/h]:points[0],dashedArrow=o.lineVariant==='arrow-dashed'||o.lineVariant==='arrow-dashed-both';
      const filled=o.type==='arrow'&&(o.lineStyle??'arrow')==='arrow'?filledArrowShape(headFrom,points.at(-1),w,h,o.size,1,o.lineVariant):null;
      if(curve){
        if(o.lineStyle==='dashed'||dashedArrow)page.pushOperators(...quadraticStrokeOperators(curve,color(o.color),o.size,lineDashPattern(o.size,1,dashedArrow?'dash-even':o.lineVariant)));
        else if(filled){
          const joinStart=filled.shaftEnd??{x:(filled.points[1].x+filled.points.at(-2).x)/2,y:(filled.points[1].y+filled.points.at(-2).y)/2},inset=Math.hypot(curve.end.x-joinStart.x,curve.end.y-joinStart.y),tangent=Math.max(1,Math.hypot(curve.end.x-curve.control.x,curve.end.y-curve.control.y)),stop=Math.max(.05,Math.min(.995,1-inset/(2*tangent))),shaftWidth=filled.includesShaft?Math.max(4,o.size*3.2):o.size;
          page.pushOperators(...quadraticStrokeOperators(curve,color(o.color),shaftWidth,null,stop));
        }else page.pushOperators(...quadraticStrokeOperators(curve,color(o.color),o.size));
      }else if(o.type==='arrow'&&(o.lineStyle==='dashed'||dashedArrow)){
        const dashed=[setStrokingColor(color(o.color)),setLineWidth(o.size),setDashPattern(lineDashPattern(o.size,1,dashedArrow?'dash-even':o.lineVariant),0),moveTo(points[0][0]*w,points[0][1]*h)];
        for(let i=1;i<points.length;i++)dashed.push(lineTo(points[i][0]*w,points[i][1]*h));
        page.pushOperators(...dashed,strokePath(),restoreDashPattern());
      }else if(!filled?.includesShaft)for(let i=1;i<points.length;i++)page.drawLine({start:{x:points[i-1][0]*w,y:points[i-1][1]*h},end:i===points.length-1&&filled?.shaftEnd?filled.shaftEnd:{x:points[i][0]*w,y:points[i][1]*h},thickness:o.size,color:color(o.color)});
      if(o.type==='arrow'&&(o.lineStyle??'arrow')==='arrow')for(const segment of curve?arrowHeadForCurve(curve,w,h,o.size,o.lineVariant):arrowHeadSegments(points[0],points.at(-1),w,h,o.size,1,o.lineVariant))page.drawLine({...segment,thickness:o.size,color:color(o.color)});
      if(filled){const polygon=curve&&filled.includesShaft?filled.points.slice(1,-1):filled.points,[first,...rest]=polygon,operators=[setFillingColor(color(o.color)),moveTo(first.x,first.y),...rest.map(point=>lineTo(point.x,point.y)),closePath(),fillPath()];page.pushOperators(...operators);}
    }
    page.pushOperators(popGraphicsState());
  }
  for(const o of objects.filter(o=>o.placement==='under'))await drawObject(o);
  const underStreams=new Map();
  for(const page of pages)if(page.contentStreamRef){underStreams.set(page,page.contentStreamRef);delete page.contentStream;delete page.contentStreamRef;}
  for(const o of objects.filter(o=>o.placement!=='under'))await drawObject(o);
  for(const [page,under] of underStreams){
    const contents=page.node.Contents(),over=page.contentStreamRef,ordered=[under,...originalContents.get(page),...(over?[over]:[])];
    while(contents.size())contents.remove(0);for(const ref of ordered)contents.push(ref);
  }
  const result=await doc.save();if(result.length>64*1024*1024)throw new Error('导出文件超过 64 MiB，请减少图片或拆分文档。');return result;
}
