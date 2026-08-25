const CITIES = [
  ['Budapest',47.4979,19.0402],['Debrecen',47.5316,21.6273],['Szeged',46.2530,20.1414],['Pécs',46.0727,18.2323],
  ['Győr',47.6875,17.6504],['Miskolc',48.1035,20.7784],['Nyíregyháza',47.9554,21.7167],['Kecskemét',46.8964,19.6897],
  ['Székesfehérvár',47.1860,18.4221],['Szolnok',47.1621,20.1825],['Sopron',47.6817,16.5845],['Eger',47.9025,20.3772],
  ['Kaposvár',46.3594,17.7968],['Zalaegerszeg',46.8417,16.8416],['Veszprém',47.0929,17.9133],['Tatabánya',47.5862,18.3940],
  ['Békéscsaba',46.6736,21.0877],['Szombathely',47.2307,16.6218],['Salgótarján',48.0935,19.7999],['Dunaújváros',46.9619,18.9355]
].map(([name,lat,lng])=>({name,lat,lng}));

const map = L.map('map',{
  zoomControl:false, attributionControl:false, preferCanvas:true,
  zoomSnap:.25, zoomDelta:.25, minZoom:5.25, maxZoom:13,
  scrollWheelZoom:true, doubleClickZoom:false, tap:true
});

const DATA='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const neighbors=new Set(['Austria','Slovakia','Ukraine','Romania','Serbia','Croatia','Slovenia']);
let countryFill=null, borderLayer=null, hillshade=null, riverLayer=null, lakeLayer=null;

map.getContainer().classList.add('clean-terrain-map');

// Dedicated panes keep the map visually clean and, importantly, keep relief visible over land.
map.createPane('reliefPane');
map.getPane('reliefPane').style.zIndex=300;
map.createPane('borderPane');
map.getPane('borderPane').style.zIndex=410;
map.createPane('waterPane');
map.getPane('waterPane').style.zIndex=420;

fetch(DATA+'ne_50m_admin_0_countries.geojson').then(r=>r.json()).then(countries=>{
  countryFill=L.geoJSON(countries,{
    style:f=>{
      const name=f?.properties?.ADMIN||'';
      return {
        color:'transparent',weight:0,
        fillColor:name==='Hungary'?'#ffffff':(neighbors.has(name)?'#f0f2f4':'#f6f7f8'),
        fillOpacity:name==='Hungary'?.98:.9,
        interactive:false
      };
    }
  }).addTo(map);

  hillshade=L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    {
      pane:'reliefPane',maxZoom:13,maxNativeZoom:13,opacity:.9,
      className:'hillshade-tiles',crossOrigin:true,updateWhenZooming:true,keepBuffer:2
    }
  ).addTo(map);

  borderLayer=L.geoJSON(countries,{
    pane:'borderPane',
    style:f=>{
      const hungary=f?.properties?.ADMIN==='Hungary';
      const name=f?.properties?.ADMIN||'';
      return {
        color:hungary?'#4a5560':(neighbors.has(name)?'#8b96a1':'#c0c6cc'),
        weight:hungary?2.35:.9,
        opacity:hungary?.98:.72,
        fill:false,interactive:false
      };
    }
  }).addTo(map);
}).catch(err=>console.warn('Országrétegek:',err));

Promise.all([
  fetch(DATA+'ne_50m_rivers_lake_centerlines.geojson').then(r=>r.json()),
  fetch(DATA+'ne_50m_lakes.geojson').then(r=>r.json())
]).then(([rivers,lakes])=>{
  lakeLayer=L.geoJSON(lakes,{
    pane:'waterPane',
    style:{color:'#58bfe8',weight:1.25,opacity:1,fillColor:'#8edaf2',fillOpacity:.96},
    interactive:false
  }).addTo(map);
  riverLayer=L.geoJSON(rivers,{
    pane:'waterPane',
    style:{color:'#5fc3e9',weight:1.45,opacity:.96},
    interactive:false
  }).addTo(map);
}).catch(err=>console.warn('Vízrétegek:',err));

let target=null, attempts=0, used=[];
const guessMarkers=[];
const cityEl=document.getElementById('city');
const attemptEl=document.getElementById('attempt');
const feedbackEl=document.getElementById('feedback');
const nextBtn=document.getElementById('next');
const resultEl=document.getElementById('result');
const drawer=document.getElementById('drawer');

function distanceKm(a,b){const R=6371,p=Math.PI/180,dLat=(b.lat-a.lat)*p,dLon=(b.lng-a.lng)*p;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function bearing(a,b){const p=Math.PI/180,y=Math.sin((b.lng-a.lng)*p)*Math.cos(b.lat*p);const x=Math.cos(a.lat*p)*Math.sin(b.lat*p)-Math.sin(a.lat*p)*Math.cos(b.lat*p)*Math.cos((b.lng-a.lng)*p);return (Math.atan2(y,x)*180/Math.PI+360)%360;}
function direction(deg){const dirs=[['Észak','↑'],['Északkelet','↗'],['Kelet','→'],['Délkelet','↘'],['Dél','↓'],['Délnyugat','↙'],['Nyugat','←'],['Északnyugat','↖']];return dirs[Math.round(deg/45)%8];}
function setFeedback(label,arrow='—',distance=''){feedbackEl.innerHTML=`<span class="feedback-arrow">${arrow}</span><strong>${label}${distance?`<br><small>${distance}</small>`:''}</strong>`;}
function clearMarkers(){guessMarkers.forEach(m=>m.remove());guessMarkers.length=0;}
function addGuessMarker(latlng){const icon=L.divIcon({className:'guess-marker',iconSize:[32,32],iconAnchor:[16,16],html:'<span></span>'});const m=L.marker(latlng,{icon,interactive:false,zIndexOffset:1000}).addTo(map);guessMarkers.push(m);}
function chooseTarget(){let pool=CITIES.filter(c=>!used.includes(c.name));if(!pool.length){used=[];pool=CITIES;}target=pool[Math.floor(Math.random()*pool.length)];used.push(target.name);cityEl.textContent=target.name;attempts=0;attemptEl.textContent='1 / 3';nextBtn.disabled=true;resultEl.classList.remove('show');resultEl.textContent='';setFeedback('Tippelj a térképen');clearMarkers();}
function newGame(){used=[];chooseTarget();map.setView([47.15,19.35],6.15,{animate:false});}
function finishRound(){nextBtn.disabled=false;}
function guess(latlng){if(!target||attempts>=3)return;attempts++;addGuessMarker(latlng);const d=distanceKm(latlng,target);const [dir,arrow]=direction(bearing(latlng,target));const remaining=3-attempts;setFeedback(dir,arrow,`${d.toFixed(1)} km`);attemptEl.textContent=`${Math.min(attempts+1,3)} / 3`;
  if(d<=20){resultEl.textContent=`🎯 Talált! ${d.toFixed(1)} km-re voltál.`;resultEl.classList.add('show');finishRound();return;}
  if(attempts>=3){resultEl.textContent=`❌ Nem sikerült – ${d.toFixed(1)} km-re voltál.`;resultEl.classList.add('show');finishRound();}
  else{resultEl.textContent=`${d.toFixed(1)} km • ${dir} irányban van • még ${remaining} próbálkozás`;resultEl.classList.add('show');setTimeout(()=>resultEl.classList.remove('show'),2400);}
}

map.on('click',e=>guess(e.latlng));
document.getElementById('zoomIn').addEventListener('click',()=>map.zoomIn(.5));
document.getElementById('zoomOut').addEventListener('click',()=>map.zoomOut(.5));
nextBtn.addEventListener('click',chooseTarget);
document.getElementById('menu').addEventListener('click',openDrawer);
document.getElementById('infoToggle').addEventListener('click',openDrawer);
document.getElementById('closeMenu').addEventListener('click',closeDrawer);
document.getElementById('drawerBackdrop').addEventListener('click',closeDrawer);
document.getElementById('newGame').addEventListener('click',()=>{closeDrawer();newGame();});
function openDrawer(){drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');document.getElementById('menu').setAttribute('aria-expanded','true');document.getElementById('infoToggle').setAttribute('aria-expanded','true');}
function closeDrawer(){drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.getElementById('menu').setAttribute('aria-expanded','false');document.getElementById('infoToggle').setAttribute('aria-expanded','false');}

map.setView([47.15,19.35],6.15,{animate:false});
chooseTarget();
setTimeout(()=>map.invalidateSize(),100);
window.addEventListener('resize',()=>map.invalidateSize());
