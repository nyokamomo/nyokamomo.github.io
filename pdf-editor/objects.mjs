export const TYPES=['text','image','pen','highlight','rect','shape','arrow'];
export const TEXT_FONT_FAMILIES=['noto-sans-sc','noto-serif-sc','noto-sans-jp','noto-serif-jp','noto-sans-kr','noto-serif-kr','sans','serif','mono'];
export const TEXT_FONTS=[...TEXT_FONT_FAMILIES,'sans-bold','sans-italic','serif-bold','serif-italic','mono-bold','mono-italic'];
export function normalizeTextStyle(value={}) {
  const legacy=String(value.font??'sans'),bold=legacy.endsWith('-bold'),italic=legacy.endsWith('-italic'),font=bold||italic?legacy.replace(/-(bold|italic)$/,''):legacy;
  return{font:TEXT_FONT_FAMILIES.includes(font)?font:'sans',size:value.size,color:value.color,bold:value.bold===undefined?bold:!!value.bold,italic:value.italic===undefined?italic:!!value.italic,underline:!!value.underline,letterSpacing:Number.isFinite(value.letterSpacing)?value.letterSpacing:0};
}
export function textSizeFromGlyphs(glyphs,fallback=20,pageHeight=800) {
  const exact=(glyphs??[]).map(glyph=>glyph.fontSize).filter(value=>Number.isFinite(value)&&value>0);
  const measured=(glyphs??[]).map(glyph=>glyph.raw?.length>=4?Math.abs(glyph.raw[1]-glyph.raw[3]):glyph.height*pageHeight).filter(value=>Number.isFinite(value)&&value>0);
  const values=(exact.length?exact:measured.map(value=>value*.9)).sort((a,b)=>a-b);
  if(!values.length)return fallback;
  const middle=Math.floor(values.length/2),median=values.length%2?values[middle]:(values[middle-1]+values[middle])/2;
  return Math.max(1,Math.min(160,median));
}
export function objectBounds(o,size) {
  const cx=(o.x+o.width/2)*size.width,cy=(o.y+o.height/2)*size.height,a=o.rotation*Math.PI/180;
  const w=Math.abs(Math.cos(a))*o.width*size.width+Math.abs(Math.sin(a))*o.height*size.height;
  const h=Math.abs(Math.sin(a))*o.width*size.width+Math.abs(Math.cos(a))*o.height*size.height;
  return {x:(cx-w/2)/size.width,y:(cy-h/2)/size.height,width:w/size.width,height:h/size.height};
}
export function selectionBounds(objects,size) {
  if(!objects?.length||!size?.width||!size?.height)return null;
  const bounds=objects.map(object=>objectBounds(object,size)),left=Math.min(...bounds.map(bound=>bound.x)),top=Math.min(...bounds.map(bound=>bound.y)),right=Math.max(...bounds.map(bound=>bound.x+bound.width)),bottom=Math.max(...bounds.map(bound=>bound.y+bound.height));
  return{x:left,y:top,width:right-left,height:bottom-top};
}
const RESIZE_HANDLES=['n','ne','e','se','s','sw','w','nw'];
export function resizeObject(object,size,point,handle,proportional=false) {
  if(!RESIZE_HANDLES.includes(handle)||!size?.width||!size?.height)return object;
  const W=size.width,H=size.height,a=object.rotation*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
  const cx=(object.x+object.width/2)*W,cy=(object.y+object.height/2)*H,dx=point.x*W-cx,dy=point.y*H-cy;
  const localX=cos*dx+sin*dy,localY=-sin*dx+cos*dy,minW=W*.01,minH=H*.01;
  let left=-object.width*W/2,right=object.width*W/2,top=-object.height*H/2,bottom=object.height*H/2;
  if(handle.includes('e'))right=Math.max(left+minW,localX);
  if(handle.includes('w'))left=Math.min(right-minW,localX);
  if(handle.includes('s'))bottom=Math.max(top+minH,localY);
  if(handle.includes('n'))top=Math.min(bottom-minH,localY);
  if(proportional){
    const originalWidth=object.width*W,originalHeight=object.height*H,sx=(right-left)/originalWidth,sy=(bottom-top)/originalHeight,minScale=Math.max(minW/originalWidth,minH/originalHeight);
    const scale=Math.max(minScale,handle.length===2?(Math.abs(sx-1)>=Math.abs(sy-1)?sx:sy):handle.includes('e')||handle.includes('w')?sx:sy),width=originalWidth*scale,height=originalHeight*scale;
    if(handle.includes('e'))right=left+width;else if(handle.includes('w'))left=right-width;else{left=-width/2;right=width/2;}
    if(handle.includes('s'))bottom=top+height;else if(handle.includes('n'))top=bottom-height;else{top=-height/2;bottom=height/2;}
  }
  const width=right-left,height=bottom-top,localCx=(left+right)/2,localCy=(top+bottom)/2;
  const nextCx=cx+cos*localCx-sin*localCy,nextCy=cy+sin*localCx+cos*localCy;
  return {...object,x:(nextCx-width/2)/W,y:(nextCy-height/2)/H,width:width/W,height:height/H};
}
export function objectPointerAngle(object,size,point) {
  const cx=(object.x+object.width/2)*size.width,cy=(object.y+object.height/2)*size.height;
  return Math.atan2(point.y*size.height-cy,point.x*size.width-cx)*180/Math.PI;
}
export function angleDelta(from,to) {return Math.atan2(Math.sin((to-from)*Math.PI/180),Math.cos((to-from)*Math.PI/180))*180/Math.PI;}
export function normalizeRotation(value) {const result=((value%360)+540)%360-180;return Math.abs(result)<1e-10?0:result;}
export function resizeCursor(handle,rotation=0) {
  const base={e:0,w:0,se:45,nw:45,n:90,s:90,ne:135,sw:135}[handle];if(base===undefined)return'default';
  const bucket=Math.round((((base+rotation)%180)+180)%180/45)%4;return['ew-resize','nwse-resize','ns-resize','nesw-resize'][bucket];
}
export function constrainShapePoint(start,point,size) {
  if(!size?.width||!size?.height)return point;
  const dx=(point.x-start.x)*size.width,dy=(point.y-start.y)*size.height,signX=dx<0?-1:1,signY=dy<0?-1:1;
  const limitX=(signX<0?start.x:1-start.x)*size.width,limitY=(signY<0?start.y:1-start.y)*size.height,side=Math.min(Math.max(Math.abs(dx),Math.abs(dy)),limitX,limitY);
  return{x:start.x+signX*side/size.width,y:start.y+signY*side/size.height};
}
export function snapLinePoint(start,point,size) {
  if(!size?.width||!size?.height)return point;
  const dx=(point.x-start.x)*size.width,dy=(point.y-start.y)*size.height,length=Math.hypot(dx,dy);
  if(!length)return start;
  const step=Math.PI/12,angle=Math.round(Math.atan2(dy,dx)/step)*step,ux=Math.cos(angle),uy=Math.sin(angle),limits=[];
  if(Math.abs(ux)>.000001)limits.push(((ux>0?1-start.x:start.x)*size.width)/Math.abs(ux));
  if(Math.abs(uy)>.000001)limits.push(((uy>0?1-start.y:start.y)*size.height)/Math.abs(uy));
  const distance=Math.min(length,...limits);
  return{x:start.x+ux*distance/size.width,y:start.y+uy*distance/size.height};
}
function stabilizePenPoints(points) {
  let current=points;
  for(let pass=0;pass<4&&current.length>2;pass++){
    const next=[current[0]];
    for(let i=1;i<current.length-1;i++){
      const before=current[i-1],point=current[i],after=current[i+1];
      next.push({x:(before.x+point.x*2+after.x)/4,y:(before.y+point.y*2+after.y)/4});
    }
    next.push(current.at(-1));current=next;
  }
  return current;
}
function pointDistanceToSegment(point,start,end) {
  const dx=end.x-start.x,dy=end.y-start.y,lengthSquared=dx*dx+dy*dy;
  if(!lengthSquared)return Math.hypot(point.x-start.x,point.y-start.y);
  const position=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/lengthSquared)),x=start.x+dx*position,y=start.y+dy*position;
  return Math.hypot(point.x-x,point.y-y);
}
function simplifyPenPoints(points,tolerance) {
  if(points.length<=2)return points;
  const keep=new Uint8Array(points.length),stack=[[0,points.length-1]];keep[0]=1;keep[points.length-1]=1;
  while(stack.length){const [start,end]=stack.pop();let furthest=-1,distance=0;for(let i=start+1;i<end;i++){const next=pointDistanceToSegment(points[i],points[start],points[end]);if(next>distance){distance=next;furthest=i;}}if(furthest>=0&&distance>tolerance){keep[furthest]=1;stack.push([start,furthest],[furthest,end]);}}
  return points.filter((_,index)=>keep[index]);
}
function cappedControl(origin,target,limit) {
  const dx=target.x-origin.x,dy=target.y-origin.y,distance=Math.hypot(dx,dy),scale=distance>limit?limit/distance:1;
  return{x:origin.x+dx*scale,y:origin.y+dy*scale};
}
export function smoothPenGeometry(points,width=1,height=1,tolerance=2.5) {
  const scaled=[];
  for(const point of points??[]){const next={x:point[0]*width,y:point[1]*height},previous=scaled.at(-1);if(!previous||Math.hypot(next.x-previous.x,next.y-previous.y)>.2)scaled.push(next);}
  if(scaled.length<2)return null;
  const knots=simplifyPenPoints(stabilizePenPoints(scaled),Math.max(.5,tolerance));
  if(knots.length===2)return{start:knots[0],curves:[],end:knots[1],points:knots};
  const curves=[],tension=.85/6;
  for(let i=0;i<knots.length-1;i++){
    const previous=knots[i-1]??knots[i],start=knots[i],end=knots[i+1],next=knots[i+2]??end,segmentLength=Math.hypot(end.x-start.x,end.y-start.y),limit=segmentLength*.42;
    const cp1=cappedControl(start,{x:start.x+(end.x-previous.x)*tension,y:start.y+(end.y-previous.y)*tension},limit),cp2=cappedControl(end,{x:end.x-(next.x-start.x)*tension,y:end.y-(next.y-start.y)*tension},limit);
    curves.push({cp1,cp2,end});
  }
  return{start:knots[0],curves,end:knots.at(-1),points:knots};
}
function linePagePoints(object,size) {
  const path=object.points??[[0,0],[1,1]];
  if(!size?.width||!size?.height)return path.map(point=>({x:object.x+point[0]*object.width,y:object.y+point[1]*object.height}));
  const W=size.width,H=size.height,cx=(object.x+object.width/2)*W,cy=(object.y+object.height/2)*H,a=object.rotation*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
  return path.map(point=>{const x=(object.x+point[0]*object.width)*W,y=(object.y+point[1]*object.height)*H,dx=x-cx,dy=y-cy;return{x:(cx+cos*dx-sin*dy)/W,y:(cy+sin*dx+cos*dy)/H};});
}
const midpoint=(start,end)=>({x:(start.x+end.x)/2,y:(start.y+end.y)/2});
const quadraticPoint=(start,control,end,t)=>{const inverse=1-t;return{x:inverse*inverse*start.x+2*inverse*t*control.x+t*t*end.x,y:inverse*inverse*start.y+2*inverse*t*control.y+t*t*end.y};};
export function lineCurveGeometry(object,size) {
  const path=linePagePoints(object,size),start=path[0],end=path.at(-1),curved=path.length===3,bend=curved?path[1]:midpoint(start,end),control=curved?{x:2*bend.x-(start.x+end.x)/2,y:2*bend.y-(start.y+end.y)/2}:bend;
  return{start,bend,end,control,curved};
}
export function lineEndpoints(object,size) {const {start,end}=lineCurveGeometry(object,size);return[start,end];}
function curveBounds(points) {
  const values=[...points];
  if(points.length===3){const [start,bend,end]=points,control={x:2*bend.x-(start.x+end.x)/2,y:2*bend.y-(start.y+end.y)/2};for(const axis of ['x','y']){const divisor=start[axis]-2*control[axis]+end[axis];if(Math.abs(divisor)<1e-12)continue;const t=(start[axis]-control[axis])/divisor;if(t>0&&t<1)values.push(quadraticPoint(start,control,end,t));}}
  return{x1:Math.min(...values.map(point=>point.x)),y1:Math.min(...values.map(point=>point.y)),x2:Math.max(...values.map(point=>point.x)),y2:Math.max(...values.map(point=>point.y))};
}
function lineObjectFromPagePoints(object,points) {
  const bounds=curveBounds(points),rawWidth=bounds.x2-bounds.x1,rawHeight=bounds.y2-bounds.y1,width=Math.max(.003,rawWidth),height=Math.max(.003,rawHeight),x=rawWidth<.003?(bounds.x1+bounds.x2-width)/2:bounds.x1,y=rawHeight<.003?(bounds.y1+bounds.y2-height)/2:bounds.y1,local=pagePoint=>[(pagePoint.x-x)/width,(pagePoint.y-y)/height];
  return{...object,x,y,width,height,rotation:0,points:points.map(local)};
}
export function lineObjectFromEndpoints(object,start,end) {return lineObjectFromPagePoints(object,[start,end]);}
export function reshapeLineBend(object,size,point) {
  if(!size?.width||!size?.height)return object;
  const [start,end]=lineEndpoints(object,size),bend={x:Math.max(-3,Math.min(3,point.x)),y:Math.max(-3,Math.min(3,point.y))};
  return lineObjectFromPagePoints(object,[start,bend,end]);
}
export function reshapeLineEndpoint(object,size,endpoint,point,snap=false) {
  if(!size?.width||!size?.height||!['start','end'].includes(endpoint))return object;
  const path=linePagePoints(object,size),current=[path[0],path.at(-1)],fixed=current[endpoint==='start'?1:0],limited={x:Math.max(-3,Math.min(3,fixed.x+Math.max(-3,Math.min(3,point.x-fixed.x)))),y:Math.max(-3,Math.min(3,fixed.y+Math.max(-3,Math.min(3,point.y-fixed.y))))},next=snap?snapLinePoint(fixed,limited,size):limited;
  if(Math.hypot((next.x-fixed.x)*size.width,(next.y-fixed.y)*size.height)<.5)return object;
  path[endpoint==='start'?0:path.length-1]=next;
  return lineObjectFromPagePoints(object,path);
}
export function resizeObjects(objects,size,point,handle,proportional=false) {
  const bounds=selectionBounds(objects,size);if(!bounds)return objects;
  const next=resizeObject({...bounds,rotation:0},size,point,handle,proportional),scaleX=next.width/bounds.width,scaleY=next.height/bounds.height,mapPoint=p=>({x:next.x+(p.x-bounds.x)*scaleX,y:next.y+(p.y-bounds.y)*scaleY});
  return objects.map(object=>{
    if(object.type==='arrow')return lineObjectFromPagePoints(object,linePagePoints(object,size).map(mapPoint));
    const center=mapPoint({x:object.x+object.width/2,y:object.y+object.height/2}),width=object.width*scaleX,height=object.height*scaleY;
    return{...object,x:center.x-width/2,y:center.y-height/2,width,height};
  });
}
export function resizeObjectGroup(objects,size,point,handle,frame,proportional=false) {
  const base=frame??selectionBounds(objects,size);if(!base||!size?.width||!size?.height)return{objects,frame:base};
  const rotation=base.rotation??0,next=resizeObject({...base,rotation},size,point,handle,proportional),W=size.width,H=size.height,a=rotation*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),oldCx=(base.x+base.width/2)*W,oldCy=(base.y+base.height/2)*H,newCx=(next.x+next.width/2)*W,newCy=(next.y+next.height/2)*H,scaleX=next.width/base.width,scaleY=next.height/base.height;
  const mapPoint=p=>{const dx=p.x*W-oldCx,dy=p.y*H-oldCy,localX=cos*dx+sin*dy,localY=-sin*dx+cos*dy,x=localX*scaleX,y=localY*scaleY;return{x:(newCx+cos*x-sin*y)/W,y:(newCy+sin*x+cos*y)/H};};
  const resized=objects.map(object=>{
    if(object.type==='arrow')return lineObjectFromPagePoints(object,linePagePoints(object,size).map(mapPoint));
    const center=mapPoint({x:object.x+object.width/2,y:object.y+object.height/2}),relative=(object.rotation-rotation)*Math.PI/180,widthScale=Math.hypot(scaleX*Math.cos(relative),scaleY*Math.sin(relative)),heightScale=Math.hypot(scaleX*Math.sin(relative),scaleY*Math.cos(relative)),nextRelative=Math.atan2(scaleY*Math.sin(relative),scaleX*Math.cos(relative))*180/Math.PI,width=object.width*widthScale,height=object.height*heightScale;
    return{...object,x:center.x-width/2,y:center.y-height/2,width,height,rotation:normalizeRotation(rotation+nextRelative)};
  });
  return{objects:resized,frame:{...base,x:next.x,y:next.y,width:next.width,height:next.height,rotation}};
}
export function selectionPointerAngle(objects,size,point) {
  const bounds=selectionBounds(objects,size);if(!bounds)return 0;
  return Math.atan2((point.y-bounds.y-bounds.height/2)*size.height,(point.x-bounds.x-bounds.width/2)*size.width)*180/Math.PI;
}
export function rotateObjectGroup(objects,size,degrees,center) {
  const bounds=center?null:selectionBounds(objects,size);if((!bounds&&!center)||Math.abs(degrees)<1e-12)return objects;
  const W=size.width,H=size.height,cx=(center?.x??bounds.x+bounds.width/2)*W,cy=(center?.y??bounds.y+bounds.height/2)*H,a=degrees*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a),rotatePoint=point=>{const dx=point.x*W-cx,dy=point.y*H-cy;return{x:(cx+cos*dx-sin*dy)/W,y:(cy+sin*dx+cos*dy)/H};};
  return objects.map(object=>{
    if(object.type==='arrow')return lineObjectFromPagePoints(object,linePagePoints(object,size).map(rotatePoint));
    const center=rotatePoint({x:object.x+object.width/2,y:object.y+object.height/2});
    return{...object,x:center.x-object.width/2,y:center.y-object.height/2,rotation:normalizeRotation(object.rotation+degrees)};
  });
}
export function lineDashPattern(size,scale=1,variant='dash-even') {
  if(variant==='dash-long')return[Math.max(11,size*6)*scale,Math.max(4,size*2)*scale];
  if(variant==='dash-dot')return[Math.max(9,size*5)*scale,Math.max(3,size*1.5)*scale,Math.max(1.3,size*.75)*scale,Math.max(3,size*1.5)*scale];
  if(variant==='dash-dotted')return[Math.max(1,size*.35)*scale,Math.max(5,size*2.6)*scale];
  if(variant==='dash-short')return[Math.max(3,size*1.5)*scale,Math.max(3,size*1.4)*scale];
  if(variant==='dash-double')return[Math.max(11,size*5.5)*scale,Math.max(3,size*1.5)*scale,Math.max(3,size*1.6)*scale,Math.max(3,size*1.5)*scale];
  return[Math.max(5,size*3)*scale,Math.max(4,size*2)*scale];
}
export function arrowHeadSegments(first,last,width,height,lineWidth,unitScale=1,variant='arrow-end') {
  const head=(from,to,spread=.5,lengthScale=1)=>{const x=to[0]*width,y=to[1]*height,angle=Math.atan2((to[1]-from[1])*height,(to[0]-from[0])*width),length=Math.max(10*unitScale,lineWidth*4)*lengthScale;return[-1,1].map(sign=>({start:{x,y},end:{x:x-length*Math.cos(angle+sign*spread),y:y-length*Math.sin(angle+sign*spread)}}));};
  if(['arrow-filled','arrow-block','arrow-notch'].includes(variant))return[];
  if(variant==='arrow-both'||variant==='arrow-dashed-both')return[...head(first,last),...head(last,first)];
  if(variant==='arrow-wide')return head(first,last,.72,1.2);
  return head(first,last);
}
export function filledArrowShape(first,last,width,height,lineWidth,unitScale=1,variant='arrow-end') {
  if(!['arrow-filled','arrow-block','arrow-notch'].includes(variant))return null;
  const start={x:first[0]*width,y:first[1]*height},end={x:last[0]*width,y:last[1]*height},dx=end.x-start.x,dy=end.y-start.y,distance=Math.hypot(dx,dy);
  if(distance<.01)return null;
  const ux=dx/distance,uy=dy/distance,nx=-uy,ny=ux,point=(back,side)=>({x:end.x-ux*back+nx*side,y:end.y-uy*back+ny*side});
  if(variant==='arrow-filled'){
    const length=Math.min(Math.max(13*unitScale,lineWidth*5),distance*.75),half=Math.max(7*unitScale,lineWidth*2.5);
    return{includesShaft:false,shaftEnd:point(length*.55,0),points:[point(length,half),end,point(length,-half)]};
  }
  const length=Math.min(Math.max((variant==='arrow-notch'?22:18)*unitScale,lineWidth*(variant==='arrow-notch'?7:6)),distance*.75),headHalf=Math.max((variant==='arrow-notch'?10:9)*unitScale,lineWidth*3),shaftHalf=Math.max(2*unitScale,lineWidth*1.6),startTop={x:start.x+nx*shaftHalf,y:start.y+ny*shaftHalf},startBottom={x:start.x-nx*shaftHalf,y:start.y-ny*shaftHalf};
  if(variant==='arrow-notch')return{includesShaft:true,points:[startTop,point(length*.62,shaftHalf),point(length,headHalf),end,point(length,-headHalf),point(length*.62,-shaftHalf),startBottom]};
  return{includesShaft:true,points:[startTop,point(length,shaftHalf),point(length,headHalf),end,point(length,-headHalf),point(length,-shaftHalf),startBottom]};
}
export function validateObjects(input,count) {
  if(!Array.isArray(input)||input.length>1000)throw new Error('新增内容最多 1000 个。');
  const ids=new Set();let images=0,points=0,text=0;const seenImages=new Set();
  return input.map(o=> {
    if(!o||typeof o!=='object'||!TYPES.includes(o.type)||typeof o.id!=='string'||o.id.length>100||ids.has(o.id)||!Number.isInteger(o.page)||o.page<0||o.page>=count)throw new Error('工程内的对象或页码无效。');
    ids.add(o.id);
    for(const k of ['x','y','width','height','rotation','opacity','size'])if(!Number.isFinite(o[k]))throw new Error('对象尺寸和参数必须是有效数字。');
    if(Math.abs(o.x)>3||Math.abs(o.y)>3||o.width<=0||o.height<=0||o.width>3||o.height>3||o.opacity<0||o.opacity>1||o.size<.1||o.size>160||Math.abs(o.rotation)>36000||!/^#[0-9a-f]{6}$/i.test(o.color))throw new Error('对象参数超出允许范围。');
    if(o.placement!==undefined&&!['under','over'].includes(o.placement))throw new Error('对象层级无效。');
    const result={id:o.id,page:o.page,type:o.type,x:o.x,y:o.y,width:o.width,height:o.height,rotation:o.rotation%360,opacity:o.opacity,size:o.size,color:o.color};if(o.placement)result.placement=o.placement;
    if(o.type==='text') {
      if(typeof o.text!=='string'||o.text.length>10000||!TEXT_FONTS.includes(o.font)||!['left','center','right'].includes(o.align)||['bold','italic','underline'].some(key=>o[key]!==undefined&&typeof o[key]!=='boolean')||(o.letterSpacing!==undefined&&(!Number.isFinite(o.letterSpacing)||o.letterSpacing< -20||o.letterSpacing>100))||(o.lineHeight!==undefined&&(!Number.isFinite(o.lineHeight)||o.lineHeight<.5||o.lineHeight>5)))throw new Error('文字或字体设置无效。');
      text+=o.text.length;if(text>200000)throw new Error('新增文字总量过大，请拆分工程。');
      const value=o.text.replace(/\r\n?/g,'\n').replace(/\t/g,'    '),runs=o.runs??[],baseStyle=normalizeTextStyle(o);
      if(!Array.isArray(runs)||runs.length>2000)throw new Error('文字局部样式过多。');
      const cleanRuns=runs.map(run=>{if(!run||!Number.isInteger(run.start)||!Number.isInteger(run.end)||run.start<0||run.start>=run.end||run.end>value.length||!TEXT_FONTS.includes(run.font)||!Number.isFinite(run.size)||run.size<1||run.size>160||!/^#[0-9a-f]{6}$/i.test(run.color)||['bold','italic','underline'].some(key=>run[key]!==undefined&&typeof run[key]!=='boolean')||(run.letterSpacing!==undefined&&(!Number.isFinite(run.letterSpacing)||run.letterSpacing< -20||run.letterSpacing>100)))throw new Error('文字局部样式无效。');const style=normalizeTextStyle(run);return{start:run.start,end:run.end,font:style.font,size:style.size,color:style.color,...(style.bold?{bold:true}:{}),...(style.italic?{italic:true}:{}),...(style.underline?{underline:true}:{}),...(style.letterSpacing?{letterSpacing:style.letterSpacing}:{})};}).sort((a,b)=>a.start-b.start||a.end-b.end);
      if(cleanRuns.some((run,i)=>i>0&&run.start<cleanRuns[i-1].end))throw new Error('文字局部样式范围重叠。');
      Object.assign(result,{text:value,font:baseStyle.font,align:o.align,...(baseStyle.bold?{bold:true}:{}),...(baseStyle.italic?{italic:true}:{}),...(baseStyle.underline?{underline:true}:{}),...(baseStyle.letterSpacing?{letterSpacing:baseStyle.letterSpacing}:{}),...(o.lineHeight!==undefined&&o.lineHeight!==1.3?{lineHeight:o.lineHeight}:{}),...(cleanRuns.length?{runs:cleanRuns}:{})});
    }
    if(o.type==='image') {
      if(typeof o.data!=='string'||!/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/]+=*$/.test(o.data)||o.data.length>9*1024*1024)throw new Error('图片数据无效，单张最多 6 MiB。');
      if(!seenImages.has(o.data)){images+=o.data.length;seenImages.add(o.data);}
      if(images>32*1024*1024)throw new Error('图片总量过大，请减少图片后重试。');result.data=o.data;
    }
    if(o.type==='shape') {
      if(!['rectangle','triangle','ellipse'].includes(o.shape)||!Number.isFinite(o.cornerRadius??0)||(o.cornerRadius??0)<0||(o.cornerRadius??0)>160)throw new Error('图形类型或圆角参数无效。');
      const paint=value=>{if(value===null||value===undefined)return null;if(typeof value!=='object'||!/^#[0-9a-f]{6}$/i.test(value.color))throw new Error('图形填充或描边颜色无效。');return{color:value.color,opacity:1};};
      const fill=paint(o.fill),stroke=paint(o.stroke);if(!fill&&!stroke)throw new Error('图形至少需要填充或描边。');
      Object.assign(result,{shape:o.shape,cornerRadius:o.shape==='ellipse'?0:o.cornerRadius??0,fill,stroke});
    }
    if(o.type==='pen'||o.type==='arrow') {
      const path=o.points??(o.type==='arrow'?[[0,0],[1,1]]:null);
      if(!Array.isArray(path)||path.length<2||path.length>10000||path.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('笔迹数据无效。');
      points+=path.length;if(points>100000)throw new Error('笔迹总量过大，请拆分工程。');
      result.points=path.map(p=>[...p]);
      if(o.type==='pen'){
        if(o.penMode!==undefined&&!['fill','line'].includes(o.penMode))throw new Error('画笔模式无效。');
        result.penMode=o.penMode??'fill';
      }
      if(o.type==='arrow'){
        if(o.lineStyle!==undefined&&!['arrow','dashed','solid'].includes(o.lineStyle))throw new Error('线段种类无效。');
        result.lineStyle=o.lineStyle??'arrow';
        const variants=result.lineStyle==='arrow'?['arrow-end','arrow-both','arrow-wide','arrow-filled','arrow-block','arrow-notch','arrow-dashed','arrow-dashed-both']:result.lineStyle==='dashed'?['dash-even','dash-long','dash-dot','dash-dotted','dash-short','dash-double']:[];
        if(o.lineVariant!==undefined&&!variants.includes(o.lineVariant))throw new Error('线段样式无效。');
        if(variants.length)result.lineVariant=o.lineVariant??variants[0];
      }
    }
    return result;
  });
}
export function rotateObjects(objects,page,oldSize) {
  return objects.map(o=>{if(o.page!==page)return o;const cx=1-o.y-o.height/2,cy=o.x+o.width/2,w=o.width*oldSize.width/oldSize.height,h=o.height*oldSize.height/oldSize.width;return {...o,x:cx-w/2,y:cy-h/2,width:w,height:h,rotation:o.rotation+90};});
}
export function selectionText(chars,ids) {
  const selected=new Set(ids),sorted=[...selected].sort((a,b)=>a-b);if(!sorted.length)return '';
  return chars.filter(c=>selected.has(c.id)||(c.id>sorted[0]&&c.id<sorted.at(-1)&&/^\s+$/.test(c.value))).map(c=>c.value).join('');
}
export function textParagraphs(chars,textChars) {
  if(!chars.length)return [];
  const ordered=[...chars].sort((a,b)=>a.id-b.id),values=new Map(textChars.map(c=>[c.id,c.value]));
  const between=(a,b)=>{let value='';for(let id=a+1;id<b;id++)value+=values.get(id)??'';return value;};
  const lines=[];let current=[];
  for(const glyph of ordered) {
    const previous=current.at(-1),separator=previous?between(previous.id,glyph.id):'';
    const sameLine=!previous||(!/[\r\n]/.test(separator)&&Math.abs((glyph.y+glyph.height/2)-(previous.y+previous.height/2))<=Math.max(glyph.height,previous.height)*.72);
    if(!sameLine&&current.length){lines.push(current);current=[];}
    current.push(glyph);
  }
  if(current.length)lines.push(current);
  const bounds=list=>{const left=Math.min(...list.map(c=>c.x)),top=Math.min(...list.map(c=>c.y)),right=Math.max(...list.map(c=>c.x+c.width)),bottom=Math.max(...list.map(c=>c.y+c.height));return{x:left,y:top,width:right-left,height:bottom-top};};
  const groups=[];current=[];
  for(const line of lines) {
    const previous=current.at(-1),a=bounds(line),b=previous?bounds(previous):null,separator=previous?between(previous.at(-1).id,line[0].id):'';
    const paragraphBreak=!!previous&&((separator.match(/\r\n|[\r\n]/g)?.length??0)>1||a.y<b.y-b.height*.5||a.y-(b.y+b.height)>Math.max(a.height,b.height)*.95||a.x>b.x+b.width+.04||b.x>a.x+a.width+.04);
    if(paragraphBreak&&current.length){groups.push(current.flat());current=[];}
    current.push(line);
  }
  if(current.length)groups.push(current.flat());
  return groups.map(group=>{const box=bounds(group),ids=group.map(c=>c.id),idSet=new Set(ids),first=Math.min(...ids),last=Math.max(...ids);let text='';for(let id=first;id<=last;id++){const value=values.get(id)??'';if(idSet.has(id)||/^\s+$/.test(value))text+=value;}return{...box,ids,text:text.replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n').trim()};}).filter(p=>p.text);
}
const sameStyle=(a,b)=>a.font===b.font&&a.size===b.size&&a.color===b.color&&a.bold===b.bold&&a.italic===b.italic&&a.underline===b.underline&&a.letterSpacing===b.letterSpacing;
export function textStyleAt(object,index) {const run=object.runs?.find(item=>index>=item.start&&index<item.end);return normalizeTextStyle(run??object);}
function stylesToRuns(styles,object) {
  const base=normalizeTextStyle(object),runs=[];let start=0;
  while(start<styles.length){let end=start+1;while(end<styles.length&&sameStyle(styles[start],styles[end]))end++;if(!sameStyle(styles[start],base)){const style=styles[start];runs.push({start,end,font:style.font,size:style.size,color:style.color,...(style.bold?{bold:true}:{}),...(style.italic?{italic:true}:{}),...(style.underline?{underline:true}:{}),...(style.letterSpacing?{letterSpacing:style.letterSpacing}:{})});}start=end;}
  return runs;
}
export function textSegments(object) {
  const text=object.text??'',boundaries=new Set([0,text.length]);for(const run of object.runs??[]){boundaries.add(run.start);boundaries.add(run.end);}const points=[...boundaries].sort((a,b)=>a-b),segments=[];
  for(let i=1;i<points.length;i++){const start=points[i-1],end=points[i];if(end>start)segments.push({start,end,text:text.slice(start,end),...textStyleAt(object,start)});}
  return segments;
}
export function styleTextRange(object,start,end,patch) {
  const length=object.text?.length??0;start=Math.max(0,Math.min(length,start));end=Math.max(start,Math.min(length,end));
  if(start===end){const next={...object,...patch};return{...next,runs:(object.runs??[]).map(run=>({...run,...patch}))};}
  const styles=Array.from({length},(_,i)=>i>=start&&i<end?{...textStyleAt(object,i),...patch}:textStyleAt(object,i));return{...object,runs:stylesToRuns(styles,object)};
}
export function replaceTextContent(object,value,start,end) {
  const old=object.text??'',next=value.replace(/\r\n?/g,'\n').replace(/\t/g,'    ');start=Math.max(0,Math.min(old.length,start));end=Math.max(start,Math.min(old.length,end));
  let from=0;while(from<old.length&&from<next.length&&old[from]===next[from])from++;
  let suffix=0;while(suffix<old.length-from&&suffix<next.length-from&&old[old.length-1-suffix]===next[next.length-1-suffix])suffix++;
  const to=old.length-suffix,inserted=next.length-from-suffix,styles=Array.from({length:old.length},(_,i)=>textStyleAt(object,i));
  const selected=end>start,inherit=selected?Math.min(start,Math.max(0,old.length-1)):Math.max(0,Math.min(old.length-1,from-1)),fallback=textStyleAt(object,inherit),nextStyles=[...styles.slice(0,from),...Array.from({length:inserted},()=>fallback),...styles.slice(to)];
  return{...object,text:next,runs:stylesToRuns(nextStyles,object)};
}
export function shortcut(event) {
  if(event.isComposing||event.altKey)return null;
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
  if(mod) {
    if(key==='z')return event.shiftKey?'redo':'undo';if(key==='y')return 'redo';
    if(key==='s')return event.shiftKey?'export':'project';if(key==='o')return 'open';if(key==='n')return 'new';if(key==='d')return 'duplicate';if(key==='a')return 'selectAll';
    if(key==='='||key==='+')return 'zoomIn';if(key==='-')return 'zoomOut';if(key==='0')return 'fit';
  }
  if(key==='escape')return 'escape';if(key==='delete'||key==='backspace')return 'delete';
  if(['arrowleft','arrowright','arrowup','arrowdown'].includes(key)&&!mod)return 'nudge';
  return null;
}
export function nativeTextEditing(control={}) {
  if(control.isContentEditable)return true;
  const tag=String(control.tagName??'').toLowerCase();
  if(tag==='textarea')return true;
  return tag==='input'&&['text','search','email','url','tel','password','number'].includes(String(control.type??'text').toLowerCase());
}
export function encodeBase64(bytes) {let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
export function decodeBase64(value) {if(typeof value!=='string'||value.length>86*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('工程 PDF 数据无效。');const s=atob(value);return Uint8Array.from(s,c=>c.charCodeAt(0));}
export function readProject(value) {
  if(!value||value.schema!=='nyokore.pdf-matrix'||value.version!==1)throw new Error('请选择 PDF重塑矩阵 保存的工程文件。');
  const bytes=decodeBase64(value.pdf);if(!bytes.length||bytes.length>64*1024*1024)throw new Error('工程 PDF 超过 64 MiB。');
  const meta=value.meta??{};
  return {bytes,objects:value.objects,meta:{sourceName:typeof meta.sourceName==='string'?meta.sourceName.slice(0,160):'工程文档.pdf',name:typeof meta.name==='string'?meta.name.slice(0,160):'文档_重塑.pdf',range:typeof meta.range==='string'?meta.range.slice(0,1500):''}};
}
