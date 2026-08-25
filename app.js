const CITIES = [
  ['Budapest',47.4979,19.0402],['Debrecen',47.5316,21.6273],['Szeged',46.2530,20.1414],['Pécs',46.0727,18.2323],
  ['Győr',47.6875,17.6504],['Miskolc',48.1035,20.7784],['Nyíregyháza',47.9554,21.7167],['Kecskemét',46.8964,19.6897],
  ['Székesfehérvár',47.1860,18.4221],['Szolnok',47.1621,20.1825],['Sopron',47.6817,16.5845],['Eger',47.9025,20.3772],
  ['Kaposvár',46.3594,17.7968],['Zalaegerszeg',46.8417,16.8416],['Veszprém',47.0929,17.9133],['Tatabánya',47.5862,18.3940],
  ['Békéscsaba',46.6736,21.0877],['Szombathely',47.2307,16.6218],['Salgótarján',48.0935,19.7999],['Dunaújváros',46.9619,18.9355]
].map(([name,lat,lng])=>({name,lat,lng}));

const map=L.map('map',{
  zoomControl:false,attributionControl:false,preferCanvas:true,
  minZoom:5.5,maxZoom:12,zoomSnap:.1,zoomDelta:.5,
  scrollWheelZoom:true,doubleClickZoom:true,tap:true,worldCopyJump:false
});

const NE='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const NE_COUNTRIES=NE+'ne_10m_admin_0_countries.geojson';
const NE_LAKES=NE+'ne_10m_lakes.geojson';
const NE_RIVERS=NE+'ne_10m_rivers_europe.geojson';
const neighbors=new Set(['Austria','Slovakia','Ukraine','Romania','Serbia','Croatia','Slovenia']);

map.createPane('landPane');map.getPane('landPane').style.zIndex=250;
map.createPane('reliefPane');map.getPane('reliefPane').style.zIndex=300;
map.createPane('borderPane');map.getPane('borderPane').style.zIndex=410;
map.createPane('waterPane');map.getPane('waterPane').style.zIndex=430;

// 1) Tiszta országfelületek: Magyarország fehér, a környezet nagyon halvány szürke.
fetch(NE_COUNTRIES).then(r=>r.json()).then(data=>{
  L.geoJSON(data,{
    pane:'landPane',
    style:f=>{
      const n=f?.properties?.ADMIN||'';
      const hu=n==='Hungary';
      const near=neighbors.has(n);
      return {color:'transparent',weight:0,fillColor:hu?'#ffffff':near?'#f0f3f5':'#f7f8f9',fillOpacity:hu?1:.95,interactive:false};
    }
  }).addTo(map);

  // 2) Pontosan ugyanarra a geometriára kerül a határ.
  L.geoJSON(data,{
    pane:'borderPane',
    style:f=>{
      const n=f?.properties?.ADMIN||'';
      const hu=n==='Hungary';
      const near=neighbors.has(n);
      return {color:hu?'#4c5661':near?'#87929d':'#c5cbd1',weight:hu?2.2:near?1.05:.65,opacity:hu?1:.7,fill:false,interactive:false};
    }
  }).addTo(map);
}).catch(e=>console.warn('Natural Earth országok:',e));

// 3) Valódi hillshade, feliratok és utak nélkül.
const relief=L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  {pane:'reliefPane',maxZoom:12,maxNativeZoom:12,opacity:.64,className:'hillshade-primary',crossOrigin:true,updateWhenZooming:true,keepBuffer:3}
).addTo(map);

// 4) 10m-es tavak: a Balaton, Velencei-tó, Fertő-tó és a kisebb vízfelületek valódi geometriával.
fetch(NE_LAKES).then(r=>r.json()).then(data=>{
  L.geoJSON(data,{
    pane:'waterPane',
    style:{color:'#52bce8',weight:1.05,opacity:1,fillColor:'#9cdef3',fillOpacity:.92},
    interactive:false
  }).addTo(map);
}).catch(e=>console.warn('Natural Earth tavak:',e));

// 5) Európa 10m-es folyóhálózata. A fő folyók hangsúlyosak, a kisebbek finomabbak.
fetch(NE_RIVERS).then(r=>r.json()).then(data=>{
  L.geoJSON(data,{
    pane:'waterPane',
    style:f=>{
      const p=f?.properties||{};
      const rank=Number(p.scalerank ?? p.scale_rank ?? 6);
      const name=String(p.name_en||p.name||'');
      const major=/Danube|Duna|Tisza|Drava|Sava|Mura|Rába|Raab/i.test(name);
      return {color:'#4bb9e6',weight:major?2.25:(rank<=4?1.45:.8),opacity:major?1:.72,interactive:false};
    }
  }).addTo(map);
}).catch(e=>console.warn('Natural Earth folyók:',e));

let target=null,attempts=0,used=[];
const guessMarkers=[];
const cityEl=document.getElementById('city'),attemptEl=document.getElementById('attempt'),feedbackEl=document.getElementById('feedback');
const nextBtn=document.getElementById('next'),resultEl=document.getElementById('result'),drawer=document.getElementById('drawer');

function distanceKm(a,b){const R=6371,p=Math.PI/180,dLat=(b.lat-a.lat)*p,dLon=(b.lng-a.lng)*p;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function bearing(a,b){const p=Math.PI/180,y=Math.sin((b.lng-a.lng)*p)*Math.cos(b.lat*p);const x=Math.cos(a.lat*p)*Math.sin(b.lat*p)-Math.sin(a.lat*p)*Math.cos(b.lat*p)*Math.cos((b.lng-a.lng)*p);return (Math.atan2(y,x)*180/Math.PI+360)%360;}
function direction(deg){const d=[['Észak','↑'],['Északkelet','↗'],['Kelet','→'],['Délkelet','↘'],['Dél','↓'],['Délnyugat','↙'],['Nyugat','←'],['Északnyugat','↖']];return d[Math.round(deg/45)%8];}
function setFeedback(label,arrow='—',distance=''){feedbackEl.innerHTML=`<span class="feedback-arrow">${arrow}</span><strong>${label}${distance?`<br><small>${distance}</small>`:''}</strong>`;}
function clearMarkers(){guessMarkers.forEach(m=>m.remove());guessMarkers.length=0;}
function addGuessMarker(latlng){const icon=L.divIcon({className:'guess-marker',iconSize:[40,40],iconAnchor:[20,20],html:'<span></span>'});const m=L.marker(latlng,{icon,interactive:false,zIndexOffset:1000}).addTo(map);guessMarkers.push(m);}
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
setTimeout(()=>map.invalidateSize(),250);
window.addEventListener('resize',()=>map.invalidateSize());
