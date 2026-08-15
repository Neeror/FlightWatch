import {
  fetchAlerts,
  startPolling,
  getAlerts,
  getError,
  raionStatus,
  oblastStatus,
  oblastHasAnyAlarm,
  alarmSummary,
  diffAlarms,
  GEO_TO_ALERT,
  OBLAST_ORDER
} from './alerts.js';

import { FRONT_LINE } from '../data/front-line.js';

const SPRITE_URL = '../assets/icons.svg';
async function loadIconSprite(){const host=document.querySelector('#icon-sprite');if(!host)return;try{host.innerHTML=await(await fetch(SPRITE_URL)).text()}catch(e){console.warn('SVG sprite failed to load',e)}}

(async()=>{
await loadIconSprite();

/* ═════ URLs ═════ */
const ADM2_URL = './data/ukraine-adm2-simplified.geojson';
const ADM1_URL = 'https://gist.githubusercontent.com/tingeber/9cafe2675d6bfe0a5ce609e40872c0a3/raw/mapbox-geoBoundaries-UKR-ADM1.geojson';
const ADM0_URL = '';
const TRANSNISTRIA_URL = 'https://raw.githubusercontent.com/missinglink/osm-boundaries/master/data/000/065/335/000065335.geojson';
const DEEPSTATE_URL=(()=>{
  const d=new Date();
  return 'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_'+
    d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'.geojson';
})();

/* ═════ дані ═════ */
const UA=[[23.60,51.52],[24.35,51.90],[25.20,51.92],[26.40,51.85],[27.70,51.60],[28.75,51.55],[29.30,51.40],[30.55,51.40],[30.62,51.90],[31.60,52.10],[32.40,52.25],[33.20,52.35],[34.10,51.70],[34.40,51.25],[35.10,51.20],[35.40,50.55],[36.60,50.30],[37.45,50.40],[38.20,50.00],[39.20,49.85],[40.15,49.60],[40.20,49.20],[39.80,48.85],[39.95,48.30],[40.10,48.25],[39.75,47.85],[38.90,47.85],[38.30,47.60],[38.25,47.10],[37.50,47.10],[36.75,46.70],[35.85,46.65],[35.30,46.00],[34.85,46.15],[34.20,46.20],[33.75,46.15],[33.20,46.20],[32.60,46.35],[31.90,46.60],[31.50,46.60],[30.95,46.55],[30.75,46.45],[30.20,45.85],[29.70,45.65],[29.00,45.35],[28.50,45.45],[28.25,45.50],[28.90,45.90],[29.55,46.35],[29.90,46.50],[29.60,47.00],[29.20,47.50],[28.35,48.15],[27.60,48.45],[26.65,48.30],[26.00,48.20],[25.50,47.95],[24.90,47.72],[24.20,47.90],[23.60,48.00],[23.15,48.10],[22.60,48.10],[22.15,48.40],[22.55,49.08],[22.70,49.40],[23.30,50.35],[24.10,50.85]];
const CRIMEA=[[33.65,46.15],[34.25,46.05],[34.90,45.88],[35.50,45.95],[36.00,45.60],[36.60,45.45],[36.35,45.15],[35.60,45.10],[35.00,44.85],[34.40,44.70],[33.80,44.45],[33.45,44.60],[33.55,45.00],[33.20,45.20],[32.50,45.35],[32.60,45.60],[33.30,45.75],[33.10,46.00]];
const FRONT=[[37.76,50.28],[37.72,49.98],[37.82,49.72],[37.75,49.50],[37.96,49.20],[38.10,48.98],[38.04,48.78],[37.86,48.62],[37.98,48.48],[37.72,48.36],[37.40,48.31],[37.25,48.18],[37.18,47.99],[36.93,47.87],[36.69,47.78],[36.38,47.73],[36.16,47.66],[35.84,47.58],[35.55,47.55],[35.23,47.49],[34.94,47.42],[34.63,47.31],[34.32,47.20],[33.95,47.10],[33.58,46.94],[33.24,46.78],[32.90,46.60],[32.50,46.43]];
const OCC=FRONT.concat([[32.60,46.35],[33.20,46.20],[33.75,46.15],[34.20,46.20],[34.85,46.15],[35.30,46.00],[35.85,46.65],[36.75,46.70],[37.50,47.10],[38.25,47.10],[38.30,47.60],[38.90,47.85],[39.75,47.85],[40.10,48.25],[39.95,48.30],[39.80,48.85],[40.20,49.20],[40.15,49.60],[39.20,49.85],[38.20,50.00],[37.45,50.40]]);

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
const CITY=[['Київ',30.52,50.45],['Харків',36.23,49.99],['Одеса',30.73,46.48],['Дніпро',35.05,48.47],
 ['Львів',24.03,49.84],['Запоріжжя',35.14,47.84],['Миколаїв',31.99,46.98],['Суми',34.80,50.91],
 ['Чернігів',31.29,51.50],['Полтава',34.55,49.59],['Вінниця',28.47,49.23],['Житомир',28.66,50.25],
 ['Луцьк',25.34,50.75],['Херсон',32.62,46.64],['Кривий Ріг',33.39,47.91],['Черкаси',32.06,49.44],
 ['Хмельницький',26.99,49.42],['Краматорськ',37.55,48.74],['Мелітополь',35.37,46.84],
 ['Кропивницький',32.26,48.51],['Івано-Франківськ',24.71,48.92],['Ужгород',22.30,48.62],['Ізмаїл',28.84,45.35]];
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
 {id:'shahed',cat:'БПЛА',n:'Ударний БпЛА',ic:'ic-shahed',c:'#2f2f2f',role:'uav',sp:[150,195],alt:[600,2600]},
 {id:'jetuav',cat:'БПЛА',n:'Реактивний БпЛА',ic:'ic-shahed',c:'#4a4a4a',role:'uav',sp:[430,560],alt:[1500,4200]},
 {id:'recon',cat:'БПЛА',n:'Розвідувальний БпЛА',ic:'ic-recon',c:'#8d8f84',role:'uav',sp:[110,155],alt:[1200,3200]},
 {id:'molnia',cat:'БПЛА',n:'БпЛА «Молнія»',ic:'ic-molniya',c:'#b98d4c',role:'uav',sp:[120,165],alt:[200,800]},
 {id:'fpv',cat:'БПЛА',n:'FPV дрон',ic:'ic-fpv',c:'#2c3134',role:'uav',sp:[80,130],alt:[80,400]},
 {id:'x101',cat:'РАКЕТИ',n:'Крилата ракета',ic:'ic-x101',c:'#00c9cc',role:'msl',sp:[720,890],alt:[50,300]},
 {id:'band',cat:'РАКЕТИ',n:'Ракета «Бандероль»',ic:'ic-banderol',c:'#e02020',role:'msl',sp:[520,620],alt:[100,500]},
 {id:'ball',cat:'РАКЕТИ',n:'Балістика',ic:'ic-iskander',c:'#6b6b3a',role:'msl',sp:[2400,3800],alt:[9000,45000]},
 {id:'kab',cat:'ІНШЕ',n:'КАБ',ic:'ic-kab2',c:'#5d6b48',role:'kab',sp:[600,800],alt:[1500,6000]}];
const T=Object.fromEntries(TYPES.map(t=>[t.id,t]));
const ROLE={uav:['БпЛА','#3a3a3a'],msl:['Ракети','#d13a2a'],avia:['Авіація','#3f4956'],kab:['КАБ','#5d6b48']};

/* alarmNames тепер = повні офіційні назви з alerts.in.ua */
let adm2=[], alarmNames=[...OBLAST_ORDER], frontRings=[FRONT], occRings=[OCC,CRIMEA], mapDataReady=false;
let uaBorderPath='', adm1=[];

/* Відстеження попереднього стану для логу в ефірі */


/* ═════ проєкція ═════ */
const TS=256,Z8=8;
const lon2x=(lo,z)=>(lo+180)/360*TS*2**z;
const lat2y=(la,z)=>{const s=Math.sin(la*Math.PI/180);return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*TS*2**z;};
const x2lon=(x,z)=>x/(TS*2**z)*360-180;
const y2lat=(y,z)=>{const n=Math.PI-2*Math.PI*y/(TS*2**z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));};
const w8=(lo,la)=>[lon2x(lo,Z8),lat2y(la,Z8)];

/* ═════ стан ═════ */
const DEF={size:1,labels:true,meta:false,trails:true,alarmFill:true,frontLine:true,dim:true,sound:false};
const S={...DEF,off:new Set()};
const view={lat:48.55,lon:31.4,zoom:6.1};
const MINZ=5,MAXZ=11;
let base='osm',tileErr=0,targets=[],levels=new Map(),cells=new Map();

const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[(Math.random()*a.length)|0];
const pad=n=>String(n|0).padStart(2,'0');
const hhmm=d=>pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());

function tileURL(z,x,y){
  const n=2**z;x=((x%n)+n)%n;
  if(base==='osm') return 'https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png';
  const s='abcd'[(x+y)%4];
  return 'https://'+s+'.basemaps.cartocdn.com/light_all/'+z+'/'+x+'/'+y+(devicePixelRatio>1.4?'@2x':'')+'.png';
}

/* ═════ рушій мапи ═════ */
function size(){const e=$('#mapwrap');return [e.clientWidth,e.clientHeight];}
function paneT(z){const [w,h]=size(),s=2**(view.zoom-z);
  return 'translate('+w/2+'px,'+h/2+'px) scale('+s+') translate('+(-lon2x(view.lon,z))+'px,'+(-lat2y(view.lat,z))+'px)';}
function screenOf(lo,la){const [w,h]=size(),z=view.zoom;
  return [lon2x(lo,z)-lon2x(view.lon,z)+w/2, lat2y(la,z)-lat2y(view.lat,z)+h/2];}
function latlngAt(px,py){const [w,h]=size(),z=view.zoom;
  return [y2lat(lat2y(view.lat,z)+py-h/2,z), x2lon(lon2x(view.lon,z)+px-w/2,z)];}

function drawTiles(){
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
    lv.el.style.transform=paneT(z);
    if(z!==tz){lv.stale=(lv.stale||0)+1;if(lv.stale>2){lv.el.remove();levels.delete(z);}}
    else lv.stale=0;
  }
  $('#vg').setAttribute('transform','translate('+w/2+','+h/2+') scale('+2**(view.zoom-Z8)+') translate('+(-lon2x(view.lon,Z8))+','+(-lat2y(view.lat,Z8))+')');
  scaleBar();
}
function scaleBar(){
  const mpp=156543.03392*Math.cos(view.lat*Math.PI/180)/2**view.zoom;
  const target=130*mpp,steps=[1,2,5,10,20,50,100,200,500,1000];
  const km=steps.find(v=>v*1000>=target*0.55)||1000;
  $('#scBar').style.width=Math.round(km*1000/mpp)+'px';
  $('#scTxt').textContent=km+' км';
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
      getJSON(ADM2_URL).catch(()=>null),
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
     const shapeName=f.properties?.shapeName||f.properties?.name||('Район '+(i+1));
     return{name:shapeName,oblastUa:'',lo:c[0],la:c[1],g:f.geometry,d:geomPath(f.geometry)};
    });
  }

    /* DeepState — тільки outer ring */
    if(rd){
      const ds=rd.features?.[0]?.geometry;
      if(ds){
        if(ds.type==='MultiPolygon') occRings=ds.coordinates.map(polygon=>polygon[0]);
        else if(ds.type==='Polygon') occRings=[ds.coordinates[0]];
         frontRings=[FRONT_LINE];
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
g += '<g id="occG" opacity="0.36">';
 g += occRings.map(r =>
   '<path class="occ" d="' + ringPath(r) + '" fill="rgba(224,52,42,.20)"' +
   ' stroke="rgba(190,42,32,.35)" stroke-width="1"' +
   ' vector-effect="non-scaling-stroke" pointer-events="none"/>'
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
      fill="rgba(203,42,32,.30)"
      fill-opacity="0"
      stroke="rgba(58,42,38,.62)"
      stroke-width="0.85"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  `).join('');
}

g += '</g>';

  // Межі областей
  g += '<g id="adm1G">';
  g += adm1.map(a =>
    '<path class="oblast-border" d="' + a.d + '"/>'
  ).join('');
  g += '</g>';

  // Кордон України
   g += ' ';
g += ' ';
g += ' ';


  // Лінія фронту
   g += '<g id="frontG">';
 g += frontRings.map(r =>
   '<path class="front-line" d="' + line(r) + '" fill="none" stroke="rgba(190,42,32,.62)"' +
   ' stroke-width="1.45" stroke-linejoin="round" stroke-linecap="round"' +
   ' vector-effect="non-scaling-stroke" pointer-events="none"/>'
 ).join('');
 g += '</g>';

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
  const hasDistricts = mapDataReady && adm2.length > 0;

  $$('#alarmG .ac').forEach(path => {
    const district = adm2[Number(path.dataset.i)];
    const state = S.alarmFill && hasDistricts
      ? raionStatus(district)
      : 'none';

    path.dataset.state = state;

    if (state === 'full') {
      path.setAttribute('fill', 'rgba(203,42,32,.30)');
      path.setAttribute('fill-opacity', '1');
      path.setAttribute('stroke', 'rgba(145,35,28,.95)');
      path.setAttribute('stroke-width', '1.15');
    } else if (state === 'partial') {
      path.setAttribute('fill', 'rgba(203,42,32,.14)');
      path.setAttribute('fill-opacity', '1');
      path.setAttribute('stroke', 'rgba(145,35,28,.80)');
      path.setAttribute('stroke-width', '1.0');
    } else {
      path.setAttribute('fill-opacity', '0');
      path.setAttribute('stroke', 'rgba(58,42,38,.62)');
      path.setAttribute('stroke-width', '0.85');
    }

    // Контур району завжди суцільний, без пунктиру
    path.removeAttribute('stroke-dasharray');
  });

  const frontLayer = $('#frontG');
  if (frontLayer) {
    frontLayer.setAttribute(
      'display',
      S.frontLine ? 'inline' : 'none'
    );
  }

  const dimmer = $('#dimmer');
  if (dimmer) {
    dimmer.setAttribute(
      'display',
      S.dim ? 'inline' : 'none'
    );
  }
}

/* ═════ цілі ═════ */
function near(lo,la,arr){let b=arr[0],d=1e9;for(const c of arr){const k=(c[1]-lo)**2*0.44+(c[2]-la)**2;if(k<d){d=k;b=c;}}return b;}
function oblastAt(lo,la){for(const a of adm2)if(insideGeom(lo,la,a.g))return a.oblastUa||a.name;if(la<46.3&&lo>32.4&&lo<36.7)return CRN;return near(lo,la,OBL)[0];}
const DIRS=['північний','північно-східний','східний','південно-східний','південний','південно-західний','західний','північно-західний'];
const dirName=h=>DIRS[Math.round((((h%360)+360)%360)/45)%8];

function spawn(quiet){
  const t=pick(TYPES);let lo,la,hd,r=Math.random();
  if(t.role==='avia'||t.id==='kab'||t.id==='fpv'||t.id==='molnia'){
    const f=(frontRings[0]||FRONT)[(Math.random()*(frontRings[0]||FRONT).length)|0];
    lo=f[0]+rnd(0.3,1.5);la=f[1]+rnd(-0.5,0.5);hd=rnd(235,305);
  }else if(r<0.42){lo=rnd(30.4,39.6);la=52.5;hd=rnd(150,215);}
  else if(r<0.76){lo=40.4;la=rnd(47.8,51.6);hd=rnd(230,292);}
  else{lo=rnd(30.4,36.6);la=44.3;hd=rnd(340,395)%360;}
  const tg={t,lo,la,hd,sp:rnd(t.sp[0],t.sp[1]),alt:Math.round(rnd(t.alt[0],t.alt[1])/50)*50,
    born:performance.now(),trail:[w8(lo,la)],lastTrail:0,el:null};
  targets.push(tg);
  if(!quiet){
    const dst=near(lo+Math.sin(hd*Math.PI/180)*2.4,la+Math.cos(hd*Math.PI/180)*2.4,CITY);
    log(t,'<b>'+t.n+'</b> · '+oblastAt(lo,la)+', курс '+dirName(hd),'орієнтовно на '+dst[0]);
    if(S.sound&&t.role==='msl')beep(t.id==='ball'?520:380);
  }
}
function mkEl(tg){
  const d=document.createElement('div');
  d.className='tgt fresh';d.style.setProperty('--tc',tg.t.c);
  d.innerHTML='<svg class="ico" viewBox="0 0 100 100"><use href="#'+tg.t.ic+'" width="100" height="100"/></svg>'+
              '<div class="tag"><span>'+tg.t.n+'</span><em></em></div>';
  $('#marks').appendChild(d);
  tg.el=d;tg.ico=d.querySelector('.ico');tg.tag=d.querySelector('.tag');tg.em=d.querySelector('em');
  setTimeout(()=>d.classList.remove('fresh'),650);
}
function renderTargets(){
  let n=0,by={uav:0,msl:0,avia:0,kab:0};
  for(const tg of targets){
    if(!tg.el)mkEl(tg);
    if(S.off.has(tg.t.id)){tg.el.style.display='none';continue;}
    tg.el.style.display='';n++;by[tg.t.role]++;
    const [x,y]=screenOf(tg.lo,tg.la);
    tg.el.style.transform='translate3d('+x.toFixed(1)+'px,'+y.toFixed(1)+'px,0)';
    const px=Math.round(30*S.size);
    tg.ico.style.width=px+'px';tg.ico.style.height=px+'px';
    tg.ico.style.transform='translate(-50%,-50%) rotate('+tg.hd.toFixed(1)+'deg)';
    tg.tag.style.display=S.labels?'':'none';
    tg.tag.style.left=(px*0.55+5)+'px';
    tg.tag.style.top='-11px';
    if(S.meta){tg.em.style.display='';tg.em.textContent=Math.round(tg.sp)+' км/год · '+tg.alt.toLocaleString('uk-UA')+' м · '+Math.round(tg.hd)+'°';}
    else tg.em.style.display='none';
  }
  $('#totN').textContent=n;
  $('#chips').innerHTML=Object.keys(ROLE).map(r=>
    '<span class="chip"><i style="background:'+ROLE[r][1]+'"></i>'+ROLE[r][0]+' <b>'+by[r]+'</b></span>').join('');
}
function renderTrails(){
  const g=$('#trails');if(!g)return;
  if(!S.trails){g.innerHTML='';return;}
  g.innerHTML=targets.filter(t=>!S.off.has(t.t.id)&&t.trail.length>1).map(t=>
    '<path d="M'+t.trail.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join('L')+
    '" fill="none" stroke="'+t.t.c+'" stroke-opacity=".4" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>').join('');
}

const SPEEDUP=42;let last=performance.now();
function loop(now){
  const dt=Math.min(now-last,150);last=now;
  const hrs=dt/3600000*SPEEDUP;
  for(let i=targets.length-1;i>=0;i--){
    const tg=targets[i],r=tg.hd*Math.PI/180;
    tg.la+=Math.cos(r)*tg.sp*hrs/111;
    tg.lo+=Math.sin(r)*tg.sp*hrs/(111*Math.cos(tg.la*Math.PI/180));
    tg.hd+=Math.sin(now/2600+i)*0.028;
    if(now-tg.lastTrail>1400){tg.lastTrail=now;tg.trail.push(w8(tg.lo,tg.la));if(tg.trail.length>14)tg.trail.shift();}
    if(tg.lo<21||tg.lo>41.4||tg.la<43.4||tg.la>53.2||now-tg.born>210000){
      if(tg.el)tg.el.remove();targets.splice(i,1);
      if(Math.random()<0.5)log(tg.t,'<b>Ціль збита</b> · '+oblastAt(tg.lo,tg.la),tg.t.n+', супровід завершено','down');
    }
  }
  renderTargets();
  requestAnimationFrame(loop);
}

/* ═════ стрічка ═════ */
function log(type,html,sub,kind){
  const li=document.createElement('li');li.dataset.k=kind||'move';
  const ico=type?'<svg class="ic" viewBox="0 0 100 100"><use href="#'+type.ic+'" width="100" height="100"/></svg>'
   :'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="'+(kind==='alarm'?'rgb(190,40,26)':'currentColor')+'" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM10 20h4"/></svg>';
  li.innerHTML='<time>'+hhmm(new Date())+'</time><div><div class="txt">'+ico+'<span>'+html+'</span></div>'+(sub?'<div class="sub">'+sub+'</div>':'')+'</div>';
  const f=$('#feed'),em=f.querySelector('.empty');if(em)em.remove();
  f.prepend(li);
  while(f.children.length>45)f.lastElementChild.remove();
  $('#roll').innerHTML='<span>'+hhmm(new Date())+' &nbsp;·&nbsp; '+html.replace(/<[^>]+>/g,'')+(sub?' · '+sub:'')+'</span>';
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

 /* що почалось / скінчилось з минулого разу → у стрічку «Ефір» */
 const A=getAlerts();
 const {started,ended}=diffAlarms();
 const LVL={oblast:'на всю область',raion:'районний рівень',hromada:'громада',city:'місто'};

 for(const title of started){
 const a=A.get(title);
 log(null,'<b>Повітряна тривога</b> · '+esc(title),a?.notes||LVL[a?.level]||'','alarm');
 if(S.sound)beep(300);
 }
 for(const title of ended){
 log(null,'<b>Відбій тривоги</b> · '+esc(title),'','down');
 }

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
      '<svg class="gl" viewBox="0 0 100 100"><use href="#'+t.ic+'" width="100" height="100"/></svg>'+
      '<span class="nm">'+t.n+'</span><span class="box"></span></button></li>';
  }
  $('#typeList').innerHTML=html;
}
function sync(){
  $$('.sw').forEach(b=>b.setAttribute('aria-checked',String(S[b.dataset.p])));
  $$('.chk').forEach(b=>b.setAttribute('aria-checked',String(!S.off.has(b.dataset.t))));
  $('#rSize').value=S.size;
  $('#vSize').textContent=S.size.toFixed(1).replace('.',',')+'×';
  renderTargets();renderTrails();paintAlarms();
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
    drawTiles();renderTargets();
    if(k<1)requestAnimationFrame(step);
  })(t0);
}
let redrawQueued=false;
function redrawMap(){if(redrawQueued)return;redrawQueued=true;requestAnimationFrame(()=>{redrawQueued=false;drawTiles();renderTargets();});}
function zoomAt(dz,px,py){
  const [w,h]=size();
  if(px==null){px=w/2;py=h/2;}
  const [la,lo]=latlngAt(px,py);
  const nz=Math.max(MINZ,Math.min(MAXZ,view.zoom+dz));
  if(nz===view.zoom)return;
  view.zoom=nz;
  view.lon=x2lon(lon2x(lo,nz)-(px-w/2),nz);
  view.lat=y2lat(lat2y(la,nz)-(py-h/2),nz);
  drawTiles();renderTargets();
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
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)lastD=0;if(!pts.size)el.classList.remove('drag');};
  el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  el.addEventListener('wheel',e=>{e.preventDefault();const r=el.getBoundingClientRect();
    zoomAt(-e.deltaY*(e.deltaMode===1?0.05:0.0022),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  el.addEventListener('dblclick',e=>{const r=el.getBoundingClientRect();zoomAt(1,e.clientX-r.left,e.clientY-r.top);});
})();

document.addEventListener('click',e=>{
  const tab=e.target.closest('.tab');
  if(tab){$$('.tab').forEach(t=>t.setAttribute('aria-selected',String(t===tab)));
    $$('.pane').forEach(p=>p.toggleAttribute('data-on',p.dataset.pane===tab.dataset.pane));
    $('#rail').classList.add('tall');return;}
  const sw=e.target.closest('.sw');
  if(sw){S[sw.dataset.p]=!S[sw.dataset.p];sync();if(sw.dataset.p==='sound'&&S.sound)beep(440);return;}
  const chk=e.target.closest('.chk');
  if(chk){const id=chk.dataset.t;S.off.has(id)?S.off.delete(id):S.off.add(id);sync();return;}
  if(e.target.closest('#reset')){Object.assign(S,DEF);S.off=new Set();sync();toast('Налаштування скинуто');return;}
  const bm=e.target.closest('.basemaps button');if(bm){setBase(bm.dataset.bm);return;}
  if(e.target.closest('#zin')){zoomAt(1);return;}
  if(e.target.closest('#zout')){zoomAt(-1);return;}
  if(e.target.closest('#home')){flyTo(48.55,31.4,6.1);return;}
  if(e.target.closest('#handle')){$('#rail').classList.toggle('tall');return;}
  if(e.target.closest('#openSupport')){$('#dSupport').showModal();return;}
  if(e.target.closest('#closeSupport')){$('#dSupport').close();return;}
  const cp=e.target.closest('#copyCard');
  if(cp){if(navigator.clipboard)navigator.clipboard.writeText('4874100031515474');
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
  $('#vSize').textContent=S.size.toFixed(1).replace('.',',')+'×';renderTargets();});

/* ═════ СТАРТ ═════ */
await loadMapData();

buildTypes();
buildVector();
drawTiles();
sync();

$('#feed').innerHTML =
  '<li class="empty">Очікування даних з каналу…</li>';

/* Перший реальний запит тривог */
await pollAlerts();

for(let i = 0; i < 11; i++) spawn(true);

[
  ['shahed', 'Чернігівська обл., курс південний', 'орієнтовно на Київ'],
  ['x101', 'Полтавська обл., курс західний', 'орієнтовно на Кременчук'],
  ['ball', 'Харківська обл., пуск з півночі', 'швидкісна ціль'],
  ['ball', 'Донецька обл., балістична ціль', 'швидкісна ціль']
].forEach((a, i) => {
  setTimeout(() => {
    log(T[a[0]], '<b>' + T[a[0]].n + '</b> · ' + a[1], a[2]);
  }, i * 60);
});

new ResizeObserver(() => {
  drawTiles();
  renderTargets();
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

setInterval(renderTrails, 1500);
requestAnimationFrame(loop);
setTimeout(() => $('#boot').classList.add('gone'), 1200);

})();