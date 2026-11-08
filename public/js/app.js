import {
  fetchAlerts,
  getAlerts,
  getError,
  raionStatus,
  oblastStatus,
  alarmSummary,
  diffAlarms,
  GEO_TO_ALERT
} from './alerts.js';

(async()=>{

/* ═════ URLs ═════ */
const ADM2_URL = 'https://raw.githubusercontent.com/slawomirmatuszak/ukrainian_geodata/main/rayony.geojson';
const ADM2_FB  = './data/ukraine-adm2-simplified.geojson';
const ADM1_URL = 'https://gist.githubusercontent.com/tingeber/9cafe2675d6bfe0a5ce609e40872c0a3/raw/mapbox-geoBoundaries-UKR-ADM1.geojson';
const ADM0_URL = 'https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/UKR/ADM0/geoBoundaries-UKR-ADM0.geojson';
const TRANSNISTRIA_URL = 'https://raw.githubusercontent.com/missinglink/osm-boundaries/master/data/000/065/335/000065335.geojson';
const DEEPSTATE_URL=(()=>{
  const d=new Date();
  return 'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_'+
    d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'.geojson';
})();

/* ═════ дані ═════ */
const UA=[[23.60,51.52],[24.35,51.90],[25.20,51.92],[26.40,51.85],[27.70,51.60],[28.75,51.55],[29.30,51.40],[30.55,51.40],[30.62,51.90],[31.60,52.10],[32.40,52.25],[33.20,52.35],[34.10,51.70],[34.40,51.25],[35.10,51.20],[35.40,50.55],[36.60,50.30],[37.45,50.40],[38.20,50.00],[39.20,49.85],[40.15,49.60],[40.20,49.20],[39.80,48.85],[39.95,48.30],[40.10,48.25],[39.75,47.85],[38.90,47.85],[38.30,47.60],[38.25,47.10],[37.50,47.10],[36.75,46.70],[35.85,46.65],[35.30,46.00],[34.85,46.15],[34.20,46.20],[33.75,46.15],[33.20,46.20],[32.60,46.35],[31.90,46.60],[31.50,46.60],[30.95,46.55],[30.75,46.45],[30.20,45.85],[29.70,45.65],[29.00,45.35],[28.50,45.45],[28.25,45.50],[28.90,45.90],[29.55,46.35],[29.90,46.50],[29.60,47.00],[29.20,47.50],[28.35,48.15],[27.60,48.45],[26.65,48.30],[26.00,48.20],[25.50,47.95],[24.90,47.72],[24.20,47.90],[23.60,48.00],[23.15,48.10],[22.60,48.10],[22.15,48.40],[22.55,49.08],[22.70,49.40],[23.30,50.35],[24.10,50.85]];
const CRIMEA=[[33.65,46.15],[34.25,46.05],[34.90,45.88],[35.50,45.95],[36.00,45.60],[36.60,45.45],[36.35,45.15],[35.60,45.10],[35.00,44.85],[34.40,44.70],[33.80,44.45],[33.45,44.60],[33.55,45.00],[33.20,45.20],[32.50,45.35],[32.60,45.60],[33.30,45.75],[33.10,46.00]];

/* Координати для навігації по областях (назва API → [lon, lat]) */
const OBLAST_COORDS={
  'Волинська область':[25.30,51.15],'Рівненська область':[26.40,51.00],'Житомирська область':[28.60,50.60],
  'Київська область':[30.30,50.30],'м. Київ':[30.52,50.45],'Чернігівська область':[31.80,51.50],
  'Сумська область':[34.00,51.00],'Харківська область':[36.40,49.70],'Луганська область':[39.00,48.80],
  'Донецька область':[37.60,48.10],'Запорізька область':[35.40,47.30],'Дніпропетровська область':[34.50,48.30],
  'Полтавська область':[33.70,49.70],'Черкаська область':[31.30,49.20],'Кіровоградська область':[32.30,48.40],
  'Миколаївська область':[31.60,47.30],'Херсонська область':[33.40,46.70],'Одеська область':[30.00,46.60],
  'Вінницька область':[28.50,49.10],'Хмельницька область':[27.00,49.50],'Тернопільська область':[25.60,49.40],
  'Львівська область':[23.80,49.70],'Івано-Франківська область':[24.70,48.60],'Закарпатська область':[23.30,48.40],
  'Чернівецька область':[26.00,48.30],'Автономна Республіка Крим':[34.20,45.30],'м. Севастополь':[33.50,44.60],
};

const OBL=[['Волинська область',25.30,51.15],['Рівненська область',26.40,51.00],['Житомирська область',28.60,50.60],
 ['Київська область',30.30,50.30],['Чернігівська область',31.80,51.50],['Сумська область',34.00,51.00],
 ['Харківська область',36.40,49.70],['Луганська область',39.00,48.80],['Донецька область',37.60,48.10],
 ['Запорізька область',35.40,47.30],['Дніпропетровська область',34.50,48.30],['Полтавська область',33.70,49.70],
 ['Черкаська область',31.30,49.20],['Кіровоградська область',32.30,48.40],['Миколаївська область',31.60,47.30],
 ['Херсонська область',33.40,46.70],['Одеська область',30.00,46.60],['Вінницька область',28.50,49.10],
 ['Хмельницька область',27.00,49.50],['Тернопільська область',25.60,49.40],['Львівська область',23.80,49.70],
 ['Івано-Франківська область',24.70,48.60],['Закарпатська область',23.30,48.40],['Чернівецька область',26.00,48.30]];
const CRN='Автономна Республіка Крим';
const ADM1_ISO_TO_ALERT={
 'UA-05':'Вінницька область','UA-07':'Волинська область','UA-09':'Луганська область',
 'UA-12':'Дніпропетровська область','UA-14':'Донецька область','UA-18':'Житомирська область',
 'UA-21':'Закарпатська область','UA-23':'Запорізька область','UA-26':'Івано-Франківська область',
 'UA-30':'м. Київ','UA-32':'Київська область','UA-35':'Кіровоградська область',
 'UA-40':'м. Севастополь','UA-43':'Автономна Республіка Крим','UA-46':'Львівська область',
 'UA-48':'Миколаївська область','UA-51':'Одеська область','UA-53':'Полтавська область',
 'UA-56':'Рівненська область','UA-59':'Сумська область','UA-61':'Тернопільська область',
 'UA-63':'Харківська область','UA-65':'Херсонська область','UA-68':'Хмельницька область',
 'UA-71':'Черкаська область','UA-73':'Чернівецька область','UA-74':'Чернігівська область',
};
function alertRegionName(props){
 props = props || {};
 const iso = String(props.shapeISO || '').toUpperCase();
 return ADM1_ISO_TO_ALERT[iso] || GEO_TO_ALERT[props.shapeName] || '';
}
const TYPES=[
  {id:'shahed',cat:'БПЛА',n:'Ударний БпЛА',f:'shahed.svg',c:'#2f2f2f',role:'uav',sp:[150,195],alt:[600,2600]},
  {id:'jetuav',cat:'БПЛА',n:'Реактивний БпЛА',f:'Geran-4 Seekersayt.svg',c:'#4a4a4a',role:'uav',sp:[430,560],alt:[1500,4200]},
  {id:'recon',cat:'БПЛА',n:'Розвідувальний БпЛА',f:'orion.svg',c:'#8d8f84',role:'uav',sp:[110,155],alt:[1200,3200]},
  {id:'molnia',cat:'БПЛА',n:'БпЛА «Молнія»',f:'Molnia.svg',c:'#b98d4c',role:'uav',sp:[120,165],alt:[200,800]},
  {id:'fpv',cat:'БПЛА',n:'FPV дрон',f:'FPV.svg',c:'#2c3134',role:'uav',sp:[80,130],alt:[80,400]},
  {id:'x101',cat:'РАКЕТИ',n:'Крилата ракета',f:'x-101.svg',c:'#00c9cc',role:'msl',sp:[720,890],alt:[50,300]},
  {id:'band',cat:'РАКЕТИ',n:'Ракета «Бандероль»',f:'Banderolsayt.svg',c:'#e02020',role:'msl',sp:[520,620],alt:[100,500]},
  {id:'ball',cat:'РАКЕТИ',n:'Балістика',f:'Iskander.svg',c:'#6b6b3a',role:'msl',sp:[2400,3800],alt:[9000,45000]},
  {id:'kab',cat:'ІНШЕ',n:'КАБ',f:'KAB.svg',c:'#5d6b48',role:'kab',sp:[600,800],alt:[1500,6000]}
];
const iconURL=t=>'/' + t.f.split('/').map(encodeURIComponent).join('/');
const ROLE={uav:['БпЛА','#3a3a3a'],msl:['Ракети','#d13a2a'],kab:['КАБ','#5d6b48']};

let adm2=[],occRings=[],mapDataReady=false;
let uaBorderPath='', adm1=[];

const SPAWN_EDGE=[
  [37.8,50.1],[37.9,49.2],[38.0,48.5],
  [37.3,48.2],[36.7,47.8],[35.8,47.6],
  [34.9,47.4],[33.9,47.1],[32.9,46.6]
];

/* ═════ проєкція ═════ */
const TS=256,Z8=8;
const lon2x=(lo,z)=>(lo+180)/360*TS*2**z;
const lat2y=(la,z)=>{const s=Math.sin(la*Math.PI/180);return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*TS*2**z;};
const x2lon=(x,z)=>x/(TS*2**z)*360-180;
const y2lat=(y,z)=>{const n=Math.PI-2*Math.PI*y/(TS*2**z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));};
const w8=(lo,la)=>[lon2x(lo,Z8),lat2y(la,Z8)];

/* ═════ стан ═════ */
const DEF={size:1,labels:true,alarmFill:true,frontLine:true,dim:true,sound:false};
const S={...DEF,off:new Set()};
const view={lat:48.55,lon:31.4,zoom:6.1};
const MINZ=5,MAXZ=11;
let base='osm',tileErr=0,targets=[],levels=new Map(),cells=new Map(),selectedTarget=null,summaryDirty=true;

const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[(Math.random()*a.length)|0];
const pad=n=>String(n|0).padStart(2,'0');
const hhmm=d=>pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
const mapSize={w:1,h:1};
const targetCanvas=$('#marks');
const targetCtx=targetCanvas.getContext('2d',{alpha:true,desynchronized:true});
const LOW_POWER=matchMedia('(pointer:coarse)').matches||
  (navigator.hardwareConcurrency||8)<=4||(navigator.deviceMemory||8)<=4;
const TARGET_FRAME_MS=1000/(LOW_POWER?20:30);
const TARGET_DPR_CAP=LOW_POWER?1.25:1.75;
let targetDpr=1;

function tileURL(z,x,y){
  const n=2**z;x=((x%n)+n)%n;
  if(base==='osm') return 'https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png';
  const s='abcd'[(x+y)%4];
  return 'https://'+s+'.basemaps.cartocdn.com/light_all/'+z+'/'+x+'/'+y+(!LOW_POWER&&devicePixelRatio>1.4?'@2x':'')+'.png';
}

/* ═════ рушій мапи ═════ */
function measureMap(){
  const e=$('#mapwrap');
  mapSize.w=Math.max(1,e.clientWidth);mapSize.h=Math.max(1,e.clientHeight);
  targetDpr=Math.min(devicePixelRatio||1,TARGET_DPR_CAP);
  const w=Math.round(mapSize.w*targetDpr),h=Math.round(mapSize.h*targetDpr);
  if(targetCanvas.width!==w||targetCanvas.height!==h){
    targetCanvas.width=w;targetCanvas.height=h;
    targetCanvas.style.width=mapSize.w+'px';targetCanvas.style.height=mapSize.h+'px';
  }
}
function size(){return[mapSize.w,mapSize.h];}
function paneT(z){const [w,h]=size(),s=2**(view.zoom-z);
  return 'translate('+w/2+'px,'+h/2+'px) scale('+s+') translate('+(-lon2x(view.lon,z))+'px,'+(-lat2y(view.lat,z))+'px)';}
function targetAt(px,py){
  const R=Math.max(20,22*S.size),scale=2**(view.zoom-Z8);
  const ox=mapSize.w/2-lon2x(view.lon,Z8)*scale,oy=mapSize.h/2-lat2y(view.lat,Z8)*scale;
  let best=null,bd=R*R;
  for(const tg of targets){
    if(S.off.has(tg.t.id))continue;
    const x=tg.wx*scale+ox,y=tg.wy*scale+oy,d=(x-px)**2+(y-py)**2;
    if(d<bd){bd=d;best=tg;}
  }
  return best;
}
(()=>{
  const wrap=$('#mapwrap');let sx=0,sy=0,moved=false;
  wrap.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;moved=false},true);
  wrap.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-sx,e.clientY-sy)>6)moved=true},true);
  wrap.addEventListener('pointerup',e=>{
    if(moved||e.button||e.target.closest('.pill'))return;
    const r=wrap.getBoundingClientRect();
    const tg=targetAt(e.clientX-r.left,e.clientY-r.top);
    selectedTarget=tg===selectedTarget?null:tg;
    renderTargets(true);
  },true);
})();
function latlngAt(px,py){const [w,h]=size(),z=view.zoom;
  return [y2lat(lat2y(view.lat,z)+py-h/2,z), x2lon(lon2x(view.lon,z)+px-w/2,z)];}

  const BB={w:21.9,e:40.4,s:43.9,n:52.5};           // bbox України з невеликим запасом
function clampView(){
  const [w,h]=size();
  const fit=Math.max(Math.log2(w/(lon2x(BB.e,0)-lon2x(BB.w,0))),
                     Math.log2(h/(lat2y(BB.s,0)-lat2y(BB.n,0))));
  view.zoom=Math.min(MAXZ,Math.max(Math.max(MINZ,fit),view.zoom));
  const z=view.zoom,x0=lon2x(BB.w,z),x1=lon2x(BB.e,z),y0=lat2y(BB.n,z),y1=lat2y(BB.s,z);
  let cx=lon2x(view.lon,z),cy=lat2y(view.lat,z);
  cx=(x1-x0<=w)?(x0+x1)/2:Math.min(Math.max(cx,x0+w/2),x1-w/2);
  cy=(y1-y0<=h)?(y0+y1)/2:Math.min(Math.max(cy,y0+h/2),y1-h/2);
  view.lon=x2lon(cx,z); view.lat=y2lat(cy,z);
}

function positionMapLayers(){
  const [w,h]=size();
  for(const [z,lv] of levels)lv.el.style.transform=paneT(z);
  const s=2**(view.zoom-Z8),x=w/2-lon2x(view.lon,Z8)*s,y=h/2-lat2y(view.lat,Z8)*s;
  $('#vg').style.transform='matrix('+s+',0,0,'+s+','+x+','+y+')';
  scaleBar();
}

let tileDrawTimer=0;
function queueTileDraw(){
  if(tileDrawTimer)return;
  tileDrawTimer=setTimeout(()=>{tileDrawTimer=0;drawTiles();},90);
}
function drawTiles(){
  if(tileDrawTimer){clearTimeout(tileDrawTimer);tileDrawTimer=0;}
  clampView();
  const tz=Math.max(MINZ,Math.min(MAXZ,Math.round(view.zoom)));
  const [w,h]=size(),s=2**(view.zoom-tz);
  let L=levels.get(tz);
  if(!L){L={el:document.createElement('div'),tiles:new Map()};
    L.el.className='lvl';L.el.style.zIndex=tz;$('#levels').appendChild(L.el);levels.set(tz,L);}
  const cx=lon2x(view.lon,tz),cy=lat2y(view.lat,tz);
  const hw=(w/2)/s+TS,hh=(h/2)/s+TS;
  const x0=Math.floor((cx-hw)/TS),x1=Math.floor((cx+hw)/TS);
  const y0=Math.max(0,Math.floor((cy-hh)/TS)),y1=Math.min(2**tz-1,Math.floor((cy+hh)/TS));
  const need=new Set();
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    const k=x+'_'+y;need.add(k);
    if(L.tiles.has(k))continue;
    const img=new Image();img.decoding='async';img.alt='';
    img.style.left=(x*TS)+'px';img.style.top=(y*TS)+'px';
    img.onload=()=>img.classList.add('ok');
    img.onerror=()=>{if(base==='osm'&&++tileErr>6){setBase('light');toast('Тайли OSM недоступні, увімкнув світлу мапу');}};
    img.src=tileURL(tz,x,y);
    L.el.appendChild(img);L.tiles.set(k,img);
  }
  for(const [k,img] of L.tiles) if(!need.has(k)){img.remove();L.tiles.delete(k);}
  for(const [z,lv] of levels){
    if(z!==tz){lv.stale=(lv.stale||0)+1;if(lv.stale>2){lv.el.remove();levels.delete(z);}}
    else lv.stale=0;
  }
  positionMapLayers();
}
function scaleBar(){
  const mpp=156543.03392*Math.cos(view.lat*Math.PI/180)/2**view.zoom;
  const target=130*mpp,steps=[1,2,5,10,20,50,100,200,500,1000];
  const km=steps.find(v=>v*1000>=target*0.55)||1000;
  const width=Math.round(km*1000/mpp)+'px',text=km+' км';
  if($('#scBar').style.width!==width)$('#scBar').style.width=width;
  if($('#scTxt').textContent!==text)$('#scTxt').textContent=text;
}

/* ═════ векторний шар ═════ */
function esc(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function poly(pts){return pts.map((p,i)=>(i?'L':'M')+w8(p[0],p[1]).map(v=>v.toFixed(1)).join(' ')).join('')+'Z';}
function line(pts){return pts.map((p,i)=>(i?'L':'M')+w8(p[0],p[1]).map(v=>v.toFixed(1)).join(' ')).join('');}
function ringPath(r){return r.map((p,i)=>(i?'L':'M')+w8(p[0],p[1]).map(v=>v.toFixed(1)).join(' ')).join('')+'Z';}
function geomRings(g){if(!g)return[];if(g.type==='Polygon')return g.coordinates;if(g.type==='MultiPolygon')return g.coordinates.flatMap(p=>p);return[];}
function geomPath(g){return geomRings(g).map(ringPath).join('')||'M0 0';}
function center(g){const pts=geomRings(g).flat();if(!pts.length)return[31,49];let minx=99,maxx=-99,miny=99,maxy=-99;for(const [x,y]of pts){minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y)}return[(minx+maxx)/2,(miny+maxy)/2];}
function insideRing(lo,la,r){let inn=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if(((a[1]>la)!==(b[1]>la))&&(lo<(b[0]-a[0])*(la-a[1])/(b[1]-a[1])+a[0]))inn=!inn;}return inn;}
function insideGeom(lo,la,g){const rings=geomRings(g);return rings.some(r=>insideRing(lo,la,r));}
async function getJSON(url){
 if(!url) throw Error('empty URL');
 const r = await fetch(url);
 if(!r.ok) throw Error(url + ' ' + r.status);
 const text = await r.text();
 if(text.startsWith('version https://git-lfs.github.com')) throw Error('Git LFS pointer: ' + url);
 return JSON.parse(text);
}

/* ═════ loadMapData ═════ */
async function loadMapData(){
  try{
    const yesterday=new Date(Date.now()-86400000);
    const dsFallback='https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_'+
      yesterday.getFullYear()+String(yesterday.getMonth()+1).padStart(2,'0')+String(yesterday.getDate()).padStart(2,'0')+'.geojson';
      const [ra,rd,rb1,rb0,rm]=await Promise.all([
      getJSON(ADM2_URL).catch(()=>getJSON(ADM2_FB).catch(()=>null)),
      getJSON(DEEPSTATE_URL).catch(()=>getJSON(dsFallback).catch(()=>null)),
      getJSON(ADM1_URL).catch(()=>null),
      getJSON(ADM0_URL).catch(()=>null),
      getJSON(TRANSNISTRIA_URL).catch(()=>null)
    ]);

    /* райони — додаємо oblastUa для матчингу з alerts API */
     /* райони: назву беремо як є, область визначаємо геометрично нижче */
     if(ra){
     adm2=(ra.features||[]).map((f,i)=>{
     const c=center(f.geometry);
     const shapeName = f.properties?.rayon || f.properties?.shapeName || f.properties?.name || ('Район '+(i+1));
     return{name:shapeName,oblastUa:'',lo:c[0],la:c[1],g:f.geometry,d:geomPath(f.geometry)};
    });
  }

    /* DeepState — тільки outer ring */
    if(rd){
      const ds=rd.features?.[0]?.geometry;
      if(ds){
        if(ds.type==='MultiPolygon') occRings=ds.coordinates.map(polygon=>polygon[0]);
        else if(ds.type==='Polygon') occRings=[ds.coordinates[0]];

      }
    }
      if(rm){
   const rings = geomRings(rm.geometry || rm.features?.[0]?.geometry);
   if(rings.length) occRings = [...occRings, ...rings];
   else console.warn('[map] Придністров\'я: порожня геометрія');
 }

    /* межі областей */
     if(rb1){
  adm1=(rb1.features||[]).map(f=>({
    name:f.properties?.shapeName||'',
    ua:alertRegionName(f.properties),
    g:f.geometry,
    d:geomPath(f.geometry)
  }));

  let orphans=0;
  const regions=adm1.filter(o=>o.ua);

  for(const r of adm2){
    let hit=regions.find(o=>insideGeom(r.lo,r.la,o.g));

    if(!hit){
      const pts=geomRings(r.g).flat();
      const step=Math.max(1,(pts.length/24)|0);

      for(let i=0;i<pts.length&&!hit;i+=step){
        hit=regions.find(o=>insideGeom(pts[i][0],pts[i][1],o.g));
      }
    }

    if(!hit){
      let bestDist=Infinity;

      for(const o of regions){
        const c=center(o.g);
        const d=(c[0]-r.lo)**2*0.44+(c[1]-r.la)**2;

        if(d<bestDist){
          bestDist=d;
          hit=o;
        }
      }
    }

    r.oblastUa=hit?.ua||'';
    if(!r.oblastUa) orphans++;
  }

  if(orphans){
    console.warn('[alerts] районів без області:', orphans);
  }
}

console.log('[map] ADM2 районів:', adm2.length);
console.log('[map] ADM1 областей:', adm1.length);
console.log('[map] Район без області:', adm2.filter(r => !r.oblastUa).length);
    /* точний кордон */
    if(rb0){const g=rb0.features?.[0]?.geometry;if(g)uaBorderPath=geomPath(g);}
    mapDataReady=true;
  }catch(e){console.warn('map data fallback',e);mapDataReady=true;}
}

function clipHalf(pl,A,B){
  const mx=(A[0]+B[0])/2,my=(A[1]+B[1])/2,nx=B[0]-A[0],ny=B[1]-A[1];
  const sd=p=>(p[0]-mx)*nx+(p[1]-my)*ny,out=[];
  for(let i=0;i<pl.length;i++){
    const P=pl[i],Q=pl[(i+1)%pl.length],sp=sd(P),sq=sd(Q);
    if(sp<=0)out.push(P);
    if((sp<0&&sq>0)||(sp>0&&sq<0)){const t=sp/(sp-sq);out.push([P[0]+(Q[0]-P[0])*t,P[1]+(Q[1]-P[1])*t]);}
  }
  return out;
}

function buildVector(){
  const ua8 = UA.map(p => w8(p[0], p[1]));

  // Fallback-області, якщо GeoJSON районів не завантажився
  const seeds = OBL.map(o => ({
    name: o[0],
    point: w8(o[1], o[2])
  }));

  for(const s of seeds){
    let polygon = ua8;

    for(const other of seeds){
      if(other === s || !polygon.length) continue;
      polygon = clipHalf(polygon, s.point, other.point);
    }

    cells.set(s.name, polygon);
  }

  cells.set(CRN, CRIMEA.map(p => w8(p[0], p[1])));

  const fallbackPath = name => {
    const points = cells.get(name);
    if(!points || !points.length) return 'M0 0';
    return 'M' + points
      .map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1))
      .join('L') + 'Z';
  };

   const countryPath = adm1.length
   ? adm1.map(a => a.d).join('')
   : (uaBorderPath || poly(UA) + poly(CRIMEA));

  const world = TS * 2 ** Z8;
 let g = '<path id="dimmer" d="M0 0H' + world + 'V' + world + 'H0Z' + countryPath +
   '" fill="rgba(49,40,38,.18)" fill-rule="evenodd" clip-rule="evenodd" pointer-events="none"/>';

  // Активні тривоги: точні полігони районів
 // Окуповані території: НЕ чорні, тільки легка штрихована зона
g += '<g id="occG">';
g += occRings.map(r =>
  '<path class="occ" d="' + ringPath(r) + '"/>'
).join('');
g += '</g>';
// Тривоги поверх окупованого шару
g += '<g id="alarmG">';

if (mapDataReady && adm2.length) {
  g += adm2.map((a, i) => `
  <path
    class="ac"
    data-i="${i}"
    data-oblast="${esc(a.oblastUa || '')}"
    data-raion="${esc(a.name)}"
    d="${a.d}"
  />
`).join('');
}

g += '<g id="adm1G">';

g += adm1.map(a =>
  '<path class="oblast-border" d="' + a.d + '"/>'
).join('');

g += adm1.filter(a => a.ua).map(a =>
  '<path class="ob" data-oblast="' + esc(a.ua) +
  '" d="' + a.d + '" display="none"/>'
).join('');

g += '</g>';

  // Кордон України
   g += ' ';
g += ' ';
g += ' ';


  // Лінія фронту
  

  $('#vg').innerHTML = g;

  console.log('[map] vector built:', {
    districts: adm2.length,
    oblasts: adm1.length
  });
  $('#lgOcc').style.background='repeating-linear-gradient(45deg,rgba(224,52,42,.6) 0 3px,rgba(224,52,42,.2) 3px 6px)';
}

/* ═════ paintAlarms — реальні дані ═════ */
/* ═════ paintAlarms — три рівні: область / район / громада ═════ */

function paintAlarms(){
  const on = S.alarmFill && mapDataReady;

  $$('#alarmG .ac').forEach(p=>{
    const st = on ? raionStatus(adm2[+p.dataset.i]) : 'none';
    p.dataset.state = st;
    p.setAttribute('display', st === 'none' ? 'none' : 'inline');
    if (st === 'none') return;
    p.setAttribute('fill', st === 'full' ? 'rgba(203,42,32,.30)' : 'rgba(203,42,32,.14)');
    p.setAttribute('stroke-width', st === 'full' ? '1.15' : '1');
  });

  $$('#adm1G .ob').forEach(p=>{
    const full = on && oblastStatus(p.dataset.oblast) === 'A';
    p.setAttribute('display', full ? 'inline' : 'none');
  });

  const occ = $('#occG'); if (occ) occ.setAttribute('display', S.frontLine ? 'inline' : 'none');
  const dim = $('#dimmer'); if (dim) dim.setAttribute('display', S.dim ? 'inline' : 'none');
}

/* ═════ цілі ═════ */
const TARGET_ICON_PX=128;
const targetIcons=new Map();

async function loadTargetIcons(){
  await Promise.all(TYPES.map(t=>new Promise(resolve=>{
    const img=new Image();img.decoding='async';
    img.onload=()=>{
      const c=document.createElement('canvas'),ctx=c.getContext('2d',{alpha:true});
      c.width=TARGET_ICON_PX;c.height=TARGET_ICON_PX;
      const scale=Math.min((TARGET_ICON_PX-4)/img.naturalWidth,(TARGET_ICON_PX-4)/img.naturalHeight);
      const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
      ctx.drawImage(img,(TARGET_ICON_PX-w)/2,(TARGET_ICON_PX-h)/2,w,h);
      targetIcons.set(t.id,c);resolve();
    };
    img.onerror=()=>{console.warn('[targets] Не вдалося завантажити',t.f);resolve();};
    img.src=iconURL(t);
  })));
}

function spawn(quiet){
  const t=pick(TYPES);
  let lo,la,hd,r=Math.random();
  if(t.role==='avia'||t.id==='kab'||t.id==='fpv'||t.id==='molnia'){
    const edge=occRings[0]?.length ? occRings[0] : SPAWN_EDGE;
    const f=edge[(Math.random()*edge.length)|0];
    lo=f[0]+rnd(0.3,1.5);la=f[1]+rnd(-0.5,0.5);hd=rnd(235,305);
  }else if(r<0.42){
    lo=rnd(30.4,39.6);
    la=52.5;
    hd=rnd(150,215);
  }
  else if(r<0.76){
    lo=40.4;
    la=rnd(47.8,51.6);
    hd=rnd(230,292);
  }
  else{
    lo=rnd(30.4,36.6);
    la=44.3;
    hd=rnd(340,395)%360;
  }
  const tg={
    t,lo,la,hd,sp:rnd(t.sp[0],t.sp[1]),
    alt:Math.round(rnd(t.alt[0],t.alt[1])/50)*50,
    born:performance.now(),
    wx:lon2x(lo,Z8),wy:lat2y(la,Z8),
    cos:Math.cos(hd*Math.PI/180),sin:Math.sin(hd*Math.PI/180)
  };
  targets.push(tg);summaryDirty=true;
  if(!quiet&&S.sound&&t.role==='msl')beep(t.id==='ball'?520:380);
}

function renderTargetSummary(){
  if(!summaryDirty)return;
  let n=0,by={uav:0,msl:0,kab:0};
  for(const tg of targets){
    if(S.off.has(tg.t.id))continue;
    n++;by[tg.t.role]++;
  }
  if($('#totN').textContent!==String(n))$('#totN').textContent=n;
  const html=Object.keys(ROLE).map(r=>
    '<span class="chip"><i style="background:'+ROLE[r][1]+'"></i>'+ROLE[r][0]+' <b>'+by[r]+'</b></span>').join('');
  if($('#chips').innerHTML!==html)$('#chips').innerHTML=html;
  summaryDirty=false;
}

function paintTargets(){
  renderTargetSummary();
  targetCtx.setTransform(1,0,0,1,0,0);
  targetCtx.clearRect(0,0,targetCanvas.width,targetCanvas.height);
  targetCtx.imageSmoothingEnabled=true;
  targetCtx.imageSmoothingQuality='medium';

  const scale=2**(view.zoom-Z8);
  const ox=mapSize.w/2-lon2x(view.lon,Z8)*scale,oy=mapSize.h/2-lat2y(view.lat,Z8)*scale;
  const px=Math.round(30*S.size),margin=px;
  let selectedX=0,selectedY=0,selectedVisible=false;

  for(const tg of targets){
    if(S.off.has(tg.t.id))continue;
    const x=tg.wx*scale+ox,y=tg.wy*scale+oy;
    if(tg===selectedTarget){selectedX=x;selectedY=y;selectedVisible=true;}
    if(x<-margin||x>mapSize.w+margin||y<-margin||y>mapSize.h+margin)continue;
    const icon=targetIcons.get(tg.t.id);if(!icon)continue;
    const cos=tg.cos*targetDpr,sin=tg.sin*targetDpr;
    targetCtx.setTransform(cos,sin,-sin,cos,x*targetDpr,y*targetDpr);
    targetCtx.drawImage(icon,-px/2,-px/2,px,px);
  }

  targetCtx.setTransform(1,0,0,1,0,0);
  const tip=$('#targetTip');
  if(!S.labels||!selectedTarget||S.off.has(selectedTarget.t.id)||!selectedVisible||
     selectedX<-margin||selectedX>mapSize.w+margin||selectedY<-margin||selectedY>mapSize.h+margin){
    tip.hidden=true;
  }else{
    const label=tip.querySelector('b');if(label.textContent!==selectedTarget.t.n)label.textContent=selectedTarget.t.n;
    tip.style.setProperty('--tc',selectedTarget.t.c);
    tip.style.transform='translate3d('+(selectedX+px*.55+5).toFixed(1)+'px,'+(selectedY-11).toFixed(1)+'px,0)';
    tip.hidden=false;
  }
}

let lastTargetPaint=0,targetPaintTimer=0;
function renderTargets(force=false){
  const now=performance.now(),wait=TARGET_FRAME_MS-(now-lastTargetPaint);
  if(!force&&wait>1){
    if(!targetPaintTimer)targetPaintTimer=setTimeout(()=>{targetPaintTimer=0;renderTargets(true);},wait);
    return;
  }
  if(targetPaintTimer){clearTimeout(targetPaintTimer);targetPaintTimer=0;}
  lastTargetPaint=now;paintTargets();
}

const SPEEDUP=42;let last=performance.now(),lastStep=0;
function loop(now){
  requestAnimationFrame(loop);
  if(now-lastStep<TARGET_FRAME_MS)return;
  const dt=Math.min(now-last,250);last=now;lastStep=now;
  const hrs=dt/3600000*SPEEDUP;
  for(let i=targets.length-1;i>=0;i--){
    const tg=targets[i],r=tg.hd*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
    tg.la+=cos*tg.sp*hrs/111;
    tg.lo+=sin*tg.sp*hrs/(111*Math.cos(tg.la*Math.PI/180));
    tg.hd+=Math.sin(now/2600+i)*0.028*(dt/16.667);
    tg.wx=lon2x(tg.lo,Z8);tg.wy=lat2y(tg.la,Z8);tg.cos=cos;tg.sin=sin;
    if(tg.lo<21||tg.lo>41.4||tg.la<43.4||tg.la>53.2||now-tg.born>210000){
      if(selectedTarget===tg)selectedTarget=null;
      targets.splice(i,1);summaryDirty=true;
    }
  }
  renderTargets();
}

/* ═════ тривоги — реальні дані з alerts.in.ua ═════ */
const dur=t=>{const s=(Date.now()-t)/1000|0;return pad(s/60)+':'+pad(s%60);};




function tickAlarms(){
  $$('#aList .st').forEach(e=>e.textContent=dur(+e.dataset.s));
  const active=getAlerts();
  const times=[...active.values()].filter(a=>a.level === 'oblast').map(a=>a.startedAt.getTime()).sort((a,b)=>a-b);
  $('#aLong').textContent=times.length?'найдовша '+dur(times[0]):'';
}

/* ═════ pollAlerts — замість shuffleAlarms ═════ */
/* ═════ тривоги — область / район / громада ═════ */

function renderAlarmPanel(){
  const summary = alarmSummary();

  // Кількість областей, де є повна або часткова тривога
  const affectedOblasts = summary.countFull + summary.countPartial;

  // Велике число у вкладці «Тривоги»
  const bigNumber = $('#aBig');
  if (bigNumber) bigNumber.textContent = affectedOblasts;

  // Маленьке число біля вкладки «Тривоги»
  const tabNumber = $('#tabN');
  if (tabNumber) tabNumber.textContent = affectedOblasts;

  const alarmTab = document.querySelector('.tab[data-pane="alarms"]');
  if (alarmTab) {
    alarmTab.dataset.hot = String(affectedOblasts > 0);
  }

  const activeOblasts = summary.oblasts
    .filter(o => o.status !== 'N')
    .sort((a, b) => a.title.localeCompare(b.title, 'uk'));

  const calmOblasts = summary.oblasts
    .filter(o => o.status === 'N')
    .sort((a, b) => a.title.localeCompare(b.title, 'uk'));

  const activeList = $('#aList');
  if (activeList) {
    activeList.innerHTML = activeOblasts.length
      ? activeOblasts.map(o => {
          const details = summary.raionAlarms
            .concat(summary.hromadaAlarms)
            .filter(a => a.oblast === o.title).length;

          const label = o.status === 'A'
            ? 'тривога'
            : `${details} р-н/грм`;

          return `
            <li class="on" data-go="${esc(o.title)}">
              <span class="fl"></span>
              <span class="nm">${esc(o.title)}</span>
              <span class="st">${label}</span>
            </li>
          `;
        }).join('')
      : `
        <li style="padding-left:0;color:var(--ink-3);font-size:.875rem">
          Тривог немає. Тихо по всій країні.
        </li>
      `;
  }

  const calmList = $('#cList');
  if (calmList) {
    calmList.innerHTML = calmOblasts.map(o => `
      <li class="calm" data-go="${esc(o.title)}">
        <span class="fl"></span>
        <span class="nm">${esc(o.title)}</span>
        <span class="st">відбій</span>
      </li>
    `).join('');
  }
}

async function pollAlerts(){
 try{
 await fetchAlerts();
 }catch(e){
 console.warn('[pollAlerts] error',e);
 return;
 }

 const err=getError();
 if(err){
 const badge=$('#apiState');
 if(badge)badge.textContent=err==='token'?'ТОКЕН':err==='ratelimit'?'ЛІМІТ':'ОФЛАЙН';
 if(err==='token'||err==='ratelimit')console.warn('[alerts]',err);
 }

  const {started}=diffAlarms();
  if(S.sound&&started.length)beep(300);

 paintAlarms();
 renderAlarmPanel();
}

/* ═════ звук ═════ */
let ac;
function beep(f){
  try{
    ac=ac||new (window.AudioContext||window.webkitAudioContext)();
    if(ac.state==='suspended')ac.resume();
    const o=ac.createOscillator(),g=ac.createGain();
    o.type='sine';o.frequency.value=f;
    g.gain.setValueAtTime(0.0001,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07,ac.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,ac.currentTime+0.35);
    o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+0.36);
  }catch(e){}
}

/* ═════ UI ═════ */
function buildTypes(){
  let html='',cat='';
  for(const t of TYPES){
    if(t.cat!==cat){cat=t.cat;html+='<li class="cat eyebrow">'+cat+'</li>';}
    html+='<li><button class="chk" role="checkbox" aria-checked="true" data-t="'+t.id+'">'+
      '<img class="gl" src="'+iconURL(t)+'" alt="">'+
      '<span class="nm">'+t.n+'</span><span class="box"></span></button></li>';
  }
  $('#typeList').innerHTML=html;
}
function sync(){
  $$('.sw').forEach(b=>b.setAttribute('aria-checked',String(S[b.dataset.p])));
  $$('.chk').forEach(b=>b.setAttribute('aria-checked',String(!S.off.has(b.dataset.t))));
  $('#rSize').value=S.size;
  $('#vSize').textContent=S.size.toFixed(1).replace('.',',')+'×';
  if(selectedTarget&&S.off.has(selectedTarget.t.id))selectedTarget=null;
  summaryDirty=true;renderTargets(true);paintAlarms();
}
let toastT;
function toast(m){const e=$('#toast');e.textContent=m;e.classList.add('on');
  clearTimeout(toastT);toastT=setTimeout(()=>e.classList.remove('on'),2800);}
function setBase(b){
  if(base===b)return;base=b;tileErr=0;
  for(const [,L] of levels)L.el.remove();
  levels.clear();
  $$('.basemaps button').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.bm===b)));
  drawTiles();
}
function flyTo(lat,lon,zoom){
  const s={...view},e={lat,lon,zoom:zoom==null?view.zoom:zoom},t0=performance.now(),D=620;
  (function step(t){
    const k=Math.min(1,(t-t0)/D),p=1-Math.pow(1-k,4);
    view.lat=s.lat+(e.lat-s.lat)*p;view.lon=s.lon+(e.lon-s.lon)*p;view.zoom=s.zoom+(e.zoom-s.zoom)*p;
    renderMapFrame();
    if(k<1)requestAnimationFrame(step);else drawTiles();
  })(t0);
}
let redrawQueued=false;
function renderMapFrame(){clampView();positionMapLayers();renderTargets();queueTileDraw();}
function redrawMap(){if(redrawQueued)return;redrawQueued=true;requestAnimationFrame(()=>{redrawQueued=false;renderMapFrame();});}
function zoomAt(dz,px,py){
  const [w,h]=size();
  if(px==null){px=w/2;py=h/2;}
  const [la,lo]=latlngAt(px,py);
  const nz=Math.max(MINZ,Math.min(MAXZ,view.zoom+dz));
  if(nz===view.zoom)return;
  view.zoom=nz;
  view.lon=x2lon(lon2x(lo,nz)-(px-w/2),nz);
  view.lat=y2lat(lat2y(la,nz)-(py-h/2),nz);
  redrawMap();
}

(function(){
  const el=$('#mapwrap');const pts=new Map();let lastD=0;
  el.addEventListener('pointerdown',e=>{
    if(e.target.closest('.pill'))return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    el.classList.add('drag');
  });
  el.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId))return;
    const p=pts.get(e.pointerId),dx=e.clientX-p.x,dy=e.clientY-p.y;
    p.x=e.clientX;p.y=e.clientY;
    if(pts.size===1){
      const z=view.zoom;
      view.lon=x2lon(lon2x(view.lon,z)-dx,z);
      view.lat=y2lat(Math.max(1,lat2y(view.lat,z)-dy),z);
      redrawMap();
    }else if(pts.size===2){
      const v=[...pts.values()],d=Math.hypot(v[0].x-v[1].x,v[0].y-v[1].y);
      if(lastD){const r=el.getBoundingClientRect();
        zoomAt(Math.log2(d/lastD),(v[0].x+v[1].x)/2-r.left,(v[0].y+v[1].y)/2-r.top);}
      lastD=d;
    }
  });
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)lastD=0;if(!pts.size){el.classList.remove('drag');drawTiles();renderTargets(true);}};
  el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  el.addEventListener('wheel',e=>{e.preventDefault();const r=el.getBoundingClientRect();
    zoomAt(-e.deltaY*(e.deltaMode===1?0.05:0.0022),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  el.addEventListener('dblclick',e=>{const r=el.getBoundingClientRect();zoomAt(1,e.clientX-r.left,e.clientY-r.top);});
})();

document.addEventListener('click',e=>{
  const tab=e.target.closest('.tab');
  if(tab){$$('.tab').forEach(t=>t.setAttribute('aria-selected',String(t===tab)));
    $$('.pane').forEach(p=>p.toggleAttribute('data-on',p.dataset.pane===tab.dataset.pane));
    return;}
  const sw=e.target.closest('.sw');
  if(sw){S[sw.dataset.p]=!S[sw.dataset.p];sync();if(sw.dataset.p==='sound'&&S.sound)beep(440);return;}
  const chk=e.target.closest('.chk');
  if(chk){const id=chk.dataset.t;S.off.has(id)?S.off.delete(id):S.off.add(id);sync();return;}
  if(e.target.closest('#reset')){Object.assign(S,DEF);S.off=new Set();sync();toast('Налаштування скинуто');return;}
  const bm=e.target.closest('.basemaps button');if(bm){setBase(bm.dataset.bm);return;}
  if(e.target.closest('#zin')){zoomAt(1);return;}
  if(e.target.closest('#zout')){zoomAt(-1);return;}
  if(e.target.closest('#home')){flyTo(48.55,31.4,6.1);return;}
  if(e.target.closest('#openSupport')){$('#dSupport').showModal();return;}
  if(e.target.closest('#closeSupport')){$('#dSupport').close();return;}
  const cp=e.target.closest('#copyCard');
  if(cp){if(navigator.clipboard)navigator.clipboard.writeText('4874 1000 3088 4673');
    cp.textContent='Скопійовано';setTimeout(()=>cp.textContent='Копіювати',1800);return;}

  /* Навігація по кліку на область/район */
  const go=e.target.closest('[data-go]');
  if(go){
    const n=go.dataset.go;
    /* Шукаємо в adm2 */
    const a=adm2.find(x=>x.name===n||x.oblastUa===n);
    if(a){flyTo(a.la,a.lo,Math.max(view.zoom,7.4));return;}
    /* Шукаємо в OBLAST_COORDS (повні назви API) */
    const c=OBLAST_COORDS[n];
    if(c){flyTo(c[1],c[0],Math.max(view.zoom,7.4));return;}
  }
  if(e.target.id==='dSupport')$('#dSupport').close();
});
$('#rSize').addEventListener('input',e=>{S.size=+e.target.value;
  $('#vSize').textContent=S.size.toFixed(1).replace('.',',')+'×';renderTargets(true);});

/* ═════ СТАРТ ═════ */
measureMap();
await Promise.all([loadMapData(),loadTargetIcons()]);

buildTypes();
buildVector();
drawTiles();
sync();

/* Перший реальний запит тривог */
await pollAlerts();

for(let i = 0; i < 11; i++) spawn(true);
renderTargets(true);

let resizeQueued=false;
new ResizeObserver(()=>{
  if(resizeQueued)return;resizeQueued=true;
  requestAnimationFrame(()=>{
    resizeQueued=false;measureMap();clampView();positionMapLayers();renderTargets(true);queueTileDraw();
  });
}).observe($('#mapwrap'));

setInterval(() => {
  $('#clock').textContent = hhmm(new Date());
  tickAlarms();
}, 1000);

setInterval(() => {
  if (targets.length < 17) spawn();
}, 5200);

/* API alerts.in.ua: 2 запити на хвилину, ліміт не перевищуємо */
setInterval(pollAlerts, 30_000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollAlerts();
});

requestAnimationFrame(loop);
setTimeout(() => $('#boot').classList.add('gone'), 1200);

})();
