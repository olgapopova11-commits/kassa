/* Silver — касса и учёт MOON и Sunshine. Данные: Supabase. */
'use strict';
const INIT_HASH = location.hash;
const SB_URL = 'https://ottuadjdksxipfjytlyv.supabase.co';
const SB_KEY = 'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const POS_PAY = ['cash','card','certificate'];
const PAY = { cash:'Наличные', card:'Карта', kaspi_qr:'Kaspi QR', transfer:'Перевод', invoice:'По счёту', bonus:'Бонусы', certificate:'Сертификат' };
const ROLE = { owner:'Владелец', manager:'Менеджер', consultant:'Консультант', purchaser:'Закуп', viewer:'Управленец Астаны', accountant:'Бухгалтер' };
const BRAND = { moon:'MOON', sunshine:'Sunshine' };

const S = {
  me:null, stores:[], store:null, view:(location.hash.startsWith('#ph=')?'po':(location.hash.slice(1).replace(/[^a-z]/g,'')||'pos')), catalog:[], catalogAt:null,
  q:'', found:[], stock:{},
  cf:{ st:'active', q:'', store:'' }, cart:[], discType:'pct', disc:0, pays:{}, certCode:'', cert:null, certQ:'', certList:null,
  phone:'', cust:null, custMsg:'', bonusSpend:0,
  sales:[], salesQ:'', stockQ:'', stockRows:[], certs:[], emps:[], busy:false,
  sel:null, period:'30', from:'', to:'', an:null, anMode:'sales', sa:null, saGroup:'category', saFilter:{}, saItems:null, saKey:null, stockSort:'total', stockDir:'desc', wmode:null, nm:{ q:'', cat:'', arch:false, off:0, data:null, cats:null, ed:null, sq:'', sfound:[], busy:false }, st:{ site:'moon', status:'review', q:'', off:0, data:null, open:null, cands:null, cq:'', cfound:[] }, doc:null, dq:'', dfound:[], audit:null, auditRows:[], whList:[], trList:[],
};

/* ---------- утилиты ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => Math.round(Number(n)||0).toLocaleString('ru-RU').replace(/ |,/g,' ') + ' ₸';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c=='x'?r:(r&3|8)).toString(16)}));
const isBoss = () => S.me && ['owner','manager','viewer','accountant'].includes(S.me.role);  // видит всё; viewer — без изменений
const isViewer = () => S.me && ['viewer','accountant'].includes(S.me.role);
// может ли текущий пользователь менять данные магазина (менеджер — только свой город)
const canEdit = st => { const m = S.me; if(!m) return false; if(m.role==='owner') return true; if(m.role==='viewer') return false;
  if(m.role==='manager') return !m.store_ids || !m.store_ids.length || m.store_ids.includes(+st); return (m.store_ids||[]).includes(+st); };
const store = () => S.allStores.find(s => s.id === S.store) || {};
const storeName = id => { const s = S.allStores.find(x=>x.id===id); return s ? `${BRAND[s.brand]} · ${s.address}` : '—'; };
function selStores(){
  if(!isBoss()) return [S.store];
  if(!S.sel) S.sel = ls.get('kassa_sel', null) || S.stores.map(s=>s.id);
  return S.sel.filter(id => S.stores.some(s=>s.id===id));
}
function storeFilterHtml(){
  if(!isBoss()) return `<div class="meta">${esc(storeName(S.store))}</div>`;
  const sel = selStores(), all = sel.length === S.stores.length;
  const groups = [['all','Все'],['moon','Все MOON'],['sunshine','Все Sunshine'],['Алматы','Алматы'],['Астана','Астана']];
  return `<div class="filters" style="align-items:center">
    ${groups.map(([k,t])=>`<button class="btn small" data-sgroup="${k}">${t}</button>`).join('')}
    ${S.stores.map(st=>`<label class="chip ${sel.includes(st.id)?'ok':''}" style="cursor:pointer;padding:4px 10px"><input type="checkbox" data-sone="${st.id}" ${sel.includes(st.id)?'checked':''} style="margin-right:4px">${esc(BRAND[st.brand]+' · '+st.address)}</label>`).join('')}
    <span class="meta">${all?'выбраны все магазины — нажмите на магазин, чтобы смотреть только его':'выбрано: '+sel.length+' · нажатие добавляет или убирает магазин'}</span></div>`;
}
async function onSelChange(){
  ls.set('kassa_sel', S.sel);
  // выбран один магазин — он же становится «текущим» для экранов одного магазина (дела продавца, фотосессия, табель)
  if(S.sel.length===1 && S.store!==S.sel[0] && S.stores.some(s=>s.id===S.sel[0])) setStore(S.sel[0]);
  if(S.view==='sales') await loadSales();
  if(S.view==='analytics') await loadAnalytics();
  if(S.view==='shifts') await loadShifts();
  if(S.view==='cash') await loadCash();
  if(S.view==='pay') await loadPay();
  if(S.view==='profit') await loadProfit();
  if(S.view==='flow') await loadFlow();
  render();
}
function normPhone(v){ let d=String(v||'').replace(/\D/g,''); if(d.length===11&&(d[0]==='7'||d[0]==='8')) d=d.slice(1); if(d.length===10) return '+7'+d; return null; }
function toast(t){ const el=document.createElement('div'); el.className='toast'; el.textContent=t; document.body.append(el); setTimeout(()=>el.remove(),3200); }
const ls = { get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d }catch(e){ return d } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)) }catch(e){} } };
const thumbUrl = u => /alicdn\.com/.test(u) ? u.replace(/(_\d+x\d+.*)?$/,'_160x160.jpg') : u.replace('static.tildacdn.pro/','thumb.tildacdn.pro/').replace(/\/([^/]+)$/,'/-/resize/120x/$1');
// увеличенное фото при наведении на миниатюру (на телефоне — по касанию и удержанию)
(() => {
  let box;
  const show = (img, x, y) => {
    if(!box){ box = document.createElement('div'); box.id = 'zoom-pop'; box.style.cssText = 'position:fixed;z-index:50;pointer-events:none;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:none'; box.innerHTML = '<img referrerpolicy="no-referrer" style="display:block;width:300px;height:300px;object-fit:contain;border-radius:8px">'; document.body.appendChild(box); }
    const im = box.firstChild, src = img.dataset.full || img.src; if(im.getAttribute('src') !== src) im.src = src;
    const W = 312, H = 312, left = x + 20 + W > innerWidth ? Math.max(8, x - W - 20) : x + 20, top = Math.min(Math.max(8, y - H/2), innerHeight - H - 8);
    box.style.left = left + 'px'; box.style.top = top + 'px'; box.style.display = 'block';
  };
  const hide = () => { if(box) box.style.display = 'none'; };
  document.addEventListener('mouseover', e => { const im = e.target.closest && e.target.closest('img.thumb'); if(im) show(im, e.clientX, e.clientY); });
  document.addEventListener('mousemove', e => { const im = e.target.closest && e.target.closest('img.thumb'); if(im) show(im, e.clientX, e.clientY); else hide(); });
  document.addEventListener('touchstart', e => { const im = e.target.closest && e.target.closest('img.thumb'); if(im){ const t = e.touches[0]; show(im, t.clientX, t.clientY); } else hide(); }, { passive:true });
  document.addEventListener('scroll', hide, true);
})();
// выпадающий список магазинов с галочками
const shortStore = id => { const s = S.allStores.find(x=>x.id===id); return s ? s.address : '—'; };
const ddSummary = ids => !ids.length ? 'не выбраны' : ids.length===S.allStores.length ? 'все магазины' : ids.slice(0,2).map(shortStore).join(', ') + (ids.length>2 ? ' +' + (ids.length-2) : '');
function storesDD(ids, attr){
  return `<details class="dd"><summary>${esc(ddSummary(ids))}</summary><div class="dd-panel">${S.allStores.map(st=>`<label><input type="checkbox" ${attr(st.id)} ${ids.includes(st.id)?'checked':''}> ${esc(BRAND[st.brand]+' · '+st.address)}</label>`).join('')}</div></details>`;
}
document.addEventListener('click', e => { document.querySelectorAll('details.dd[open]').forEach(d => { if(!d.contains(e.target)) d.removeAttribute('open'); }); });
/* ---------- анимации загрузки: 12 сценок из жизни магазина в мягком рисованном стиле, каждый раз случайная ---------- */
/* MOON & Sunshine loaders — soft hand-painted style. Call ldDefs() once, then insert ldHtml(). */
var LD_DEFS='<svg id="ldg-defs" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>'+
'<linearGradient id="ldg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9d7e3"/><stop offset=".55" stop-color="#d7e9ee"/><stop offset="1" stop-color="#fdf6e6"/></linearGradient>'+
'<linearGradient id="ldg-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd59e"/><stop offset=".6" stop-color="#9fc184"/><stop offset="1" stop-color="#86ab72"/></linearGradient>'+
'<linearGradient id="ldg-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe0c0"/><stop offset="1" stop-color="#b7cfa6"/></linearGradient>'+
'<linearGradient id="ldg-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7eedd"/><stop offset="1" stop-color="#ead9bb"/></linearGradient>'+
'<linearGradient id="ldg-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3cca6"/><stop offset=".5" stop-color="#d9c09a"/><stop offset="1" stop-color="#c9ab84"/></linearGradient>'+
'<linearGradient id="ldg-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d2a776"/><stop offset=".6" stop-color="#c89b6d"/><stop offset="1" stop-color="#a87a52"/></linearGradient>'+
'<linearGradient id="ldg-dress" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8f2e5"/><stop offset=".7" stop-color="#ece3cf"/><stop offset="1" stop-color="#dccfb4"/></linearGradient>'+
'<linearGradient id="ldg-apr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c391"/><stop offset=".7" stop-color="#eaab76"/><stop offset="1" stop-color="#d98f5c"/></linearGradient>'+
'<radialGradient id="ldg-skin" cx=".42" cy=".36" r=".72"><stop offset="0" stop-color="#fdeedf"/><stop offset=".65" stop-color="#fbe2cc"/><stop offset="1" stop-color="#efc9ab"/></radialGradient>'+
'<radialGradient id="ldg-hair" cx=".45" cy=".25" r=".8"><stop offset="0" stop-color="#7a5441"/><stop offset=".6" stop-color="#5f4031"/><stop offset="1" stop-color="#4b3128"/></radialGradient>'+
'<radialGradient id="ldg-fur" cx=".4" cy=".3" r=".75"><stop offset="0" stop-color="#fffdf7"/><stop offset=".7" stop-color="#f6efe1"/><stop offset="1" stop-color="#e3d8c3"/></radialGradient>'+
'<linearGradient id="ldg-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8e3a0"/><stop offset=".5" stop-color="#d9a94a"/><stop offset="1" stop-color="#f1cf7c"/></linearGradient>'+
'<linearGradient id="ldg-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1f8fa" stop-opacity=".85"/><stop offset="1" stop-color="#cfe3ea" stop-opacity=".6"/></linearGradient>'+
'<linearGradient id="ldg-bucket" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a3b7c3"/><stop offset=".5" stop-color="#bccbd4"/><stop offset="1" stop-color="#8399a8"/></linearGradient>'+
'<linearGradient id="ldg-pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dba07a"/><stop offset="1" stop-color="#bf7f5c"/></linearGradient>'+
'<linearGradient id="ldg-can" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd6cb"/><stop offset="1" stop-color="#8fb3a6"/></linearGradient>'+
'<radialGradient id="ldg-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff8dc" stop-opacity=".9"/><stop offset="1" stop-color="#fff8dc" stop-opacity="0"/></radialGradient>'+
'<clipPath id="ldg-c4"><rect x="57" y="25" width="28" height="36" rx="1.5"/></clipPath>'+
'<filter id="ldg-wc" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter>'+
'</defs></svg>';

function ldDefs(){ if(!document.getElementById('ldg-defs')) document.body.insertAdjacentHTML('beforeend', LD_DEFS) }

var LD_SVG=(function(){
  var OL=' stroke="#a8927a" stroke-width=".7"';
  /* arm: outlined cream sleeve + hand */
  function A(d,hx,hy){
    return '<path d="'+d+'" fill="none" stroke="#b9a68c" stroke-width="4.4" stroke-linecap="round"/>'+
      '<path d="'+d+'" fill="none" stroke="#f1e9d8" stroke-width="3" stroke-linecap="round"/>'+
      '<circle cx="'+hx+'" cy="'+hy+'" r="2.2" fill="url(#ldg-skin)" stroke="#d9a98a" stroke-width=".5"/>';
  }
  var AL=A('M38 66Q33 74 34 82',34,83), AR=A('M58 66Q63 74 62 82',62,83);
  var APR='<path d="M38 66q10-4 20 0l2 26H36z" fill="url(#ldg-apr)" stroke="#b9774a" stroke-width=".7"/>'+
    '<path d="M37 88h22" stroke="#c98455" stroke-width="1.4" opacity=".35"/><path d="M42 70h12" stroke="#fff6e8" stroke-width=".9" opacity=".8"/>';
  /* girl: o.b behind body, o.na no apron, o.m between body and head, o.x in front */
  function G(dx,dy,o){
    o=o||{};
    return '<g transform="translate('+dx+' '+dy+')"><g class="ld-bob">'+(o.b||'')+
      '<path d="M30 92q2-30 18-32t18 32z" fill="url(#ldg-dress)"'+OL+'/>'+
      '<path d="M32 90q16 4 32 0" stroke="#d2c3a6" stroke-width="1.6" fill="none" opacity=".6"/>'+
      (o.na?'':APR)+(o.m||'')+
      '<path d="M44 56h8v6h-8z" fill="url(#ldg-skin)"/><path d="M44 60q4 2 8 0" stroke="#e8bf9f" stroke-width="1" fill="none"/>'+
      '<ellipse cx="48" cy="40" rx="15" ry="16" fill="url(#ldg-skin)" stroke="#d9a98a" stroke-width=".6"/>'+
      '<g class="ld-hair"><path d="M32 42q-2-22 16-22t17 22q-3-10-9-12-4 6-14 6-6 0-10 6z" fill="url(#ldg-hair)"/>'+
      '<path d="M33 40q-4 14 2 22M63 40q4 14-2 22" fill="none" stroke="#5a3b2e" stroke-width="3" stroke-linecap="round"/>'+
      '<path d="M38 24q10-6 22 2" fill="none" stroke="#e9c79a" stroke-width="2.2" stroke-linecap="round" opacity=".85"/></g>'+
      '<g class="ld-eye"><ellipse cx="42" cy="43" rx="1.8" ry="2.4" fill="#3b2a24"/><ellipse cx="54" cy="43" rx="1.8" ry="2.4" fill="#3b2a24"/>'+
      '<circle cx="42.6" cy="42.2" r=".6" fill="#fff"/><circle cx="54.6" cy="42.2" r=".6" fill="#fff"/></g>'+
      '<ellipse cx="38.5" cy="48" rx="3" ry="1.6" fill="#f1a7a0" opacity=".55"/><ellipse cx="57.5" cy="48" rx="3" ry="1.6" fill="#f1a7a0" opacity=".55"/>'+
      '<path d="M46 50q2 1.6 4 0" fill="none" stroke="#a5605a" stroke-width="1" stroke-linecap="round"/>'+
      (o.x||'')+'</g></g>';
  }
  /* original companion: tiny fluffy moon-rabbit with golden crescent mark */
  function R(x,y,cls){
    return '<g transform="translate('+x+' '+y+')"><g class="'+(cls||'ld-hop')+'">'+
      '<ellipse cx="0" cy="9.2" rx="6" ry="1.2" fill="#8a7a5c" opacity=".18"/>'+
      '<g class="ld-ear"><path d="M-2.6-4q-2.4-7-.2-9.6 2 1.6 1.6 9.6z" fill="url(#ldg-fur)" stroke="#b5a487" stroke-width=".5"/>'+
      '<path d="M1.2-4q1.4-7.4 4-8.6 1.2 2.4-1.8 9z" fill="url(#ldg-fur)" stroke="#b5a487" stroke-width=".5"/>'+
      '<path d="M-2-5q-1.2-4-.3-6.4M2.4-5q1-4 2.4-5.8" stroke="#f3c6c0" stroke-width=".9" stroke-linecap="round" fill="none"/></g>'+
      '<path d="M-6 6q-1-7 4-8.6 2-3.4 5.4-1.4 4 1.4 3.6 6 1.6 3.4-1 5.2Q2 9 -3 8.4q-3-.2-3-2.4z" fill="url(#ldg-fur)" stroke="#ad9b7c" stroke-width=".6"/>'+
      '<circle cx="5.6" cy="5" r="1.6" fill="#fffdf7" stroke="#d8ccb6" stroke-width=".35"/>'+
      '<path d="M.6-2.2a1.5 1.5 0 1 0 1.4 2.2 1.2 1.2 0 1 1-1.4-2.2z" fill="url(#ldg-gold)"/>'+
      '<circle cx="-1.4" cy="1.2" r=".75" fill="#3b2a24"/><circle cx="-1.2" cy=".9" r=".25" fill="#fff"/>'+
      '<ellipse cx="-3.4" cy="2.8" rx="1.3" ry=".7" fill="#f1a7a0" opacity=".55"/>'+
      '</g></g>';
  }
  function SPK(x,y,s,cls,st){
    return '<path class="'+cls+'"'+(st?' style="'+st+'"':'')+' d="M'+x+' '+(y-s)+'q.5 '+(s*.7)+' '+s+' '+s+'q-'+(s*.5)+' .3-'+s+' '+s+'q-.5-'+(s*.7)+'-'+s+'-'+s+'q'+(s*.5)+'-.3 '+s+'-'+s+'z" fill="#fff6cf"/>';
  }
  var BGS='<rect width="96" height="100" rx="14" fill="url(#ldg-wall)"/>'+
    '<path d="M0 74h96v12a14 14 0 0 1-14 14H14A14 14 0 0 1 0 86z" fill="url(#ldg-floor)"/>'+
    '<path d="M0 74.4h96" stroke="#c2a47c" stroke-width=".8" opacity=".7"/><path d="M6 82h28M48 87h36M16 94h30" stroke="#c4a67e" stroke-width=".5" opacity=".55"/>'+
    '<ellipse cx="20" cy="22" rx="16" ry="10" fill="url(#ldg-glow)" opacity=".7"/>';
  var BGK='<rect width="96" height="100" rx="14" fill="url(#ldg-sky)"/>'+
    '<path d="M0 70q20-12 44-6t52-4v14H0z" fill="url(#ldg-hill)"/>'+
    '<path d="M0 76q24-6 48-2t48-2v14a14 14 0 0 1-14 14H14A14 14 0 0 1 0 86z" fill="url(#ldg-grass)"/>'+
    '<path d="M10 84q1-3 2 0M22 90q1-3 2 0M74 86q1-3 2 0M84 92q1-3 2 0" stroke="#7da068" stroke-width=".6" fill="none" filter="url(#ldg-wc)"/>';
  function S(inner){return '<svg viewBox="0 0 96 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'+inner+'</svg>'}
  var sc=[];

  /* 1 greeting */
  sc.push(S(BGK+
    '<g class="ld-cloud"><path d="M12 24q0-6 7-6 3-5 9-2 6-1 6 5 4 1 3 5H14q-3 0-2-2z" fill="#fff" opacity=".9"/></g>'+
    '<ellipse class="ld-cloud ld-d1" cx="80" cy="14" rx="8" ry="3" fill="#fff" opacity=".75"/>'+
    '<path class="ld-leaf" d="M78 40q5-4 9 0-5 4-9 0z" fill="#a3c784" stroke="#7a9e62" stroke-width=".4"/>'+
    G(-4,0,{x:AL+'<g class="ld-wave" style="transform-origin:58px 66px">'+A('M58 66Q66 62 68 52',68,51)+'</g>'})+
    R(78,82)));

  /* 2 mopping */
  sc.push(S(BGS+
    '<ellipse class="ld-shine" cx="52" cy="95" rx="15" ry="2.4" fill="#fff"/>'+
    G(-12,0,{x:'<g class="ld-mop" style="transform-origin:60px 66px">'+
      '<path d="M73 44L66 88" stroke="#b5875b" stroke-width="2" stroke-linecap="round"/>'+
      A('M39 67Q52 72 70 62',70,62)+A('M57 67Q63 74 68.3 74',68.3,74)+
      '<path d="M63 89q-4 4-6 7M64.5 89q-2 4-3 7.5M66 89v7.5M67.5 89q2 4 3 7.5M69 89q4 4 6 7" stroke="#b8b0a0" stroke-width="2.8" stroke-linecap="round" fill="none"/>'+
      '<path d="M63 89q-4 4-6 7M64.5 89q-2 4-3 7.5M66 89v7.5M67.5 89q2 4 3 7.5M69 89q4 4 6 7" stroke="#fbfaf6" stroke-width="1.8" stroke-linecap="round" fill="none"/>'+
      '<rect x="62" y="86" width="8" height="3.4" rx="1.2" fill="#d9d4c7" stroke="#a8927a" stroke-width=".5"/></g>'})+
    '<path d="M87 75q-7-11-14 0" fill="none" stroke="#6f8593" stroke-width=".9"/>'+
    '<path d="M70 75h20l-2.4 18h-15.2z" fill="url(#ldg-bucket)" stroke="#71889a" stroke-width=".7"/>'+
    '<path d="M72 81h16" stroke="#dce6ec" stroke-width=".7"/>'+
    '<ellipse cx="80" cy="75" rx="10" ry="2.4" fill="#cfe6ef" stroke="#71889a" stroke-width=".7"/>'+
    '<circle class="ld-bub" cx="77" cy="74" r="1.5" fill="#f4fbff" stroke="#9cc0cf" stroke-width=".4"/>'+
    '<circle class="ld-bub ld-d1" cx="82" cy="74" r="1.1" fill="#f4fbff" stroke="#9cc0cf" stroke-width=".4"/>'+
    '<circle class="ld-bub ld-d2" cx="79.5" cy="74" r="1.3" fill="#f4fbff" stroke="#9cc0cf" stroke-width=".4"/>'));

  /* 3 packing a gift */
  sc.push(S(BGS+
    G(-14,0,{x:AL+A('M57 67Q66 67 72 63',72,63)})+
    '<path d="M63 68h22v4H63z" fill="#d6bb8d"/>'+
    '<g class="ld-drop"><rect x="69" y="64" width="10" height="9" rx="1.4" fill="#b9aee0" stroke="#8f84bf" stroke-width=".6"/>'+
    '<path d="M74 64v9M69 68h10" stroke="#fff6e8" stroke-width="1.1"/>'+
    '<path d="M74 64q-3-3.4-4.4-.4 2 1 4.4.4 3-3.4 4.4-.4-2 1-4.4.4z" fill="#fbe6ee" stroke="#c98fae" stroke-width=".4"/></g>'+
    '<path d="M62 71h24l-2 23H64z" fill="#ecd9b4" stroke="#b39672" stroke-width=".7"/>'+
    '<path d="M64 90h20" stroke="#cdb087" stroke-width="2" opacity=".45"/><path d="M63 74h22" stroke="#d8c09a" stroke-width=".6"/>'+
    '<path d="M68 72q6-12 12 0" fill="none" stroke="#a8875c" stroke-width="1.3"/>'+
    '<path d="M72.4 80.4a2.6 2.6 0 1 0 2.6 3.4 2.1 2.1 0 1 1-2.6-3.4z" fill="url(#ldg-gold)"/>'+
    R(88,86,'ld-hop ld-d2')));

  /* 4 washing a window */
  sc.push(S(BGS+
    '<rect x="54" y="22" width="34" height="42" rx="3" fill="url(#ldg-wood)" stroke="#8d6644" stroke-width=".6"/>'+
    '<rect x="57" y="25" width="28" height="36" rx="1.5" fill="url(#ldg-sky)"/>'+
    '<g clip-path="url(#ldg-c4)"><path d="M58 52q14-8 28-2v12H58z" fill="#b9d39a"/><ellipse cx="78" cy="33" rx="5" ry="2" fill="#fff" opacity=".85"/>'+
    '<path class="ld-glint" d="M50 62L62 22h5L55 62z" fill="#fff" opacity=".6"/></g>'+
    '<path d="M71 25v36M57 43h28" stroke="#b5875b" stroke-width="1.6"/>'+
    '<rect x="52" y="62" width="38" height="3.5" rx="1.2" fill="#b5875b" stroke="#8d6644" stroke-width=".5"/>'+
    G(-16,0,{b:'<g class="ld-wipe" style="transform-origin:56px 68px">'+A('M55 68Q70 62 74 47',74,47)+
      '<rect x="71" y="42" width="8" height="5.4" rx="1.8" fill="#9cc884" stroke="#6f9455" stroke-width=".5"/>'+
      '<path d="M72 43.4h6" stroke="#d6efc4" stroke-width=".7"/>'+
      '<circle cx="80.5" cy="42" r="1" fill="#fff" opacity=".8"/><circle cx="79" cy="40" r=".7" fill="#fff" opacity=".8"/></g>',x:AL})));

  /* 5 engraving a ring */
  sc.push(S(BGS+
    G(-14,0,{x:AL+'<g class="ld-engr">'+'<path d="M70 44q-4-4-2-10" stroke="#8f7a6a" stroke-width=".7" fill="none"/>'+
      '<path d="M70.5 44.6L79.6 59.6" stroke="#5f6b74" stroke-width="3.4" stroke-linecap="round"/>'+
      '<path d="M70.5 44.6L79.6 59.6" stroke="#9aa8b1" stroke-width="2" stroke-linecap="round"/>'+
      '<path d="M76.4 54.4l1.2 2" stroke="url(#ldg-gold)" stroke-width="3.2"/>'+
      '<path d="M79.6 59.6l1.6 2.6" stroke="#3f4347" stroke-width="1.2" stroke-linecap="round"/>'+
      A('M58 66Q70 64 75.4 53',75.4,53)+'</g>'})+
    '<path d="M2 70h92v4H2z" fill="#d6ab79"/><path d="M2 74h92v12a14 14 0 0 1-14 14H16A14 14 0 0 1 2 86z" fill="url(#ldg-wood)"/>'+
    '<path d="M8 80h80" stroke="#a87a52" stroke-width=".6" opacity=".6"/>'+
    '<ellipse cx="73" cy="69" rx="8" ry="2.6" fill="#b9aee0" stroke="#8f84bf" stroke-width=".5"/>'+
    '<circle cx="73" cy="61.6" r="6" fill="none" stroke="#b8893a" stroke-width="3"/>'+
    '<circle cx="73" cy="61.6" r="6" fill="none" stroke="url(#ldg-gold)" stroke-width="2.2"/>'+
    '<path d="M71 56.4q2-1 4 0" stroke="#fff7d8" stroke-width=".8" fill="none"/>'+
    SPK(67.4,62.4,2.2,'ld-spark')+'<circle class="ld-spark ld-d1" cx="65" cy="60" r=".6" fill="#f6dc8e"/>'));

  /* 6 arranging a display case */
  sc.push(S(BGS+
    G(-18,0,{x:AL+'<g class="ld-reach">'+A('M58 66Q66 62 74 56',74,56)+'</g>'})+
    '<rect x="56" y="72" width="36" height="20" rx="2" fill="url(#ldg-wood)" stroke="#8d6644" stroke-width=".6"/>'+
    '<path d="M60 78h28" stroke="#a87a52" stroke-width=".6"/>'+
    '<rect x="57" y="34" width="34" height="38" rx="2" fill="url(#ldg-glass)" stroke="#a8927a" stroke-width=".7"/>'+
    '<rect x="55" y="32" width="38" height="3" rx="1" fill="#b5875b"/>'+
    '<path d="M57 54h34" stroke="#d6c3a2" stroke-width="1.4"/>'+
    '<g class="ld-p1"><path d="M62 43q1-2 2 0M67 43q1-2 2 0" stroke="#c9993f" stroke-width=".6" fill="none"/><path d="M63 44.6q-1.6 3.4 0 5 1.6-1.6 0-5zM68 44.6q-1.6 3.4 0 5 1.6-1.6 0-5z" fill="#b9aee0" stroke="#8f84bf" stroke-width=".35"/></g>'+
    '<g class="ld-p2"><circle cx="76" cy="50.4" r="3" fill="none" stroke="url(#ldg-gold)" stroke-width="1.4"/><circle cx="76" cy="47" r="1.1" fill="#e9f3f7" stroke="#8fb7c6" stroke-width=".35"/></g>'+
    '<g class="ld-p3"><path d="M81 38l4 7 4-7" stroke="#d9a94a" stroke-width=".5" fill="none"/><path d="M84.4 45.4a2 2 0 1 0 2 2.6 1.6 1.6 0 1 1-2-2.6z" fill="url(#ldg-gold)"/></g>'+
    '<g class="ld-p4"><ellipse cx="66" cy="69" rx="5" ry="1.8" fill="none" stroke="url(#ldg-gold)" stroke-width="1.2"/><circle cx="62" cy="69" r=".9" fill="#f6efe0"/><circle cx="70" cy="69" r=".9" fill="#f6efe0"/></g>'+
    '<g class="ld-p5"><circle cx="82" cy="68" r="2.6" fill="none" stroke="#e5e8ea" stroke-width="1.2"/><circle cx="82" cy="65.2" r="1" fill="#f1a7a0"/></g>'+
    '<path d="M60 36l-2.4 9M88 58l-3 10" stroke="#fff" opacity=".75" stroke-width="1"/>'));

  /* 7 sweeping */
  sc.push(S(BGS+
    '<g class="ld-dust"><circle cx="66" cy="93" r="2.2" fill="#e9dcc4"/><circle cx="69" cy="91.6" r="1.6" fill="#efe4cf"/><circle cx="68" cy="94.6" r="1.3" fill="#e2d3b8"/></g>'+
    G(-14,0,{x:'<g class="ld-sweep" style="transform-origin:68px 66px">'+
      '<path d="M74 44L64 85" stroke="#b5875b" stroke-width="2" stroke-linecap="round"/>'+
      A('M39 67Q52 70 70 60',70,60)+A('M57 67Q62 74 67 72',67,72)+
      '<path d="M60 87h9l7 10H53z" fill="#e8cc84" stroke="#b8954f" stroke-width=".6"/>'+
      '<path d="M61.5 88l-5 9M63.5 88l-3 9M65 88v9M66.8 88l3 9M68.4 88l5 9" stroke="#c9a85e" stroke-width=".5"/>'+
      '<rect x="60" y="84.4" width="9" height="3" rx="1" fill="#9f93cf" stroke="#7d72ad" stroke-width=".4"/></g>'})));

  /* 8 putting on an apron */
  sc.push(S(BGS+
    G(0,0,{na:1,m:'<g class="ld-apron"><path d="M40 67Q42 55 48 55Q54 55 56 67" fill="none" stroke="#df9a64" stroke-width="1.3"/>'+APR+'</g>',
      x:AL+A('M58 66Q65 72 62 76',62,76)+
      '<g class="ld-tie"><path d="M60 76q5-4.4 6.4 0-1.4 4.4-6.4 0-5 4.4-6.4 0 1.4-4.4 6.4 0z" fill="#eaa874" stroke="#b9774a" stroke-width=".5"/><path d="M60 76l2.4 6M60 76l-1 6" stroke="#df9a64" stroke-width="1.2"/><circle cx="60" cy="76" r="1" fill="#d98f5c"/></g>'})+
    R(14,84,'ld-hop ld-d1')));

  /* 9 pinning a name badge */
  sc.push(S(BGS+
    G(0,0,{x:AL+AR+
      '<g class="ld-badge"><rect x="49" y="68.4" width="8.4" height="5.4" rx="1.4" fill="#fdf6e6" stroke="url(#ldg-gold)" stroke-width=".9"/>'+
      '<path d="M52.2 69.6a1.6 1.6 0 1 0 1.8 2.2 1.3 1.3 0 1 1-1.8-2.2z" fill="#b9aee0"/><circle cx="55.6" cy="71.4" r=".6" fill="#f0b984"/></g>'+
      SPK(59.6,67,2,'ld-tw')})));

  /* 10 fixing hair */
  sc.push(S(BGK+
    '<ellipse class="ld-cloud" cx="18" cy="16" rx="9" ry="3.2" fill="#fff" opacity=".8"/>'+
    G(0,0,{m:'<ellipse cx="63" cy="45" rx="1.8" ry="2.8" fill="url(#ldg-skin)" stroke="#d9a98a" stroke-width=".5"/>',
      x:AL+'<path class="ld-strand" d="M60 31q6 8 3.4 18" fill="none" stroke="#5a3b2e" stroke-width="2.2" stroke-linecap="round"/>'+
      '<g class="ld-tuck" style="transform-origin:58px 66px">'+A('M58 66Q70 60 64 46',64,46)+'</g>'})+
    '<path class="ld-leaf ld-d1" d="M10 40q4-3 7 0-4 3-7 0z" fill="#a3c784" stroke="#7a9e62" stroke-width=".4"/>'));

  /* 11 stringing beads */
  var cols=['#fbf6ee','#b9aee0','#f0b984','#e9c46a','#a9cfc0'], beads='';
  for(var i=0;i<5;i++){
    var rx=30+i*5;
    beads+='<circle class="ld-bead ld-b'+(i+1)+'" style="--d:'+(84-rx)+'px" cx="'+rx+'" cy="76" r="2.5" fill="'+cols[i]+'" stroke="#9c8a74" stroke-width=".45"/>';
  }
  sc.push(S(BGS+
    G(-6,0,{x:A('M38 67Q28 70 24 76',24,76)+
      '<path d="M24 76H72" stroke="#8f7a6a" stroke-width=".6"/><circle cx="27" cy="76" r="1" fill="#8f7a6a"/>'+
      '<path d="M72 76h13" stroke="#9aa6ad" stroke-width="1.1" stroke-linecap="round"/><path d="M85 76h1.6" stroke="#c7d0d5" stroke-width=".7" stroke-linecap="round"/>'+
      '<ellipse cx="74" cy="76" rx="1.3" ry=".35" fill="#f4f7f8"/>'+
      '<g class="ld-pick">'+A('M58 67Q72 64 86 72',86.6,73)+'</g>'+beads})+
    R(12,88,'ld-hop ld-d1')));

  /* 12 watering a plant */
  sc.push(S(BGS+
    '<path d="M76 84q-1-8 1-15M76 84q3-6 6-9M76 84q-3-5-7-7" stroke="#7fa564" stroke-width="1" fill="none"/>'+
    '<path d="M77 69q-6-6-2-11 5 4 2 11z" fill="#a3c784" stroke="#6f9455" stroke-width=".5"/>'+
    '<path d="M69 77q-6-1-7-5 5-1 7 5z" fill="#93bb76" stroke="#6f9455" stroke-width=".5"/>'+
    '<path class="ld-perk" d="M82 75q7 1 8 6-6 1-8-6z" fill="#a3c784" stroke="#6f9455" stroke-width=".5"/>'+
    '<rect x="66.5" y="83" width="19" height="3.6" rx="1.2" fill="#e3a880" stroke="#b07454" stroke-width=".6"/>'+
    '<path d="M68 86.6h16l-2 8H70z" fill="url(#ldg-pot)" stroke="#b07454" stroke-width=".6"/>'+
    '<ellipse class="ld-drip" cx="74" cy="60" rx=".8" ry="1.2" fill="#a9d3e3"/>'+
    '<ellipse class="ld-drip ld-d1" cx="76" cy="61" rx=".8" ry="1.2" fill="#a9d3e3"/>'+
    '<ellipse class="ld-drip ld-d2" cx="72.4" cy="61" rx=".8" ry="1.2" fill="#a9d3e3"/>'+
    G(-16,0,{x:AL+A('M58 66Q68 60 75 55.4',75,55.4)+
      '<g class="ld-tilt" style="transform-origin:75px 56px">'+
      '<path d="M71 61.4q5-10 10 0" fill="none" stroke="#7fa196" stroke-width="1.3"/>'+
      '<path d="M82 64l7.4-5.6" stroke="#8fb3a6" stroke-width="2" stroke-linecap="round"/><ellipse cx="89.6" cy="58.2" rx="1.6" ry="1" transform="rotate(-36 89.6 58.2)" fill="#9cbfb2"/>'+
      '<rect x="69" y="60" width="14" height="11" rx="3" fill="url(#ldg-can)" stroke="#6f9488" stroke-width=".6"/>'+
      '<path d="M71 62.4h10" stroke="#e3f0ea" stroke-width=".8" opacity=".8"/>'+
      '<circle cx="75" cy="56" r="2.2" fill="url(#ldg-skin)" stroke="#d9a98a" stroke-width=".5"/></g>'})+
    R(58,88,'ld-hop')));

  return sc;
})();

/* «Сильвер» v2 — живые анимации загрузки (ld-*.html на сайте, каждая в своём окошке, чтобы переменные не пересекались) */
const LD_FRAMES = ['magic','polish','search','hourglass','fly','sleep','chest','progress','shop'];
function ldHtml(){ const p = LD_FRAMES[Math.floor(Math.random()*LD_FRAMES.length)]; return '<span class="ld ld-fr" aria-hidden="true"><iframe src="ld-'+p+'.html" tabindex="-1" title="" scrolling="no"></iframe></span>' }
const LD_RE = /(Загруж|загруж|Считаем|Собираем|Ищем|Проверяю|Проверяем|Готовим|Обновляем)[^.!?]*…\s*$/;
let ldQ = 0;
function ldScan(){ ldQ = 0; if(document.body) ldDefs(); document.querySelectorAll('.empty:not([data-ld]), p.meta:not([data-ld])').forEach(el => {
  if(el.children.length > 2 || !LD_RE.test(el.textContent.trim())) return; el.dataset.ld = '1'; el.classList.add('ld-box'); el.insertAdjacentHTML('afterbegin', ldHtml()); }); }
new MutationObserver(() => { if(!ldQ) ldQ = requestAnimationFrame(ldScan); }).observe(document.documentElement, { childList:true, subtree:true });
/* Значки в стиле Apple (SF Symbols): эмодзи в интерфейсе заменяются на тонкие линейные иконки, цвет — по тексту */
const SF_P = {
  check:'<path d="M20 6 9 17l-5-5"/>', checkc:'<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>', x:'<path d="M18 6 6 18M6 6l12 12"/>',
  spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  warn:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  cam:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  pen:'<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', search:'<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>', down:'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  box:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.6l-3.7-4.6A1 1 0 0 0 17.5 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  money:'<circle cx="12" cy="12" r="9.5"/><path d="M14.8 9.3c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2.1 2.7.9 2.7 2.1-1.1 2-2.7 2c-1.2 0-2.3-.5-2.8-1.5M12 6.3v1.6M12 16.1v1.6"/>',
  book:'<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  trend:'<path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/>', bars:'<path d="M3 3v18h18M8 17v-5M13 17V8M18 17V5"/>',
  receipt:'<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-2-3 2-3-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  refresh:'<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5"/>',
  bulb:'<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  cal:'<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>', eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  plane:'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>', plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  tag:'<path d="M12 2H2v10l9.3 9.3a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7" cy="7" r="1.5"/>',
  star:'<path fill="currentColor" d="m12 2 3.1 6.3 6.9 1-5 4.8 1.2 6.9-6.2-3.2L5.8 21 7 14.1 2 9.3l6.9-1z"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  dotg:'<circle cx="12" cy="12" r="6" fill="#34C759" stroke="none"/>', dotw:'<circle cx="12" cy="12" r="6" fill="#C7C7CC" stroke="none"/>',
  buoy:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.9 4.9 4.2 4.2M14.8 14.8l4.2 4.2M14.8 9.2l4.2-4.2M4.9 19.1l4.2-4.2"/>',
  cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>', key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.2.4 1.3 1.3 2.2 2.5 2.7z"/>',
  trophy:'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2-1.2.5-2 2-2 3.8M14 14.7V17c0 .6.5 1 1 1.2 1.2.5 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
  net:'<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.3 5.6M12 11.5l5.3 5.6"/>',
  people:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  store:'<path d="M3 9l1.5-5h15L21 9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v9h14v-9M10 21v-5h4v5"/>',
  cart:'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h2l2.6 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 6H5.1"/>',
  bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m22 7-10 6L2 7"/>',
  trash:'<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  clip:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  scale:'<path d="M12 3v18M5 21h14M3 7h18M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
  monitor:'<rect x="2" y="3" width="20" height="14" rx="2.5"/><path d="M8 21h8M12 17v4"/>',
  archive:'<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  ruler:'<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
  chev:'<path d="m9 18 6-6-6-6"/>', bolt:'<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', pause:'<circle cx="12" cy="12" r="10"/><path d="M10 9v6M14 9v6"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
  chat:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>', lock:'<rect x="3" y="11" width="18" height="11" rx="2.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mega:'<path d="m3 11 18-5v12L3 14zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>'
};
const SF_E = { '✓':'check','✔':'check','✅':'checkc','✕':'x','✗':'x','❌':'x','✖':'x','✨':'spark','🎉':'spark','⚠':'warn','📷':'cam','📸':'cam','🎁':'gift','✎':'pen','✍':'pen','✏':'pen','📝':'pen',
  '🔍':'search','🔎':'search','⬆':'up','📤':'up','⬇':'down','📥':'down','📦':'box','🚚':'truck','🚛':'truck','💰':'money','💵':'money','📖':'book','📚':'book','📜':'book','📈':'trend','📊':'bars',
  '🧾':'receipt','🔁':'refresh','🔄':'refresh','💡':'bulb','📅':'cal','🗓':'cal','☀':'sun','🌙':'moon','☾':'moon','👁':'eye','✈':'plane','🛎':'bell','🔔':'bell','➕':'plus','➖':'minus','🏷':'tag',
  '★':'star','⭐':'star','🔗':'link','🟢':'dotg','⚪':'dotw','🛟':'buoy','☁':'cloud','🔑':'key','🌐':'globe','🔥':'flame','🏆':'trophy','🕸':'net','👥':'people','👤':'people','💳':'card','☰':'menu',
  '🏬':'store','🏪':'store','🛒':'cart','🛍':'bag','📨':'mail','✉':'mail','📧':'mail','🗑':'trash','📋':'clip','⚖':'scale','📟':'monitor','🖥':'monitor','🗄':'archive','📏':'ruler','👉':'chev','⚡':'bolt',
  '🚫':'ban','🧩':'grid','📞':'phone','🕐':'clock','⏰':'clock','⏳':'clock','✋':'pause','⚙':'gear','💛':'heart','❤':'heart','🤖':'chat','💬':'chat','🔒':'lock','📣':'mega','📢':'mega' };
const SF_RE = new RegExp('(' + Object.keys(SF_E).map(k => k.replace(/[*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')\\uFE0F?', 'g');
const SF_TONE = { checkc:'ok', dotg:'', warn:'warn', x:'', ban:'bad', flame:'warn', star:'warn', heart:'bad' };
const sfSvg = n => `<svg class="sf${SF_TONE[n]?' sf-'+SF_TONE[n]:''}" viewBox="0 0 24 24" aria-hidden="true">${SF_P[n]}</svg>`;
function sfScan(root){ if(!root || root.nodeType!==1) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: t => { const p = t.parentElement; if(!p || p.closest('textarea,input,select,option,script,style,svg,[contenteditable],.no-sf,title')) return NodeFilter.FILTER_REJECT; SF_RE.lastIndex = 0; return SF_RE.test(t.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
  const list = []; while(w.nextNode()) list.push(w.currentNode);
  for(const t of list){ const span = document.createElement('span'); span.className = 'sf-t'; span.innerHTML = esc(t.data).replace(SF_RE, (m, e) => sfSvg(SF_E[e])); t.replaceWith(span); } }
let sfQ = 0; const sfPend = new Set();
new MutationObserver(ms => { for(const m of ms) for(const n of m.addedNodes) if(n.nodeType===1) sfPend.add(n); else if(n.nodeType===3 && n.parentElement) sfPend.add(n.parentElement);
  if(!sfQ) sfQ = requestAnimationFrame(() => { sfQ = 0; const a = [...sfPend]; sfPend.clear(); for(const n of a) if(n.isConnected) sfScan(n); }); }).observe(document.documentElement, { childList:true, subtree:true });
document.addEventListener('DOMContentLoaded', () => sfScan(document.body));
const brCls = p => p && p.brand==='moon' ? ' br-moon' : p && p.brand==='sunshine' ? ' br-sun' : p && p.brand==='both' ? ' br-both' : '';
const thumb = p => p.photo_url ? `<img class="thumb${brCls(p)}" referrerpolicy="no-referrer" src="${esc(thumbUrl(p.photo_url))}" data-full="${esc(p.photo_url)}" alt="" loading="lazy" decoding="async" onerror="if(this.dataset.full&&this.src!==this.dataset.full)this.src=this.dataset.full">` : `<span class="thumb${brCls(p)}"></span>`;
function errText(e){ return (e && (e.message || e.error_description)) || String(e); }
const isNetErr = e => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(errText(e));

/* ---------- офлайн-очередь ---------- */
function queue(){ return ls.get('kassa_queue', []); }
function setQueue(q){ ls.set('kassa_queue', q); renderHeader(); }
async function flushQueue(){
  const q = queue(); if(!q.length || !navigator.onLine) return;
  const left = [];
  for(const job of q){
    const { error } = await sb.rpc(job.fn, job.args);
    if(error){ if(isNetErr(error)) { left.push(job); } else { left.push({...job, error: errText(error)}); } }
  }
  setQueue(left);
  if(left.length < q.length) toast(`Отправлено чеков из очереди: ${q.length-left.length}`);
}
window.addEventListener('online', ()=>{ renderHeader(); flushQueue(); });
window.addEventListener('offline', renderHeader);
setInterval(flushQueue, 60000);

/* ---------- каталог (кэш на устройстве для быстрого поиска и офлайна) ---------- */
async function loadCatalog(force){
  const cached = ls.get('kassa_catalog7', null);
  if(cached && !force){ S.catalog = cached.items; S.catalogAt = cached.at; S.alias = cached.alias || {}; }
  if(!navigator.onLine) return;
  if(cached && !force && Date.now() - cached.at < 6*3600e3) return;
  const items = []; let from = 0;
  while(true){
    const { data, error } = await sb.from('products').select('id,barcode,sku,name,price,archived,photo_url,category_id,is_service,brand').eq('archived', false).order('name').range(from, from+999);
    if(error) { toast('Каталог не загрузился: '+errText(error)); return; }
    data.forEach(p => items.push([p.id, p.barcode, p.sku||'', p.name, Number(p.price), p.photo_url||'', p.category_id||null, p.is_service?1:0, p.brand||'']));
    if(data.length < 1000) break; from += 1000;
  }
  // штрихкоды объединённых дублей (вторая база): пробиваются как основной товар
  const alias = {}; { let f2 = 0; while(true){ const { data } = await sb.from('products').select('barcode,merged_into').not('merged_into','is',null).range(f2, f2+999); (data||[]).forEach(r => { alias[r.barcode] = r.merged_into; }); if(!data || data.length < 1000) break; f2 += 1000; } }
  S.catalog = items; S.alias = alias; S.catalogAt = Date.now(); ls.set('kassa_catalog7', {at:S.catalogAt, items, alias});
}
const prodObj = a => ({ id:a[0], barcode:a[1], sku:a[2], name:a[3], price:a[4], photo_url:a[5]||null, category_id:a[6]||null, svc:!!a[7], brand:a[8]||'' });
function searchCatalog(q){
  q = q.trim().toLowerCase(); if(!q) return [];
  let exact = S.catalog.filter(p => p[1] === q || p[2].toLowerCase() === q);
  if(!exact.length && S.alias && S.alias[q]) exact = S.catalog.filter(p => p[0] === S.alias[q]);
  if(exact.length) return exact.map(prodObj);
  const words = q.split(/\s+/);
  return S.catalog.filter(p => { const n = p[3].toLowerCase(); return words.every(w => n.includes(w)) || p[1].includes(q); }).slice(0,30).map(prodObj);
}
async function loadStock(ids){
  if(!ids.length || !navigator.onLine) return;
  const { data } = await sb.from('stock_balances').select('product_id,store_id,qty').in('product_id', ids);
  (data||[]).forEach(r => { (S.stock[r.product_id] ||= {})[r.store_id] = r.qty; });
}

/* ---------- вход ---------- */
const FN_URL = 'https://ottuadjdksxipfjytlyv.supabase.co/functions/v1/tg';
async function fnCall(body, auth){
  const headers = { 'Content-Type':'application/json', apikey:'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo' };
  if(auth){ const { data:{ session } } = await sb.auth.getSession(); if(session) headers.Authorization = 'Bearer '+session.access_token; }
  const r = await fetch(FN_URL, { method:'POST', headers, body: JSON.stringify(body) });
  return r.json();
}
async function tgLogin(mode){
  const st = await fnCall({ action:'login_start', mode }, mode==='link');
  if(st.error) return toast(st.error);
  window.open(st.url, '_blank');
  modal(`<h2>${mode==='link'?'Привязка Telegram':'Вход через Telegram'}</h2>
    <p>Откроется бот. Нажмите в нём <b>«Start»</b>${mode==='login'?', а если попросит — <b>«Поделиться номером»</b>':''}. Потом вернитесь сюда.</p>
    <p><a href="${esc(st.url)}" target="_blank" rel="noopener">Если бот не открылся — нажмите здесь</a></p>
    <p class="meta" id="tg-wait">Ждём подтверждения…</p><div class="row"><button class="btn" data-close>Отмена</button></div>`);
  const t0 = Date.now();
  while(Date.now()-t0 < 15*60e3 && document.getElementById('tg-wait')){
    await new Promise(r=>setTimeout(r, 2500));
    const p = await fnCall({ action:'login_poll', nonce: st.nonce });
    if(p.pending) continue;
    closeModal();
    if(p.error) return toast(p.error);
    if(p.linked){ toast('Telegram привязан — уведомления будут приходить в бот'); return; }
    if(p.token_hash){ const { error } = await sb.auth.verifyOtp({ token_hash:p.token_hash, type:'magiclink' }); if(error) return toast('Не удалось войти: '+errText(error)); return boot(); }
    return;
  }
}
function renderLogin(mode='in', msg=''){
  $('#app').innerHTML = `<div class="login card">
    <div class="brand-login" style="font-weight:800;font-size:26px;letter-spacing:.04em">Silver</div>
    <h2>${mode==='in'?'Вход':'Регистрация сотрудника'}</h2>
    ${mode==='in'?`<button class="btn primary" id="lg-tg">✈️ Войти через Telegram</button><p class="meta">Для сотрудников, которых менеджер добавил по номеру телефона.</p><div class="label">или по логину и паролю</div>`:''}
    ${mode==='up'?'<input id="lg-name" placeholder="Имя и фамилия" autocomplete="name"><input id="lg-phone" placeholder="Телефон, который указал менеджер" inputmode="tel" autocomplete="tel">':''}
    <input id="lg-email" placeholder="${mode==='in'?'Логин или почта':'Почта'}" autocomplete="username" autocapitalize="off" spellcheck="false">
    <input id="lg-pass" type="password" placeholder="Пароль (не меньше 6 символов)" autocomplete="${mode==='in'?'current-password':'new-password'}">
    ${msg?`<div class="${/ошиб|не /i.test(msg)?'warn':'okmsg'}">${esc(msg)}</div>`:''}
    <button class="btn primary" id="lg-go">${mode==='in'?'Войти':'Зарегистрироваться'}</button>
    <button class="btn" id="lg-switch">${mode==='in'?'Я новый сотрудник':'У меня уже есть вход'}</button>
    <p class="meta">Зарегистрироваться можно только с номером телефона, который менеджер заранее добавил во вкладке «Сотрудники».</p>
  </div>`;
  $('#lg-switch').onclick = () => renderLogin(mode==='in'?'up':'in');
  if($('#lg-tg')) $('#lg-tg').onclick = () => tgLogin('login');
  $('#lg-go').onclick = async () => {
    let email = $('#lg-email').value.trim().toLowerCase(), password = $('#lg-pass').value;
    if(mode==='in'){ if(email && !email.includes('@')) email += '@silver.kz';
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) return renderLogin('in', 'Не удалось войти: '+errText(error));
      boot();
    } else {
      const full_name = $('#lg-name').value.trim();
      if(!full_name) return renderLogin('up','Укажите имя');
      const phone = ($('#lg-phone')||{}).value||''; if(phone.replace(/\D/g,'').length<10) return renderLogin('up','Укажите телефон, который добавил менеджер');
      const { error } = await sb.auth.signUp({ email, password, options:{ data:{ full_name, phone }, emailRedirectTo: location.href.split('#')[0] } });
      if(error) return renderLogin('up', 'Ошибка регистрации: '+errText(error));
      renderLogin('in', 'Готово. Подтвердите почту по ссылке из письма, потом войдите. Доступ включит менеджер.');
    }
  };
}

async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session) return renderLogin();
  const { data: me, error } = await sb.rpc('me');
  if(error || !me) return renderLogin('in', 'Не удалось получить профиль: '+errText(error));
  S.me = me;
  if(!me.active){
    $('#app').innerHTML = `<div class="login card"><h2>Доступ ещё не включён</h2><p>${esc(me.full_name)}, менеджер должен подтвердить вашу учётную запись и назначить магазин.</p><button class="btn" id="out">Выйти</button></div>`;
    $('#out').onclick = async()=>{ await sb.auth.signOut(); renderLogin(); }; return;
  }
  const st = await sb.from('stores').select('*').eq('active', true).order('id');
  S.allStores = st.data || [];
  S.stores = ['owner','manager','viewer'].includes(me.role) ? S.allStores : S.allStores.filter(s => (me.store_ids||[]).includes(s.id));
  if(!S.stores.length){
    $('#app').innerHTML = `<div class="login card"><h2>Магазин не назначен</h2><p>${esc(me.full_name)}, менеджер должен открыть вам доступ к магазину.</p><button class="btn" id="out">Выйти</button></div>`;
    $('#out').onclick = async()=>{ await sb.auth.signOut(); renderLogin(); }; return;
  }
  S.store = ls.get('kassa_store', null) || (me.store_ids||[])[0] || (S.stores[0]||{}).id;
  if(!S.stores.some(s=>s.id===S.store)) S.store = (S.stores[0]||{}).id;
  { const [a, e, pe] = await Promise.all([sb.rpc('get_tab_access'), sb.rpc('get_tab_edit'), sb.from('settings').select('value').eq('key','pos_enabled').maybeSingle()]); S.tabAccess = a.data || {}; S.tabEdit = e.data || {}; S.posOn = !!(pe && pe.data && pe.data.value==='true'); }
  const ph1688 = location.hash.startsWith('#ph=') ? location.hash.slice(4) : null; if(ph1688) try{ history.replaceState(null,'','#po'); }catch(_){}
  const sup1688 = location.hash.startsWith('#sup=') ? location.hash.slice(5) : null; if(sup1688) try{ history.replaceState(null,'','#po'); }catch(_){}
  renderShell(); await loadPosShift(); if(S.view!=='pos') render(); if(ph1688) importPhotos1688(ph1688); if(sup1688) importSuppliers(sup1688); await loadCatalog(); loadPromos().then(()=>{ if(S.view==='pos') render(); }); render(); flushQueue(); subscribeReqs(); if(S.view!=='pos') loadView();
}

/* ---------- каркас ---------- */
function renderShell(){
  const tabs = [['pos','Продажа'],['shifts','Смены'],['cash','Расходы'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты']];
  if(isBoss()) { tabs.splice(1,0,['analytics','Аналитика']); tabs.push(['bonus','Бонусные карты']); tabs.push(['nom','Номенклатура']); tabs.push(['site','Сайт']); tabs.push(['emps','Сотрудники']); }
  if(S.me.role==='purchaser') tabs.push(['site','Сайт']);  // сайт ведёт закуп
  // настройка владельца: какие вкладки видит каждая роль
  const acc = (S.tabAccess||{})[S.me.role];
  if(S.me.role !== 'owner' && Array.isArray(acc)){ const keep = tabs.filter(([v]) => acc.includes(v)); tabs.splice(0, tabs.length, ...keep); }
  // остальные вкладки: владельцу все, остальным — по настройке «Какие вкладки видит каждая роль» (или по умолчанию)
  for(const [v,t] of EXTRA_TABS){ if(S.me.role==='owner' || v==='day' || (Array.isArray(acc) ? acc.includes(v) : (EXTRA_DEF[v]||[]).includes(S.me.role))) tabs.push([v, v==='pay' && !isBoss() ? 'Моя зарплата' : t]); }
  if(S.me.role==='owner') tabs.push(['adm','Административный штат'], ['audit','Журнал']);
  // касса Silver (продажа, смены, расходы) пока не используется — чеки пробиваются в Wipon; включается настройкой pos_enabled
  if(!S.posOn){ const off = ['pos','shifts', ...(isBoss() ? [] : ['cash'])]; tabs.splice(0, tabs.length, ...tabs.filter(([v]) => !off.includes(v)));
    // без кассы Silver «Расходы» — это журнал расходов магазинов (из тетрадей), он живёт в «Аналитике» рядом с «Рентабельностью»
    const ga = GROUPS.find(g => g[0]==='analytics'), gk = GROUPS.find(g => g[0]==='kassa'); if(!ga[3].includes('cash')){ gk[3] = gk[3].filter(v => v!=='cash'); ga[3].push('cash'); } }
  // «Требует внимания» теперь внутри «Моего дня», «Остатки» — режим «Склада»
  S.canAttn = tabs.some(([v]) => v==='attn'); S.canStock = tabs.some(([v]) => v==='stock');
  S.whStockOnly = S.canStock && !tabs.some(([v]) => v==='wh');
  tabs.splice(0, tabs.length, ...tabs.filter(([v]) => v!=='attn' && v!=='stock'));
  if(S.whStockOnly){ const i = tabs.findIndex(([v]) => v==='certs'); tabs.splice(i<0 ? tabs.length : i, 0, ['wh','Склад']); }
  viewAlias();
  if(isViewer()){ tabs.splice(0, tabs.length, ...tabs.filter(([v]) => v!=='pos' && (v!=='emps' || S.me.role==='accountant'))); if(!S.view || S.view==='pos' || (S.view==='emps' && S.me.role!=='accountant')) S.view = 'analytics'; }
  if(!S._land){ S._land = 1; if(!INIT_HASH && ['owner','manager','purchaser'].includes(S.me.role)) S.view = 'day'; }
  if(tabs.length && !tabs.some(([v]) => v===S.view)) S.view = (tabs.find(t => t[0]==='day') || tabs[0])[0];

  S.tabs = tabs;
  $('#app').innerHTML = `<header id="hdr"></header><nav class="subtabs" id="subnav" role="tablist"></nav><div id="storebar" class="storebar" hidden></div><main id="main"></main>
    <nav class="tabs" id="mainnav" role="tablist"></nav>`;
  renderHeader();
}
// вкладки сгруппированы в разделы: внизу — разделы, сверху — вкладки выбранного раздела
const GROUPS = [['home','✅','Мой день',['day']],['goods','📦','Товары',['flow','wh','po','nom','photo','site']],['analytics','📈','Аналитика',['analytics','profit']],
  ['team','👥','Команда',['me','emps','cons','bot','pay','adm','audit']],['kassa','🧾','Чеки',['pos','shifts','cash','sales']],['clients','💳','Клиенты',['promo','content','bonus','certs']]];
const groupOf = v => GROUPS.find(g => g[3].includes(v)) || GROUPS[0];
// старые адреса вкладок: #attn → «Мой день», #stock → «Склад» в режиме «Остатки»
function viewAlias(){ if(S.view==='attn') S.view = 'day'; else if(S.view==='stock'){ S.view = 'wh'; S.wmode = 'stock'; } }
/* меняем DOM, только если разметка изменилась — меньше перерисовок и не сбивается фокус */
function setHtml(el, h){ if(el._h !== h){ el.innerHTML = h; el._h = h; } }
function renderNav(){
  const tabs = S.tabs || [], has = v => tabs.some(t => t[0]===v), title = v => (tabs.find(t=>t[0]===v)||[])[1];
  const cur = groupOf(S.view); (S.lastView ||= {})[cur[0]] = S.view;
  const rq = S.reqCount ? ` (${S.reqCount})` : '';
  // внизу не больше 5 разделов: 4 первых + «Ещё» (остальные открываются листом)
  const GA = GROUPS.filter(g => g[3].some(has)), main = GA.length > 5 ? GA.slice(0, 4) : GA, more = GA.length > 5 ? GA.slice(4) : [];
  const gbtn = g => `<button role="tab" data-group="${g[0]}" aria-selected="${g===cur}"><span class="ico">${g[1]}</span>${g[2]}${g[0]==='goods'?rq:''}</button>`;
  const mn = $('#mainnav'); if(mn) setHtml(mn, main.map(gbtn).join('')
    + (more.length ? `<button role="tab" data-more="1" aria-selected="${more.includes(cur)}"><span class="ico">☰</span>${more.includes(cur)?esc(cur[2]):'Ещё'}</button>` : '')
    + (more.length && S.moreOpen ? `<div class="more-bg" data-moreclose="1"></div><div class="more-sheet" id="more-sheet">${more.map(gbtn).join('')}</div>` : ''));
  const av = cur[3].filter(has), sn = $('#subnav');
  // магазин выбирают только в разделе «Касса»: чек, смена и расходы относятся к конкретной кассе
  const kassa = cur[0]==='kassa' && ['pos','shifts','cash'].includes(S.view) && (S.view==='pos' || S.posOn);
  if(sn){ sn.hidden = av.length < 2 && !kassa; setHtml(sn, av.map(v => `<button role="tab" data-view="${v}" aria-selected="${v===S.view}">${title(v)}${v==='wh'?rq:''}</button>`).join('')
    + (kassa && S.stores && S.stores.length ? `<label class="store-pick"><span class="meta">Магазин</span><select id="store-sel" aria-label="Магазин">${S.stores.map(s=>`<option value="${s.id}" ${s.id===S.store?'selected':''}>${esc(BRAND[s.brand]+' · '+s.city+', '+s.address)}</option>`).join('')}</select></label>` : ''));
    const ss = $('#store-sel'); if(ss) ss.onchange = e => { S.store = +e.target.value; ls.set('kassa_store', S.store); S.cust = null; S.bonusSpend = 0; if(S.phone) lookupCustomer(); renderHeader(); render(); loadPosShift().then(render); if(S.view==='shifts') loadShifts().then(render); if(S.view==='cash') loadCash().then(render); };
  }
  renderStoreBar(kassa);
}
/* один выбор магазинов на всё приложение: руководителю — несколько магазинов сразу, остальным — свой магазин */
const STORE_MULTI = ['sales','analytics','shifts','cash','profit','pay','flow'], STORE_ONE = ['sales','day','wh','photo','pay'];
function renderStoreBar(kassa){
  const el = $('#storebar'); if(!el) return; let h = '';
  if(!kassa && S.stores && S.stores.length > 1){
    if(isBoss() && STORE_MULTI.includes(S.view)){ const sel = selStores(), all = sel.length===S.stores.length;
      h = `<button class="btn small" id="sp-toggle" aria-expanded="${!!S.spOpen}">🏬 ${all?'Все магазины':sel.length===1?esc(storeName(sel[0])):'Магазинов: '+sel.length+' из '+S.stores.length} ▾</button>${S.spOpen?storeFilterHtml():''}`; }
    else if(!isBoss() && STORE_ONE.includes(S.view))
      h = `<label class="store-pick"><span class="meta">Магазин</span><select id="gstore-sel" aria-label="Магазин">${S.stores.map(s=>`<option value="${s.id}" ${s.id===S.store?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select></label>`;
  }
  setHtml(el, h); el.hidden = !h;
}
function setStore(id){ S.store = +id; ls.set('kassa_store', S.store); S.cust = null; S.bonusSpend = 0;
  if(typeof DAY!=='undefined'){ DAY.store = null; DAY.data = null; } if(typeof PH!=='undefined') PH.store = null; if(typeof PY!=='undefined') PY.store = null;
  renderHeader(); }
document.addEventListener('click', e => { if(e.target.closest('#sp-toggle')){ S.spOpen = !S.spOpen; renderNav(); } });
document.addEventListener('change', async e => { if(e.target.id!=='gstore-sel') return; setStore(e.target.value); render(); await loadView(); });
function renderHeader(){
  const h = $('#hdr'); if(!h) return;
  const q = queue();
  h.innerHTML = `<span class="brand">Silver</span>
    <span class="who"><span class="net ${navigator.onLine?'':'off'}">${navigator.onLine?'онлайн':'нет интернета'}</span>
    ${q.length?`<span class="chip warn">в очереди: ${q.length}</span>`:''}
    <span>${esc(S.me.full_name)} · ${ROLE[S.me.role]}</span>${!canEdit(S.store)?`<span class="chip warn" title="${isViewer()?'Можно смотреть всё, изменения недоступны':'Этот магазин в другом городе: можно смотреть, менять нельзя'}">только просмотр</span>`:''}${S.me.telegram?'':'<button id="tg-link" title="Получать уведомления и входить через Telegram">Привязать Telegram</button>'}<button id="logout">Выйти</button></span>`;
  if(false) $('#store-sel').onchange = e => { S.store = +e.target.value; ls.set('kassa_store', S.store); S.cust = null; S.bonusSpend = 0; if(S.phone) lookupCustomer(); renderHeader(); render(); loadPosShift().then(render); if(S.view==='shifts') loadShifts().then(render); if(S.view==='cash') loadCash().then(render); };
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  if($('#tg-link')) $('#tg-link').onclick = () => tgLogin('link');
}
function render(){
  viewAlias();
  if(S.view!=='nom' && document.getElementById('nm-modal')){ $('#modal').innerHTML = ''; if(S.nm) S.nm.ed = null; }
  if(location.hash.slice(1)!==S.view) try{ history.replaceState(null,'','#'+S.view); }catch(_){}
  document.body.classList.toggle('readonly', !canEdit(S.store) || !canEditTab(S.view));
  renderNav();
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart, y0 = scrollY;
  if(lazyPending(S.view)){ $('#main').innerHTML = `<div class="card" style="text-align:center;padding:28px 16px"><div style="font-size:32px">📊</div><p style="margin:8px 0 14px">На телефоне аналитика загружается только по запросу — так приложение работает быстрее.</p><button class="btn primary" data-lazyload="${S.view}">Загрузить</button></div>`; return; }
  ({ pos:renderPos, sales:renderSales, certs:renderCerts, emps:renderEmps, shifts:renderShifts, analytics:renderAnalytics, wh:renderWh, site:renderSite, nom:renderNom, bonus:renderBonus, cash:renderCash, pay:renderPay, profit:renderProfit, po:renderPo, promo:renderPromo, me:renderMe, adm:renderAdm, flow:renderFlow, content:renderContent, cons:renderCons, photo:renderPhoto, day:renderDay, audit:renderAudit, bot:renderBot })[S.view]();
  if(id){ const el = document.getElementById(id); if(el){ el.focus({ preventScroll:true }); try{ if(pos!=null) el.setSelectionRange(pos,pos) }catch(e){} } }
  if(y0 && Math.abs(scrollY - y0) > 2) scrollTo(0, y0);  // перерисовка не должна сбрасывать прокрутку
}

/* ---------- продажа ---------- */
function lineDisc(l){ const base=l.price*l.qty, v=+l.dv||0; return Math.round(l.dt==='pct' ? base*Math.min(v,100)/100 : Math.min(v, base)); }
function totals(){
  S.cart.forEach(l => { l.disc = lineDisc(l); });
  const sub = S.cart.reduce((a,l)=>a+l.price*l.qty,0);
  const lineDisc_ = S.cart.reduce((a,l)=>a+l.disc,0), lineDiscV = lineDisc_;
  const after = sub - lineDiscV;
  const chk = Math.round(S.discType==='pct' ? after*Math.min(S.disc||0,100)/100 : Math.min(S.disc||0, after));
  return { sub, lineDisc: lineDiscV, chk, total: after - chk };
}
const paid = () => Object.values(S.pays).reduce((a,v)=>a+(+v||0),0);
function syncPays(){
  const t = totals().total, keys = Object.keys(S.pays);
  if('bonus' in S.pays) S.pays.bonus = Math.min(+S.pays.bonus||0, maxBonus());
  const fixed = keys.filter(k=>k==='bonus'||k==='certificate').reduce((a,k)=>a+(+S.pays[k]||0),0);
  const free = keys.filter(k=>k!=='bonus'&&k!=='certificate');
  if(free.length===1) S.pays[free[0]] = Math.max(0, t - fixed);
}
function maxBonus(){
  if(!S.cust) return 0;
  return Math.max(0, Math.min(Number(S.cust.available)||0, Math.floor(totals().total * (Number(S.cust.max_spend_percent)||50) / 100)));
}
async function lookupCustomer(){
  const p = normPhone(S.phone); S.cust = null; S.custMsg = '';
  if(!p){ S.custMsg = S.phone ? 'Телефон: 10 цифр после +7' : ''; return render(); }
  if(!navigator.onLine){ S.custMsg = 'Нет интернета: бонусы покажутся позже, начисление пройдёт при отправке чека'; return render(); }
  const { data, error } = await sb.rpc('customer_lookup', { p_phone:p, p_store:S.store });
  if(error) S.custMsg = errText(error); else if(!data) S.custMsg = 'Клиент не найден — можно создать';
  else S.cust = data;
  render();
}
function renderPos(){
  const t = totals(), keys = Object.keys(S.pays), diff = t.total - paid();
  const brand = store().brand;
  const needCode = 'certificate' in S.pays && !S.certCode.trim();
  const shOpen = S.posShift && S.posShift[S.store];
  const canPay = S.cart.length && keys.length && Math.abs(diff) < 1 && !needCode && !S.busy && shOpen !== false;
  const c = S.cust;
  $('#main').innerHTML = `${shOpen===false?`<div class="card row" style="margin-bottom:12px;border-color:var(--bad);flex-wrap:wrap"><span><b>Смена не открыта.</b> Чтобы пробивать чеки, откройте смену и пересчитайте наличные в кассе.</span><button class="btn primary" id="go-shift">Открыть смену</button></div>`:''}<div class="grid2">
   <div>
     <div class="row" style="flex-wrap:wrap;gap:8px"><h2>Товары</h2><span class="meta">${S.catalog.length.toLocaleString('ru-RU')} в каталоге</span><span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${S.catalog.filter(a=>a[7]).map(a=>`<button class="btn small" data-svc="${a[0]}">${/доставк/i.test(a[3])?'🚚':'🛎'} ${esc(a[3])}</button>`).join('')}<button class="btn small" id="c-open">🎁 Продать сертификат</button></span></div>
     <div class="row"><input id="q" style="flex:1" placeholder="Штрихкод, артикул или название" value="${esc(S.q)}" autocomplete="off"><button class="btn" id="q-add">Добавить</button></div>
     <div class="list">${S.found.length ? S.found.map(p=>{ const s = S.stock[p.id]||{}; const here = s[S.store] ?? null;
        return `<button class="prod" data-add="${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}${p.sku?' · '+esc(p.sku):''}</span><br>
          ${here===null?'<span class="chip">остаток…</span>':`<span class="chip ${here>0?'ok':'zero'}">здесь: ${here}</span>`}
          ${Object.entries(s).filter(([k,v])=>+k!==S.store&&v>0).slice(0,4).map(([k,v])=>`<span class="chip">${esc((S.allStores.find(x=>x.id==k)||{}).address||k)}: ${v}</span>`).join('')}</span>
          <span class="price num">${fmt(p.price)}</span></button>`}).join('') : `<div class="empty">${S.q?'Ничего не найдено':'Отсканируйте штрихкод или введите название'}</div>`}</div>
   </div>
   <div class="card stack">
     <div class="row"><h2 style="margin:0">Чек</h2><span class="meta">${esc(storeName(S.store))}</span></div>
     ${S.cart.length ? S.cart.map((l,i)=>`<div class="line">
        <span>${esc(l.name)}</span><span class="price num">${fmt(l.price*l.qty-(l.disc||0))}</span>
        <div class="ctrl"><span class="qty"><button data-dec="${i}" aria-label="Меньше">−</button><span class="num">${l.qty}</span><button data-inc="${i}" aria-label="Больше">+</button></span>
        <span class="meta num">× ${fmt(l.price)}</span>
        <span class="meta">скидка</span><div class="seg"><button data-ldt="${i}:pct" aria-pressed="${l.dt==='pct'}">%</button><button data-ldt="${i}:kzt" aria-pressed="${l.dt!=='pct'}">₸</button></div>
        <input class="small" type="number" min="0" id="ld-${i}" data-ldisc="${i}" value="${l.dv||''}" inputmode="numeric" aria-label="Скидка на товар">${l.disc?`<span class="meta num">−${fmt(l.disc)}</span>`:''}
        <button class="btn small" data-del="${i}">Убрать</button></div>
        ${(()=>{ if(l.svc) return ''; const here=(S.stock[l.pid]||{})[S.store]; if(here==null || here>=l.qty) return ''; const need=l.qty-Math.max(0,here);
          return `<div class="ctrl"><span class="chip zero">по системе ${here>0?'есть только '+here:'нет в наличии'}</span>${(S.reqSent||{})[l.pid+':'+S.store]?'<span class="chip ok">запрос отправлен менеджеру</span>':`<button class="btn small" data-reqcap="${i}" data-need="${need}">Запросить оприходование ${need} шт.</button>`}</div>`; })()}</div>`).join('') : '<div class="empty">Чек пуст</div>'}
     <div class="row" style="justify-content:flex-start;flex-wrap:wrap"><span class="label">Скидка на чек</span>
       <div class="seg"><button data-dt="pct" aria-pressed="${S.discType==='pct'}">%</button><button data-dt="kzt" aria-pressed="${S.discType==='kzt'}">₸</button></div>
       <input class="small" type="number" min="0" id="disc" value="${S.disc||''}" inputmode="numeric"></div>

     <div class="cust stack">
       <div class="row"><span class="label">Клиент · бонусы ${BRAND[brand]||''}</span>${c?'<button class="btn small" id="cust-clear">Убрать</button>':''}</div>
       <div class="row"><input id="phone" style="flex:1" placeholder="Телефон или скан QR с карты" value="${esc(S.phone)}" inputmode="tel" autocomplete="off"><button class="btn small" id="cust-find">Найти</button></div>
       ${S.custMsg?`<div class="meta">${esc(S.custMsg)}</div>`:''}
       ${!c && /не найден/.test(S.custMsg) ? `<div class="row" style="flex-wrap:wrap"><input id="new-name" placeholder="Имя" style="flex:1"><input id="new-bd" type="date" title="День рождения"><button class="btn small primary" id="cust-create">Создать клиента</button></div>`:''}
       ${c?`<div><b>${esc(c.name||'Без имени')}</b> <span class="chip">${{new:'новый',regular:'постоянный',imported:'из Sagi'}[c.status]||c.status}</span>${c.first_purchase?'<span class="chip ok">первая покупка: 7%</span>':''}
         <div class="meta num">Доступно: <b>${fmt(c.available).replace(' ₸','')}</b> бонусов${+c.pending?` · ждут активации: ${fmt(c.pending).replace(' ₸','')}`:''}${c.next_burn&&c.next_burn.amount?` · сгорят ${fmt(c.next_burn.amount).replace(' ₸','')} до ${new Date(c.next_burn.at).toLocaleDateString('ru-RU')}`:''}</div>
         <div class="meta">Покупок в ${BRAND[brand]}: ${c.purchases} на ${fmt(c.total)}</div>
         ${S.cart.length?`<div class="seg" style="margin-top:8px;display:inline-flex"><button data-bmode="save" aria-pressed="${!('bonus' in S.pays)}">Копить бонусы</button><button data-bmode="spend" aria-pressed="${'bonus' in S.pays}" ${maxBonus()>0?'':'disabled'}>Списать до ${fmt(maxBonus()).replace(' ₸','')}</button></div>
           <div class="meta">${'bonus' in S.pays?'Бонусы списываются, на остаток суммы бонусы тоже начислятся.':'Бонусы начислятся после покупки (активируются через 3 дня).'}</div>`:''}</div>`:''}
     </div>

     ${promoHintHtml(t)}
     <div class="num">
       <div class="row"><span>Без скидок</span><span>${fmt(t.sub)}</span></div>
       ${t.lineDisc+t.chk?`<div class="row"><span>Скидки</span><span>−${fmt(t.lineDisc+t.chk)}</span></div>`:''}
       <div class="row total"><span>Итого</span><span>${fmt(t.total)}</span></div>
     </div>
     <div><div class="label" style="margin-bottom:6px">Способ оплаты — обязательно</div>
       <div class="pays">${[...POS_PAY, ...(c?['bonus']:[])].map(k=>[k,PAY[k]]).map(([k,v])=>`<div class="pay ${k in S.pays?'on':''}">
         <label><input type="checkbox" data-pay="${k}" ${k in S.pays?'checked':''}>${v}${k==='bonus'?` <span class="meta">до ${fmt(maxBonus()).replace(' ₸','')}</span>`:''}</label>
         ${k in S.pays?`<input type="number" min="0" id="pa-${k}" data-pamt="${k}" value="${S.pays[k]}" inputmode="numeric" aria-label="Сумма ${v}">`:''}

       </div>`).join('')}</div>
       ${'certificate' in S.pays ? certPickerHtml() : ''}</div>
     ${S.cart.length&&!keys.length?'<div class="warn">Выберите способ оплаты</div>':''}
     ${keys.length&&Math.abs(diff)>=1?`<div class="warn num">${diff>0?'Не хватает '+fmt(diff):'Лишние '+fmt(-diff)}</div>`:''}
     ${needCode?'<div class="warn">Выберите сертификат из списка</div>':''}
     <div class="row"><button class="btn" id="clear" ${S.cart.length?'':'disabled'}>Очистить</button>
       <button class="btn primary" id="checkout" ${canPay?'':'disabled'} ${shOpen===false?'title="Сначала откройте смену"':''}>${S.busy?'Проводим…':'Провести чек'}</button></div>
   </div></div>`;
}
async function loadCertList(){
  const { data, error } = await sb.from('certificates').select('code,kind,nominal,balance,expires_at,buyer_name,buyer_phone,recipient_name,recipient_phone,sold_store_id')
    .eq('status','active').gt('balance',0).order('created_at',{ascending:false}).limit(1000);
  S.certList = error ? [] : (data||[]).filter(c => !c.expires_at || new Date(c.expires_at) > new Date());
  if(error) toast(errText(error));
}
function certPickerHtml(){
  if(S.cert) return `<div class="cust" style="margin-top:8px"><div class="row"><span><b>Сертификат ${esc(S.cert.code)}</b><br><span class="meta">остаток ${fmt(S.cert.balance)}${S.cert.recipient_name?' · для '+esc(S.cert.recipient_name):''}</span></span><button class="btn small" id="cert-change">Другой</button></div></div>`;
  if(!S.certList) return '<div class="meta" style="margin-top:8px">Загружаем сертификаты…</div>';
  const q = S.certQ.trim().toLowerCase(), qd = q.replace(/\D/g,'');
  const list = S.certList.filter(c => !q || c.code.toLowerCase().includes(q) || [c.buyer_name,c.recipient_name].some(n=>n&&n.toLowerCase().includes(q)) || (qd.length>=4 && [c.buyer_phone,c.recipient_phone].some(p=>p&&p.replace(/\D/g,'').includes(qd)))).slice(0,8);
  return `<div class="cust stack" style="margin-top:8px"><span class="label">Сертификат из базы</span>
    <input id="cert-q" placeholder="Номер, имя или телефон" value="${esc(S.certQ)}" autocomplete="off">
    ${list.length?`<div class="list" style="margin-top:0">${list.map(c=>`<button class="prod" style="grid-template-columns:minmax(0,1fr) auto" data-certpick="${esc(c.code)}"><span><b class="num">${esc(c.code)}</b><br><span class="meta">${c.kind==='electronic'?'электронный':'физический'}${c.recipient_name?' · для '+esc(c.recipient_name):''}${c.buyer_name?' · купил(а) '+esc(c.buyer_name):''}</span></span><span class="price num">${fmt(c.balance)}</span></button>`).join('')}</div>`
      :`<div class="meta">${S.certList.length?'Не найдено':'Активных сертификатов пока нет'}</div>`}</div>`;
}
function addToCart(p){
  if(p.svc) return svcModal(p.id);
  if(!(+p.price>0)) return toast('У товара «'+p.name+'» ещё нет розничной цены — попросите менеджера поставить её в «Номенклатуре»');
  const l = S.cart.find(x=>x.pid===p.id);
  if(l) l.qty++; else S.cart.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, cat:p.category_id||null, qty:1, disc:0, dt:'pct', dv:0 });
  syncPays(); render();
  if(!S.stock[p.id] || S.stock[p.id][S.store]==null) loadStock([p.id]).then(()=>{ (S.stock[p.id] ||= {}); if(S.stock[p.id][S.store]==null) S.stock[p.id][S.store]=0; if(S.view==='pos') render(); });
}
/* услуги (доставка и т.п.): сумму вводят при продаже, остатки не двигаются */
function svcModal(id){ const a = S.catalog.find(x=>x[0]===id); if(!a) return;
  modal(`<div class="row"><h3 style="margin:0">${/доставк/i.test(a[3])?'🚚':'🛎'} ${esc(a[3])}</h3><button class="btn small" data-close>✕</button></div>
    <div class="stack" style="gap:8px;margin-top:10px"><span class="meta">${/доставк/i.test(a[3])?'Клиент оплачивает доставку — на эту сумму вы вызываете курьера, с получателя ничего не берут. ':''}Это услуга: остатки не меняются.</span>
    <label class="stack" style="gap:2px"><span class="label">Сумма, ₸</span><input id="svc-amt" type="number" min="1" inputmode="numeric" value="${+a[4]>0?+a[4]:''}"></label>
    <div class="row"><span></span><button class="btn primary" id="svc-add" data-id="${a[0]}">Добавить в чек</button></div></div>`);
  setTimeout(()=>{ const i = $('#svc-amt'); if(i) i.focus(); }, 50); }
document.addEventListener('click', e => { const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.svc){ svcModal(t.dataset.svc); }
  else if(t.id==='svc-add'){ const a = S.catalog.find(x=>x[0]===t.dataset.id), amt = Math.round(+$('#svc-amt').value); if(!a) return; if(!(amt>0)) return toast('Введите сумму');
    S.cart.push({ pid:a[0], name:a[3], barcode:a[1], price:amt, cat:a[6]||null, qty:1, disc:0, dt:'pct', dv:0, svc:true }); closeModal(); syncPays(); render(); }
});
async function doSearch(){
  S.found = searchCatalog(S.q); render();
  await loadStock(S.found.map(p=>p.id)); if(S.view==='pos') render();
}
async function checkout(){
  const t = totals(); S.busy = true; render();
  const phone = normPhone(S.phone);
  const args = { p: {
    client_uuid: uuid(), kind:'sale', store_id:S.store, created_at:new Date().toISOString(),
    customer_phone: phone || null, discount_total: t.chk, bonus_spent: +S.pays.bonus || 0,
    items: S.cart.map(l=>({ product_id:l.pid, qty:l.qty, price:l.price, discount:l.disc||0 })),
    payments: Object.entries(S.pays).filter(([k,v])=>+v>0).map(([k,v])=>({ method:k, amount:+v, ...(k==='certificate'?{code:S.certCode.trim()}:{}) })),
  }};
  const snapshot = { lines:S.cart.map(l=>({...l})), t, pays:{...S.pays}, cust:S.cust, phone, at:new Date(), store:S.store, by:S.me.full_name };
  let number = null, offline = false;
  const { data, error } = await sb.rpc('post_sale', args);
  S.busy = false;
  if(error){
    if(isNetErr(error)){ setQueue([...queue(), { fn:'post_sale', args, at:Date.now() }]); offline = true; }
    else { render(); return toast('Чек не проведён: '+errText(error)); }
  } else {
    const r = await sb.from('sales').select('number,bonus_earned').eq('id', data).single(); number = r.data && r.data.number; snapshot.bonus = r.data && r.data.bonus_earned;
    celebrate(data);
  }
  S.cart=[]; S.disc=0; S.pays={}; S.certCode=''; S.cert=null; S.certQ=''; S.phone=''; S.cust=null; S.custMsg=''; S.q=''; S.found=[];
  render(); showReceipt(snapshot, number, offline);
}
function receiptText(s, number){
  const w=32, pad=(a,b)=>{ a=String(a); b=String(b); return a+' '.repeat(Math.max(1,w-a.length-b.length))+b; };
  const L=[storeName(s.store), `Товарный чек ${number?'№'+number:'(в очереди)'}`, s.at.toLocaleString('ru-RU'), 'Продавец: '+s.by, '-'.repeat(w)];
  s.lines.forEach(l=>{ L.push(l.name); L.push(pad(`  ${l.qty} × ${fmt(l.price)}`, fmt(l.price*l.qty))); if(l.disc) L.push(pad('  скидка','−'+fmt(l.disc))); });
  L.push('-'.repeat(w)); if(s.t.chk) L.push(pad('Скидка на чек','−'+fmt(s.t.chk)));
  L.push(pad('ИТОГО', fmt(s.t.total)));
  Object.entries(s.pays).filter(([k,v])=>+v>0).forEach(([k,v])=>L.push(pad(PAY[k], fmt(v))));
  if(s.phone) L.push('Клиент: '+s.phone);
  if(s.bonus) L.push(pad('Начислено бонусов', String(Math.round(s.bonus))));
  L.push('', 'Не является фискальным чеком.', 'Фискальный чек выдаёт Kaspi.');
  return L.join('\n');
}
function showReceipt(s, number, offline){
  const txt = receiptText(s, number);
  modal(`<h2>${offline?'Нет интернета — чек сохранён':'Чек проведён'}</h2>
    ${offline?'<p class="warn">Чек отправится в базу автоматически, когда появится интернет.</p>':''}
    <div class="receipt">${esc(txt)}</div>
    <p class="meta">Отчёт уже отправлен в Telegram. Если нужно — сфотографируйте этот экран вместе с отчётом терминала.</p>
    <div class="row"><button class="btn" data-close>Закрыть</button><button class="btn primary" id="print">Печать</button></div>`);
  $('#print').onclick = () => { $('#paper').textContent = txt; window.print(); };
}

/* ---------- чеки и возвраты ---------- */
async function loadSales(){
  if(!navigator.onLine) return;
  { const F = (S.sf ||= { from:'', to:'', kind:'', lim:100 });
    const { data, error } = await sb.rpc('sales_list2', { p_stores: selStores(), p_from: F.from||null, p_to: F.to||null, p_kind: F.kind||null, p_q: S.salesQ.trim()||null, p_offset: 0, p_limit: F.lim });
    if(error) return toast(errText(error)); S.sales = (data && data.rows) || []; S.salesTotal = data ? data.total : 0; S.salesSum = data ? data.sum : 0;
    if(wiponOk()) wuLoadLast();
    return; }
  let q = sb.from('sales').select('id,number,kind,created_at,total,store_id,original_sale_id,is_certificate_sale,note,customers(phone,name),employees(full_name),sale_items(product_id,qty,price,discount,total,products(name,barcode)),sale_payments(method,amount,certificate_code)')
    .in('store_id', selStores()).order('created_at',{ascending:false}).limit(200);
  const qq = S.salesQ.trim();
  if(/^\d+$/.test(qq) && qq.length < 8) q = q.eq('number', +qq);
  const { data, error } = await q;
  if(error) return toast(errText(error));
  S.sales = data || [];
  if(qq && !/^\d+$/.test(qq)){ const p = normPhone(qq); S.sales = S.sales.filter(s => (p && s.customers && s.customers.phone===p) || s.sale_items.some(i=>i.products&&i.products.name.toLowerCase().includes(qq.toLowerCase()))); }
}
function returnedQty(saleId){
  const m = {}; S.sales.filter(s=>s.original_sale_id===saleId).forEach(s=>s.sale_items.forEach(i=>m[i.product_id]=(m[i.product_id]||0)+i.qty)); return m;
}
function renderSales(){
  $('#main').innerHTML = `<h2>Чеки и возвраты</h2>${wiponUpHtml('sales')}
    ${(()=>{ const F = S.sf || { from:'', to:'', kind:'' }; return `<div class="filters"><label class="meta">с <input type="date" id="sf-from" value="${F.from}"></label><label class="meta">по <input type="date" id="sf-to" value="${F.to}"></label>
      <select id="sf-kind">${[['','Все чеки'],['sale','Только продажи'],['return','Только возвраты'],['with_return','Продажи, по которым был возврат'],['no_return','Продажи без возврата']].map(([k,v])=>`<option value="${k}" ${F.kind===k?'selected':''}>${v}</option>`).join('')}</select>
      ${F.from||F.to||F.kind||S.salesQ?'<button class="btn small" id="sf-reset">Сбросить</button>':''}</div>`; })()}
    <div class="filters"><input id="sq" style="flex:1" placeholder="Товар (название или штрихкод), номер чека или телефон клиента" value="${esc(S.salesQ)}"><button class="btn" id="sq-go">Найти</button></div>
    ${S.salesTotal!=null?`<p class="meta">Найдено чеков: <b>${(S.salesTotal||0).toLocaleString('ru-RU')}</b> · сумма продаж минус возвраты: <b>${fmt(S.salesSum||0)}</b>${S.salesTotal>S.sales.length?` · показаны последние ${S.sales.length}`:''}</p>`:''}
    ${S.sales.length?`<div class="scroll"><table class="mc"><thead><tr><th>№</th><th>Когда</th>${isBoss()?'<th>Магазин</th>':''}<th>Товары</th><th>Сумма</th><th>Оплата</th><th>Клиент</th><th></th></tr></thead><tbody>
    ${S.sales.map(s=>`<tr><td class="num mc-t">${s.number}${s.kind==='return'?' <span class="chip zero">возврат</span>':''}${s.has_return?' <span class="chip warn">был возврат</span>':''}${s.wipon_id?'<br><span class="meta">Wipon '+esc(String(s.wipon_id).replace('-R',''))+'</span>':''}</td>
      <td class="num" data-l="Когда">${new Date(s.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}<br><span class="meta">${esc(s.employees&&s.employees.full_name||'')}</span></td>${isBoss()?`<td data-l="Магазин">${esc(storeName(s.store_id))}</td>`:''}
      <td data-l="Товары">${s.is_certificate_sale?esc(s.note):s.sale_items.map(i=>pcl(i.product_id, esc(i.products?i.products.name:''))+' × '+i.qty).join('<br>')}</td>
      <td class="num" data-l="Сумма">${fmt(s.total)}</td><td data-l="Оплата">${s.sale_payments.map(p=>PAY[p.method]+(p.certificate_code?' '+esc(p.certificate_code):'')).join(', ')}</td>
      <td data-l="Клиент">${s.customers?esc(s.customers.phone):'—'}</td>
      <td class="mc-a">${s.kind==='sale'&&!s.is_certificate_sale?`<button class="btn small" data-ret="${s.id}">Возврат</button>`:''}</td></tr>`).join('')}</tbody></table></div>${S.salesTotal>S.sales.length?`<button class="btn" id="sf-more" style="width:100%;margin-top:8px">Показать ещё</button>`:''}`
    : '<div class="empty">Чеков по этим условиям нет</div>'}`;
}
function openReturn(id){
  const s = S.sales.find(x=>x.id===id); const back = returnedQty(id);
  const rows = s.sale_items.map(i=>({ i, left: i.qty - (back[i.product_id]||0) })).filter(r=>r.left>0);
  if(!rows.length) return toast('По этому чеку всё уже возвращено');
  const methods = [...new Set(s.sale_payments.map(p=>p.method).filter(m=>m!=='bonus'))].concat(POS_PAY.filter(k=>!s.sale_payments.some(p=>p.method===k)));
  modal(`<h2>Возврат по чеку №${s.number}</h2><p class="meta">Отметьте количество. Сумма считается из цены в чеке с учётом скидок.</p>
    ${rows.map(({i,left})=>`<label class="row"><span>${esc(i.products?i.products.name:'')}<br><span class="meta">можно вернуть: ${left} · ${fmt(i.total/i.qty)} за шт.</span></span>
      <input class="small" type="number" min="0" max="${left}" value="0" data-rq="${i.product_id}" data-unit="${i.total/i.qty}" data-price="${i.price}"></label>`).join('')}
    <label class="label">Как вернули деньги</label>
    <select id="rmethod">${methods.map(k=>`<option value="${k}">${PAY[k]}</option>`).join('')}</select>
    <input id="rcode" placeholder="Номер сертификата (если возврат на сертификат)" value="${esc((s.sale_payments.find(p=>p.certificate_code)||{}).certificate_code||'')}">
    <div class="row"><button class="btn" data-close>Отмена</button><button class="btn primary" id="doret">Оформить возврат</button></div>`);
  $('#doret').onclick = async () => {
    const items = []; let amount = 0;
    document.querySelectorAll('[data-rq]').forEach(el=>{ const q = Math.min(+el.value||0, +el.max); if(q>0){ const unit=+el.dataset.unit; items.push({ product_id:el.dataset.rq, qty:q, price:unit, discount:0 }); amount += unit*q; } });
    if(!items.length) return toast('Укажите количество');
    const method = $('#rmethod').value;
    const args = { p:{ client_uuid:uuid(), kind:'return', store_id:S.store, original_sale_id:s.id, customer_phone:s.customers?s.customers.phone:null,
      items, payments:[{ method, amount:Math.round(amount*100)/100, ...(method==='certificate'?{code:$('#rcode').value.trim()}:{}) }] } };
    const { error } = await sb.rpc('post_sale', args);
    if(error) return toast('Возврат не проведён: '+errText(error));
    closeModal(); toast('Возврат оформлен: '+fmt(amount)); await loadSales(); render();
  };
}

/* ---------- остатки ---------- */
async function loadStockView(){
  const byName = S.stockSort === 'name', sortCol = (S.stockSort === 'total' || byName) ? null : +S.stockSort;
  if(!S.fopts){ const { data } = await sb.rpc('filter_options'); S.fopts = data || { categories:[], materials:[], colors:[] }; }
  const f = S.stockF || (S.stockF = {}), flt = {};
  ['category','material','color'].forEach(k => { if(f[k]) flt[k] = f[k]; });
  const { data, error } = await sb.rpc('stock_top3', { p_sort_store: sortCol, p_order: byName ? (S.stockDir==='asc'?'name_desc':'name_asc') : S.stockDir, p_filter: flt, p_q: S.stockQ.trim(), p_limit: 300, p_offset: 0 });
  if(error) return toast(errText(error));
  const byId = new Map(S.catalog.map(a=>[a[0],a]));
  S.stockLim = 80;
  S.stockRows = (data||[]).map(r => { S.stock[r.product_id] = Object.fromEntries(Object.entries(r.per_store).map(([k,v])=>[+k,v]));
    const a = byId.get(r.product_id); return a ? prodObj(a) : { id:r.product_id, name:'(нет в кэше — обновите страницу)', barcode:'', price:0 }; });
}
function renderStock(head){
  const sortCol = (S.stockSort === 'total' || S.stockSort === 'name') ? null : +S.stockSort;
  const act = key => String(S.stockSort)===String(key);
  const arrow = key => !act(key) ? '↕' : key==='name' ? (S.stockDir==='asc'?'Я→А':'А→Я') : (S.stockDir==='asc'?'↑':'↓');
  const th = (key, label) => `<th><button class="btn small" data-ssort="${key}" style="${act(key)?'background:var(--ink);color:var(--surface)':''}">${label} ${arrow(key)}</button></th>`;
  $('#main').innerHTML = `${head||'<h2>Остатки по магазинам</h2>'}${wiponUpHtml('stock')}
    <div class="filters"><input id="stq" style="flex:1;min-width:200px" placeholder="Название, штрихкод или артикул" value="${esc(S.stockQ)}">
      ${(()=>{ const o=S.fopts||{categories:[],materials:[],colors:[]}, f=S.stockF||{}; const sel=(k,ph,items)=>`<select data-stf="${k}" aria-label="${ph}"><option value="">${ph}</option>${items.map(([v,t])=>`<option value="${esc(v)}" ${String(f[k]||'')===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
        return sel('category','Все категории',(o.categories||[]).map(c=>[c.id,c.name])) + sel('material','Все материалы',(o.materials||[]).map(m=>[m,m])) + sel('color','Все цвета',(o.colors||[]).map(m=>[m,m]))
          + (Object.values(f).some(Boolean)?'<button class="btn small" id="stf-clear">Сбросить фильтры</button>':''); })()}</div>
    <p class="meta">${S.stockQ.trim()||Object.values(S.stockF||{}).some(Boolean)?'Найдено '+S.stockRows.length+(S.stockRows.length===300?' (показаны первые 300)':''):'300 товаров'}: ${S.stockSort==='name'?'по названию':(S.stockDir==='asc'?'от меньшего остатка к большему':'от большего остатка к меньшему')+' '+(sortCol?'в магазине '+esc(storeName(sortCol)):'по всей сети')}. Повторное нажатие на заголовок — сортировка в обратную сторону.${S.stockDir==='asc'&&S.stockSort!=='name'?' Товары с нулевым остатком не показываются.':''}</p>
    ${S.stockRows.length?`<div class="scroll"><table class="mc"><thead><tr>${th('name','Товар')}${S.allStores.map(st=>th(st.id, esc(BRAND[st.brand])+'<br>'+esc(st.address))).join('')}${th('total','Всего')}<th></th></tr></thead><tbody>
    ${S.stockRows.slice(0, S.stockLim||80).map(p=>{ const st=S.stock[p.id]||{}; const qs=S.allStores.map(x=>st[x.id]||0);
      return `<tr><td class="mc-t"><b>${pcl(p.id, esc(p.name))}</b><br><span class="meta num">${esc(p.barcode)} · ${fmt(p.price)}</span></td>${qs.map((n,i)=>`<td class="num" data-l="${esc(BRAND[S.allStores[i].brand]+' '+S.allStores[i].address)}" style="${n?'':'color:var(--muted)'};${S.allStores[i].id===sortCol?'background:var(--soft)':''}">${n}</td>`).join('')}
      <td class="num" data-l="Всего" style="${sortCol?'':'background:var(--soft)'}"><b>${qs.reduce((a,b)=>a+b,0)}</b></td><td class="mc-a"><button class="btn small" data-hist="${p.id}">История</button></td></tr>`}).join('')}</tbody></table></div>${S.stockRows.length>(S.stockLim||80)?`<button class="btn" data-stockmore="1" style="width:100%;margin-top:8px">Показать ещё (${S.stockRows.length-(S.stockLim||80)})</button>`:''}`
    : '<div class="empty">Загружаем остатки…</div>'}`;
}
/* остатки: длинный список показываем частями */
document.addEventListener('click', e => { if(!e.target.closest('[data-stockmore]')) return; S.stockLim = (S.stockLim||80) + 150; render(); });
const MOVE_T = { opening:'Начальный остаток', receipt:'Приёмка', sale:'Продажа', return:'Возврат', transfer_out:'Перемещение (отправлено)', transfer_in:'Перемещение (получено)', writeoff:'Списание', audit:'Ревизия' };
async function openHistory(pid){
  const p = prodObj(S.catalog.find(x=>x[0]===pid));
  const { data, error } = await sb.from('stock_movements').select('created_at,type,qty,store_id,note,employees(full_name)').eq('product_id', pid).order('created_at',{ascending:false}).limit(100);
  if(error) return toast(errText(error));
  const T = MOVE_T;
  modal(`<h2>${esc(p.name)}</h2><p class="meta num">${esc(p.barcode)}</p>
    <div class="scroll"><table><thead><tr><th>Когда</th><th>Что</th><th>Магазин</th><th>Шт.</th><th>Кто</th></tr></thead><tbody>
    ${data.map(m=>`<tr><td class="num">${new Date(m.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td><td>${T[m.type]||m.type}</td>
      <td>${esc((S.allStores.find(s=>s.id===m.store_id)||{}).address||'')}</td><td class="num" style="color:${m.qty>0?'var(--ok)':'var(--bad)'}">${m.qty>0?'+':''}${m.qty}</td><td>${esc(m.employees?m.employees.full_name:'')}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn" data-close>Закрыть</button>`);
}

/* ---------- склад: приёмка, оприходование, списание, перемещение, ревизия ---------- */
const WH = {
  stock:     { t:'Остатки', boss:false, hint:'Остатки по всем магазинам. Нажмите на заголовок столбца, чтобы отсортировать.' },
  requests:  { t:'Запросы', boss:false, hint:'Консультант на кассе просит оприходовать товар, которого нет по системе. Менеджер подтверждает — товар сразу приходуется в этот магазин.' },
  receipt:   { t:'Приёмка', boss:true, hint:'Товар от поставщика. Закупочная цена обновится, после проведения можно напечатать этикетки.' },
  capitalize:{ t:'Оприходование', boss:true, hint:'Излишки и найденный товар без поставщика.' },
  writeoff:  { t:'Списание', boss:false, hint:'Брак, потеря, подарок. Причина обязательна. Списание сначала уходит на подтверждение директору (Астана — Ирине Николаевне) и проводится только после «Списать».' },
  transfer:  { t:'Перемещение', boss:false, hint:'Создаёт перемещение менеджер. Товар списывается в магазине-отправителе сразу, а в магазине-получателе — когда там нажмут «Принять».' },
  audit:     { t:'Ревизия', boss:false, hint:'Сканируйте товар на полке — каждое сканирование +1. Продажи во время ревизии учитываются. Закрывает менеджер.' },
};
function whModes(){ return Object.entries(WH).filter(([k,v]) => k==='stock' ? S.canStock : !S.whStockOnly && (!v.boss || isBoss())); }
function newDoc(mode){ return { mode, store:S.store, to:(S.stores.find(x=>x.id!==S.store)||{}).id, supplier:'', note:'', reason:'', items:[] }; }
async function loadReqs(){ const { data, error } = await sb.rpc('requests_list', { p_status: S.reqSt||'pending' }); if(error) toast(errText(error)); S.reqs = data||[]; if((S.reqSt||'pending')==='pending') setReqBadge(S.reqs.length); }
function setReqBadge(n){ S.reqCount=n; renderNav(); }
function renderReqs(head){
  const st = S.reqSt||'pending';
  $('#main').innerHTML = `${head}
    <div class="filters">${[['pending','Ждут решения'],['approved','Оприходованы'],['rejected','Отклонены']].map(([k,v])=>`<button class="btn small ${st===k?'primary':''}" data-reqst="${k}">${v}</button>`).join('')}</div>
    ${!(S.reqs||[]).length?'<div class="empty">Запросов нет</div>':S.reqs.map(r=>`<div class="card" style="margin-bottom:8px"><div class="row" style="justify-content:flex-start;align-items:flex-start">${thumb(r)}
      <div style="flex:1"><b>${esc(r.name)}</b><br><span class="meta num">${esc(r.barcode)} · ${fmt(r.price)}</span><br>
      <span>${esc(storeName(r.store))}: просят <b>${r.qty} шт.</b> · сейчас по системе ${r.stock}</span><br>
      <span class="meta">${esc(r.by||'')} · ${new Date(r.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${r.note?' · «'+esc(r.note)+'»':''}${r.decided_by?' · решение: '+esc(r.decided_by):''}</span></div></div>
      ${st==='pending'&&isBoss()?`<div class="row" style="justify-content:flex-end;margin-top:8px"><label class="meta">шт. <input class="small" type="number" min="1" id="rq-${r.id}" value="${r.qty}"></label>
        <button class="btn small" data-reqno="${r.id}">Отклонить</button><button class="btn small primary" data-reqok="${r.id}">Оприходовать</button></div>`:''}
    </div>`).join('')}`;
}
let reqChan = null;
function subscribeReqs(){
  if(reqChan || !isBoss()) return;
  try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission(); }catch(_){}
  reqChan = sb.channel('stock_requests').on('postgres_changes', { event:'INSERT', schema:'public', table:'stock_requests' }, async payload => {
    const r = payload.new || {}; const p = S.catalog.find(a=>a[0]===r.product_id);
    const text = `${storeName(r.store_id)}: запрос на оприходование ${p?p[3]:''} — ${r.qty} шт.`;
    toast(text);
    try{ if('Notification' in window && Notification.permission==='granted') new Notification('Запрос на оприходование', { body:text }); }catch(_){}
    const { data } = await sb.rpc('requests_list', { p_status:'pending' }); setReqBadge((data||[]).length);
    if(S.view==='wh' && S.wmode==='requests'){ await loadReqs(); render(); }
  }).subscribe();
  sb.rpc('requests_list', { p_status:'pending' }).then(({data}) => setReqBadge((data||[]).length));
}
async function loadWhSide(){
  { const { data } = await sb.rpc('receipts_transit', { p_store:null }); S.trIn = data || []; }
  if(S.wmode==='stock'){ if(!S.stockRows.length) await loadStockView(); return; }
  if(S.wmode==='requests'){ await loadReqs(); return; }
  if(S.wmode==='transfer'){ const { data } = await sb.rpc('transfers_list', { p_store: isBoss()?null:S.store }); S.trList = data||[]; if(TC.on && !TC.data) await tcLoad(); }
  else if(S.wmode==='audit'){ await loadAudit(); }
  else { const { data } = await sb.rpc('writeoffs_list', { p_store: isBoss()?null:S.store }); S.whList = (data||[]).filter(x => x.kind === S.wmode);
    if(S.wmode==='writeoff'){ const r = await sb.rpc('writeoff_requests_list', { p_status:null }); S.woReqs = r.data||[]; } }
}
setInterval(async () => {
  if(document.hidden || S.view!=='wh' || S.wmode!=='audit' || !S.audit) return;
  const ae = document.activeElement; if(ae && ae.tagName==='INPUT' && ae.id!=='dq') return;
  if((ae && ae.id==='dq' && ae.value) || AU_Q.length || auBusy) return;
  const had = ae && ae.id==='dq'; await loadAudit(); if(S.view==='wh' && S.wmode==='audit'){ render(); if(had && $('#dq')) $('#dq').focus(); }
}, 10000);
async function loadAudit(){
  if(!S.auStore || !S.stores.some(x=>x.id===S.auStore)) S.auStore = S.store;
  const { data: open } = await sb.from('audits').select('id,store_id,status,started_at').eq('store_id', S.auStore).eq('status','counting').limit(1);
  S.audit = open && open[0] || null; S.auditRows = []; const A = (S.au ||= { tab:'sheet', flt:'all', unc:false });
  if(S.audit){
    const sh = await sb.rpc('audit_sheets_list', { p_audit:S.audit.id }); A.sheets = sh.data || [];
    let sid = A.sheet; try{ sid = sid || localStorage.getItem('au_sheet_'+S.audit.id); }catch(_){}
    A.sheet = A.sheets.some(x=>x.id===sid) ? sid : null;
    const [it, rv] = await Promise.all([ A.sheet ? sb.rpc('audit_sheet_items', { p_sheet:A.sheet }) : Promise.resolve({ data:[] }), sb.rpc('audit_review', { p_audit:S.audit.id, p_include_uncounted:A.tab==='review'&&A.unc }) ]);
    A.items = it.data || []; S.auditRows = rv.data || [];
  }
}
function docSearchHtml(ph){
  return `<div class="row"><input id="dq" style="flex:1" placeholder="${ph||'Скан штрихкода или название'}" value="${esc(S.dq)}" autocomplete="off" ${S.view==='wh'&&S.wmode==='audit'&&auScanMode()?'inputmode="none"':''}><button class="btn" id="dq-add">Добавить</button></div>
    ${S.dfound.length?`<div class="list">${S.dfound.slice(0,10).map(p=>`<button class="prod" data-dadd="${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}</div>`:''}`;
}
const WH_ICO = { stock:'📦', requests:'📨', receipt:'📥', capitalize:'➕', writeoff:'🗑', transfer:'🔁', audit:'📋' };
function whCss(){ if(document.getElementById('wh-css')) return; const st = document.createElement('style'); st.id = 'wh-css'; st.textContent = `
  .wh-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px}.wh-tabs button{border:1px solid var(--line);background:var(--card,transparent);border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit;color:inherit}
  .wh-tabs button[aria-pressed="true"]{background:var(--accent,#222);color:var(--accent-fg,#fff);border-color:transparent}
  .wh-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px;align-items:start}@media(max-width:900px){.wh-grid{grid-template-columns:1fr}}
  .wh-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}.wh-fields label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted,#888)}
  .wh-fields select,.wh-fields input{width:100%}
  .wh-items td{padding:5px 6px;vertical-align:middle}.wh-items input{width:72px;padding:4px 6px}
  .wh-foot{position:sticky;bottom:0;background:var(--card,var(--bg,#fff));border-top:1px solid var(--line);padding:10px 0 2px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  .wh-hist{border:1px solid var(--line);border-radius:12px;margin-bottom:8px;overflow:hidden}.wh-hist>summary{list-style:none;cursor:pointer;padding:9px 12px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 10px;align-items:center}
  .wh-hist>summary::-webkit-details-marker{display:none}.wh-hist[open]>summary{border-bottom:1px solid var(--line)}.wh-hist .wh-body{padding:8px 12px}
  .wh-hist .wh-body table td{padding:3px 6px;font-size:13px}`; document.head.append(st); }
function whItemsTable(items){ return `<table class="wh-items"><tbody>${items.map(i=>`<tr><td>${esc(i.name)}<br><span class="meta num">${esc(i.barcode||'')}</span></td><td class="num">× ${i.qty}</td></tr>`).join('')}</tbody></table>`; }
function whHead(m){ return `<h2 style="margin:0">Склад</h2><div class="wh-tabs" role="tablist">${whModes().map(([k,v])=>`<button data-wmode="${k}" aria-pressed="${k===m}">${WH_ICO[k]||''} ${v.t}</button>`).join('')}</div>
    <p class="meta" style="margin:2px 0 10px">${WH[m].hint}</p>${transitHtml()}`; }
function renderWh(){
  whCss();
  if(!S.wmode || !whModes().some(([k]) => k===S.wmode)) S.wmode = whModes()[0][0];
  if(S.wmode==='stock') return renderStock(whHead('stock'));
  const m = S.wmode, d = S.doc && S.doc.mode===m ? S.doc : (S.doc = newDoc(m));
  const head = whHead(m);
  if(m==='requests') return renderReqs(head);
  if(m==='audit') return renderAudit(head);
  if(m==='transfer' && !isBoss()){ $('#main').innerHTML = `${head}${renderTransfers()}`; return; }
  if(m==='transfer' && TC.on){ $('#main').innerHTML = `${head}${tcToggle()}${tcHtml()}`; return; }
  const storeSel = (id, val) => `<select id="${id}">${S.stores.map(st=>`<option value="${st.id}" ${st.id===val?'selected':''}>${esc(BRAND[st.brand]+' · '+st.city+', '+st.address)}</option>`).join('')}</select>`;
  const total = d.items.reduce((a,i)=>a+i.qty,0), retail = d.items.reduce((a,i)=>a+(+i.price||0)*i.qty,0), cost = d.items.reduce((a,i)=>a+(+i.cost||0)*i.qty,0);
  const title = { receipt:'Новая приёмка', capitalize:'Новое оприходование', writeoff:'Новое списание', transfer:'Новое перемещение' }[m];
  $('#main').innerHTML = `${head}${m==='transfer'?tcToggle():''}<div class="wh-grid"><div class="card stack" style="gap:10px">
    <b style="font-size:16px">${title}</b>
    <div class="wh-fields">
      <label>${m==='transfer'?'Откуда':'Магазин'}${storeSel('d-store', d.store)}</label>
      ${m==='transfer'?`<label>Куда${storeSel('d-to', d.to)}</label>`:''}
      ${m==='receipt'?`<label>Поставщик<input id="d-supplier" placeholder="Китай, Иу, рынок, наша студия…" value="${esc(d.supplier)}"></label>`:''}
      ${m==='writeoff'?`<label>Причина списания *<input id="d-reason" placeholder="брак, потеря, подарок…" value="${esc(d.reason)}"></label>`:''}
      ${m==='capitalize'||m==='receipt'?`<label>Комментарий<input id="d-note" placeholder="необязательно" value="${esc(d.note)}"></label>`:''}
    </div>
    ${docSearchHtml()}
    ${(m==='receipt'||m==='capitalize')&&isBoss()&&!isViewer()?(S.dnew?dnewHtml():`<button class="btn small" id="dn-open" style="align-self:flex-start">+ Новый товар (нет в базе)</button>`):''}
    ${d.items.length?`<div class="scroll"><table class="wh-items"><thead><tr><th></th><th>Товар</th><th>Кол-во</th>${m==='receipt'?'<th>Закуп, ₸</th>':''}<th>Розница</th><th></th></tr></thead><tbody>
      ${d.items.map((i,n)=>`<tr><td>${thumb(i)}</td><td>${esc(i.name)}<br><span class="meta num">${esc(i.barcode)}</span></td>
        <td><input type="number" min="1" id="dqty-${n}" data-dqty="${n}" value="${i.qty}" inputmode="numeric"></td>
        ${m==='receipt'?`<td><input type="number" min="0" id="dcost-${n}" data-dcost="${n}" value="${i.cost??''}" inputmode="numeric" placeholder="0"></td>`:''}
        <td class="num">${+i.price>0?fmt(i.price):'<span style="color:var(--bad)">нет цены</span>'}</td>
        <td><button class="btn small" data-ddel="${n}" title="Убрать">✕</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty" style="padding:18px">Сканируйте штрихкоды или найдите товар по названию — он появится здесь</div>'}
    <div class="wh-foot"><span class="meta">Позиций <b>${d.items.length}</b> · штук <b>${total}</b>${retail?` · в рознице <b>${fmt(retail)}</b>`:''}${m==='receipt'&&cost?` · закуп <b>${fmt(cost)}</b>`:''}</span>
      <button class="btn primary" id="d-post" ${d.items.length?'':'disabled'}>${{receipt:'Провести приёмку',capitalize:'Оприходовать',writeoff:'Отправить на подтверждение',transfer:'Отправить'}[m]}</button></div>
  </div><div>${m==='transfer'?renderTransfers():m==='writeoff'?renderWoReqs()+renderWhList():renderWhList()}</div></div>`;
}
/* ---------- перемещения: сравнить остатки магазинов одного города и разложить товар правильно ---------- */
const TC = { on:false, city:'', days:30, target:30, brand:'', q:'', data:null, sel:{}, qty:{}, busy:false, open:{} };
const tcCities = () => [...new Set((isBoss() && S.me.role==='owner' ? S.allStores : S.stores).map(x => x.city))].filter(Boolean);
function tcToggle(){ return `<div class="seg" style="margin:0 0 10px"><button data-tcon="0" aria-pressed="${!TC.on}">✍ Новое перемещение</button><button data-tcon="1" aria-pressed="${TC.on}">⚖ Сравнить остатки магазинов</button></div>`; }
async function tcLoad(){
  if(!TC.city || !tcCities().includes(TC.city)) TC.city = (S.allStores.find(x=>x.id===S.store)||{}).city || tcCities()[0] || 'Алматы';
  TC.busy = true; const k = [TC.city, TC.days, TC.target, TC.brand, TC.q].join('|');
  const { data, error } = await sb.rpc('transfer_suggest', { p_city:TC.city, p_days:TC.days, p_target:TC.target, p_brand:TC.brand||null, p_q:TC.q.trim()||null });
  if(k !== [TC.city, TC.days, TC.target, TC.brand, TC.q].join('|')) return;
  TC.busy = false; if(error){ toast(errText(error)); TC.data = { products:[], stores:[], mine:[] }; return; }
  TC.data = data; TC.sel = {}; TC.qty = {};
}
const tcKey = (p, m) => p.id+'|'+m.from+'|'+m.to;
const tcShort = id => { const st = S.allStores.find(x=>x.id===+id); return st ? (st.brand==='moon'?'MOON ':'')+st.address : '№'+id; };
function tcSelected(){ const out = []; for(const p of (TC.data&&TC.data.products)||[]) for(const m of p.moves||[]){ const k = tcKey(p, m); if(TC.sel[k]===false) continue; const q = TC.qty[k]!=null ? +TC.qty[k] : m.qty; if(q>0) out.push({ p, m, k, q }); } return out; }
function tcHtml(){
  const D = TC.data, seg = (k, cur, arr) => `<div class="seg">${arr.map(([v,t])=>`<button data-${k}="${v}" aria-pressed="${String(cur)===String(v)}">${t}</button>`).join('')}</div>`;
  const ctl = `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px 14px;margin-bottom:8px">
      ${tcCities().length>1?`<span class="row" style="gap:6px"><span class="meta">Город:</span>${seg('tccity', TC.city, tcCities().map(c=>[c,c]))}</span>`:''}
      <span class="row" style="gap:6px"><span class="meta">Бренд:</span>${seg('tcbrand', TC.brand, [['','Все'],['sunshine','Sunshine'],['moon','MOON']])}</span>
      <span class="row" style="gap:6px"><span class="meta">Продажи за:</span>${seg('tcdays', TC.days, [[30,'30 дн.'],[60,'60 дн.'],[90,'90 дн.']])}</span>
      <span class="row" style="gap:6px"><span class="meta">Запас на:</span>${seg('tctarget', TC.target, [[14,'14 дн.'],[30,'30 дн.'],[45,'45 дн.']])}</span></div>
    <div class="row" style="gap:6px;margin-bottom:8px"><input id="tc-q" type="search" placeholder="🔍 Найти товар и сравнить остатки по магазинам" value="${esc(TC.q)}" style="flex:1;min-width:200px" autocomplete="off"></div>
    <p class="meta" style="margin:0 0 10px">Silver сравнивает остатки и продажи магазинов города ${esc(TC.city)}: где товара не хватит на ${TC.target} дн. (по продажам за ${TC.days} дн.), туда предлагает перенести из магазина, где он лежит сверх нужного (1 шт. остаётся на витрине). Товар MOON — только между магазинами MOON, Sunshine — между Sunshine. Снимите галочку или поменяйте количество — и нажмите «Создать перемещения»: на каждое направление создастся отдельное перемещение, как обычно, с приёмкой в магазине-получателе.</p>`;
  if(!D || TC.busy) return ctl + '<div class="empty">Сравниваем остатки…</div>';
  const stores = (D.stores||[]).filter(id => (D.products||[]).some(p => p.per && p.per[id]));
  const cell = (p, id) => { const c = (p.per||{})[id]; if(!c) return '<span class="meta">—</span>'; const low = c.sold>0 && c.stock < c.need, extra = c.stock > Math.max(c.need,1);
    return `<span style="${low?'color:var(--bad);font-weight:600':extra?'color:var(--ok)':''}">${c.stock}</span> <span class="meta">/ прод. ${c.sold}</span>`; };
  const groups = new Map(); const none = [];
  for(const p of D.products||[]){ if(!(p.moves||[]).length){ none.push(p); continue; } for(const m of p.moves){ const g = m.from+'>'+m.to; (groups.get(g) || groups.set(g, []).get(g)).push({ p, m }); } }
  const sel = tcSelected(), docs = new Set(sel.map(x=>x.m.from+'>'+x.m.to)).size, pcs = sel.reduce((a,x)=>a+x.q,0);
  const head = `<thead><tr><th></th><th></th><th>Товар</th>${stores.map(id=>`<th>${esc(tcShort(id))}<br><span class="meta" style="font-weight:400">остаток / продано</span></th>`).join('')}<th>Переместить</th></tr></thead>`;
  const row = (p, m) => { const k = m ? tcKey(p, m) : ''; const on = m && TC.sel[k]!==false;
    return `<tr style="${m&&!on?'opacity:.5':''}"><td class="mc-x">${m?`<input type="checkbox" data-tcsel="${esc(k)}" ${on?'checked':''}>`:''}</td><td data-l="">${thumb(p)}</td>
      <td class="mc-t">${pcl(p.id, esc(p.name))}<br><span class="meta num">${esc(p.barcode||'')} · ${esc(p.cat||'')}</span>${m?`<br><span class="meta">${esc(m.reason||'')}</span>`:''}</td>
      ${stores.map(id=>`<td class="num" data-l="${esc(tcShort(id))}">${cell(p, id)}</td>`).join('')}
      <td class="num" data-l="Переместить">${m?`<input type="number" min="0" style="width:70px" data-tcqty="${esc(k)}" value="${TC.qty[k]!=null?TC.qty[k]:m.qty}" inputmode="numeric"> шт.`:'<span class="meta">не нужно</span>'}</td></tr>`; };
  const gs = [...groups].sort((a,b)=>b[1].length-a[1].length);
  return ctl + `<div class="card row" style="flex-wrap:wrap;gap:8px;margin-bottom:10px;position:sticky;top:0;z-index:3"><span style="flex:1;min-width:200px">${gs.length?`Предложено: <b>${D.moves}</b> перемещений товара, <b>${D.qty}</b> шт. · выбрано <b>${pcs}</b> шт. в <b>${docs}</b> документ(ах)`:'Перемещать нечего — остатки распределены ровно'}</span>
      <button class="btn primary" id="tc-go" ${pcs?'':'disabled'}>${TC.creating?'Создаём…':'Создать перемещения'}</button></div>
    ${gs.map(([g, L])=>{ const [f, t] = g.split('>'), n = L.reduce((a,x)=>a+(TC.sel[tcKey(x.p,x.m)]===false?0:(TC.qty[tcKey(x.p,x.m)]!=null?+TC.qty[tcKey(x.p,x.m)]:x.m.qty)),0);
      return `<details class="card" style="margin-bottom:8px;padding:8px 12px" ${TC.open[g]||gs.length===1?'open':''} data-tcgrp="${g}"><summary style="cursor:pointer;font-weight:600">${esc(tcShort(f))} → ${esc(tcShort(t))} <span class="meta">· ${L.length} поз. · ${n} шт.</span></summary>
        <div class="row" style="justify-content:flex-start;gap:6px;margin:6px 0"><button class="btn small" data-tcall="${g}" data-v="1">Отметить все</button><button class="btn small" data-tcall="${g}" data-v="0">Снять все</button></div>
        <div class="scroll"><table class="mc">${head}<tbody>${L.map(x=>row(x.p, x.m)).join('')}</tbody></table></div></details>`; }).join('')}
    ${none.length?`<details class="card" style="margin-bottom:8px;padding:8px 12px" open><summary style="cursor:pointer;font-weight:600">Найдено, перемещать не нужно <span class="meta">· ${none.length} поз.</span></summary>
      <div class="scroll"><table class="mc">${head}<tbody>${none.slice(0,200).map(p=>row(p, null)).join('')}</tbody></table></div></details>`:''}`;
}
async function tcCreate(){
  const sel = tcSelected(); if(!sel.length) return; const by = new Map();
  for(const x of sel){ const g = x.m.from+'>'+x.m.to; (by.get(g) || by.set(g, []).get(g)).push({ product_id:x.p.id, qty:x.q }); }
  TC.creating = true; render(); let ok = 0, pcs = 0; const errs = [];
  for(const [g, items] of by){ const [f, t] = g.split('>').map(Number);
    const { error } = await sb.rpc('create_transfer', { p:{ from_store_id:f, to_store_id:t, items } });
    if(error) errs.push(tcShort(f)+' → '+tcShort(t)+': '+errText(error)); else { ok++; pcs += items.reduce((a,i)=>a+i.qty,0); } }
  TC.creating = false; TC.on = false; TC.data = null;
  toast(ok ? `Создано перемещений: ${ok} (${pcs} шт.). Товар уже списан в магазинах-отправителях, в получателях его примут через «Принять».` + (errs.length?' Не создано: '+errs.join('; '):'') : 'Не создано: '+errs.join('; '));
  await loadWhSide(); render(); scrollTo(0,0);
}
let tcTimer;
document.addEventListener('click', async e => { if(S.view!=='wh' || S.wmode!=='transfer') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset;
  if(d.tcon!==undefined){ TC.on = d.tcon==='1'; render(); if(TC.on && !TC.data){ await tcLoad(); render(); } return; }
  const re = async () => { TC.data = null; render(); await tcLoad(); render(); };
  if(d.tccity!==undefined){ TC.city = d.tccity; await re(); }
  else if(d.tcbrand!==undefined){ TC.brand = d.tcbrand; await re(); }
  else if(d.tcdays!==undefined){ TC.days = +d.tcdays; await re(); }
  else if(d.tctarget!==undefined){ TC.target = +d.tctarget; await re(); }
  else if(d.tcall!==undefined){ const on = d.v==='1'; for(const p of (TC.data&&TC.data.products)||[]) for(const m of p.moves||[]) if(m.from+'>'+m.to===d.tcall) TC.sel[tcKey(p,m)] = on; TC.open[d.tcall] = true; render(); }
  else if(t.id==='tc-go'){ await tcCreate(); }
});
document.addEventListener('change', e => { if(S.view!=='wh' || S.wmode!=='transfer') return; const t = e.target;
  if(t.dataset.tcsel){ TC.sel[t.dataset.tcsel] = t.checked; render(); }
  else if(t.dataset.tcqty){ TC.qty[t.dataset.tcqty] = Math.max(0, Math.floor(+t.value||0)); render(); } });
document.addEventListener('input', e => { if(S.view!=='wh' || S.wmode!=='transfer' || e.target.id!=='tc-q') return; TC.q = e.target.value; clearTimeout(tcTimer);
  tcTimer = setTimeout(async () => { TC.data = null; render(); await tcLoad(); render(); }, 450); });
document.addEventListener('toggle', e => { const d = e.target; if(d.dataset && d.dataset.tcgrp) TC.open[d.dataset.tcgrp] = d.open; }, true);
function renderWoReqs(){
  const L = S.woReqs||[]; if(!L.length) return '';
  const ST = { pending:['warn','ждёт решения'], approved:['ok','списано'], rejected:['zero','отклонено'] };
  return `<h3 style="margin:0 0 8px">Запросы на списание</h3>${L.slice(0,30).map(r=>{ const sum = (r.items||[]).reduce((a,i)=>a+(+i.price||0)*i.qty,0), q = (r.items||[]).reduce((a,i)=>a+i.qty,0);
    return `<details class="wh-hist" ${r.status==='pending'?'open':''}><summary><span class="chip ${ST[r.status][0]}">${ST[r.status][1]}</span><span><b>${esc(storeName(r.store))}</b> · ${q} шт. · ${fmt(sum)}<br><span class="meta">${esc(r.reason)}</span></span><span class="meta">${tm(r.created_at)}</span></summary>
    <div class="wh-body"><div class="meta">Запросил(а) ${esc(r.by||'—')}${r.decided_by?' · решение: '+esc(r.decided_by):''}${r.note?' («'+esc(r.note)+'»)':''}</div>${whItemsTable(r.items||[])}
    ${r.status==='pending'&&r.can_decide?`<div class="row" style="justify-content:flex-start;gap:6px;margin-top:6px"><button class="btn small primary" data-wook="${r.id}">Списать</button><button class="btn small" data-wono="${r.id}">Отклонить</button></div>`:''}</div></details>`; }).join('')}<div style="height:10px"></div>`;
}
function renderWhList(){
  const L = S.whList || [];
  return `<h3 style="margin:0 0 8px">Последние документы</h3>${L.length?L.map(x=>{ const q = (x.items||[]).reduce((a,i)=>a+i.qty,0);
    return `<details class="wh-hist"><summary><span>${WH_ICO[x.kind]||''}</span><span><b>${esc(WH[x.kind]?WH[x.kind].t:x.kind)}${x.number?' №'+x.number:''}</b> · ${esc(storeName(x.store))}<br><span class="meta">${(x.items||[]).length} поз. · ${q} шт.${x.supplier?' · '+esc(x.supplier):''}${x.reason?' · '+esc(x.reason):''}</span></span>
      <span class="meta" style="text-align:right">${new Date(x.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}<br>${esc(x.by||'')}</span></summary>
    <div class="wh-body">${whItemsTable(x.items||[])}
      ${x.kind!=='writeoff'&&x.items?`<button class="btn small" style="margin-top:6px" data-labels='${esc(JSON.stringify(x.items.map(i=>({n:i.name,b:i.barcode,p:i.price,q:i.qty}))))}'>🏷 Этикетки</button>`:''}</div></details>`; }).join(''):'<div class="empty">Документов пока нет</div>'}`;
}
function renderTransfers(){
  const ST = { received:['ok','принято'], sent:['warn','в пути'], awaiting:['warn','ждёт подтверждения'], rejected:['zero','отклонено'] };
  return `<h3 style="margin:0 0 8px">Перемещения</h3>${S.trList.length?S.trList.map(t=>{ const st = ST[t.status]||['',t.status], q = (t.items||[]).reduce((a,i)=>a+i.qty,0), act = (t.can_decide&&!isViewer()) || (t.status==='sent'&&!isViewer()&&(isBoss()||t.to===S.store));
    return `<details class="wh-hist" ${act?'open':''}><summary><span class="chip ${st[0]}">${st[1]}</span><span><b>№${t.number}</b> ${esc(storeName(t.from))} → ${esc(storeName(t.to))}<br><span class="meta">${(t.items||[]).length} поз. · ${q} шт.</span></span>
      <span class="meta" style="text-align:right">${new Date(t.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></summary>
    <div class="wh-body"><div class="meta">Отправил(а) ${esc(t.sent_by||'—')}${t.received_by?' · принял(а) '+esc(t.received_by):''}${t.approved_by?(t.status==='rejected'?' · отклонил(а) ':' · подтвердил(а) ')+esc(t.approved_by):''}${t.decision_note?' · «'+esc(t.decision_note)+'»':''}</div>
      ${whItemsTable(t.items||[])}
      <div class="row" style="justify-content:flex-start;gap:6px;margin-top:6px;flex-wrap:wrap">
      ${t.can_decide&&!isViewer()?`<button class="btn small primary" data-trok="${t.id}">Подтвердить</button><button class="btn small" data-trno="${t.id}">Отклонить</button>`:''}
      ${t.status==='sent'&&!isViewer()&&(isBoss()||t.to===S.store)?`<button class="btn small primary" data-trrecv="${t.id}">Принять в ${esc(storeName(t.to))}</button>`:''}</div></div></details>`; }).join(''):'<div class="empty">Перемещений пока нет</div>'}`;
}
function renderAudit(head){
  const a = S.audit, A = S.au || {}, boss = S.me && ['owner','manager'].includes(S.me.role);
  const rows = S.auditRows || [], rec = rows.filter(r=>r.recount);
  const sheetName = (A.sheets||[]).find(x=>x.id===A.sheet)?.name;
  const R = A.flt==='diff' ? rows.filter(r=>r.diff!==0) : A.flt==='rec' ? rec : rows;
  $('#main').innerHTML = `${head}
    <div class="card stack"><div class="row" style="flex-wrap:wrap"><b>Ревизия</b><select id="au-store" aria-label="Магазин ревизии">${S.stores.map(st=>`<option value="${st.id}" ${st.id===S.auStore?'selected':''}>${esc(BRAND[st.brand]+' · '+st.city+', '+st.address)}</option>`).join('')}</select>${a?`<span class="meta">начата ${new Date(a.started_at).toLocaleString('ru-RU')} · листов ${(A.sheets||[]).length}</span>`:''}</div>
    ${!a?`<button class="btn primary" id="au-start">Начать ревизию в этом магазине</button>`:`
      <div class="seg" style="display:inline-flex;align-self:flex-start">${[['sheet','Мой лист'+(sheetName?' · '+sheetName:'')],['review','Сверка всех листов']].map(([k,v])=>`<button data-autab="${k}" aria-pressed="${A.tab===k}">${esc(v)}</button>`).join('')}</div>
      ${rec.length?`<div class="cust"><b>🔁 На пересчёт (${rec.length}):</b> ${rec.map(r=>esc(r.name)+' <span class="meta num">'+esc(r.barcode)+'</span>').join(' · ')}</div>`:''}
      ${A.tab==='sheet'?auSheetHtml(A):auReviewHtml(A, R, boss)}`}
    </div>`;
}
function auSheetHtml(A){
  const S_ = A.sheets||[], items = A.items||[], units = items.reduce((t,i)=>t+i.qty,0);
  const pick = `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
    ${S_.length?`<select id="au-sheet"><option value="">— выберите свой лист —</option>${S_.map(x=>`<option value="${x.id}" ${x.id===A.sheet?'selected':''}>${esc(x.name)} · ${x.units} шт.</option>`).join('')}</select><span class="meta">или</span>`:''}
    <input id="au-sheet-name" placeholder="Новый лист: имя или «ноутбук 3»" style="min-width:200px"><button class="btn small" id="au-sheet-new">＋ Создать лист</button></div>`;
  if(!A.sheet) return `<p class="meta" style="margin:0">У каждого, кто сканирует, свой лист: видно, что именно он посчитал, и он сам может быстро исправить ошибку. Все листы складываются в общую сверку. На этом компьютере лист запомнится.</p>${pick}`;
  return `${pick}
    ${docSearchHtml('Сканируйте товар — каждый скан +1 в ваш лист')}
    <label class="meta" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="au-scanmode" ${auScanMode()?'checked':''}> 📟 Сканер подключён к телефону — не показывать экранную клавиатуру</label>
    <div id="au-last">${auLastHtml()}</div>
    <div class="meta">В вашем листе: ${items.length} поз. · ${units} шт.</div>
    <div class="scroll"><table><thead><tr><th>Товар</th><th>Посчитано в листе</th><th></th></tr></thead><tbody>
    ${items.map(i=>`<tr><td>${esc(i.name)}<br><span class="meta num">${esc(i.barcode)}</span></td>
      <td><input class="small" type="number" min="0" data-asq="${i.product_id}" value="${i.qty}" inputmode="numeric" style="width:80px"></td>
      <td><button class="btn small" data-asdel="${i.product_id}" title="Убрать из листа">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="meta">Пока пусто — начинайте сканировать</td></tr>'}</tbody></table></div>`;
}
function auReviewHtml(A, R, boss){
  return `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">${(A.sheets||[]).map(x=>`<span class="chip">${esc(x.name)} · ${x.positions} поз. · ${x.units} шт.</span>`).join('') || '<span class="meta">Листов пока нет</span>'}</div>
    <div class="filters">${[['all','Все'],['diff','Расхождения'],['rec','На пересчёт']].map(([k,v])=>`<button class="btn small ${A.flt===k?'primary':''}" data-auflt="${k}">${v}</button>`).join('')}
      <label class="meta" style="align-self:center"><input type="checkbox" id="au-unc" ${A.unc?'checked':''}> показать и непосчитанные</label></div>
    <p class="meta" style="margin:0">«Сканы» — сумма всех листов. ${boss?'В колонке «Итог» менеджер может поставить правильное число после пересчёта — оно заменит сумму сканов. «На пересчёт» — товар появится у всех сверху списка.':''}</p>
    <div class="scroll"><table><thead><tr><th>Товар</th><th>По листам</th><th>Сканы</th><th>Итог</th><th>По базе</th><th>Разница</th>${boss?'<th></th>':''}</tr></thead><tbody>
    ${R.map(r=>`<tr style="${r.recount?'background:var(--soft)':''}"><td>${esc(r.name)}<br><span class="meta num">${esc(r.barcode)}</span></td>
      <td class="meta">${(r.sheets||[]).map(x=>esc(x.name)+': '+x.qty).join('<br>')||'—'}</td>
      <td class="num">${r.scanned}</td>
      <td>${boss?`<input class="small" type="number" min="0" data-afin="${r.product_id}" value="${r.manual??''}" placeholder="${r.counted??0}" style="width:70px">${r.manual!=null?`<br><button class="btn small" data-aclr="${r.product_id}" title="Вернуть сумму сканов">↺ сканы</button>`:''}`:`<b class="num">${r.counted??0}</b>`}</td>
      <td class="num">${r.expected}</td><td class="num" style="color:${r.diff<0?'var(--bad)':r.diff>0?'var(--ok)':'inherit'}"><b>${r.diff>0?'+':''}${r.diff}</b></td>
      ${boss?`<td><button class="btn small ${r.recount?'primary':''}" data-arec="${r.product_id}" data-on="${r.recount?1:0}">${r.recount?'✓ на пересчёте':'🔁 На пересчёт'}</button></td>`:''}</tr>`).join('') || `<tr><td colspan="${boss?7:6}" class="meta">Ничего нет</td></tr>`}</tbody></table></div>
    ${isBoss()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start">
      <button class="btn primary" id="au-close">Закрыть: поправить только посчитанные</button>
      <button class="btn" id="au-close-full">Закрыть полностью (непосчитанные = 0)</button></div>
      <span class="meta">После закрытия остатки в магазине станут равны колонке «Итог»: недостача спишется, излишек оприходуется.</span>`:'<p class="meta">Закрыть ревизию может менеджер.</p>'}`;
}
document.addEventListener('click', async e => {
  if(S.view!=='wh' || S.wmode!=='audit') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset, A = S.au || {};
  const done = async (r, msg) => { if(r && r.error) return toast(errText(r.error)); if(msg) toast(msg); await loadAudit(); render(); };
  if(d.autab){ A.tab = d.autab; render(); await loadAudit(); render(); }
  else if(d.auflt){ A.flt = d.auflt; render(); }
  else if(t.id==='au-sheet-new'){ const name = $('#au-sheet-name').value.trim(); const r = await sb.rpc('audit_sheet_open', { p_audit:S.audit.id, p_name:name });
    if(r.error) return toast(errText(r.error)); A.sheet = r.data; A.tab = 'sheet'; try{ localStorage.setItem('au_sheet_'+S.audit.id, r.data); }catch(_){} await done(null); $('#dq') && $('#dq').focus(); }
  else if(d.asdel){ await done(await sb.rpc('audit_sheet_count', { p_sheet:A.sheet, p_product:d.asdel, p_delta:0, p_set:0 })); }
  else if(d.arec){ await done(await sb.rpc('audit_final', { p_audit:S.audit.id, p_product:d.arec, p_recount: d.on!=='1' })); }
  else if(d.aclr){ await done(await sb.rpc('audit_final', { p_audit:S.audit.id, p_product:d.aclr, p_clear:true })); }
});
document.addEventListener('change', async e => {
  if(S.view!=='wh' || S.wmode!=='audit' || !S.audit) return; const t = e.target, d = t.dataset, A = S.au || {};
  if(t.id==='au-sheet'){ A.sheet = t.value || null; try{ if(A.sheet) localStorage.setItem('au_sheet_'+S.audit.id, A.sheet); }catch(_){} await loadAudit(); render(); }
  else if(t.id==='au-unc'){ A.unc = t.checked; await loadAudit(); render(); }
  else if(d.asq){ const r = await sb.rpc('audit_sheet_count', { p_sheet:A.sheet, p_product:d.asq, p_delta:0, p_set:Math.max(0,+t.value||0) }); if(r.error) toast(errText(r.error)); await loadAudit(); render(); }
  else if(d.afin){ const r = await sb.rpc('audit_final', t.value==='' ? { p_audit:S.audit.id, p_product:d.afin, p_clear:true } : { p_audit:S.audit.id, p_product:d.afin, p_manual:Math.max(0,+t.value||0) }); if(r.error) toast(errText(r.error)); await loadAudit(); render(); }
});
function dnewHtml(){
  const n = S.dnew, cats = S.dnewCats || [];
  return `<div class="cust stack" style="gap:6px"><b>Новый товар в базу</b><span class="meta">Например, изделие из нашей студии. После сохранения товар сразу встанет в эту приёмку.</span>
    <input id="dn-name" value="${esc(n.name)}" placeholder="Название *">
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
      <select id="dn-brand">${[['','Бренд *'],['moon','MOON'],['sunshine','Sunshine'],['both','MOON и Sunshine']].map(([k,v])=>`<option value="${k}" ${n.brand===k?'selected':''}>${v}</option>`).join('')}</select>
      <select id="dn-cat"><option value="">Категория…</option>${cats.map(c=>`<option value="${c.id}" ${String(n.cat)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <input id="dn-color" value="${esc(n.color)}" placeholder="цвет" list="dn-colors" style="width:120px"><datalist id="dn-colors">${COLORS_RU.map(c=>`<option value="${c}">`).join('')}</datalist>
      <input id="dn-mat" value="${esc(n.mat)}" placeholder="материал" list="dn-mats" style="width:130px"><datalist id="dn-mats">${['Серебро 925','Нержавейка','Мед сплав','Пластик','мельхиор','Жемчуг','Кожа','другой'].map(x=>`<option value="${x}">`).join('')}</datalist></div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
      <label class="meta">Розничная, ₸ <input id="dn-price" type="number" min="0" inputmode="numeric" value="${esc(n.price)}" placeholder="можно позже" style="width:110px"></label>
      <label class="meta">Себестоимость, ₸ <input id="dn-cost" type="number" min="0" inputmode="numeric" value="${esc(n.cost)}" style="width:100px"></label>
      <label class="meta">Штрихкод <input id="dn-bc" value="${esc(n.bc)}" placeholder="пусто — создать" style="width:140px"></label></div>
    <div class="row" style="justify-content:flex-start"><button class="btn small" id="dn-cancel">Отмена</button><button class="btn small primary" id="dn-save">Создать и добавить в приёмку</button></div></div>`;
}
document.addEventListener('click', async e => {
  if(S.view!=='wh') return; const t = e.target.closest('button'); if(!t) return;
  if(t.id==='dn-open'){ const q = (S.dq||'').trim(); S.dnew = { name: /^\d{6,}$/.test(q)?'':q, bc: /^\d{6,}$/.test(q)?q:'', brand:'', cat:'', color:'', mat:'', price:'', cost:'' }; render();
    if(!S.dnewCats){ const { data } = await sb.from('categories').select('id,name').eq('hidden',false).order('name'); S.dnewCats = data||[]; render(); } $('#dn-name') && $('#dn-name').focus(); }
  else if(t.id==='dn-cancel'){ S.dnew = null; render(); }
  else if(t.id==='dn-save'){ const n = S.dnew; for(const [k,id] of [['name','dn-name'],['brand','dn-brand'],['cat','dn-cat'],['color','dn-color'],['mat','dn-mat'],['price','dn-price'],['cost','dn-cost'],['bc','dn-bc']]) n[k] = $('#'+id).value.trim();
    if(!n.name) return toast('Укажите название'); if(!n.brand) return toast('Отметьте бренд: MOON, Sunshine или оба'); t.disabled = true;
    const { data, error } = await sb.rpc('product_save', { p:{ name:n.name, price:+n.price||0, brand:n.brand, category_id:n.cat||null, color:n.color||null, material:n.mat||null, barcode:n.bc||null, cost:n.cost||null } });
    if(error){ t.disabled = false; return toast(errText(error)); }
    S.catalog.push([data.id, data.barcode, '', n.name, +n.price||0, '', n.cat?+n.cat:null]);
    S.dnew = null; docAdd({ id:data.id, name:n.name, barcode:data.barcode, price:+n.price||0 });
    const it = S.doc.items.find(i=>i.pid===data.id); if(it && n.cost) it.cost = +n.cost;
    toast('Товар создан, штрихкод '+data.barcode); render(); }
});
function docAdd(p){
  if(S.wmode==='audit') return auditAdd(p);
  const d = S.doc, it = d.items.find(i=>i.pid===p.id);
  if(it) it.qty++; else d.items.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, photo_url:p.photo_url, brand:p.brand, qty:1, cost:null });
  S.dq=''; S.dfound=[]; render(); $('#dq') && $('#dq').focus();
}
/* ревизия сканером: каждый скан сразу +1, звук и вибрация; очередь, чтобы быстрые сканы не терялись */
const AU_Q = []; let auBusy = false, auReload = null;
const auScanMode = () => { try{ return localStorage.getItem('au_scanmode')==='1'; }catch(_){ return false; } };
function auBeep(ok){ try{ const c = auBeep.c || (auBeep.c = new (window.AudioContext||window.webkitAudioContext)()); const o = c.createOscillator(), g = c.createGain();
  o.frequency.value = ok ? 1400 : 300; g.gain.value = 0.15; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (ok ? 0.08 : 0.35)); }catch(_){}
  try{ navigator.vibrate && navigator.vibrate(ok ? 40 : [120,60,120]); }catch(_){} }
function auLastHtml(){ const L = (S.au||{}).last; if(!L) return ''; return `<div class="card" style="margin:6px 0;padding:12px 14px;border-left:6px solid ${L.ok?'var(--ok,#2a8a4a)':'var(--bad)'};font-size:17px">
  ${L.ok?`✓ <b>${esc(L.name)}</b> +1 <span class="meta">· в листе ${L.n} шт.</span>`:`✕ Штрихкод <b class="num">${esc(L.bc)}</b> не найден в базе — отложите товар отдельно`}</div>`; }
function auScan(inp){
  const v = (inp.value||'').trim(); if(!/^\d{6,14}$/.test(v)) return false;
  const A = S.au || {}; if(!A.sheet){ toast('Сначала выберите или создайте свой лист'); return true; }
  inp.value = ''; S.dq = ''; S.dfound = [];
  const a = S.catalog.find(x => x[1]===v) || (S.alias && S.alias[v] && S.catalog.find(x => x[0]===S.alias[v]));
  if(!a){ A.last = { ok:false, bc:v }; auBeep(false); } else {
    const it = (A.items||[]).find(i => i.product_id===a[0]); if(it) it.qty++; else (A.items ||= []).unshift({ product_id:a[0], name:a[3], barcode:a[1], qty:1 });
    A.last = { ok:true, name:a[3], n: it ? it.qty : 1 }; auBeep(true); AU_Q.push({ sheet:A.sheet, pid:a[0] }); auFlush(); }
  const el = $('#au-last'); if(el) el.innerHTML = auLastHtml();
  return true;
}
async function auFlush(){ if(auBusy) return; auBusy = true;
  while(AU_Q.length){ const q = AU_Q[0]; const { error } = await sb.rpc('audit_sheet_count', { p_sheet:q.sheet, p_product:q.pid, p_delta:1, p_set:null });
    if(error){ toast('Скан не сохранён: '+errText(error)+' — повторим'); await new Promise(r=>setTimeout(r,3000)); continue; } AU_Q.shift(); }
  auBusy = false; clearTimeout(auReload);
  auReload = setTimeout(async () => { const ae = document.activeElement; if(AU_Q.length || (ae && ae.id==='dq' && ae.value)) return; await loadAudit(); if(S.view==='wh' && S.wmode==='audit'){ render(); $('#dq') && $('#dq').focus(); } }, 1500); }
document.addEventListener('change', e => { if(e.target.id==='au-scanmode'){ try{ localStorage.setItem('au_scanmode', e.target.checked?'1':'0'); }catch(_){} render(); $('#dq') && $('#dq').focus(); } });
async function auditAdd(p){
  const A = S.au || {}; if(!A.sheet){ S.dq=''; S.dfound=[]; render(); return toast('Сначала выберите или создайте свой лист'); }
  const { error } = await sb.rpc('audit_sheet_count', { p_sheet:A.sheet, p_product:p.id, p_delta:1, p_set:null });
  if(error) return toast(errText(error));
  S.dq=''; S.dfound=[]; await loadAudit(); render(); $('#dq') && $('#dq').focus();
}
async function postDoc(){
  const d = S.doc, m = d.mode; let res;
  if(m==='receipt' || m==='capitalize')
    res = await sb.rpc('post_receipt', { p:{ kind:m, store_id:d.store, supplier:d.supplier, note:d.note, items:d.items.map(i=>({ product_id:i.pid, qty:i.qty, unit_cost:i.cost })) } });
  else if(m==='writeoff'){
    if(!d.reason.trim()) return toast('Укажите причину списания');
    res = await sb.rpc('request_writeoff', { p_store:+d.store, p_reason:d.reason, p_items:d.items.map(i=>({ product_id:i.pid, qty:i.qty })) });
    if(res.error) return toast('Не отправлено: '+errText(res.error));
    toast('Запрос на списание отправлен директору'); S.doc = newDoc(m); await loadWhSide(); render(); return;
  } else if(m==='transfer')
    res = await sb.rpc('create_transfer', { p:{ from_store_id:d.store, to_store_id:d.to, items:d.items.map(i=>({ product_id:i.pid, qty:i.qty })) } });
  if(res.error) return toast('Не проведено: '+errText(res.error));
  const labels = (m==='receipt'||m==='capitalize') ? d.items.map(i=>({ n:i.name, b:i.barcode, p:i.price, q:i.qty })) : null;
  const inter = m==='transfer' && (S.allStores.find(x=>x.id===+d.store)||{}).city !== (S.allStores.find(x=>x.id===+d.to)||{}).city;
  toast(inter ? 'Перемещение между городами создано — ждёт подтверждения менеджера города-получателя' : WH[m].t+' проведено'); S.doc = newDoc(m); await loadWhSide(); render();
  if(labels) modal(`<h2>${WH[m].t} проведена</h2><p>Напечатать этикетки? Будет ${labels.reduce((a,l)=>a+l.q,0)} шт. — по одной на каждую единицу.</p>
    <div class="row"><button class="btn" data-close>Не сейчас</button><button class="btn primary" data-labels='${esc(JSON.stringify(labels))}'>Печать этикеток</button></div>`);
}
function printLabels(list){
  const box = document.getElementById('labels') || Object.assign(document.body.appendChild(document.createElement('div')), { id:'labels' });
  box.innerHTML = '';
  list.forEach(l => { for(let k=0;k<l.q;k++){
    const el = document.createElement('div'); el.className='label47';
    el.innerHTML = `<div class="ln">${esc(l.n)}</div><svg></svg><div class="lp">${fmt(l.p)}</div>`;
    box.appendChild(el);
    try{ JsBarcode(el.querySelector('svg'), l.b, { format:/^\d{13}$/.test(l.b)?'EAN13':'CODE128', height:28, width:1.4, fontSize:10, margin:0, displayValue:true }); }catch(e){ JsBarcode(el.querySelector('svg'), l.b, { format:'CODE128', height:28, width:1.2, fontSize:10, margin:0 }); }
  }});
  document.body.classList.add('print-labels'); closeModal();
  setTimeout(()=>{ window.print(); document.body.classList.remove('print-labels'); }, 300);
}

/* ---------- сертификаты ---------- */
async function loadCerts(){
  const f = S.cf || (S.cf = { st:'active', q:'', store:'' });
  let q = sb.from('certificate_report').select('*').order('sold_at',{ascending:false, nullsFirst:false}).limit(300);
  const today = new Date().toISOString();
  if(f.st==='active') q = q.eq('status','active');
  else if(f.st==='expired') q = q.eq('status','expired');
  else if(f.st==='used') q = q.eq('status','used');
  else if(f.st==='review') q = q.eq('needs_review', true);
  if(f.q.trim()) q = q.or(`code.ilike.%${f.q.trim().replace(/[,()]/g,'')}%,buyer_phone.ilike.%${f.q.trim().replace(/[,()]/g,'')}%,recipient_name.ilike.%${f.q.trim().replace(/[,()]/g,'')}%`);
  if(f.store) q = q.eq('sold_store', (S.allStores.find(x=>x.id===+f.store)||{}).address);
  const { data, error } = await q;
  if(error) toast(errText(error)); S.certs = data || [];
}
function renderCerts(){
  const ST = { active:'активен', used:'использован', expired:'истёк', cancelled:'отменён' };
  $('#main').innerHTML = `<div class="grid2"><div>
    <h2>Сертификаты</h2>
    <div class="filters"><input id="cc" style="flex:1" placeholder="Проверить номер сертификата"><button class="btn" id="cc-go">Проверить</button></div>
    <div class="filters">${[['active','Действующие'],['expired','Истёкшие'],['used','Использованные'],['review','⚠ Сомнительные'],['all','Все']].map(([k,v])=>`<button class="btn small ${S.cf.st===k?'primary':''}" data-cfst="${k}">${v}</button>`).join('')}
      <select id="cf-store"><option value="">Все магазины</option>${S.allStores.map(st=>`<option value="${st.id}" ${String(S.cf.store)===String(st.id)?'selected':''}>${esc(BRAND[st.brand]+' · '+st.address)}</option>`).join('')}</select>
      <input id="cf-q" placeholder="Номер, телефон, имя" value="${esc(S.cf.q)}" style="flex:1;min-width:140px"></div>
    <p class="meta">Показано: ${S.certs.length}${S.certs.length===300?' (первые 300 — уточните поиск)':''}. Старые сертификаты перенесены из Google-таблицы; срок действия — 6 месяцев от даты покупки.</p>
    ${S.certs.length?`<div class="scroll"><table><thead><tr><th>Номер</th><th>Номинал / остаток</th><th>Статус</th><th>Продан</th><th>Кто купил → кому</th><th>Где использован</th></tr></thead><tbody>
    ${S.certs.map(c=>`<tr style="${c.needs_review?'background:#fff6e5':''}"><td><b>${esc(c.code)}</b><br><span class="meta">${c.kind==='electronic'?'электронный':'физический'}</span>
        ${c.needs_review?`<br><span class="chip warn" title="${esc(c.source||'')}">⚠ ${esc(c.review_note||'проверить')}</span>`:''}${c.note?`<br><span class="meta">${esc(c.note)}</span>`:''}</td>
      <td class="num">${fmt(c.nominal)}<br><span class="meta">осталось ${fmt(c.balance)}</span></td>
      <td><span class="chip ${c.status==='active'?'ok':c.status==='used'?'':'zero'}">${ST[c.status]||c.status}</span><br><span class="meta">${c.expires_at?'до '+new Date(c.expires_at).toLocaleDateString('ru-RU'):'срок не известен'}</span></td>
      <td>${esc(c.sold_city)}, ${esc(c.sold_store)}<br><span class="meta">${c.sold_at?new Date(c.sold_at).toLocaleDateString('ru-RU'):'дата не указана'}${c.sold_by_name?' · '+esc(c.sold_by_name):''}</span></td>
      <td>${esc(c.buyer_name||'')} ${esc(c.buyer_phone||'')}<br>→ ${esc(c.recipient_name||'')} ${esc(c.recipient_phone||'')}</td>
      <td>${esc(c.used_in||'—')}${c.last_used_at?`<br><span class="meta">${new Date(c.last_used_at).toLocaleDateString('ru-RU')}</span>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Сертификатов пока нет</div>'}
  </div>
  <div class="card stack"><h2 style="margin:0">Продать сертификат</h2><p class="meta" style="margin:0">Сертификаты продаются в кассе: вкладка «Продажа» → кнопка «🎁 Продать сертификат». Так продажа попадает в смену и выручку магазина.</p>
  </div></div>`;
}
function certSellHtml(){
  return `<div class="row"><h3 style="margin:0">🎁 Продать сертификат</h3><button class="btn small" data-close>✕</button></div>
  <div class="stack" style="gap:10px;margin-top:10px">
    <span class="meta">${esc(storeName(S.store))}</span>
    <div><span class="label">Вид сертификата</span><div class="seg" id="ck-kind" style="margin-top:4px"><button data-ck="physical" aria-pressed="true">Физический</button><button data-ck="electronic" aria-pressed="false">Электронный</button></div></div>
    <label class="stack" style="gap:2px"><span class="label">Номер сертификата *</span><input id="c-code" placeholder="Номер с карточки" autocomplete="off"></label>
    <label class="stack" style="gap:2px"><span class="label">Номинал, ₸ *</span><input id="c-amount" type="number" min="1" inputmode="numeric" placeholder="например, 10000"></label>
    <div><span class="label">Оплата</span><div class="seg" id="c-pay" style="margin-top:4px;flex-wrap:wrap">${['cash','card','kaspi_qr','transfer'].map((k,i)=>`<button data-cpay="${k}" aria-pressed="${i===0}">${PAY[k]}</button>`).join('')}</div></div>
    <button class="btn primary" id="c-sell">Продать сертификат</button>
    <span class="meta">Срок действия — 6 месяцев. Бонусы за покупку сертификата не начисляются — они начислятся, когда им оплатят товар.</span></div>`;
}
async function sellCert(btn){
  const code = $('#c-code').value.trim(), amount = +$('#c-amount').value;
  if(!code) return toast('Укажите номер сертификата'); if(!(amount>0)) return toast('Укажите номинал');
  const kind = document.querySelector('#ck-kind [aria-pressed="true"]').dataset.ck, method = document.querySelector('#c-pay [aria-pressed="true"]').dataset.cpay;
  if(btn) btn.disabled = true;
  const { error } = await sb.rpc('sell_certificate', { p:{ client_uuid:uuid(), store_id:S.store, code, kind, amount, payments:[{ method, amount }] } });
  if(btn) btn.disabled = false;
  if(error) return toast('Не продан: '+errText(error));
  closeModal(); toast(`Сертификат №${code} на ${fmt(amount)} продан`); if(S.view==='certs'){ await loadCerts(); render(); }
}
async function checkCert(code){
  const { data, error } = await sb.rpc('certificate_check', { p_code: code });
  if(error) return toast(errText(error)); if(!data) return toast('Сертификат не найден');
  const ST = { active:'активен', used:'использован', expired:'истёк', cancelled:'отменён' };
  modal(`<h2>Сертификат ${esc(data.code)}</h2>
    <div>Номинал ${fmt(data.nominal)} · <b>осталось ${fmt(data.balance)}</b> · ${ST[data.status]||data.status}</div>
    <div class="meta">Продан ${new Date(data.sold_at).toLocaleDateString('ru-RU')} в ${esc(data.sold_store)} · действует до ${new Date(data.expires_at).toLocaleDateString('ru-RU')}</div>
    <div class="meta">Купил: ${esc(data.buyer_name||'')} ${esc(data.buyer_phone||'')} → кому: ${esc(data.recipient_name||'')} ${esc(data.recipient_phone||'')}</div>
    <div class="scroll"><table><tbody>${(data.moves||[]).map(m=>`<tr><td class="num">${new Date(m.at).toLocaleDateString('ru-RU')}</td><td>${{sold:'продажа',redeem:'оплата',refund:'возврат на сертификат'}[m.kind]||m.kind}</td><td class="num">${fmt(m.amount)}</td><td>${esc(m.store)}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn" data-close>Закрыть</button>`);
}

/* ---------- аналитика (владелец и менеджер) ---------- */
function periodRange(){
  const now = new Date(), d0 = new Date(now); d0.setHours(0,0,0,0);
  if(S.period==='custom' && S.from) return [new Date(S.from+'T00:00:00'), S.to ? new Date(S.to+'T23:59:59') : now];
  const days = { today:0, '7':6, '30':29, '90':89, '365':364 }[S.period] ?? 29;
  const from = new Date(d0); from.setDate(from.getDate()-days); return [from, now];
}
async function loadAnalytics(){ return S.anMode==='stock' ? loadStockAn() : loadSalesAn(); }
async function loadSalesAn(){
  const [from, to] = periodRange(), ids = selStores();
  const len = to - from, pFrom = new Date(from - len - 1000), pTo = new Date(from - 1000);
  const [cur, prev] = await Promise.all([
    sb.rpc('sales_analytics', { p_stores: ids, p_from: from.toISOString(), p_to: to.toISOString() }),
    sb.rpc('sales_analytics', { p_stores: ids, p_from: pFrom.toISOString(), p_to: pTo.toISOString() })
  ]);
  if(cur.error){ toast(errText(cur.error)); S.an = null; return; }
  S.trend = null; loadTrends(from, to, pFrom, pTo);
  S.an = normAn(cur.data);
  S.anPrev = prev.error ? null : normAn(prev.data);
  S.anPrevRange = [pFrom, pTo];
}
async function loadTrends(from, to, pFrom, pTo){
  if(from){ S.trRange = [from, to, pFrom, pTo]; } else [from, to, pFrom, pTo] = S.trRange || [];
  if(!from) return;
  const { data, error } = await sb.rpc('sales_trends', { p_stores: selStores(), p_from: from.toISOString(), p_to: to.toISOString(), p_pfrom: pFrom.toISOString(), p_pto: pTo.toISOString(), p_group: S.trG||'category' });
  S.trend = error ? [] : (data||[]); if(error) toast(errText(error));
  if(S.view==='analytics' && S.anMode!=='stock') render();
}
const TR_GROUPS = [['category','Категории'],['material','Материалы'],['color','Цвета'],['price','Цены'],['store','Магазины'],['supplier','Поставщики']];
function trendsHtml(){
  const T = S.trend, g = S.trG||'category';
  const pct = r => r.prev ? Math.round((r.cur - r.prev) / Math.abs(r.prev) * 100) : null;
  const rows = (T||[]).filter(r => r.cur || r.prev);
  const tot = rows.reduce((a,r)=>a+r.cur,0) || 1, totP = rows.reduce((a,r)=>a+r.prev,0);
  const sig = rows.filter(r => Math.max(r.cur, r.prev) >= Math.max(tot*0.02, 1)); // заметные группы (≥2% выручки)
  const up = sig.filter(r=>r.cur>r.prev).sort((a,b)=>(b.cur-b.prev)-(a.cur-a.prev)).slice(0,3);
  const down = sig.filter(r=>r.cur<r.prev).sort((a,b)=>(a.cur-a.prev)-(b.cur-b.prev)).slice(0,3);
  const share = (v,t) => t ? Math.round(v/t*1000)/10 : 0;
  const line = (r, sign) => `<li><b>${esc(r.g)}</b>: ${sign>0?'+':'−'}${fmt(Math.abs(r.cur-r.prev))}${pct(r)!==null?` (${pct(r)>0?'+':''}${pct(r)}%)`:' (новое)'}, доля ${share(r.prev,totP)}% → ${share(r.cur,tot)}%</li>`;
  return `<h2 style="margin-top:18px">Тренды</h2>
    <div class="filters">${TR_GROUPS.map(([k,t])=>`<button class="btn small ${g===k?'primary':''}" data-trg="${k}">${t}</button>`).join('')}</div>
    ${!T?'<div class="empty">Считаем тренды…</div>':!rows.length?'<div class="empty">Нет продаж с товарами за период</div>':`
    <div class="grid2" style="gap:12px;margin-bottom:10px">
      <div class="card"><div class="label" style="color:var(--ok)">▲ Растут сильнее всего</div>${up.length?`<ul style="margin:6px 0 0;padding-left:18px">${up.map(r=>line(r,1)).join('')}</ul>`:'<div class="meta">Нет заметного роста</div>'}</div>
      <div class="card"><div class="label" style="color:var(--bad)">▼ Падают сильнее всего</div>${down.length?`<ul style="margin:6px 0 0;padding-left:18px">${down.map(r=>line(r,-1)).join('')}</ul>`:'<div class="meta">Нет заметного падения</div>'}</div>
    </div>
    <div class="scroll"><table><thead><tr><th>${TR_GROUPS.find(x=>x[0]===g)[1]}</th><th>Сейчас</th><th>Было</th><th>Изменение</th><th>Штук сейчас / было</th><th>Доля</th></tr></thead><tbody>
      ${rows.map(r=>{ const p = pct(r); return `<tr><td>${esc(r.g)}</td><td class="num">${fmt(r.cur)}</td><td class="num meta">${fmt(r.prev)}</td>
        <td class="num" style="font-weight:600;color:${p===null?'var(--muted)':p>0?'var(--ok)':p<0?'var(--bad)':'var(--muted)'}">${p===null?'новое':(p>0?'▲ +':p<0?'▼ ':'')+p+'%'}</td>
        <td class="num">${r.cur_q} / <span class="meta">${r.prev_q}</span></td><td class="num">${share(r.cur,tot)}%</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="meta">Сравнение с предыдущим периодом такой же длины по выбранным магазинам. «Растут/падают» — группы, у которых больше 2% выручки.</p>`}`;
}
function normAn(data){
  const A = { ...data, clients: { size: +data.clients }, byProd: Object.fromEntries((data.byProd||[]).map((p,i)=>[i,p])) };
  for(const v of Object.values(A.byStore)) for(const k of ['revenue','checks','returns']) v[k] = +v[k];
  for(const k of Object.keys(A.byPay)) A.byPay[k] = +A.byPay[k];
  for(const k of Object.keys(A.byDay)) A.byDay[k] = +A.byDay[k];
  for(const k of ['revenue','checks','returns','returnsSum','discounts','certSold','items','bonusEarned','bonusSpent']) A[k] = +(A[k]||0);
  return A;
}
/* изменение к предыдущему периоду: dir 1 — рост хорошо, -1 — рост плохо, 0 — нейтрально */
function deltaHtml(cur, prev, dir, prevText){
  if(!prev) return `<span class="meta" title="В предыдущем периоде данных нет" style="font-size:12px;white-space:nowrap">нет сравнения</span>`;
  const r = Math.round((cur - prev) / Math.abs(prev) * 100);
  const col = r===0 || dir===0 ? 'var(--muted)' : ((r>0) === (dir>0) ? 'var(--ok)' : 'var(--bad)');
  return `<span title="Предыдущий период: ${esc(prevText)}" style="font-size:13px;font-weight:600;color:${col};white-space:nowrap">${r>0?'▲ +':r<0?'▼ ':''}${r}%</span>`;
}
function renderAnalytics(){ return S.anMode==='stock' ? renderStockAn() : renderSalesAn(); }
const anModeHtml = () => `<div class="seg" style="display:inline-flex;margin-bottom:10px"><button data-anmode="sales" aria-pressed="${S.anMode==='sales'}">Продажи</button><button data-anmode="stock" aria-pressed="${S.anMode==='stock'}">Остатки</button></div>`;
/* праздники и выходные Казахстана (2026 — по производственному календарю с изменениями от 29.06.2026) */
const KZ_EXACT = {
  2026: { '01-01':'Новый год','01-02':'Новый год','01-07':'Православное Рождество','03-08':'Международный женский день','03-09':'Выходной за 8 Марта',
    '03-15':'День Конституции','03-21':'Наурыз мейрамы','03-22':'Наурыз мейрамы','03-23':'Наурыз мейрамы','03-24':'Выходной за Наурыз','03-25':'Выходной за Наурыз',
    '05-01':'День единства народа Казахстана','05-07':'День защитника Отечества','05-09':'День Победы','05-11':'Выходной за 9 Мая','05-27':'Курбан айт',
    '07-06':'День столицы','10-25':'День Республики','10-26':'Выходной за День Республики','12-16':'День Независимости' } };
const KZ_KURBAN = { 2024:'06-16', 2025:'06-06', 2027:'05-16', 2028:'05-05' };
const KZ_NOTABLE = { '02-14':'День влюблённых','09-01':'1 сентября — День знаний','12-31':'Канун Нового года' };
const kzCache = {};
function kzYear(y){
  if(kzCache[y]) return kzCache[y];
  if(KZ_EXACT[y]) return kzCache[y] = KZ_EXACT[y];
  // другие годы: основные праздники + перенос с выходного на ближайший будний (кроме Рождества и Курбан айта)
  const base = { '01-01':'Новый год','01-02':'Новый год','03-08':'Международный женский день','03-21':'Наурыз мейрамы','03-22':'Наурыз мейрамы','03-23':'Наурыз мейрамы',
    '05-01':'День единства народа Казахстана','05-07':'День защитника Отечества','05-09':'День Победы','07-06':'День столицы','10-25':'День Республики','12-16':'День Независимости' };
  base[y < 2026 ? '08-30' : '03-15'] = 'День Конституции';
  const m = { ...base, '01-07':'Православное Рождество' }; if(KZ_KURBAN[y]) m[KZ_KURBAN[y]] = 'Курбан айт';
  const key = d => String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  for(const k of Object.keys(base).sort()){
    const d = new Date(y, +k.slice(0,2)-1, +k.slice(3)); if(d.getDay()!==0 && d.getDay()!==6) continue;
    const n = new Date(d); do { n.setDate(n.getDate()+1); } while(n.getDay()===0 || n.getDay()===6 || m[key(n)]);
    m[key(n)] = 'Выходной за: ' + base[k];
  }
  return kzCache[y] = m;
}
function kzDay(iso){ // 'YYYY-MM-DD' → { kind: 'holiday'|'weekend'|'notable'|'', name }
  const y = +iso.slice(0,4), md = iso.slice(5,10), dow = new Date(iso+'T00:00:00').getDay();
  const h = kzYear(y)[md]; if(h) return { kind:'holiday', name:h };
  if(KZ_NOTABLE[md]) return { kind: dow===0||dow===6 ? 'weekend' : 'notable', name:KZ_NOTABLE[md] };
  return { kind: dow===0||dow===6 ? 'weekend' : '', name:'' };
}
/* график выручки: группировка по дням / неделям / месяцам, подписи дат */
const MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const shortNum = v => v>=1e6 ? (v/1e6).toFixed(v>=1e7?0:1).replace('.',',')+' млн' : v>=1e3 ? Math.round(v/1e3)+' тыс' : String(Math.round(v));
function revenueChart(days){
  const span = days.length;
  const mode = span <= 62 ? 'day' : span <= 190 ? 'week' : 'month';
  const b = new Map();
  for(const [d,v] of days){
    const dt = new Date(d+'T00:00:00'); let k, lab, tip;
    if(mode==='day'){ k=d; lab=dt.getDate()+' '+MON[dt.getMonth()]; tip=dt.toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'short'}); }
    else if(mode==='week'){ const m=new Date(dt); m.setDate(dt.getDate()-((dt.getDay()+6)%7)); const e=new Date(m); e.setDate(m.getDate()+6);
      k=m.toISOString().slice(0,10); lab=m.getDate()+' '+MON[m.getMonth()]; tip=`${m.getDate()} ${MON[m.getMonth()]} – ${e.getDate()} ${MON[e.getMonth()]}`; }
    else { k=d.slice(0,7); lab=MON[dt.getMonth()]+(dt.getMonth()===0?' '+String(dt.getFullYear()).slice(2):''); tip=dt.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); }
    const o = b.get(k) || { lab, tip, v:0, n:0, kind:'', names:[] }; o.v += v; o.n++;
    const kd = kzDay(d); if(mode==='day') o.kind = kd.kind; if(kd.name && kd.kind!=='' ) { const nm = (mode==='day'?'':dt.getDate()+' '+MON[dt.getMonth()]+' — ')+kd.name; if(!o.names.includes(nm)) o.names.push(nm); }
    b.set(k,o);
  }
  const bars = [...b.values()], max = Math.max(1, ...bars.map(x=>x.v)), avg = bars.reduce((a,x)=>a+x.v,0)/bars.length;
  const every = Math.max(1, Math.ceil(bars.length/12));
  const title = {day:'Выручка по дням', week:'Выручка по неделям', month:'Выручка по месяцам'}[mode];
  return `<h2 style="margin-top:16px">${title}</h2>
  <div class="card" style="padding:12px 12px 6px">
    <div style="display:flex;gap:8px">
      <div class="meta" style="display:flex;flex-direction:column;justify-content:space-between;height:150px;text-align:right;min-width:52px;font-size:11px"><span>${shortNum(max)}</span><span>${shortNum(max/2)}</span><span>0</span></div>
      <div style="flex:1;min-width:0">
        <div style="position:relative;display:flex;align-items:flex-end;gap:${bars.length>40?2:4}px;height:150px;border-bottom:1px solid var(--line,#ddd)">
          <div title="Среднее: ${fmt(avg)}" style="position:absolute;left:0;right:0;bottom:${Math.round(avg/max*150)}px;border-top:1px dashed currentColor;opacity:.25"></div>
          ${bars.map((x,i)=>`<div class="rcol ${i<bars.length/3?'l':i>=bars.length*2/3?'r':''}"><div class="rbar ${x.kind?'k-'+x.kind:''}" style="height:${Math.max(2,Math.round(x.v/max*150))}px"><span class="rtip">${esc(x.tip)}${x.names.length?`<i>${x.names.map(esc).join('<br>')}</i>`:''}<b>${fmt(x.v)}</b></span></div></div>`).join('')}
        </div>
        <div style="display:flex;gap:${bars.length>40?2:4}px;margin-top:4px">
          ${bars.map((x,i)=>`<div class="meta" style="flex:1 1 0;min-width:0;font-size:10px;text-align:center;white-space:nowrap;overflow:visible">${i%every===0?esc(x.lab):''}</div>`).join('')}
        </div>
      </div>
    </div>
    ${mode==='day'?`<div class="rleg meta"><span><i class="k-"></i>будни</span><span><i class="k-weekend"></i>суббота и воскресенье</span><span><i class="k-holiday"></i>праздник / выходной по календарю РК</span><span><i class="k-notable"></i>особый день (14 февраля, 1 сентября, 31 декабря)</span></div>`:''}
    <div class="meta" style="font-size:11px;margin-top:6px">Пунктир — среднее: ${fmt(avg)}${mode!=='day'?` за ${mode==='week'?'неделю':'месяц'}`:' в день'}. Наведите на столбик, чтобы увидеть сумму.</div>
  </div>`;
}
function renderSalesAn(){
  const A = S.an;
  const periods = [['today','Сегодня'],['7','7 дней'],['30','30 дней'],['90','3 месяца'],['365','Год'],['custom','Свой период']];
  const days = A ? Object.entries(A.byDay).sort() : [];
  $('#main').innerHTML = `<h2>Аналитика</h2>${anModeHtml()}
    <div class="filters">${periods.map(([k,t])=>`<button class="btn small ${S.period===k?'primary':''}" data-period="${k}">${t}</button>`).join('')}
      ${S.period==='custom'?`<input type="date" id="an-from" value="${S.from}"><input type="date" id="an-to" value="${S.to}"><button class="btn small" id="an-go">Показать</button>`:''}</div>
    ${!A?'<div class="empty">Загружаем…</div>':`
    ${S.anPrevRange?`<div class="meta" style="font-size:12px;margin:-4px 0 8px">Сравнение с периодом ${S.anPrevRange.map(d=>d.toLocaleString('ru-RU',S.period==='today'?{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'})).join(' — ')}</div>`:''}
    <div class="pays" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${(() => { const P = S.anPrev, avg = x => x && x.checks ? x.revenue/x.checks : 0;
        return [['Выручка',fmt(A.revenue),A.revenue,P&&P.revenue,1,P&&fmt(P.revenue)],
          ['Чеков',A.checks,A.checks,P&&P.checks,1,P&&P.checks],
          ['Средний чек',fmt(avg(A)),avg(A),avg(P),1,P&&fmt(avg(P))],
          ['Продано штук',A.items,A.items,P&&P.items,1,P&&P.items],
          ['Возвраты',A.returns+' · '+fmt(A.returnsSum),A.returnsSum,P&&P.returnsSum,-1,P&&(P.returns+' · '+fmt(P.returnsSum))],
          ['Скидки',fmt(A.discounts),A.discounts,P&&P.discounts,0,P&&fmt(P.discounts)],
          ['Клиентов с картой',A.clients.size,A.clients.size,P&&P.clients.size,1,P&&P.clients.size],
          ['Продано сертификатов',fmt(A.certSold),A.certSold,P&&P.certSold,1,P&&fmt(P.certSold)]]
        .concat([['Бонусы',`<span style="font-size:15px">начислено ${fmt(A.bonusEarned).replace(' ₸','')}<br>использовано ${fmt(A.bonusSpent).replace(' ₸','')}</span>`,A.bonusSpent,P&&P.bonusSpent,0,P&&('начислено '+fmt(P.bonusEarned)+', использовано '+fmt(P.bonusSpent))]])
        .map(([k,v,c,p,dir,pt])=>`<div class="card"><div class="label">${k}</div><div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap"><div class="total num" style="font-size:20px">${v}</div>${deltaHtml(c,p,dir,String(pt??''))}</div></div>`).join(''); })()}
    </div>
    ${days.length?revenueChart(days):''}
    <div class="grid2" style="margin-top:16px"><div>
      <h2>По магазинам</h2><div class="scroll"><table><thead><tr><th>Магазин</th><th>Выручка</th><th>Чеков</th><th>Средний чек</th><th>Возвратов</th></tr></thead><tbody>
      ${Object.entries(A.byStore).sort((a,b)=>b[1].revenue-a[1].revenue).map(([id,v])=>`<tr><td>${esc(storeName(+id))}</td><td class="num">${fmt(v.revenue)}</td><td class="num">${v.checks}</td><td class="num">${fmt(v.checks?v.revenue/v.checks:0)}</td><td class="num">${v.returns}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Продаж за период нет</td></tr>'}</tbody></table></div>
      <h2 style="margin-top:16px">Способы оплаты</h2><div class="scroll"><table><tbody>
      ${Object.entries(A.byPay).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${PAY[k]||k}</td><td class="num">${fmt(v)}</td><td class="num meta">${A.revenue?Math.round(v/A.revenue*100):0}%</td></tr>`).join('') || '<tr><td class="meta">—</td></tr>'}</tbody></table></div>
    </div><div>
      <h2>Топ-10 товаров</h2><div class="scroll"><table><thead><tr><th>Товар</th><th>Шт.</th><th>Сумма</th></tr></thead><tbody>
      ${Object.values(A.byProd).sort((a,b)=>b.sum-a.sum).slice(0,10).map(p=>`<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td class="num">${fmt(p.sum)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">—</td></tr>'}</tbody></table></div>
    </div></div>
    ${trendsHtml()}
    <p class="meta">Считается по всем чекам: новой кассы и истории из Wipon с 1 января 2026.</p>`}`;
}

/* ---------- смены ---------- */
async function loadPosShift(){
  if(!navigator.onLine || !S.store) return;
  const { data, error } = await sb.rpc('shift_current', { p_store:S.store });
  if(!error){ (S.posShift ||= {})[S.store] = !!data; }
}
async function loadShifts(){
  if(!navigator.onLine) return;
  const days = S.shDays || 7, to = new Date(), from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate()-(days-1));
  const [cur, list] = await Promise.all([
    sb.rpc('shift_current', { p_store: S.store }),
    sb.rpc('shifts_list', { p_stores: isBoss() ? selStores() : [S.store], p_from: from.toISOString(), p_to: to.toISOString() })
  ]);
  if(cur.error) toast(errText(cur.error));
  S.shift = cur.data || null; S.shifts = list.data || []; S.shLoaded = true; (S.posShift ||= {})[S.store] = !!S.shift;
  if(!S.shift){ const { data } = await sb.rpc('shift_prev_closing', { p_store:S.store }); S.prevClosing = data; }
}
const tm = d => d ? new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
function diffHtml(v){ v=+v||0; const c = Math.abs(v)<1 ? 'var(--ok)' : 'var(--bad)'; return `<b style="color:${c}">${v>0?'+':''}${fmt(v)}</b>${Math.abs(v)<1?'':v>0?' <span class="meta">излишек</span>':' <span class="meta">недостача</span>'}`; }
function shiftReportHtml(r, opening, closing){
  const row = (k,v) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
  const avg = r.checks ? r.revenue/r.checks : 0;
  return `<div class="grid2"><div><table><tbody>
    ${row('Выручка', '<b>'+fmt(r.revenue)+'</b>')}${row('Чеков', r.checks)}${row('Средний чек', fmt(avg))}${row('Продано штук', r.items)}
    ${row('Возвраты', r.returns+' · '+fmt(r.returnsSum))}${row('Скидки', fmt(r.discounts))}
    ${row('Бонусов начислено', fmt(r.bonusEarned))}${row('Бонусов использовано', fmt(r.bonusSpent))}${row('Продано сертификатов', fmt(r.certSold))}
  </tbody></table></div><div><table><tbody>
    ${Object.entries(r.byPay||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>row(PAY[k]||k, fmt(v))).join('') || row('Оплат нет','—')}
    <tr><td colspan="2" class="meta" style="padding-top:10px">Наличные в кассе</td></tr>
    ${row('На начало смены', fmt(opening))}${row('Наличными за смену', fmt(r.cashNet))}${row('Должно быть', '<b>'+fmt(r.cashExpected)+'</b>')}
    ${(r.cashIn||r.cashOut)?row('Внесено в кассу', '+'+fmt(r.cashIn||0))+row('Расходы из кассы', '−'+fmt(r.cashOut||0)):''}
    ${closing!=null ? row('Фактически', fmt(closing)) + row('Расхождение', diffHtml(closing - r.cashExpected)) : ''}
    <tr><td colspan="2" class="meta" style="padding-top:10px">Карта / Kaspi QR (терминал)</td></tr>
    ${row('По системе', fmt(r.cardNet||0))}${r.closingCard!=null ? row('По терминалу', fmt(r.closingCard)) + row('Расхождение', diffHtml(r.closingCard - (r.cardNet||0))) : ''}
    ${r.fiscal!=null ? `<tr><td colspan="2" class="meta" style="padding-top:10px">Сверка с фискальной кассой (ОФД)</td></tr>${row('Продажи в Silver (с сертификатами)', fmt((+r.revenue||0)+(+r.certSold||0)))}${row('По фискальной кассе', fmt(r.fiscal))}${row('Расхождение', diffHtml(r.fiscal - ((+r.revenue||0)+(+r.certSold||0))))}` : ''}
  </tbody></table>
  ${(r.moves||[]).length?`<table style="margin-top:8px"><tbody><tr><td colspan="2" class="meta">Расходы и внесения</td></tr>${r.moves.map(m=>row(esc(m.cat)+(m.collector?' <span class="meta">· '+esc(m.collector)+'</span>':'')+(m.comment?'<br><span class="meta">'+esc(m.comment)+'</span>':'')+(m.status==='pending'?' <span class="chip warn">ждёт подтверждения</span>':m.status==='rejected'?' <span class="chip zero">не подтверждено</span>':''), (m.dir==='in'?'+':'−')+fmt(m.amount))).join('')}</tbody></table>`:''}
  ${(r.byEmployee||[]).length>1 || ((r.byEmployee||[])[0]||{}).name!=='—' ? `<table style="margin-top:8px"><tbody><tr><td colspan="2" class="meta">По продавцам</td></tr>${r.byEmployee.map(e=>row(esc(e.name)+' <span class="meta">· '+e.checks+' чек.</span>', fmt(e.revenue))).join('')}</tbody></table>` : ''}
  </div></div>`;
}
function shiftText(sh, r){
  const w = 32, pad = (a,b) => a + ' '.repeat(Math.max(1, w - a.length - b.length)) + b, L = [];
  L.push('ОТЧЁТ О ЗАКРЫТИИ СМЕНЫ', storeName(sh.store_id), 'Смена №'+sh.number, 'Открыта: '+tm(sh.opened_at)+(sh.opened_by_name?' · '+sh.opened_by_name:''), 'Закрыта: '+tm(sh.closed_at)+(sh.closed_by_name?' · '+sh.closed_by_name:''), '-'.repeat(w));
  L.push(pad('Выручка', fmt(r.revenue)), pad('Чеков', String(r.checks)), pad('Средний чек', fmt(r.checks?r.revenue/r.checks:0)), pad('Продано штук', String(r.items)), pad('Возвраты', r.returns+' / '+fmt(r.returnsSum)), pad('Скидки', fmt(r.discounts)), pad('Бонусов начислено', fmt(r.bonusEarned)), pad('Бонусов использовано', fmt(r.bonusSpent)), pad('Сертификатов продано', fmt(r.certSold)), '-'.repeat(w));
  Object.entries(r.byPay||{}).forEach(([k,v]) => L.push(pad(PAY[k]||k, fmt(v))));
  L.push('-'.repeat(w), pad('Наличные на начало', fmt(sh.opening_cash)), pad('Наличными за смену', fmt(r.cashNet)), pad('Должно быть', fmt(r.cashExpected)));
  if(r.cashIn||r.cashOut) L.push(pad('Внесено', fmt(r.cashIn||0)), pad('Расходы', fmt(r.cashOut||0)));
  if(sh.closing_cash!=null) L.push(pad('Фактически', fmt(sh.closing_cash)), pad('Расхождение', fmt(sh.closing_cash - r.cashExpected)));
  L.push('-'.repeat(w), pad('Карта/QR по системе', fmt(r.cardNet||0)));
  if(r.closingCard!=null) L.push(pad('По терминалу', fmt(r.closingCard)), pad('Расхождение', fmt(r.closingCard - (r.cardNet||0))));
  if(r.fiscal!=null) L.push('-'.repeat(w), pad('Фискальная касса', fmt(r.fiscal)), pad('Расхождение с Silver', fmt(r.fiscal - ((+r.revenue||0)+(+r.certSold||0)))));
  (r.moves||[]).forEach(m => L.push(pad((m.dir==='in'?'+ ':'- ')+m.cat, fmt(m.amount))));
  if(sh.note) L.push('', 'Комментарий: '+sh.note);
  return L.join('\n');
}
function renderShifts(){
  const sh = S.shift, ro = isViewer(), st = esc(storeName(S.store));
  let cur;
  if(!S.shLoaded) cur = '<div class="empty">Загружаем…</div>';
  else if(!sh) cur = `<div class="card stack"><div><b>${st}</b> · <span class="chip zero">смена закрыта</span></div>
      ${ro ? '<p class="meta">Открыть смену может сотрудник магазина.</p>' : `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
        <label class="meta">Наличные в кассе на начало, ₸ <input id="sh-open-cash" type="number" min="0" inputmode="numeric" placeholder="${S.prevClosing!=null?Math.round(S.prevClosing):'0'}" style="width:140px"></label>
        <input id="sh-open-note" placeholder="Причина, если сумма не сходится" style="flex:1;min-width:180px">
        <button class="btn primary" id="sh-open">Открыть смену</button></div>
        ${S.prevClosing!=null?`<p class="meta" style="margin:0">На закрытии прошлой смены в кассе было <b>${fmt(S.prevClosing)}</b>. Пересчитайте наличные — сумма должна совпасть.</p>`:''}`}</div>`;
  else cur = `<div class="card stack"><div class="row" style="flex-wrap:wrap;gap:8px"><div><b>${st}</b> · <span class="chip ok">смена №${sh.number} открыта</span>
        <div class="meta">с ${tm(sh.opened_at)}${sh.opened_by_name?' · открыл(а) '+esc(sh.opened_by_name):''}</div>
        ${(()=>{ const end=new Date(new Date(sh.opened_at).getTime()+864e5), left=(end-Date.now())/36e5; return `<div class="meta" ${left<4?'style="color:var(--bad)"':''}>Смена не может длиться больше 24 часов — закройте её до ${tm(end)}, иначе она закроется автоматически без пересчёта наличных.</div>`; })()}</div><button class="btn small" id="sh-refresh">Обновить цифры</button></div>
      ${shiftReportHtml(sh.summary, sh.opening_cash, null)}
      ${ro ? '' : `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;border-top:1px solid var(--line);padding-top:10px">
        <label class="meta">Наличные в кассе фактически, ₸ <input id="sh-close-cash" type="number" min="0" inputmode="numeric" placeholder="${Math.round(sh.summary.cashExpected)}" style="width:150px"></label>
        <label class="meta">По терминалу (карта + Kaspi QR), ₸ <input id="sh-close-card" type="number" min="0" inputmode="numeric" placeholder="${Math.round(sh.summary.cardNet||0)}" style="width:150px"></label>
        <label class="meta">Продажи по фискальной кассе за смену, ₸ <input id="sh-close-fiscal" type="number" min="0" inputmode="numeric" placeholder="общая сумма" style="width:150px"></label>
        <input id="sh-note" placeholder="Комментарий (необязательно)" style="flex:1;min-width:180px">
        <button class="btn" id="sh-handover" title="Закрыть смену с отчётом и передать кассу следующему сотруднику">Пересменка</button>
        <button class="btn primary" id="sh-close">Закрыть смену</button></div>
        <p class="meta" style="margin:0">Пересменка в течение дня: пересчитайте кассу, нажмите «Пересменка» — смена закроется с отчётом, и следующий сотрудник сразу откроет свою с этой же суммой.</p>`}</div>`;
  const days = [[1,'Сегодня'],[7,'7 дней'],[30,'30 дней']];
  $('#main').innerHTML = `<h2>Смены</h2>${cur}
    <h2 style="margin-top:18px">Закрытые и открытые смены</h2>
    <div class="filters">${days.map(([k,t])=>`<button class="btn small ${ (S.shDays||7)===k?'primary':''}" data-shdays="${k}">${t}</button>`).join('')}</div>
    ${(S.shifts||[]).length ? `<div class="scroll"><table><thead><tr><th>№</th>${isBoss()?'<th>Магазин</th>':''}<th>Открыта</th><th>Закрыта</th><th>Выручка</th><th>Чеков</th><th>Наличные: должно / факт</th><th>Расхождение</th><th></th></tr></thead><tbody>
      ${S.shifts.map(x=>{ const r = x.report; return `<tr><td class="num">${x.number}</td>${isBoss()?`<td>${esc(storeName(x.store_id))}</td>`:''}
        <td class="num">${tm(x.opened_at)}<br><span class="meta">${esc(x.opened_by_name||'')}</span></td>
        <td class="num">${x.closed_at?tm(x.closed_at)+'<br><span class="meta">'+esc(x.closed_by_name||'')+'</span>':'<span class="chip ok">открыта</span>'}</td>
        <td class="num">${r?fmt(r.revenue):'—'}</td><td class="num">${r?r.checks:'—'}</td>
        <td class="num">${r?fmt(r.cashExpected)+' / '+fmt(x.closing_cash):'—'}</td><td class="num">${r?diffHtml(x.closing_cash - r.cashExpected):'—'}</td>
        <td>${r?`<button class="btn small" data-shrep="${x.id}">Отчёт</button>`:''}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="empty">За период смен нет</div>'}`;
}
function showShiftReport(x){
  const txt = shiftText(x, x.report);
  modal(`<h2>Смена №${x.number} · ${esc(storeName(x.store_id))}</h2>
    <p class="meta">${tm(x.opened_at)} — ${tm(x.closed_at)}${x.note?' · '+esc(x.note):''}</p>
    ${shiftReportHtml(x.report, x.opening_cash, x.closing_cash)}
    <div class="row"><button class="btn" data-close>Закрыть</button><button class="btn primary" id="print">Печать</button></div>`);
  $('#print').onclick = () => { $('#paper').textContent = txt; window.print(); };
}
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if(!t || S.view!=='shifts') return;
  const d = t.dataset;
  if(t.id==='sh-open'){ t.disabled = true; if(false){} const v0 = $('#sh-open-cash').value; if(v0===''){ toast('Пересчитайте наличные и введите сумму'); t.disabled=false; $('#sh-open-cash').focus(); return; }
    const { error } = await sb.rpc('shift_open', { p_store:S.store, p_cash: +v0, p_note: ($('#sh-open-note')||{}).value||null });
    if(error) toast(errText(error)); else toast('Смена открыта'); await loadShifts(); render(); }
  else if(t.id==='sh-refresh'){ await loadShifts(); render(); }
  else if(t.id==='sh-close' || t.id==='sh-handover'){ const hand = t.id==='sh-handover';
    const v = $('#sh-close-cash').value; if(v===''){ toast('Пересчитайте наличные в кассе и введите сумму'); $('#sh-close-cash').focus(); return; }
    const vc = $('#sh-close-card').value; if(vc===''){ toast('Введите сумму по терминалу из отчёта терминала'); $('#sh-close-card').focus(); return; }
    const vf = $('#sh-close-fiscal').value; if(vf===''){ toast('Введите общую сумму продаж из фискальной кассы'); $('#sh-close-fiscal').focus(); return; }
    t.disabled = true; const { error } = await sb.rpc('shift_close', { p_shift:S.shift.id, p_cash:+v, p_note:$('#sh-note').value, p_card:+vc, p_fiscal:+vf });
    if(error){ toast(errText(error)); t.disabled = false; return; }
    const id = S.shift.id; await loadShifts(); render(); const x = S.shifts.find(z=>z.id===id);
    if(hand){
      modal(`<h2>Пересменка</h2><p>Смена закрыта, отчёт отправлен в Telegram. В кассе: <b>${fmt(+v)}</b>.</p>
        <p>Следующий сотрудник пересчитывает кассу и открывает свою смену — сумма на открытии должна совпасть.</p><div class="row" style="flex-wrap:wrap;gap:8px">
        <button class="btn" data-shrep="${id}">Посмотреть отчёт</button>
        <button class="btn" id="sh-ho-logout">Выйти — войдёт следующий сотрудник</button>
        <button class="btn primary" data-close>Открыть смену с этого аккаунта</button></div>`);
    } else if(x) showShiftReport(x); }
  else if(t.id==='sh-ho-logout'){ await sb.auth.signOut(); location.reload(); }
  else if(d.shrep){ const x = S.shifts.find(z=>z.id===d.shrep); if(x) showShiftReport(x); }
  else if(d.shdays){ S.shDays = +d.shdays; await loadShifts(); render(); }
});

/* ---------- аналитика остатков ---------- */
const SA_GROUPS = [['category','Категория'],['material','Материал'],['color','Цвет'],['price','Цена'],['store','Магазин'],['brand','Бренд'],['supplier','Поставщик'],['site','Связь с сайтом']];
const SA_FILTERABLE = { category:'Категория', material:'Материал', color:'Цвет' };
async function loadStockAn(){
  S.sa = null; S.saItems = null; S.saKey = null;
  const { data, error } = await sb.rpc('stock_analytics', { p_stores: selStores(), p_group: S.saGroup, p_filter: S.saFilter });
  if(error){ toast(errText(error)); S.sa = { rows:[], total:{} }; return; }
  S.sa = data; S.turn = null; loadTurnover();
}
async function loadTurnover(){
  const g = ['store','brand'].includes(S.saGroup) ? 'category' : S.saGroup;
  const { data, error } = await sb.rpc('stock_turnover', { p_stores: selStores(), p_group: g });
  S.turn = error ? { rows:[], total:{}, stale:[] } : data; S.turnG = g; if(error) toast(errText(error));
  if(S.view==='analytics' && S.anMode==='stock') render();
}
function turnoverHtml(){
  const U = S.turn; if(!U) return '<div class="empty">Считаем оборачиваемость…</div>';
  const T = U.total||{}, n = v => (+v||0).toLocaleString('ru-RU'), all = +T.units||1;
  const cover = d => d==null ? '<span class="meta">не продаётся</span>' : d>365 ? `<span style="color:var(--bad)">${(d/30).toFixed(0)} мес.</span>` : d>180 ? `<span style="color:var(--bad)">${d} дн.</span>` : d>90 ? `<span style="color:#b7791f">${d} дн.</span>` : `${d} дн.`;
  const gname = (SA_GROUPS.find(x=>x[0]===S.turnG)||[])[1];
  return `<h2 style="margin-top:18px">Оборачиваемость и залежи</h2>
  <div class="pays" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
    ${[['Хватит остатков при текущих продажах', T.cover_days!=null?(T.cover_days>60?Math.round(T.cover_days/30)+' мес.':T.cover_days+' дн.'):'—'],['Продано за 90 дней', n(T.sold90)+' шт.'],
       ['Лежит без продаж больше 90 дней', n((+T.b180||0)+(+T.b999||0))+' шт.'],['Залежи в рознице', fmt(T.stale_retail||0)],['Залежи по себестоимости', fmt(T.stale_cost||0)]]
      .map(([k,v])=>`<div class="card"><div class="label">${k}</div><div class="total num" style="font-size:20px">${v}</div></div>`).join('')}
  </div>
  <div class="card" style="margin:10px 0"><div class="label">Сколько дней товар лежит без продаж (штук)</div>
    <div style="display:flex;height:22px;border-radius:6px;overflow:hidden;margin:8px 0">${[['b30','#2f855a','до 30 дн.'],['b90','#68d391','31–90'],['b180','#ecc94b','91–180'],['b999','#e53e3e','больше 180 / не продавался']].map(([k,c,t])=>`<div title="${t}: ${n(T[k])} шт." style="background:${c};width:${(+T[k]||0)/all*100}%"></div>`).join('')}</div>
    <div class="meta">${[['b30','до 30 дней'],['b90','31–90 дней'],['b180','91–180 дней'],['b999','больше 180 дней или ни разу не продавался']].map(([k,t])=>`${t}: <b>${n(T[k])}</b> (${Math.round((+T[k]||0)/all*100)}%)`).join(' · ')}</div></div>
  <div class="scroll"><table><thead><tr><th>${gname}</th><th>Штук</th><th>Продано за 90 дн.</th><th>Хватит на</th><th>Без продаж 90+ дн.</th><th>Залежи, розница</th></tr></thead><tbody>
    ${(U.rows||[]).map(r=>`<tr><td>${esc(r.g)}</td><td class="num">${n(r.units)}</td><td class="num">${n(r.sold90)}</td><td class="num">${cover(r.cover_days)}</td>
      <td class="num">${n((+r.b180||0)+(+r.b999||0))} <span class="meta">(${Math.round(((+r.b180||0)+(+r.b999||0))/(+r.units||1)*100)}%)</span></td><td class="num">${fmt(r.stale_retail||0)}</td></tr>`).join('')}
  </tbody></table></div>
  <h2 style="margin-top:16px">Залежавшиеся товары — больше 90 дней без продаж</h2>
  <div class="scroll"><table><thead><tr><th></th><th>Товар</th><th>Остаток</th><th>На сумму</th><th>Последняя продажа</th></tr></thead><tbody>
    ${(U.stale||[]).map(p=>`<tr><td>${thumb(p)}</td><td>${esc(p.name)}<br><span class="meta num">${esc(p.barcode)} · ${esc(p.g||'')}</span></td><td class="num">${p.qty}</td><td class="num">${fmt(p.qty*p.price)}</td>
      <td class="num">${p.last_sale?dshort(p.last_sale)+'<br><span class="meta">'+p.idle+' дн. назад</span>':'<span class="meta">не продавался с января 2026</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Нет залежавшихся товаров</td></tr>'}
  </tbody></table></div>
  <p class="meta">«Хватит на» = остаток ÷ средние продажи в день за последние 90 дней. История продаж — с 1 января 2026 (Wipon + новая касса). Показаны первые 60 товаров по сумме.</p>`;
}
function renderStockAn(){
  const A = S.sa, ids = selStores(), T = (A && A.total) || {}, units = +T.units || 0;
  const filt = Object.entries(S.saFilter);
  $('#main').innerHTML = `<h2>Аналитика</h2>${anModeHtml()}
    <div class="filters"><span class="label" style="align-self:center">Разрез</span>${SA_GROUPS.map(([k,t])=>`<button class="btn small ${S.saGroup===k?'primary':''}" data-sagroup="${k}">${t}</button>`).join('')}</div>
    ${filt.length?`<div class="filters"><span class="label" style="align-self:center">Фильтр</span>${filt.map(([k,v])=>`<span class="chip ok">${SA_FILTERABLE[k]}: ${esc(v)} <button class="btn small" style="padding:0 6px;border:0" data-saunf="${k}" aria-label="Убрать фильтр">✕</button></span>`).join('')}</div>`:''}
    ${!A?'<div class="empty">Считаем остатки…</div>':`
    <div class="pays" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${[['Штук на остатке',units.toLocaleString('ru-RU')],['Артикулов в наличии',(+T.skus||0).toLocaleString('ru-RU')],['В розничных ценах',fmt(T.retail||0)],['По себестоимости',fmt(T.cost||0)],['Средняя цена штуки',fmt(units?T.retail/units:0)],['Минусовые остатки',(T.negatives||0)+' поз.']]
        .map(([k,v])=>`<div class="card"><div class="label">${k}</div><div class="total num" style="font-size:20px">${v}</div></div>`).join('')}
    </div>
    <p class="meta">Нажмите на строку, чтобы увидеть товары внутри. ${SA_FILTERABLE[S.saGroup]?'Кнопка «Внутри ▸» раскроет группу по другому разрезу: например, Серьги → по материалу, цвету или цене.':''}</p>
    <div class="scroll"><table><thead><tr><th>${SA_GROUPS.find(g=>g[0]===S.saGroup)[1]}</th><th>Штук</th><th>Доля</th><th>Артикулов</th><th>Розница</th><th>Себест.</th>
      ${S.saGroup!=='store'?ids.map(id=>`<th>${esc(storeName(id))}</th>`).join(''):''}<th></th></tr></thead><tbody>
    ${A.rows.map(r=>`<tr data-sakey="${esc(r.g)}" style="cursor:pointer"><td><b>${esc(r.g)}</b>${r.negatives?`<br><span class="chip zero">минус: ${r.negatives}</span>`:''}</td>
      <td class="num">${(r.units||0).toLocaleString('ru-RU')}</td><td class="num"><div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;height:8px;border-radius:4px;background:var(--accent);width:${Math.round((r.units||0)/Math.max(1,units)*60)}px"></span>${units?((r.units||0)/units*100).toFixed(1):0}%</div></td>
      <td class="num">${r.skus||0}</td><td class="num">${fmt(r.retail||0)}</td><td class="num">${fmt(r.cost||0)}</td>
      ${S.saGroup!=='store'?ids.map(id=>`<td class="num">${(r.per_store&&r.per_store[id])||'—'}</td>`).join(''):''}
      <td>${SA_FILTERABLE[S.saGroup]?`<button class="btn small" data-safilter="${esc(r.g)}">Внутри ▸</button>`:''}</td></tr>`).join('') || '<tr><td colspan="7" class="meta">Нет остатков</td></tr>'}
    </tbody></table></div>
    ${S.saKey?`<h2 style="margin-top:16px">${esc(S.saKey)}: товары по убыванию остатка</h2>${!S.saItems?'<div class="empty">Загружаем…</div>':`<div class="scroll"><table><thead><tr><th></th><th>Товар</th><th>Цена</th><th>Всего</th>${ids.map(id=>`<th>${esc(storeName(id))}</th>`).join('')}</tr></thead><tbody>
      ${S.saItems.map(p=>`<tr><td>${thumb(p)}</td><td>${esc(p.name)}<br><span class="meta num">${esc(p.barcode)}</span></td><td class="num">${fmt(p.price)}</td><td class="num"><b>${p.total}</b></td>${ids.map(id=>`<td class="num">${p.per_store[id]??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="meta">Показаны первые 100.</p>`}`:''}
    ${turnoverHtml()}
    <p class="meta">Материал и цвет взяты из Google-таблицы товаров, а где их там нет — из названия. Товары без материала стоят в строке «Не указан».</p>`}`;
}

/* ---------- номенклатура ---------- */
const NM_EMPTY = () => ({ id:null, is_group:false, barcode:'', sku:'', name:'', price:'', cost:'', brand:'', category_id:'', material:'', color:'', supplier:'', purchase_url:'', photo_url:'', is_basic:false, archived:false, sites:[] });
async function loadNom(){
  const f = S.nm; f.data = null;
  if(!f.cats){ const { data } = await sb.from('categories').select('id,name').eq('hidden',false).order('name'); f.cats = data || []; }
  sb.rpc('po_incoming').then(({data}) => { S.inc = data || {}; });
  const { data, error } = await sb.rpc('product_list2', { p_q:f.q.trim(), p_category:f.cat?+f.cat:null, p_archived:f.arch, p_offset:f.off, p_limit:f.lim||50, p_sort:f.sort||null, p_desc:!!f.desc, p_flag:f.flag||null });
  if(error){ toast(errText(error)); f.data = { rows:[], total:0 }; } else { f.data = data; S.nmNoPrice = data.noprice; }
}
function renderNom(){
  const f = S.nm, D = f.data, e = f.ed, cats = f.cats || [];
  const inp = (k, label, extra='') => `<label class="stack" style="gap:4px"><span class="label">${label}</span><input data-nf="${k}" value="${esc(e[k]??'')}" ${extra}></label>`;
  $('#main').innerHTML = `<div class="row"><h2>Номенклатура</h2><button class="btn primary" id="nm-new">+ Новый товар</button></div>
    <div class="filters"><input id="nm-q" placeholder="Штрихкод, артикул или название" value="${esc(f.q)}" style="flex:1;min-width:180px">
      <select id="nm-cat"><option value="">Все категории</option><option value="-1" ${String(f.cat)==='-1'?'selected':''}>⚠ Без категории</option>${cats.map(c=>`<option value="${c.id}" ${String(f.cat)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <label class="meta" style="align-self:center"><input type="checkbox" id="nm-arch" ${f.arch?'checked':''}> показать и архивные</label></div>
    ${f.flag&&f.flag!=='photo'?`<div class="row" style="justify-content:flex-start;gap:8px;margin:8px 0"><span class="chip warn">Показаны только товары в наличии: ${NM_FLAG[f.flag]||f.flag}</span><button class="btn small" id="nm-flag-x">✕ Снять фильтр</button></div>`:''}
    ${!D?'<div class="empty">Загружаем…</div>':`<p class="meta">Найдено: ${D.total.toLocaleString('ru-RU')}. Нажмите на название, чтобы открыть карточку. Категорию можно менять прямо в таблице.</p>
    ${nmCanEdit()&&Object.keys(f.sel||{}).length?`<div class="cust row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;margin-bottom:8px"><b>Выбрано: ${Object.keys(f.sel).length}</b>
      <select id="nm-bulkcat"><option value="">Назначить категорию…</option>${cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <button class="btn small primary" id="nm-bulk-go">Применить</button><button class="btn small" id="nm-bulk-grp" title="Под каждым из этих штрихкодов много разных изделий одной цены">Отметить как общий штрихкод</button><button class="btn small" id="nm-bulk-arch" data-arch="1">🗄 В архив</button>${(f.data&&f.data.rows||[]).some(p=>f.sel[p.id]&&p.archived)?'<button class="btn small" id="nm-bulk-unarch" data-arch="0">Вернуть из архива</button>':''}<button class="btn small" id="nm-bulk-clear">Снять выбор</button></div>`:''}
    <div class="scroll"><table class="nm-table mc"><thead><tr>${nmCanEdit()?`<th style="width:28px;padding-right:0"><input type="checkbox" id="nm-selall" title="Выбрать все на странице" ${D.rows.length&&D.rows.every(p=>(f.sel||{})[p.id])?'checked':''}></th>`:''}<th style="white-space:nowrap"><label class="meta" style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;font-weight:400" title="Показать только товары с фото"><input type="checkbox" id="nm-withphoto" ${f.flag==='photo'?'checked':''}>с фото</label></th>${[['name','Название'],['category','Категория'],['barcode','Штрихкод'],['cost','Закуп'],['price','Цена'],['stock','Остаток'],['site','Сайт']].map(([k,v])=>`<th><button data-nmsort="${k}" style="border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;white-space:nowrap" title="Сортировать">${v} ${f.sort===k?(f.desc?'▼':'▲'):'<span class="meta">↕</span>'}</button></th>`).join('')}</tr></thead><tbody>
    ${D.rows.map(p=>{ const inc = (S.inc||{})[p.id], L = (p.sites||[]).filter(x=>x.url);
      return `<tr style="${e&&e.id===p.id?'background:var(--soft)':p.archived?'background:rgba(128,128,128,.18);color:var(--muted,#888)':''}">${nmCanEdit()?`<td class="mc-x" style="width:28px;padding-right:0;vertical-align:middle"><input type="checkbox" data-nmsel="${p.id}" ${(f.sel||{})[p.id]?'checked':''}></td>`:''}<td data-l="">${thumb(p)}</td>
      <td class="mc-t" style="min-width:200px"><button class="linkbtn" data-nmopen="${p.id}" style="border:0;background:none;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit"><b>${esc(p.name)}</b></button>${p.archived?' <span class="chip zero">архив</span>':''}${p.is_group?' <span class="chip">общий штрихкод</span>':''}${p.is_service?' <span class="chip">услуга</span>':''}<br><span class="meta">${esc([{moon:'MOON',sunshine:'Sunshine',both:'MOON и Sunshine'}[p.brand]||'', p.color, p.material].filter(Boolean).join(' · '))}</span></td>
      <td data-l="Категория">${p.category_id?esc(p.category||'—'):'<span class="chip warn">без категории</span>'}</td>
      <td class="num" data-l="Штрихкод">${esc(p.barcode)}${p.sku?'<br><span class="meta">арт. '+esc(p.sku)+'</span>':''}</td>
      <td class="num" data-l="Закуп">${p.cost!=null&&p.cost!==''?fmt(p.cost):'<span class="meta">—</span>'}</td>
      <td class="num" data-l="Цена">${+p.price>0?fmt(p.price):p.is_service?'<span class="meta">сумма при продаже</span>':'<span class="chip warn">нет цены</span>'}</td>
      <td class="num" data-l="Остаток"><span class="nm-st" tabindex="0">${p.stock>0?'<span class="chip ok">есть '+p.stock+'</span>':'<span class="chip zero">нет</span>'}<span class="nm-st-pop">${S.allStores.map(st=>{ const q = +((p.by_store||{})[st.id]||0); return `<span class="row" style="gap:12px;${q?'':'opacity:.5'}"><span>${esc(BRAND[st.brand]+' · '+st.address)}</span><b class="num">${q}</b></span>`; }).join('')}</span></span>${inc&&((inc.ordered||0)+(inc.transit||0))?`<br><span class="meta">заказано ${(inc.ordered||0)+(inc.transit||0)}</span>`:''}</td>
      <td data-l="Сайт" style="white-space:nowrap">${p.is_group?'<span class="meta">не для сайта</span>':L.length?['moon','sunshine'].map(sk=>{ const X = L.filter(x=>x.site===sk); return X.length ? `<a href="${esc(X[0].url)}" target="_blank" rel="noopener">${sk==='moon'?'MOON':'Sunshine'}</a>${X.length>1?` <span class="meta">· ${X.length} карточек</span>`:''}${X.some(x=>x.status==='review')?' <span class="meta">(не проверено)</span>':''}` : ''; }).filter(Boolean).join('<br>'):'<span class="meta">нет на сайте</span>'}</td></tr>`; }).join('') || `<tr><td colspan="${nmCanEdit()?9:8}" class="empty">Ничего не найдено</td></tr>`}</tbody></table></div>
    ${nmPagerHtml(f, D)}`}`;
  nmModalSync(e, f, cats, inp);
}
(()=>{ const st = document.createElement('style'); st.textContent = `.nm-st{position:relative;display:inline-block;cursor:default}.nm-st-pop{display:none;position:fixed;z-index:20;min-width:240px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 10px;box-shadow:0 6px 24px rgba(0,0,0,.15);text-align:left;font-size:13px;flex-direction:column;gap:4px;white-space:nowrap}.nm-st:hover .nm-st-pop,.nm-st:focus .nm-st-pop{display:flex}`; document.head.appendChild(st);
  const place = el => { const pop = el.querySelector('.nm-st-pop'); if(!pop) return; const r = el.getBoundingClientRect(); pop.style.display = 'flex';
    const w = pop.offsetWidth, h = pop.offsetHeight; pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px'; pop.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + 'px'; pop.style.display = ''; };
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('.nm-st'); if(el) place(el); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('.nm-st'); if(el) place(el); }); })();
document.addEventListener('mousedown', e => { if(e.target && e.target.id==='nm-modal' && S.nm) nmClose(); });
/* закрыть карточку: если её открыли из другого раздела (data-pcard) — вернуться туда */
function nmClose(){ S.nm.ed = null; const b = S.nm.back; S.nm.back = null;
  if(b && b!=='nom' && (S.tabs||[]).some(x=>x[0]===b)){ S.view = b; (S.lastView ||= {})[groupOf(b)[0]] = b; render(); loadView(); } else render(); }
/* имя товара → карточка товара (хаб) из любого списка */
const pcl = (id, html) => id ? `<a href="#" class="pcl" data-pcard="${esc(id)}">${html}</a>` : html;
async function pcardOpen(pid){
  if(!(S.tabs||[]).some(x=>x[0]==='nom')) return toast('Карточка товара открывается в «Номенклатуре» — у вас нет доступа к этой вкладке');
  let row = (S.nm.data&&S.nm.data.rows||[]).find(r=>r.id===pid), keep = false;
  if(!row){ const { data, error } = await sb.rpc('product_card', { p_id:pid }); if(error) return toast(errText(error)); if(!data || !data.row) return toast('Товар не найден');
    row = data.row; (S.nm.card ||= {})[pid] = data; keep = true; }
  const from = S.view;
  if(from!=='nom'){ S.nm.back = from; S.view = 'nom'; (S.lastView ||= {})[groupOf('nom')[0]] = 'nom'; }
  nmOpen(row, keep); if(!S.nm.data) loadView();
}
document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-pcard]'); if(!el) return; e.preventDefault(); e.stopPropagation(); pcardOpen(el.dataset.pcard); }, true);
const nmCanEdit = () => S.me && ['owner','manager','purchaser'].includes(S.me.role);
document.addEventListener('change', async e => { if(S.view!=='nom') return; const t = e.target, f = S.nm;
  if(t.dataset.nmcat){ const r = await sb.rpc('products_set_category', { p_ids:[t.dataset.nmcat], p_cat: t.value ? +t.value : null }); if(r.error) return toast(errText(r.error));
    const row = (f.data&&f.data.rows||[]).find(x=>x.id===t.dataset.nmcat); if(row){ row.category_id = t.value ? +t.value : null; row.category = t.value ? t.options[t.selectedIndex].text : null; } toast('Категория сохранена'); render(); }
  else if(t.dataset.nmsel){ f.sel = f.sel || {}; if(t.checked) f.sel[t.dataset.nmsel] = 1; else delete f.sel[t.dataset.nmsel]; render(); }
  else if(t.id==='nm-selall'){ f.sel = f.sel || {}; (f.data&&f.data.rows||[]).forEach(p=>{ if(t.checked) f.sel[p.id] = 1; else delete f.sel[p.id]; }); render(); }
});
document.addEventListener('click', async e => { if(S.view!=='nom') return; const t = e.target.closest('button'); if(!t) return; const f = S.nm;
  if(t.id==='nm-flag-x'){ f.flag = null; f.off = 0; f.data = null; render(); await loadNom(); render(); return; }
  if(t.dataset.nmai){ (f.open ||= {}).ai = true; render(); const b = document.getElementById('ai-box'); if(b){ b.open = true; b.scrollIntoView({ behavior:'smooth', block:'start' }); } return; }
  if(t.dataset.nmpo){ const e = f.ed; if(!e) return; const dd = PO.d || (PO.d = poNew()); if(!dd.items.some(i=>i.pid===e.id)) dd.items.push({ pid:e.id, name:e.name, barcode:e.barcode, qty:1, cost:'' });
    toast('Добавлено в новый заказ ('+dd.items.length+' поз.)'); render(); return; }
  if(t.dataset.nmpogo){ if(!(S.tabs||[]).some(x=>x[0]==='po')) return toast('Нет доступа к закупу'); f.ed = null; f.back = null; PO.mode = 'new'; S.view = 'po'; (S.lastView ||= {})[groupOf('po')[0]] = 'po'; render(); scrollTo(0,0); await loadView(); return; }
  if(t.id==='nm-bulk-clear'){ f.sel = {}; render(); }
  else if(t.id==='nm-bulk-arch' || t.id==='nm-bulk-unarch'){ const ids = Object.keys(f.sel||{}), on = t.dataset.arch==='1'; t.disabled = true;
    const r = await sb.rpc('products_set_archived', { p_ids:ids, p_arch:on }); t.disabled = false; if(r.error) return toast(errText(r.error));
    const d = r.data||{}; toast(on ? `В архив: ${d.changed}${d.with_stock?` (у ${d.with_stock} ещё есть остаток в магазинах)`:''}` : `Возвращено из архива: ${d.changed}`); f.sel = {}; await loadNom(); render(); }
  else if(t.id==='nm-bulk-grp'){ const ids = Object.keys(f.sel||{}); t.disabled = true; let linked = 0;
    for(const id of ids){ const r = await sb.rpc('product_mark_group', { p_id:id, p_on:true }); if(r.error){ t.disabled = false; return toast(errText(r.error)); } linked += +(r.data||{}).linked||0; }
    toast(`Отмечено как общий штрихкод: ${ids.length}. Такие товары на сайт не выводятся.`); f.sel = {}; await loadNom(); render(); }
  else if(t.id==='nm-bulk-go'){ const c = $('#nm-bulkcat').value; if(!c) return toast('Выберите категорию'); t.disabled = true;
    const r = await sb.rpc('products_set_category', { p_ids:Object.keys(f.sel), p_cat:+c }); if(r.error){ t.disabled = false; return toast(errText(r.error)); }
    toast('Категория назначена: '+r.data+' товарам'); f.sel = {}; await loadNom(); render(); }
});
function nmModalSync(e, f, cats, inp){
  const M = $('#modal'), has = !!M.querySelector('#nm-modal');
  if(!e){ if(has) M.innerHTML = ''; return; }
  if(e.id && !(f.gal ||= {})[e.id]) nmGalLoad(e.id);
  if(e.id && !(f.card ||= {})[e.id]){ f.card[e.id] = 'wait'; sb.rpc('product_card', { p_id:e.id }).then(({ data, error }) => { f.card[e.id] = error ? { err:errText(error) } : (data || { err:'нет данных' }); if(S.view==='nom' && f.ed && f.ed.id===e.id) render(); }); }
  if(e.id && !(f.hist ||= {})[e.id] && nmCanEdit()){ f.hist[e.id] = 'wait'; sb.rpc('product_price_history', { p_id:e.id }).then(({ data }) => { f.hist[e.id] = data || []; if(S.view==='nom' && f.ed && f.ed.id===e.id) render(); }); }
  const ae = document.activeElement, keep = ae && M.contains(ae) && ae.id ? { id:ae.id, s:ae.selectionStart, e:ae.selectionEnd } : null;
  const sc = has ? M.querySelector('.dialog').scrollTop : 0;
  M.innerHTML = `<div class="overlay" id="nm-modal"><div class="dialog" role="dialog" aria-modal="true" style="max-width:820px">${nmEditorHtml(e, f, cats, inp)}</div></div>`;
  M.querySelector('.dialog').scrollTop = sc;
  aiPaint();
  if(keep){ const el = document.getElementById(keep.id); if(el){ el.focus(); try{ el.setSelectionRange(keep.s, keep.e); }catch(_){} } }
}
/* карточка-хаб: остатки по магазинам, продажи 30/90 дней, движение, открытые заказы */
function nmCardHtml(e, f, op){
  const C = (f.card||{})[e.id];
  if(!C || C==='wait') return '<div class="meta">Остатки, продажи и движение товара: загружаем…</div>';
  if(C.err) return `<div class="meta">Не удалось загрузить остатки и продажи: ${esc(C.err)}</div>`;
  const R = C.row || {}, by = R.by_store || {}, inc = C.incoming || {}, Sa = C.sales || {}, M = C.moves || [], P = C.po;
  const tot = Object.values(by).reduce((a,v)=>a+(+v||0),0), way = (+inc.ordered||0) + (+inc.transit||0);
  const dt = v => v ? new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  const stN = id => { const st = S.allStores.find(x=>x.id===+id); return st ? BRAND[st.brand]+' · '+st.address : 'магазин '+id; };
  const PST = { draft:'черновик', ordered:'заказан', transit:'в пути' };
  return `<details class="cust" data-nmdet="cstk" ${(op.cstk ?? true)?'open':''}><summary style="cursor:pointer"><b>📦 Остатки по магазинам</b> <span class="meta">— всего ${tot}${way?` · едет ${way} (заказано ${+inc.ordered||0}, в пути ${+inc.transit||0})`:''}</span></summary>
      <div class="pc-g" style="margin-top:6px">${S.allStores.map(st=>{ const q = +(by[st.id]||0); return `<div style="${q?'':'opacity:.5'}"><span class="pc-l">${esc(BRAND[st.brand]+' · '+st.address)}</span><b class="num" style="${q<0?'color:var(--bad)':''}">${q}</b></div>`; }).join('')}</div></details>
    <details class="cust" data-nmdet="csal" ${(op.csal ?? !!+Sa.q90)?'open':''}><summary style="cursor:pointer"><b>💰 Продажи</b> <span class="meta">— 30 дн.: ${+Sa.q30||0} шт. на ${fmt(Sa.s30||0)} · 90 дн.: ${+Sa.q90||0} шт. на ${fmt(Sa.s90||0)} · последняя: ${Sa.last?dt(Sa.last):'не продавался'}</span></summary>
      ${(Sa.by_store||[]).length?`<div class="scroll" style="margin-top:6px"><table class="mc"><thead><tr><th>Магазин</th><th>30 дн.</th><th>90 дн.</th></tr></thead><tbody>
        ${Sa.by_store.map(b=>`<tr><td class="mc-t">${esc(stN(b.store))}</td><td class="num" data-l="30 дн.">${+b.q30} шт. · ${fmt(b.s30)}</td><td class="num" data-l="90 дн.">${+b.q90} шт. · ${fmt(b.s90)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="meta" style="margin-top:6px">За 90 дней продаж не было.</div>'}</details>
    <details class="cust" data-nmdet="cmov" ${op.cmov?'open':''}><summary style="cursor:pointer"><b>🔄 Движение товара</b> <span class="meta">— последние ${M.length}</span></summary>
      ${M.length?`<div class="scroll" style="margin-top:6px"><table class="mc"><thead><tr><th>Когда</th><th>Что</th><th>Магазин</th><th>Шт.</th><th>Кто</th></tr></thead><tbody>
        ${M.map(m=>`<tr><td class="num mc-t">${dt(m.at)}</td><td data-l="Что">${esc(MOVE_T[m.type]||m.type)}${m.note?`<br><span class="meta">${esc(m.note)}</span>`:''}</td><td data-l="Магазин">${esc(stN(m.store))}</td><td class="num" data-l="Шт." style="color:${m.qty>0?'var(--ok)':'var(--bad)'}">${m.qty>0?'+':''}${m.qty}</td><td data-l="Кто">${esc(m.who||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="meta" style="margin-top:6px">Движений нет.</div>'}</details>
    ${Array.isArray(P)?`<details class="cust" data-nmdet="cpo" ${(op.cpo ?? !!P.length)?'open':''}><summary style="cursor:pointer"><b>🛒 Закуп</b> <span class="meta">— ${R.supplier?esc(R.supplier)+' · ':''}${R.cost!=null?'закуп '+fmt(R.cost)+' · ':''}${P.length?'открытых заказов: '+P.length:'открытых заказов нет'}</span></summary>
      <div class="stack" style="gap:6px;margin-top:6px">
      ${e.purchase_url?`<div><a href="${esc(e.purchase_url)}" target="_blank" rel="noopener">Ссылка на поставщика ↗</a></div>`:''}
      ${P.length?`<div class="scroll"><table class="mc"><thead><tr><th>Заказ</th><th>Статус</th><th>Шт.</th><th>Себест.</th><th>Ждём</th></tr></thead><tbody>
        ${P.map(o=>`<tr><td class="mc-t">№${o.number} · ${esc(noZh(o.supplier)||'поставщик')}${o.url?` <a href="${esc(o.url)}" target="_blank" rel="noopener">↗</a>`:''}</td><td data-l="Статус">${esc(PST[o.status]||o.status)}</td><td class="num" data-l="Шт.">${o.qty}${o.received!=null?' · получено '+o.received:''}</td><td class="num" data-l="Себест.">${o.cost!=null?fmt(o.cost):'—'}</td><td class="num" data-l="Ждём">${o.eta?dshort(o.eta):'—'}</td></tr>`).join('')}</tbody></table></div>`:''}
      ${poEdit()?`<div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><button class="btn small" data-nmpo="${e.id}" ${(PO.d&&PO.d.items||[]).some(i=>i.pid===e.id)?'disabled':''}>${(PO.d&&PO.d.items||[]).some(i=>i.pid===e.id)?'Уже в новом заказе':'В заказ'}</button>${PO.d&&(PO.d.items||[]).length?`<button class="btn small" data-nmpogo="1">Открыть новый заказ (${PO.d.items.length} поз.)</button>`:''}</div>`:''}
      </div></details>`:''}`;
}
/* история закупочных цен товара: где, у кого и почём брали */
function nmHistHtml(H, op){
  if(!H) return ''; if(H==='wait') return '<div class="meta">История закупок: загружаем…</div>';
  if(!H.length) return '<div class="cust meta">📈 История закупок: этот товар ещё не связан ни с одним заказом. Связь появляется при приёмке заказа из Китая или Alibaba.</div>';
  const CUR = { CNY:'¥', USD:'$', KZT:'₸' }, pr = h => h.price_cur!=null ? (CUR[h.currency]||'')+(+h.price_cur).toLocaleString('ru-RU',{maximumFractionDigits:2}) : '—';
  const same = H.filter(h => h.price_cur!=null && h.currency===H[0].currency), last = same[0], best = same.reduce((a,h)=> !a || +h.price_cur < +a.price_cur ? h : a, null);
  const diff = last && best && +best.price_cur < +last.price_cur ? Math.round((+last.price_cur - +best.price_cur) / +best.price_cur * 100) : 0;
  const src = { '1688':'1688', alibaba:'Alibaba', receipt:'приёмка' };
  return `<details class="cust" data-nmdet="hist" ${(op ?? diff)?'open':''}><summary style="cursor:pointer"><b>📈 История закупок (${H.length})</b>${last?` · последняя ${pr(last)} у ${esc(noZh(last.supplier)||'поставщика')}`:''}${diff?` · <span style="color:var(--bad)">дороже лучшей цены на ${diff}%: ${pr(best)} у ${esc(noZh(best.supplier)||'другого поставщика')}, ${dshort(best.at)}</span>`:''}</summary>
    <div class="scroll" style="margin-top:6px"><table><thead><tr><th>Дата</th><th>Где</th><th>Поставщик</th><th>Вариант</th><th>Цена</th><th>Себест.</th><th>Шт.</th><th></th></tr></thead><tbody>
    ${H.map(h=>`<tr style="${best&&h===best?'background:var(--soft)':''}"><td class="num">${dshort(h.at)}</td><td>${src[h.source]||esc(h.source||'')}</td><td>${esc(noZh(h.supplier)||'—')}</td><td class="meta">${esc(poSpec({ spec:h.spec })||'')}</td>
      <td class="num">${pr(h)}${best&&h===best?' <span class="chip ok">лучшая</span>':''}</td><td class="num">${h.kzt!=null?fmt(h.kzt):'—'}</td><td class="num">${h.qty}</td><td>${h.url?`<a href="${esc(h.url)}" target="_blank" rel="noopener">↗</a>`:''}</td></tr>`).join('')}</tbody></table></div></details>`;
}
/* ---------- AI-фото товара (Grok): стили из «Стили генерации фото украшений», распознавание изделия, несколько вариантов с автопроверкой ---------- */
const AI = { pid:null, cv:null, mode:null, pts:[], ppm:null, len:null, wid:null, busy:false, list:null, st:null, wb:false, srcs:[], srcBusy:false,
  an:null, anBusy:false, srcUrl:null, style:null, n:2, refs:[], showRej:false, run:null, styles:null, t0:0 };
function aiReset(pid){ Object.assign(AI, { pid, cv:null, mode:null, pts:[], ppm:null, len:null, wid:null, busy:false, list:null, wb:false, srcs:[], srcBusy:false,
  an:null, anBusy:false, srcUrl:null, style:null, n:2, refs:[], showRej:false, run:null }); }
async function aiInvoke(body){ const { data, error } = await sb.functions.invoke('photo_ai', { body });
  if(error){ let msg = error.message; try{ msg = (await error.context.json()).error || msg; }catch(_){} throw Error(msg); } return data; }
async function aiLoad(pid){
  const [{ data:l }, st, { data:sp }, { data:su }, sty] = await Promise.all([ sb.from('product_ai_photos').select('id,url,mode,style,status,source,check_result,attempts,cost_usd,wish,created_at').eq('product_id', pid).order('created_at', { ascending:false }).limit(40),
    AI.st ? Promise.resolve({ data:AI.st }) : sb.functions.invoke('photo_ai', { body:{ action:'status' } }),
    sb.from('site_products').select('photo,gallery').eq('product_id', pid).limit(5),
    sb.from('product_suppliers').select('photo').eq('product_id', pid).not('photo', 'is', null).limit(5),
    AI.styles ? Promise.resolve({ data:{ styles:AI.styles } }) : sb.functions.invoke('photo_ai', { body:{ action:'styles' } }) ]);
  if(AI.pid !== pid) return; AI.list = l || []; AI.st = st.data || AI.st || {}; AI.styles = (sty.data && sty.data.styles) || AI.styles || [];
  const src = []; (sp||[]).forEach(x => { if(x.photo) src.push([x.photo,'сайт']); (Array.isArray(x.gallery)?x.gallery:[]).forEach(u => typeof u==='string' && src.push([u,'сайт'])); });
  (su||[]).forEach(x => src.push([x.photo,'поставщик'])); AI.srcs = src; if(S.view==='nom') render(); }
/* готовые фото товара, которые можно взять как исходник: главное, сгенерированные, с сайта, от поставщика */
function aiSrcList(e){
  const out = [], seen = new Set(), add = (u, t) => { if(u && !seen.has(u)){ seen.add(u); out.push([u, t]); } };
  add(e.photo_url, 'главное'); const G = (S.nm.gal||{})[e.id]; if(Array.isArray(G)) G.forEach(x => add(x.url, 'галерея')); (AI.list||[]).filter(x=>x.status!=='rejected').forEach(x => add(x.url, 'AI')); (AI.srcs||[]).forEach(([u,t]) => add(u, t));
  return out.slice(0, 20);
}
/* распознать изделие и подобрать стили — сразу после загрузки исходного фото */
async function aiAnalyze(){
  if(!AI.cv || AI.anBusy || !(AI.st && AI.st.has_key)) return; const pid = AI.pid; AI.anBusy = true; AI.an = null; AI.srcUrl = null; render();
  try{ const d = await aiInvoke({ action:'analyze', product_id:pid, image:AI.cv.toDataURL('image/jpeg', 0.9) }); if(AI.pid !== pid) return;
    AI.an = d; AI.srcUrl = d.source_url || null; if(Array.isArray(d.styles) && d.styles.length) AI.styles = d.styles;
    const sg = (d.suggested && d.suggested.styles) || []; if(!AI.style || !(AI.styles||[]).some(s=>s.code===AI.style)) AI.style = (sg[0] && sg[0].code) || 'catalog';
    const sz = d.analysis && d.analysis.size_estimate; if(sz && !AI.len && !$('#ai-size')?.value) AI.sizeGuess = String(sz); }
  catch(err){ toast('Распознать не удалось: ' + err.message); }
  AI.anBusy = false; if(S.view==='nom') render(); }
function aiAnHtml(){
  if(AI.anBusy) return '<div class="meta">🔎 Silver распознаёт изделие и подбирает стили…</div>';
  const A = AI.an && AI.an.analysis; if(!A) return AI.cv && AI.st && AI.st.has_key ? '<button class="btn small" data-aian="1">🔎 Распознать изделие и подобрать стиль</button>' : '';
  const stones = (A.stones||[]).map(s => [s.count, s.color, s.kind, s.shape].filter(Boolean).join(' ')).filter(Boolean).join('; ');
  return `<div class="cust meta" style="line-height:1.45"><b>Silver распознал:</b> ${esc(AI.an.type_ru || A.type_ru || '')}${A.metal_color?' · металл: '+esc(A.metal_color):''}${stones?' · вставки: '+esc(stones):''}${A.size_estimate?' · ≈ '+esc(A.size_estimate):''}${A.notes?'<br>'+esc(A.notes):''}${AI.an.supplier?'<br><span class="chip warn">фото поставщика — получатся черновики, одобрить после фото настоящего изделия</span>':''}${AI.an.suggested&&AI.an.suggested.palette?'<br>Палитра: '+esc(AI.an.suggested.palette):''}</div>`; }
function aiStylesHtml(){
  const sg = (AI.an && AI.an.suggested && AI.an.suggested.styles) || [], why = Object.fromEntries(sg.map(s=>[s.code, s.why]));
  const L = (AI.styles||[]).slice().sort((a,b)=>(why[b.code]?1:0)-(why[a.code]?1:0)); if(!L.length) return '';
  const cur = AI.style || (sg[0] && sg[0].code) || 'catalog';
  return `<div class="stack" style="gap:4px"><span class="label">Стиль</span><div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">${L.map(s=>`<button type="button" class="btn small ${s.code===cur?'primary':''}" data-aistyle="${esc(s.code)}" title="${esc(why[s.code]||s.purpose||'')}">${why[s.code]?'★ ':''}${esc(s.title)}${s.card_slot?` <span class="meta" style="font-size:10px">фото №${s.card_slot}</span>`:''}</button>`).join('')}</div>
    ${why[cur]?`<span class="meta">★ ${esc(why[cur])}</span>`:(L.find(s=>s.code===cur)||{}).purpose?`<span class="meta">${esc((L.find(s=>s.code===cur)||{}).purpose)}</span>`:''}</div>`; }
function aiStatusChip(x){
  const r = (x.check_result && x.check_result.reasons) || [];
  if(x.status==='approved') return '<span class="chip ok">одобрено</span>';
  if(x.status==='draft') return '<span class="chip ok" title="Прошло автопроверку совпадения с оригиналом">черновик ✓ проверка пройдена</span>';
  if(x.status==='supplier_draft') return '<span class="chip warn" title="Сделано по фото поставщика — одобрить можно после фото настоящего изделия">черновик по фото поставщика</span>';
  if(x.status==='rejected') return `<span class="chip zero" title="${esc(r.join('; '))}">брак ✗</span>${r.length?`<span class="meta" style="font-size:11px">${esc(r.join('; '))}</span>`:''}`;
  return ''; }
function aiCardHtml(e, x){
  const sty = (AI.styles||[]).find(s=>s.code===x.style), main = e.photo_url===x.url;
  return `<div class="stack" style="gap:4px;width:160px"><a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="" style="width:160px;height:160px;object-fit:cover;border-radius:10px${x.status==='rejected'?';opacity:.55':''}"></a>
    <span class="meta">${esc(sty?sty.title:x.style?x.style:x.mode==='model'?'на модели':'белый фон')} · ${dshort(x.created_at)}</span>${aiStatusChip(x)}
    ${main?'<span class="chip ok">главное фото</span>':x.id&&x.status!=='supplier_draft'?`<button class="btn small primary" data-airev="main:${x.id}"${x.status==='rejected'?' title="Фото не прошло автопроверку — нажимайте, только если сами сверили изделие"':''}>${x.status==='rejected'?'Одобрить вручную и сделать главным':'Одобрить и сделать главным'}</button>`:''}
    ${nmInGal(e.id, x.url)?'<span class="chip">в галерее</span>':x.status==='supplier_draft'?'':`<button class="btn small" data-aigal="${esc(x.url)}">В галерею</button>`}
    ${x.id&&x.status!=='rejected'&&!main?`<button class="btn small" data-airev="reject:${x.id}">В брак</button>`:''}</div>`; }
function aiPhotoHtml(e){
  if(AI.pid !== e.id){ aiReset(e.id); aiLoad(e.id); }
  const sizeTxt = AI.len ? `${AI.len}${AI.wid?' × '+AI.wid:''} мм` : (e.size_mm || AI.sizeGuess || '');
  const step = { wb:'Нажмите на белую (или серую) карточку на фото', r1:'Линейка: нажмите на отметку 0', r2:'Линейка: нажмите на отметку 1 см (10 мм)', l1:'Изделие: нажмите на один край (длина)', l2:'Изделие: нажмите на противоположный край', w1:'Ширина: нажмите на один край', w2:'Ширина: нажмите на другой край' }[AI.mode];
  const L = AI.list || [], good = L.filter(x=>x.status!=='rejected'), bad = L.filter(x=>x.status==='rejected');
  const refSrc = aiSrcList(e).filter(([u]) => /^https:\/\//.test(u));
  const secs = AI.busy ? Math.round((Date.now()-AI.t0)/1000) : 0;
  return `<details class="cust" data-nmdet="ai" ${AI.cv||AI.busy||(S.nm.open||{}).ai?'open':''} id="ai-box"><summary style="cursor:pointer"><b>✨ AI-фото для сайта (Grok)</b> <span class="meta">— каталог, студия, на модели, креатив… с проверкой, что изделие не изменилось</span></summary>
    ${AI.st && !AI.st.has_key ? (AI.st.owner ? `<div class="stack" style="gap:6px;margin-top:8px"><span class="meta">Впишите ключ Grok: console.x.ai → API Keys → Create. Ключ хранится на сервере, в браузер не возвращается.</span><div class="row" style="gap:6px"><input id="ai-key" type="password" placeholder="xai-…" autocomplete="off" style="flex:1"><button class="btn small primary" id="ai-key-save">Сохранить ключ</button></div></div>` : '<div class="meta" style="margin-top:8px">Генерация заработает, когда владелец впишет ключ Grok.</div>') : ''}
    <div class="stack" style="gap:8px;margin-top:8px">
      <label class="btn small" style="cursor:pointer;align-self:flex-start">📷 ${AI.cv?'Заменить фото из магазина':'Загрузить фото из магазина'}<input type="file" id="ai-file" accept="image/*" hidden></label>
      ${(()=>{ const S2 = aiSrcList(e); return S2.length?`<div class="stack" style="gap:4px"><span class="meta">или взять готовое фото:${AI.srcBusy?' загружаем…':''}</span><div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">${S2.map(([u,t])=>`<button type="button" data-aisrc="${esc(u)}" title="${esc(t)}" style="border:0;padding:0;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px" ${AI.srcBusy?'disabled':''}><img src="${esc(u)}" alt="" loading="lazy" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--line,#ddd)"><span class="meta" style="font-size:10px">${esc(t)}</span></button>`).join('')}</div></div>`:''; })()}
      <span class="meta">Совет: снимайте рядом с белой карточкой (для цвета) и линейкой (для размера) — на готовой картинке их не будет.</span>
      ${AI.cv?`<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">
        <button class="btn small ${AI.mode==='wb'?'primary':''}" data-aimode="wb">⚪ Цвет по карточке${AI.wb?' ✓':''}</button>
        <button class="btn small ${/^r/.test(AI.mode||'')?'primary':''}" data-aimode="r1">📏 Линейка${AI.ppm?' ✓':''}</button>
        <button class="btn small ${/^l/.test(AI.mode||'')?'primary':''}" data-aimode="l1" ${AI.ppm?'':'disabled'}>↔ Длина${AI.len?' ✓':''}</button>
        <button class="btn small ${/^w/.test(AI.mode||'')?'primary':''}" data-aimode="w1" ${AI.ppm?'':'disabled'}>↕ Ширина${AI.wid?' ✓':''}</button>
        ${AI.wb?'<button class="btn small" data-aimode="undo">↺ Вернуть исходные цвета</button>':''}</div>
        ${step?`<div class="chip warn" style="align-self:flex-start">👉 ${step}</div>`:''}
        <canvas id="ai-cv" style="max-width:100%;max-height:420px;object-fit:contain;border-radius:10px;cursor:crosshair;touch-action:manipulation;background:#eee"></canvas>
        ${aiAnHtml()}${aiStylesHtml()}`:''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 10px">
        <label class="stack" style="gap:2px"><span class="label">Размер изделия</span><input id="ai-size" value="${esc(sizeTxt)}" placeholder="например 18 × 12 мм"></label>
        <label class="stack" style="gap:2px"><span class="label">Вариантов</span><select id="ai-n">${[1,2,3,4].map(k=>`<option value="${k}" ${k===AI.n?'selected':''}>${k}</option>`).join('')}</select></label>
      </div>
      <label class="stack" style="gap:2px"><span class="label">Пожелания к генерации</span><textarea id="ai-wish" rows="2" placeholder="например: девушка, шея крупно, дневной свет, бежевый свитер">${esc(AI.wish||'')}</textarea></label>
      <details ${AI.refs.length?'open':''}><summary class="meta" style="cursor:pointer">Референсы стиля (до 3) — свет, палитра и настроение из ваших лучших фото${AI.refs.length?' · выбрано '+AI.refs.length:''}</summary>
        <div class="stack" style="gap:6px;margin-top:6px">
          ${refSrc.length?`<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">${refSrc.map(([u,t])=>{ const on = AI.refs.includes(u); return `<button type="button" data-airef="${esc(u)}" title="${esc(t)}" style="border:${on?'2px solid var(--accent,#c58b2e)':'1px solid var(--line,#ddd)'};padding:0;border-radius:8px;overflow:hidden;background:none;cursor:pointer"><img src="${esc(u)}" alt="" loading="lazy" style="width:52px;height:52px;object-fit:cover;display:block${on?'':';opacity:.75'}"></button>`; }).join('')}</div>`:''}
          <div class="row" style="gap:6px"><input id="ai-ref-url" placeholder="или вставьте ссылку на картинку https://…" style="flex:1"><button type="button" class="btn small" id="ai-ref-add">Добавить</button></div>
          ${AI.refs.filter(u=>!refSrc.some(([x])=>x===u)).map(u=>`<span class="chip">${esc(u.slice(0,60))}… <button type="button" data-airef="${esc(u)}" style="border:0;background:none;cursor:pointer">✕</button></span>`).join('')}
        </div></details>
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-start">
        <button class="btn primary" data-aigo="1" ${AI.cv&&!AI.busy&&!AI.anBusy?'':'disabled'}>✨ Сгенерировать${AI.style?' — '+esc(((AI.styles||[]).find(s=>s.code===AI.style)||{}).title||AI.style):''}</button>
        ${AI.busy?`<span class="meta">Grok рисует ${AI.n} вар. и проверяет каждый на совпадение с изделием, брак перерисовывает… ${secs} с (обычно 30–120 с)</span>`:''}</div>
      ${AI.run?`<span class="meta">Последний запуск: прошло проверку ${AI.run.passed} из ${(AI.run.photos||[]).length}, попыток ${AI.run.attempts}, расход $${(+AI.run.cost_usd||0).toFixed(3)} ≈ ${fmt(Math.round((+AI.run.cost_usd||0)*520))}${AI.run.note?' · '+esc(AI.run.note):''}</span>`:''}
      ${good.length?`<div class="row" style="gap:10px;flex-wrap:wrap;justify-content:flex-start;align-items:flex-start">${good.map(x=>aiCardHtml(e, x)).join('')}</div>`:''}
      ${bad.length?`<button type="button" class="btn small" data-airej="1" style="align-self:flex-start">${AI.showRej?'скрыть':'показать'} брак (${bad.length})</button>${AI.showRej?`<div class="row" style="gap:10px;flex-wrap:wrap;justify-content:flex-start;align-items:flex-start">${bad.map(x=>aiCardHtml(e, x)).join('')}</div>`:''}`:''}
    </div></details>`;
}
function aiPaint(){
  const c = document.getElementById('ai-cv'); if(!c || !AI.cv) return;
  c.width = AI.cv.width; c.height = AI.cv.height; const g = c.getContext('2d'); g.drawImage(AI.cv, 0, 0);
  g.fillStyle = '#e11d48'; g.strokeStyle = '#e11d48'; g.lineWidth = Math.max(2, c.width/400);
  for(const p of AI.pts){ g.beginPath(); g.arc(p[0], p[1], Math.max(5, c.width/160), 0, 7); g.fill(); }
  if(AI.pts.length===2){ g.beginPath(); g.moveTo(...AI.pts[0]); g.lineTo(...AI.pts[1]); g.stroke(); }
}
function aiWhiteBalance(x, y){
  const g = AI.cv.getContext('2d'), r = Math.max(4, Math.round(AI.cv.width/150));
  const d = g.getImageData(Math.max(0,x-r), Math.max(0,y-r), r*2, r*2).data; let R=0,G=0,B=0,n=0;
  for(let i=0;i<d.length;i+=4){ R+=d[i]; G+=d[i+1]; B+=d[i+2]; n++; } R/=n; G/=n; B/=n;
  const k = (R+G+B)/3, s = Math.min(1.6, 240/Math.max(k,1)), gr = k/R*s, gg = k/G*s, gb = k/B*s;
  if(!AI.orig) AI.orig = g.getImageData(0, 0, AI.cv.width, AI.cv.height);
  const img = g.getImageData(0, 0, AI.cv.width, AI.cv.height), p = img.data;
  for(let i=0;i<p.length;i+=4){ p[i]=Math.min(255,p[i]*gr); p[i+1]=Math.min(255,p[i+1]*gg); p[i+2]=Math.min(255,p[i+2]*gb); }
  g.putImageData(img, 0, 0); AI.wb = true;
}
async function aiUseBlob(blob){ const bm = await createImageBitmap(blob); const k = Math.min(1, 1600/Math.max(bm.width, bm.height));
  const c = document.createElement('canvas'); c.width = Math.round(bm.width*k); c.height = Math.round(bm.height*k); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  Object.assign(AI, { cv:c, orig:null, wb:false, mode:'wb', pts:[], ppm:null, len:null, wid:null, an:null, srcUrl:null }); render(); aiAnalyze(); }
document.addEventListener('click', async e => { const t = e.target.closest('button[data-aisrc]'); if(!t || AI.srcBusy) return; e.preventDefault();
  const u = t.dataset.aisrc, ext = !/supabase\.co\//.test(u); AI.srcBusy = true; render();
  try{ const r = await fetch(u, { mode:'cors', cache:'no-store' }); if(!r.ok) throw Error('HTTP ' + r.status); const b = await r.blob(); if(!/^image\//.test(b.type||'image/')) throw Error('не картинка');
    AI.srcBusy = false; await aiUseBlob(b); toast('Фото загружено — отметьте белую карточку или сразу генерируйте'); }
  catch(err){ AI.srcBusy = false; render(); toast(ext ? 'Это фото с сайта, браузер не даёт его прочитать — скачайте и загрузите вручную' : 'Не удалось загрузить фото: ' + err.message); } });
document.addEventListener('change', async e => {
  if(e.target.id==='ai-file' && e.target.files[0]){ await aiUseBlob(e.target.files[0]); }
  else if(e.target.id==='ai-wish') AI.wish = e.target.value;
  else if(e.target.id==='ai-n') AI.n = +e.target.value || 2;
});
document.addEventListener('click', async e => {
  const c = e.target.closest('#ai-cv');
  if(c && AI.cv && AI.mode){ const r = c.getBoundingClientRect(), x = Math.round((e.clientX - r.left) * c.width / r.width), y = Math.round((e.clientY - r.top) * c.height / r.height);
    if(AI.mode==='wb'){ aiWhiteBalance(x, y); AI.srcUrl = null; AI.mode = 'r1'; AI.pts = []; return render(); }
    AI.pts.push([x, y]); const dist = () => Math.hypot(AI.pts[1][0]-AI.pts[0][0], AI.pts[1][1]-AI.pts[0][1]);
    if(AI.pts.length===2){
      if(AI.mode==='r2'){ AI.ppm = dist()/10; AI.mode = 'l1'; }
      else if(AI.mode==='l2'){ AI.len = Math.round(dist()/AI.ppm); AI.mode = 'w1'; toast('Длина: '+AI.len+' мм. Можно измерить ширину или сразу генерировать'); }
      else if(AI.mode==='w2'){ AI.wid = Math.round(dist()/AI.ppm); AI.mode = null; }
      setTimeout(()=>{ AI.pts = []; aiPaint(); }, 600);
    } else AI.mode = AI.mode.replace('1','2');
    return render(); }
  const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.aimode){ if(t.dataset.aimode==='undo'){ if(AI.orig){ AI.cv.getContext('2d').putImageData(AI.orig, 0, 0); AI.orig = null; } AI.wb = false; AI.srcUrl = null; } else { AI.mode = t.dataset.aimode; AI.pts = []; } render(); }
  else if(t.id==='ai-key-save'){ const k = $('#ai-key').value.trim(); if(!k) return; t.disabled = true;
    try{ await aiInvoke({ action:'set_key', key:k }); }catch(err){ t.disabled = false; return toast(err.message); }
    t.disabled = false; AI.st = { ...(AI.st||{}), has_key:true }; toast('Ключ Grok сохранён'); render(); if(AI.cv && !AI.an) aiAnalyze(); }
  else if(t.dataset.aian){ aiAnalyze(); }
  else if(t.dataset.aistyle){ AI.style = t.dataset.aistyle; render(); }
  else if(t.dataset.airef){ const u = t.dataset.airef; AI.refs = AI.refs.includes(u) ? AI.refs.filter(x=>x!==u) : AI.refs.length>=3 ? (toast('Не больше 3 референсов'), AI.refs) : [...AI.refs, u]; render(); }
  else if(t.id==='ai-ref-add'){ const u = ($('#ai-ref-url')||{}).value?.trim() || ''; if(!/^https:\/\//.test(u)) return toast('Нужна ссылка на картинку, начинается с https://');
    if(AI.refs.length>=3) return toast('Не больше 3 референсов'); if(!AI.refs.includes(u)) AI.refs = [...AI.refs, u]; render(); }
  else if(t.dataset.airej){ AI.showRej = !AI.showRej; render(); }
  else if(t.dataset.aigo){ if(!AI.cv || AI.busy) return;
    const size = ($('#ai-size')||{}).value || '', wish = ($('#ai-wish')||{}).value || ''; AI.wish = wish; AI.n = +(($('#ai-n')||{}).value || AI.n || 2);
    const pid = AI.pid, style = AI.style || (AI.an && AI.an.suggested && AI.an.suggested.styles && AI.an.suggested.styles[0] && AI.an.suggested.styles[0].code) || 'catalog';
    if(size) sb.rpc('product_size_set', { p_id:pid, p_size:size });
    AI.busy = true; AI.t0 = Date.now(); render(); const tick = setInterval(()=>{ if(AI.busy && S.view==='nom' && AI.pid===pid) render(); }, 5000);
    const body = { action:'gen', product_id:pid, style, n:AI.n, wish, size, refs:AI.refs };
    if(AI.srcUrl) body.image_url = AI.srcUrl; else body.image = AI.cv.toDataURL('image/jpeg', 0.9);
    try{ const d = await aiInvoke(body); if(AI.pid !== pid) return;
      AI.run = d; AI.list = [...(d.photos||[]).map(p => ({ ...p, created_at:new Date().toISOString() })), ...(AI.list||[]).filter(x => !(d.photos||[]).some(p=>p.id===x.id))];
      toast(d.passed ? `Готово: ${d.passed} вар. прошли проверку. Лучший — «Одобрить и сделать главным»` : 'Ни один вариант не прошёл проверку — см. брак и причины'); }
    catch(err){ toast(err.message); }
    finally{ clearInterval(tick); AI.busy = false; render(); } }
  else if(t.dataset.airev){ const [act, id] = t.dataset.airev.split(':'), x = (AI.list||[]).find(p=>String(p.id)===id); if(!x) return;
    if(act==='main' && x.status==='rejected' && t.dataset.sure!=='1'){ t.dataset.sure = '1'; t.textContent = 'Точно? Изделие сверили сами — нажмите ещё раз'; return; }
    t.disabled = true;
    try{ await aiInvoke(act==='main' ? { action:'review', photo_id:+id, decision:'approve', make_main:true, force:x.status==='rejected' } : { action:'review', photo_id:+id, decision:'reject' }); }
    catch(err){ t.disabled = false; return toast(err.message); }
    if(act==='main'){ x.status = 'approved'; if(S.nm.ed) S.nm.ed.photo_url = x.url; const row = (S.nm.data&&S.nm.data.rows||[]).find(r=>r.id===AI.pid); if(row) row.photo_url = x.url; toast('Одобрено и стало главным фото'); nmGalLoad(AI.pid); }
    else { x.status = 'rejected'; toast('Отправлено в брак'); }
    render(); }
  else if(t.dataset.aigal){ t.disabled = true; const { error } = await sb.rpc('product_photo_add', { p_id:AI.pid, p_url:t.dataset.aigal }); if(error){ t.disabled = false; return toast(errText(error)); }
    toast('Добавлено в галерею товара'); await nmGalLoad(AI.pid); }
  else if(t.dataset.aimain){ const { error } = await sb.rpc('product_photo_set', { p_id:AI.pid, p_url:t.dataset.aimain }); if(error) return toast(errText(error)); nmGalLoad(AI.pid);
    if(S.nm.ed) S.nm.ed.photo_url = t.dataset.aimain; const row = (S.nm.data&&S.nm.data.rows||[]).find(x=>x.id===AI.pid); if(row) row.photo_url = t.dataset.aimain; toast('Главное фото обновлено'); render(); }
});
/* страницы номенклатуры: 1 2 3 … N и сколько товаров на странице */
function nmPagerHtml(f, D){
  const lim = f.lim || 50, pages = Math.max(1, Math.ceil((D.total||0) / lim)), cur = Math.floor(f.off / lim) + 1;
  const set = new Set([1, pages, cur-2, cur-1, cur, cur+1, cur+2].filter(n => n>=1 && n<=pages)), list = [...set].sort((a,b)=>a-b);
  let prev = 0, btns = '';
  for(const n of list){ if(n - prev > 1) btns += '<span class="meta">…</span>'; btns += `<button class="btn small ${n===cur?'primary':''}" data-nmpage="${n}" ${n===cur?'aria-current="page"':''}>${n}</button>`; prev = n; }
  return `<div class="row" style="margin-top:10px;flex-wrap:wrap;gap:6px;justify-content:flex-start">
    ${pages>1?`<button class="btn small" data-nmpage="${Math.max(1,cur-1)}" ${cur>1?'':'disabled'}>‹</button>${btns}<button class="btn small" data-nmpage="${Math.min(pages,cur+1)}" ${cur<pages?'':'disabled'}>›</button>`:''}
    <span class="meta" style="margin-left:auto">Показывать по</span><select id="nm-lim">${[50,100,200].map(n=>`<option value="${n}" ${n===lim?'selected':''}>${n}</option>`).join('')}</select>
    <span class="meta">${(D.total||0).toLocaleString('ru-RU')} товаров · стр. ${cur} из ${pages}</span></div>`;
}
document.addEventListener('change', async e => { if(S.view!=='nom' || e.target.id!=='nm-withphoto') return; S.nm.flag = e.target.checked ? 'photo' : null; S.nm.off = 0; S.nm.data = null; render(); await loadNom(); render(); });
document.addEventListener('change', async e => { if(S.view!=='nom' || e.target.id!=='nm-lim') return; S.nm.lim = +e.target.value; S.nm.off = 0; S.nm.data = null; render(); await loadNom(); render(); });
function nmEditorHtml(e, f, cats, inp){
  const op = f.open || {}, G = e.id && Array.isArray((f.gal||{})[e.id]) ? f.gal[e.id] : [], ed = nmCanEdit();
  const sel = (k, label, opts) => `<label class="stack" style="gap:2px"><span class="label">${label}</span><select data-nf="${k}">${opts}</select></label>`;
  return `<div class="stack" style="gap:10px">
     <div class="row" style="align-items:flex-start"><div style="min-width:0">${e.id?`<div class="meta">Карточка товара${e.barcode?' · '+esc(e.barcode):''}</div>`:''}<h2 style="margin:0;text-wrap:balance">${e.id?esc(e.name||'Без названия'):'Новый товар'}</h2></div><button class="btn small" id="nm-close">Закрыть</button></div>
     <div class="row" style="justify-content:flex-start;align-items:flex-start;gap:14px;flex-wrap:wrap">
       <div class="stack" style="gap:6px;width:150px;flex:none">
         ${e.photo_url?`<a href="${esc(e.photo_url)}" target="_blank" rel="noopener"><img src="${esc(e.photo_url)}" alt="" style="width:150px;height:150px;object-fit:cover;border-radius:12px;display:block"></a>`:'<span class="thumb" style="width:150px;height:150px"></span>'}
         ${e.id?nmGalHtml(e, f, G, ed):`<label class="btn small" style="cursor:pointer;text-align:center">📷 Фото<input type="file" id="nm-photo" accept="image/*" hidden></label>`}
         ${e.id&&ed?`<button class="btn small" data-nmai="1">✨ AI-фото</button>`:''}
         ${f.busy?'<span class="meta">Загружаем фото…</span>':''}
       </div>
       <div class="stack" style="gap:8px;flex:1;min-width:260px">
         ${inp('name','Название *')}
         ${e.id?`<div class="meta num" style="line-height:1.4">${esc(nmInfo(e))||'категория, цвет и материал не указаны'}<br>Остаток по сети: <b>${e.stock??'—'}</b>${(e.sites||[]).some(x=>x.url)?' · '+(e.sites||[]).filter(x=>x.url).map(x=>`<a href="${esc(x.url)}" target="_blank" rel="noopener">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}</a>`).join(' · '):' · на сайте не найден'}</div>`:''}
         <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 10px">
           ${inp('price','Цена, ₸ *','type="number" min="0" inputmode="numeric"')}${inp('cost','Закуп, ₸','type="number" min="0" inputmode="numeric"')}
           ${inp('barcode','Штрихкод', 'placeholder="пусто — создать свой"')}${inp('sku','Артикул')}
           ${sel('brand', 'Бренд'+(e.id?'':' *'), [['','—'],['moon','MOON'],['sunshine','Sunshine'],['both','MOON и Sunshine']].map(([k,v])=>`<option value="${k}" ${(e.brand||'')===k?'selected':''}>${v}</option>`).join(''))}
           ${sel('category_id', 'Категория', `<option value="">—</option>${cats.map(c=>`<option value="${c.id}" ${String(e.category_id)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}`)}
           ${inp('material','Материал','list="nm-mats"')}${inp('color','Цвет','list="nm-colors"')}${inp('supplier','Поставщик')}
         </div>
         ${inp('purchase_url','Ссылка на закуп')}
       </div>
     </div>
     <datalist id="nm-mats">${['Серебро 925','Нержавейка','Мед сплав','Пластик','мельхиор','Жемчуг','Кожа','другой'].map(m=>`<option value="${m}">`).join('')}</datalist>
     <datalist id="nm-colors">${['золото','серебро','цветной','черный'].map(m=>`<option value="${m}">`).join('')}</datalist>
     <div class="row" style="flex-wrap:wrap;gap:8px 16px">
       <span class="row" style="gap:16px;flex-wrap:wrap;justify-content:flex-start"><label title="Под одним штрихкодом продаются разные изделия одной цены — на сайте это много карточек"><input type="checkbox" data-nf="is_group" ${e.is_group?'checked':''}> Общий штрихкод</label>
         <label><input type="checkbox" data-nf="archived" ${e.archived?'checked':''}> В архиве</label></span>
       <span class="row" style="gap:8px">${e.id&&e.barcode?`<button class="btn small" data-labels='${esc(JSON.stringify([{n:e.name,b:e.barcode,p:+e.price,q:1}]))}'>Этикетка</button>`:''}
         <button class="btn primary" id="nm-save">${e.id?'Сохранить':'Создать товар'}</button></span></div>
     ${e.id?nmCardHtml(e, f, op):''}
     ${e.id?nmHistHtml((f.hist||{})[e.id], op.hist):''}
     ${e.id&&ed?aiPhotoHtml(e):''}
     <details class="cust" data-nmdet="site" ${op.site||f.sq?'open':''}><summary style="cursor:pointer"><b>🔗 Связь с сайтом</b> <span class="meta">${!e.id?'— сначала сохраните товар':(e.sites||[]).length?'— связан: '+(e.sites||[]).map(x=>x.site==='moon'?'MOON':'Sunshine').join(', '):'— не связан'}</span></summary>
       ${!e.id?'':`<div class="stack" style="gap:6px;margin-top:8px">
       ${(e.sites||[]).map(x=>`<div class="row"><span>${x.site==='moon'?'MOON':'Sunshine'}: ${esc(x.title)} ${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">открыть</a>`:''}</span><button class="btn small" data-nmunlink="${x.site}:${x.uid}">Отвязать</button></div>`).join('')}
       <input id="nm-sq" placeholder="Найти карточку на сайте по названию" value="${esc(f.sq)}" autocomplete="off">
       ${f.sfound.map(x=>`<button class="prod" data-nmlink="${x.site}:${x.uid}">${thumb({photo_url:x.photo})}<span><b>${esc(x.title)}</b><br><span class="meta">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}${x.linked_to?' · сейчас связан с: '+esc(x.linked_to):''}</span></span><span class="price num">${fmt(x.price)}</span></button>`).join('')}</div>`}
     </details>
   </div>`.replace(/<label class="stack" style="gap:4px">/g, '<label class="stack" style="gap:2px">');
}
/* галерея фото товара: несколько фото, одно главное (оно же photo_url) */
function nmInGal(pid, url){ const G = (S.nm.gal||{})[pid]; return Array.isArray(G) && G.some(x => x.url===url); }
async function nmGalLoad(pid){
  (S.nm.gal ||= {})[pid] = (S.nm.gal[pid] && S.nm.gal[pid] !== 'wait') ? S.nm.gal[pid] : 'wait';
  const { data } = await sb.from('product_photos').select('id,url,sort').eq('product_id', pid).order('sort').order('id');
  S.nm.gal[pid] = data || []; if(S.view==='nom' && S.nm.ed && S.nm.ed.id===pid) render();
}
function nmGalHtml(e, f, G, ed){
  const list = G.length ? G : (e.photo_url ? [{ id:null, url:e.photo_url }] : []);
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
    ${list.map(x=>{ const main = x.url===e.photo_url;
      return `<div style="position:relative">
        <button type="button" ${x.id&&!main&&ed?`data-ngmain="${x.id}" title="Сделать главным"`:'disabled'} style="border:${main?'2px solid var(--accent,#c58b2e)':'1px solid var(--line,#ddd)'};padding:0;border-radius:8px;overflow:hidden;background:none;cursor:${main?'default':'pointer'};display:block;width:100%"><img src="${esc(x.url)}" alt="" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;display:block"></button>
        ${x.id&&ed?`<button type="button" data-ngdel="${x.id}" title="${f.galDel===x.id?'Нажмите ещё раз, чтобы убрать':'Убрать из галереи'}" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:0;padding:0;font-size:11px;line-height:20px;cursor:pointer;background:${f.galDel===x.id?'var(--bad,#d33)':'rgba(0,0,0,.55)'};color:#fff">${f.galDel===x.id?'?':'✕'}</button>`:''}
        ${main?'<span style="position:absolute;left:2px;bottom:2px;font-size:9px;background:rgba(0,0,0,.6);color:#fff;border-radius:4px;padding:0 3px">главное</span>':''}</div>`; }).join('')}
    </div>
    ${ed?`<label class="btn small" style="cursor:pointer;text-align:center">＋ фото<input type="file" id="nm-gal-add" accept="image/*" multiple hidden></label>`:''}
    ${G==='wait'?'<span class="meta">загружаем фото…</span>':''}
    ${list.length>1?'<span class="meta" style="font-size:11px">Нажмите на фото, чтобы сделать главным</span>':''}
    <details data-nmdet="purl" ${(f.open||{}).purl?'open':''}><summary class="meta" style="cursor:pointer;font-size:12px">ссылка на главное фото</summary><input data-nf="photo_url" placeholder="ссылка на картинку" value="${esc(e.photo_url||'')}" style="margin-top:4px;width:100%"></details>`;
}
async function nmGalUpload(files){
  const e = S.nm.ed; if(!e || !e.id || !files.length) return;
  S.nm.busy = true; render(); let ok = 0;
  for(const [i, file] of [...files].entries()){
    try{
      const img = await createImageBitmap(file); const k = Math.min(1, 1600/Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      const path = `${e.id}/${Date.now()}-${i}.jpg`;
      const { error } = await sb.storage.from('product-photos').upload(path, blob, { contentType:'image/jpeg', upsert:true }); if(error) throw error;
      const url = sb.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
      const r = await sb.rpc('product_photo_add', { p_id:e.id, p_url:url }); if(r.error) throw r.error;
      if(!e.photo_url){ e.photo_url = url; const row = (S.nm.data&&S.nm.data.rows||[]).find(x=>x.id===e.id); if(row) row.photo_url = url; }
      ok++;
    }catch(err){ toast('Фото не загрузилось: '+errText(err)); }
  }
  S.nm.busy = false; if(ok) toast(ok===1?'Фото добавлено':'Добавлено фото: '+ok); await nmGalLoad(e.id); render();
}
document.addEventListener('change', e => { if(e.target.id==='nm-gal-add' && e.target.files.length) nmGalUpload(e.target.files); });
document.addEventListener('toggle', e => { const d = e.target; if(!d || !d.dataset || !d.dataset.nmdet || S.view!=='nom') return; (S.nm.open ||= {})[d.dataset.nmdet] = d.open; }, true);
document.addEventListener('click', async e => {
  const t = e.target.closest('button[data-ngmain],button[data-ngdel]'); if(!t || S.view!=='nom' || !S.nm.ed) return;
  const ed = S.nm.ed, f = S.nm;
  if(t.dataset.ngmain){ const { data, error } = await sb.rpc('product_photo_main', { p_photo:+t.dataset.ngmain }); if(error) return toast(errText(error));
    ed.photo_url = data; const row = (f.data&&f.data.rows||[]).find(x=>x.id===ed.id); if(row) row.photo_url = data; f.galDel = null; toast('Главное фото обновлено'); await nmGalLoad(ed.id); return; }
  const id = +t.dataset.ngdel;
  if(f.galDel !== id){ f.galDel = id; render(); setTimeout(()=>{ if(f.galDel===id){ f.galDel = null; if(S.view==='nom') render(); } }, 4000); return; }
  f.galDel = null; const { error } = await sb.rpc('product_photo_del', { p_photo:id }); if(error) return toast(errText(error));
  const { data:p } = await sb.from('products').select('photo_url').eq('id', ed.id).maybeSingle(); ed.photo_url = p ? p.photo_url : ed.photo_url;
  const row = (f.data&&f.data.rows||[]).find(x=>x.id===ed.id); if(row) row.photo_url = ed.photo_url; toast('Фото убрано из галереи'); await nmGalLoad(ed.id);
});
function nmInfo(p){ return [p.category, p.color, p.material, p.stone, {moon:'MOON',sunshine:'Sunshine',both:'MOON и Sunshine'}[p.brand]||p.brand, +p.price===0?'⚠ нет розничной цены':'', p.supplier?'поставщик '+p.supplier:''].filter(Boolean).join(' · '); }
function nmSiteLinks(p){ const L=(p.sites||[]).filter(x=>x.url); return L.length?`<div class="meta" style="padding:0 10px 8px">${L.map(x=>`🔗 <a href="${esc(x.url)}" target="_blank" rel="noopener">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}${x.status==='review'?' (связь не проверена)':''}</a>`).join(' &nbsp; ')}</div>`:''; }
function nmOpen(p, keep){ if(p && p.id && !keep && S.nm.card) delete S.nm.card[p.id]; S.nm.ed = { ...NM_EMPTY(), ...p, category_id: p.category_id??'', cost: p.cost??'', supplier: p.supplier||'', sites: p.sites||[] }; S.nm.sq=''; S.nm.sfound=[]; render(); }
async function nmSave(){
  const e = S.nm.ed; if(!e) return;
  const { data, error } = await sb.rpc('product_save', { p: { ...e, sites: undefined } });
  if(error) return toast(errText(error));
  toast(e.id ? 'Сохранено' : 'Товар создан, штрихкод '+data.barcode);
  e.id = data.id; e.barcode = data.barcode;
  const row = [e.id, e.barcode, e.sku||'', e.name, Number(e.price), e.photo_url||'', e.category_id||null, 0, e.brand||''];
  const i = S.catalog.findIndex(a=>a[0]===e.id); if(i>=0) S.catalog[i]=row; else S.catalog.push(row);
  try{ ls.set('kassa_catalog4', { at:S.catalogAt, items:S.catalog }); }catch(_){}
  await loadNom(); const fresh = S.nm.data.rows.find(r=>r.id===e.id); if(fresh) nmOpen(fresh); else render();
}
async function nmPhoto(file){
  const e = S.nm.ed; if(!file || !e) return;
  S.nm.busy = true; render();
  try{
    const img = await createImageBitmap(file); const k = Math.min(1, 1200/Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    const path = `${e.id || 'new'}/${Date.now()}.jpg`;
    const { error } = await sb.storage.from('product-photos').upload(path, blob, { contentType:'image/jpeg', upsert:true });
    if(error) throw error;
    e.photo_url = sb.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
    toast('Фото загружено — нажмите «Сохранить»');
  }catch(err){ toast('Фото не загрузилось: '+errText(err)); }
  S.nm.busy = false; render();
}

/* ---------- сайт ↔ база ---------- */
const SITE_ST = [['review','Проверить'],['auto','Связано автоматически'],['confirmed','Подтверждено'],['siteonly','Только на сайте — нет в базе'],['group','Общий товар (скрыто)'],['baseonly','Только в базе — нет на сайте']];
const SITE_NAME = { moon:'mooncollection.kz', sunshine:'sunshinejewelry.kz' };
async function loadSite(){
  const f = S.st; f.data = null;
  const pk = f.site+':'+f.status;
  if(!f.parts || f.partsKey!==pk){ const r = await sb.rpc('site_parts2', { p_site:f.site, p_status: f.status==='baseonly' ? null : f.status }); f.parts = (r.data || []).sort((a,b) => (!a.name)-(!b.name) || b.n-a.n); f.partsKey = pk; if(!f.parts.some(x=>x.part===f.part)) f.part = null; }
  const bo = f.status==='baseonly';
  const [{ data, error }, b] = await Promise.all([
    sb.rpc('site_list2', { p_site:f.site, p_status:bo?'review':f.status, p_q:f.q.trim(), p_offset:f.off, p_limit:bo?0:50, p_part:f.part||null, p_sort:f.sort||null, p_desc:!!f.desc }),
    sb.rpc('site_base_only2', { p_site:f.site, p_q:f.q.trim(), p_offset:f.off, p_limit:bo?50:0, p_sort:f.sort||null, p_desc:!!f.desc }) ]);
  if(error){ toast(errText(error)); f.data = { rows:[], counts:{} }; } else f.data = data;
  f.baseTotal = b.data ? b.data.total : 0; f.base = bo && b.data ? b.data.rows : [];
}
function siteImg(u){ return u ? `<img class="thumb" style="width:64px;height:64px" src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="" loading="lazy" decoding="async" onerror="if(this.dataset.full&&this.src!==this.dataset.full)this.src=this.dataset.full">` : '<span class="thumb" style="width:64px;height:64px"></span>'; }
function renderSite(){
  const f = S.st, D = f.data, c0 = k => (D && D.counts && D.counts[f.site+':'+k]) || 0;
  const cnt = k => k==='siteonly' ? c0('none')+c0('rejected') : k==='baseonly' ? (f.baseTotal||0) : c0(k);
  $('#main').innerHTML = `<h2>Сайт ↔ база товаров</h2>
    <p class="meta">Слева карточка с сайта, справа товар из базы, с которым она связана. Через эту связь на сайт пойдут остатки, а в кассу — фото. Товары с общим штрихкодом (например «Серьги 3500») на сайт не выводятся и с карточками не связываются.</p>

    <div class="filters">${Object.entries(SITE_NAME).map(([k,v])=>`<button class="btn small ${f.site===k?'primary':''}" data-stsite="${k}">${v}</button>`).join('')}</div>
    <div class="filters">${SITE_ST.map(([k,v])=>`<button class="btn small ${f.status===k?'primary':''}" data-ststatus="${k}">${v} · ${cnt(k)}</button>`).join('')}
      <input id="st-q" placeholder="Поиск: название или штрихкод" value="${esc(f.q)}" style="flex:1;min-width:200px"></div>
    ${f.status==='baseonly'?'':`<div class="filters"><select id="st-part" aria-label="Раздел сайта"><option value="">Все разделы сайта${(f.parts||[]).length?' ('+(f.parts||[]).length+')':''}</option>${(f.parts||[]).map(x=>`<option value="${esc(x.part)}" ${f.part===x.part?'selected':''}>${esc(x.name || 'Без названия: '+(x.sample||[]).slice(0,2).join(', '))} · ${x.n}</option>`).join('')}</select>
      ${f.part?(()=>{ const P = (f.parts||[]).find(x=>x.part===f.part); return P && /^\d+$/.test(P.part) ? `<input id="st-part-name" placeholder="Назовите раздел, например «Авторская работа»" value="${esc(P.name||'')}" style="min-width:240px"><button class="btn small" id="st-part-save">Сохранить название</button>` : ''; })():''}</div>`}
    ${f.status==='baseonly' ? siteBaseOnlyHtml(f) : !D?'<div class="empty">Загружаем…</div>':!D.rows.length?'<div class="empty">Здесь пусто</div>':`<div class="row" style="justify-content:flex-start;gap:18px;flex-wrap:wrap;padding:6px 12px;margin-bottom:6px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600">${[['name','Товар'],['category','Категория'],['barcode','Штрихкод'],['price','Цена'],['stock','Остаток']].map(([k,v])=>stSortTh(f,k,v)).join('')}</div>`+D.rows.map(r=>{ const key=r.site+':'+r.uid, open=f.open===key;
      return `<div class="card" style="margin-bottom:8px">
      <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:center">
        <div class="row" style="justify-content:flex-start;align-items:flex-start">${siteImg(r.photo)}<div><b>${esc(r.title)}</b><br><span class="meta">${esc(r.part||'')}</span><br><span class="num">${fmt(r.price)}</span>
          ${r.url?` · <a href="${esc(r.url)}" target="_blank" rel="noopener">на сайте</a>`:''}</div></div>
        <div class="row" style="justify-content:flex-start;align-items:flex-start">${r.product_id?`${siteImg(r.p_photo)}<div><b>${esc(r.p_name)}</b><br><span class="meta num">${esc(r.p_barcode)}</span><br>
          <span class="num" style="${+r.p_price!==+r.price?'color:var(--bad)':''}">${fmt(r.p_price)}${+r.p_price!==+r.price?' — цена отличается':''}</span>${r.score!=null&&r.status!=='confirmed'?` <span class="chip">сходство ${Math.round(r.score*100)}%</span>`:''}<br><span class="meta">${r.p_cat?esc(r.p_cat)+' · ':''}остаток </span>${+r.stock>0?'<span class="chip ok">'+r.stock+'</span>':'<span class="meta">0</span>'}</div>`
          :'<div class="meta">Не связан с базой</div>'}</div>
      </div>
      <div class="row" style="justify-content:flex-end;flex-wrap:wrap;margin-top:8px">
        ${r.product_id&&r.status!=='confirmed'?`<button class="btn small primary" data-stok="${key}" data-pid="${r.product_id}">Верно</button>`:''}
        <button class="btn small" data-stopen="${key}">${open?'Скрыть':'Выбрать другой товар'}</button>
        ${isBoss()&&!isViewer()&&!r.product_id?(r.status==='group'?`<button class="btn small" data-stgcard="${key}" data-on="0">Вернуть в «Только на сайте»</button>`:`<button class="btn small" data-stgcard="${key}" data-on="1" title="Изделие продаётся под общим штрихкодом — в базе отдельного товара нет. Карточка уйдёт из списка «Только на сайте»">Пометить как общий товар</button>`):''}
      </div>
      ${open?`<div class="cust stack" style="margin-top:8px">
        <span class="label">Похожие товары в базе</span>
        ${!f.cands?'<div class="meta">Ищем…</div>':f.cands.map(c=>`<button class="prod" data-stpick="${key}" data-pid="${c.product_id}">${thumb({photo_url:c.photo})}<span><b>${esc(c.name)}</b><br><span class="meta num">${esc(c.barcode)} · ${c.grp?'<span class="chip ok">общий штрихкод · тот же тип и цена</span>':'сходство '+Math.round(c.sim*100)+'%'}</span></span><span class="price num">${fmt(c.price)}</span></button>`).join('')}
        <span class="label">Или найдите вручную</span>
        <input id="st-cq" placeholder="Штрихкод или название из базы" value="${esc(f.cq)}" autocomplete="off">
        ${f.cfound.slice(0,10).map(p=>`<button class="prod" data-stpick="${key}" data-pid="${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}
      </div>`:''}
    </div>`; }).join('')}
    ${f.status!=='baseonly'&&D&&(f.off||D.rows.length===50)?`<div class="row"><button class="btn" data-stpage="-1" ${f.off?'':'disabled'}>Назад</button><span class="meta">${f.off+1}–${f.off+D.rows.length}</span><button class="btn" data-stpage="1" ${D.rows.length===50?'':'disabled'}>Дальше</button></div>`:''}`;
}
const stSortTh = (f, k, v) => `<button data-stsort="${k}" style="border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;white-space:nowrap" title="Сортировать">${v} ${f.sort===k?(f.desc?'▼':'▲'):'<span class="meta">↕</span>'}</button>`;
function siteBaseOnlyHtml(f){
  const L = f.base || [];
  return `<p class="meta">Товары из базы, у которых нет карточки на сайте ${esc(SITE_NAME[f.site]||f.site)}. Сверху — те, что есть в наличии. Если карточка на сайте всё-таки есть — нажмите «Найти на сайте» и свяжите.</p>
  ${!f.data?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">Здесь пусто</div>':`<div class="scroll"><table class="mc"><thead><tr><th></th>${[['name','Товар'],['category','Категория'],['barcode','Штрихкод'],['price','Цена'],['stock','Остаток']].map(([k,v])=>`<th>${stSortTh(f,k,v)}</th>`).join('')}<th></th></tr></thead><tbody>
  ${L.map(p=>`<tr><td data-l="">${thumb(p)}</td><td class="mc-t"><b>${esc(p.name)}</b>${p.is_group?' <span class="chip">общий штрихкод</span>':''}</td><td data-l="Категория">${esc(p.category||'—')}</td><td class="num" data-l="Штрихкод">${esc(p.barcode)}</td><td class="num" data-l="Цена">${fmt(p.price)}</td>
    <td class="num" data-l="Остаток">${p.stock>0?'<span class="chip ok">'+p.stock+'</span>':'<span class="meta">0</span>'}</td>
    <td class="mc-a" style="white-space:nowrap">${wiponOk()&&!isViewer()?`<button class="btn small" data-stbfind="${p.id}">${f.bfind===p.id?'Скрыть':'Найти на сайте'}</button>
      ${p.is_group?`<button class="btn small" data-stbgrp="${p.id}" data-on="0" title="Снять отметку">✓ общий штрихкод</button>`:`<button class="btn small" data-stbgrp="${p.id}" data-on="1" title="Под этим штрихкодом много разных изделий одной цены">Отметить как общий штрихкод</button>`}`:''}</td></tr>
    ${f.bfind===p.id?`<tr><td data-l=""></td><td class="mc-t" colspan="6"><div class="cust stack" style="gap:4px"><input id="st-bq" placeholder="Название карточки на сайте" value="${esc(f.bq||'')}" autocomplete="off">
      ${(f.bfound||[]).filter(x=>x.site===f.site).map(x=>`<button class="prod" data-stblink="${x.site}:${x.uid}" data-pid="${p.id}">${thumb({photo_url:x.photo})}<span><b>${esc(x.title)}</b><br><span class="meta">${x.linked_to?'сейчас связан с: '+esc(x.linked_to):'не связан'}</span></span><span class="price num">${fmt(x.price)}</span></button>`).join('')}</div></td></tr>`:''}`).join('')}</tbody></table></div>
  ${f.off||L.length===50?`<div class="row" style="margin-top:8px"><button class="btn" data-stpage="-1" ${f.off?'':'disabled'}>Назад</button><span class="meta">${f.off+1}–${f.off+L.length} из ${f.baseTotal}</span><button class="btn" data-stpage="1" ${L.length===50?'':'disabled'}>Дальше</button></div>`:''}`}`;
}
document.addEventListener('click', async e => {
  if(S.view!=='site') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset, f = S.st;
  if(d.stbfind){ if(f.bfind===d.stbfind){ f.bfind = null; render(); return; } const p = (f.base||[]).find(x=>x.id===d.stbfind); f.bfind = d.stbfind; f.bq = p ? p.name : ''; f.bfound = []; render();
    const { data } = await sb.rpc('site_search', { p_q: f.bq.split(' ').slice(0,2).join(' ') }); f.bfound = data || []; render(); const el = $('#st-bq'); if(el) el.focus(); }
  else if(d.stgrp){ const [site, uid] = d.stgrp.split(':'); t.disabled = true;
    const { data } = await sb.rpc('site_candidates', { p_site:site, p_uid:+uid }); const G = (data||[]).filter(c=>c.grp); t.disabled = false;
    if(G.length===1){ const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product:G[0].product_id, p_status:'confirmed' }); if(error) return toast(errText(error)); toast('Связано с «'+G[0].name+'»'); await loadSite(); render(); }
    else { f.open = d.stgrp; f.cands = data||[]; f.cq = ''; f.cfound = []; render(); toast(G.length ? 'Подходит несколько общих штрихкодов — выберите нужный' : 'Общего штрихкода с такой ценой нет — выберите товар вручную'); } }
  else if(d.stbgrp){ t.disabled = true; const on = d.on==='1'; const { data, error } = await sb.rpc('product_mark_group', { p_id:d.stbgrp, p_on:on }); if(error){ t.disabled = false; return toast(errText(error)); }
    toast(on ? 'Отмечен как общий штрихкод — такой товар на сайт не выводится' : 'Отметка снята'); await loadSite(); render(); }
  else if(d.stgcard){ const [site, uid] = d.stgcard.split(':'), on = d.on==='1'; t.disabled = true;
    const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product:null, p_status: on ? 'group' : 'none' }); if(error){ t.disabled = false; return toast(errText(error)); }
    toast(on ? 'Помечено как общий товар — карточка скрыта из «Только на сайте»' : 'Карточка вернулась в «Только на сайте»'); S.st.parts = null; await loadSite(); render(); }
  else if(d.stblink){ const [site, uid] = d.stblink.split(':'); const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product:d.pid, p_status:'confirmed' });
    if(error) return toast(errText(error)); toast('Связано с карточкой сайта'); f.bfind = null; await loadSite(); render(); }
});
document.addEventListener('input', e => { if(S.view!=='site' || e.target.id!=='st-bq') return; const f = S.st; f.bq = e.target.value; clearTimeout(f.bqT);
  f.bqT = setTimeout(async () => { if(f.bq.trim().length < 2) return; const { data } = await sb.rpc('site_search', { p_q: f.bq.trim() }); f.bfound = data || []; render(); const el = $('#st-bq'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 350); });
async function siteSet(key, pid, status){
  const [site, uid] = key.split(':');
  const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product:pid||null, p_status:status });
  if(error) return toast(errText(error));
  toast(status==='confirmed'?'Связь подтверждена':'Отмечено: в базе такого товара нет');
  S.st.open=null; S.st.cands=null; await loadSite(); render();
}

/* ---------- сотрудники ---------- */
/* ---------- расходы и внесения ---------- */
const CS = { dir:'out', cat:'', amount:'', comment:'', collector:'', photo:null, photoUrl:'', busy:false, cats:null, list:null, days:7 };
async function loadCash(){
  if(!S.posOn) return loadExp();
  if(!CS.cats){ const { data } = await sb.from('cash_categories').select('direction,name,sort').order('sort'); CS.cats = data || []; }
  const to = new Date(), from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate()-(CS.days-1));
  const [lst, bal] = await Promise.all([ sb.rpc('cash_moves_list', { p_stores: isBoss() ? selStores() : [S.store], p_from: from.toISOString(), p_to: to.toISOString() }), sb.rpc('cash_balances'), loadPosShift() ]);
  if(lst.error) toast(errText(lst.error)); CS.list = lst.data || []; CS.bal = bal.data || [];
}
async function cashPhoto(file){
  if(!file) return; CS.busy = true; render();
  try{
    const img = await createImageBitmap(file); const k = Math.min(1, 1600/Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k); c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    const path = `${S.store}/${new Date().toISOString().slice(0,10)}/${uuid()}.jpg`;
    const { error } = await sb.storage.from('cash-photos').upload(path, blob, { contentType:'image/jpeg' });
    if(error) throw error;
    CS.photo = path; CS.photoUrl = URL.createObjectURL(blob);
  }catch(err){ toast('Фото не загрузилось: '+errText(err)); }
  CS.busy = false; render();
}
async function openCashPhoto(path){
  const { data, error } = await sb.storage.from('cash-photos').createSignedUrl(path, 600);
  if(error) return toast(errText(error));
  modal(`<img src="${esc(data.signedUrl)}" alt="Фото" style="max-width:100%;border-radius:10px"><div class="row"><button class="btn" data-close>Закрыть</button></div>`);
}
/* касса Silver выключена: «Расходы» = наличные по тетрадям + журнал расходов магазинов (тетради → «Расходы магазинов») */
const EX = { per:'month', list:null };
function exRange(){ const d = new Date(), y = d.getFullYear(), m = d.getMonth(), iso = x => x.toLocaleDateString('sv-SE');
  return EX.per==='prev' ? [iso(new Date(y,m-1,1)), iso(new Date(y,m,0))] : EX.per==='q' ? [iso(new Date(y,m-2,1)), iso(d)] : [iso(new Date(y,m,1)), iso(d)]; }
async function loadExp(){ EX.list = null; const [f,t] = exRange();
  const [l] = await Promise.all([ sb.from('store_expenses').select('id,store_id,day,amount,category,comment').in('store_id', selStores()).gte('day', f).lte('day', t).order('day',{ascending:false}).limit(2000), DAY.cash ? null : loadCashStat() ]);
  if(l.error) toast(errText(l.error)); EX.list = l.data || []; if(!DAY.cash) DAY.cash = {}; }
function renderExp(){
  const L = EX.list, ids = selStores(), [f,t] = exRange(), sum = a => a.reduce((s,x)=>s+(+x.amount||0),0);
  const cats = {}; (L||[]).forEach(x => { const k = (x.category||'прочее').trim().toLowerCase(); cats[k] = (cats[k]||0) + (+x.amount||0); });
  const C = (DAY.cash||{});
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Расходы</h2>${(S.tabs||[]).some(x=>x[0]==='profit')?'<button class="btn small" data-goprofit>Аренда и постоянные расходы → «Рентабельность»</button>':''}</div>
  <h3 style="margin:14px 0 6px">Наличные в кассах <span class="meta">— по последней странице тетради + наличные продажи Wipon после неё</span></h3>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px">${ids.map(id => { const c = C[id]; return `<div class="card" style="padding:10px 12px"><div class="meta">${esc(storeName(id))}</div><div style="font-size:20px;font-weight:700" class="num">${!c||c.est_kzt==null?(DAY.cash?'нет данных':'…'):fmt(c.est_kzt)}${c&&+c.snap_usd?' · $'+(+c.snap_usd).toLocaleString('ru-RU'):''}</div></div>`; }).join('')}</div>
  <h3 style="margin:16px 0 6px">Журнал расходов магазинов <span class="meta">— хозрасходы из тетрадей (файл «Расходы магазинов»)</span></h3>
  <div class="filters">${[['month','Этот месяц'],['prev','Прошлый месяц'],['q','3 месяца']].map(([k,v])=>`<button class="btn small ${EX.per===k?'primary':''}" data-exper="${k}">${v}</button>`).join('')}<span class="meta" style="align-self:center">${new Date(f).toLocaleDateString('ru-RU')} — ${new Date(t).toLocaleDateString('ru-RU')}</span></div>
  ${!L?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">За этот период расходов нет</div>':`
  <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:8px"><span class="chip ok">Всего ${fmt(sum(L))}</span>${Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="chip">${esc(k)}: ${fmt(v)}</span>`).join('')}</div>
  <div class="scroll"><table class="mc"><thead><tr><th>Дата</th><th>Магазин</th><th>Категория</th><th>Сумма</th></tr></thead><tbody>
  ${L.slice(0,300).map(x=>`<tr><td class="num mc-t">${new Date(x.day).toLocaleDateString('ru-RU')}</td><td data-l="Магазин">${esc(storeName(x.store_id))}</td><td data-l="Категория">${esc(x.category||'—')}${x.comment?`<br><span class="meta">${esc(x.comment)}</span>`:''}</td><td class="num" data-l="Сумма">${fmt(x.amount)}</td></tr>`).join('')}</tbody></table></div>
  ${L.length>300?`<p class="meta">Показаны последние 300 из ${L.length}.</p>`:''}`}
  <p class="meta" style="margin-top:10px">Новые расходы пока ведутся в тетради и раз в месяц переносятся в файл «Расходы магазинов». Записывать расходы прямо в Silver можно будет, когда включится касса Silver.</p>`;
}
document.addEventListener('click', async e => { const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.exper && S.view==='cash'){ EX.per = t.dataset.exper; render(); await loadExp(); render(); }
  else if('goprofit' in t.dataset || 'gocash' in t.dataset){ const v = 'goprofit' in t.dataset ? 'profit' : 'cash'; S.view = v; (S.lastView ||= {})[groupOf(v)[0]] = v; render(); scrollTo(0,0); await loadView(); } });
function renderCash(){
  if(!S.posOn) return renderExp();
  const ro = isViewer(), open = S.posShift && S.posShift[S.store], inc = CS.cat.trim().toLowerCase()==='инкассация';
  const cats = (CS.cats||[]).filter(c=>c.direction===CS.dir);
  const ST = { ok:'', pending:'<span class="chip warn">ждёт подтверждения</span>', confirmed:'<span class="chip ok">подтверждено</span>', rejected:'<span class="chip zero">не подтверждено</span>' };
  const bal = (CS.bal||[]).filter(b => isBoss() ? selStores().includes(b.store) : b.store===S.store);
  const balTotal = bal.reduce((a,b)=>a+(+b.cash||0),0);
  $('#main').innerHTML = `<h2>Наличные в кассах</h2>
  ${!CS.bal?'<div class="empty">Загружаем…</div>':`<div class="kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:14px">
    ${bal.map(b=>`<div class="card" style="padding:12px"><div class="meta">${esc(storeName(b.store))}</div>
      <div style="font-size:20px;font-weight:700" class="num">${b.cash==null?'—':fmt(b.cash)}</div>
      <div class="meta">${b.open?'смена открыта с '+tm(b.at):b.at?'смена закрыта '+tm(b.at)+' · сумма на закрытии':'смен ещё не было'}${b.by?' · '+esc(b.by):''}</div>
      ${+b.today_out?`<div class="meta">расходы сегодня: ${fmt(b.today_out)}</div>`:''}${+b.pending_inc?`<div class="meta" style="color:var(--bad)">инкассация ждёт подтверждения: ${fmt(b.pending_inc)}</div>`:''}</div>`).join('')}
    ${bal.length>1?`<div class="card" style="padding:12px"><div class="meta">Итого по выбранным</div><div style="font-size:20px;font-weight:700" class="num">${fmt(balTotal)}</div></div>`:''}
  </div>`}
  <h2>Расходы и внесения</h2>
  <div class="grid2"><div>
   ${ro?'':open===false?`<div class="card row" style="flex-wrap:wrap;border-color:var(--bad)"><span>Смена не открыта — расходы записываются в открытую смену.</span><button class="btn primary" id="go-shift">Открыть смену</button></div>`:`<div class="card stack">
    <div class="seg" style="display:inline-flex;align-self:flex-start"><button data-csdir="out" aria-pressed="${CS.dir==='out'}">➖ Расход из кассы</button><button data-csdir="in" aria-pressed="${CS.dir==='in'}">➕ Внесение в кассу</button></div>
    <div class="label">${esc(storeName(S.store))}</div>
    <div class="filters" style="margin:0">${cats.map(c=>`<button class="btn small ${CS.cat===c.name?'primary':''}" data-cscat="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>
    <input id="cs-cat" placeholder="Или своя категория" value="${esc(CS.cat)}">
    <input id="cs-amount" type="number" min="1" inputmode="numeric" placeholder="Сумма, ₸" value="${esc(CS.amount)}">
    ${inc?`<input id="cs-collector" placeholder="Кто забирает деньги (имя, должность) *" value="${esc(CS.collector)}">`:''}
    <input id="cs-comment" placeholder="${CS.dir==='in'?'Комментарий: на что деньги (например, оплата закупа — что именно)':CS.cat==='Закуп'?'Что именно закупили':'Комментарий'}" value="${esc(CS.comment)}">
    <label class="stack" style="gap:4px"><span class="label">Фото ${inc?'записи в тетради / расписки — обязательно':'чека (по желанию)'}</span>
      <input type="file" id="cs-photo" accept="image/*" capture="environment"></label>
    ${CS.busy?'<span class="meta">Загружаем фото…</span>':CS.photoUrl?`<img src="${CS.photoUrl}" alt="" style="max-width:160px;border-radius:8px">`:''}
    ${inc?'<p class="meta" style="margin:0">Инкассация: запишите сумму и имя в тетрадь, сфотографируйте запись. Уведомление с фото сразу уйдёт владельцу в Telegram — пока там не нажмут «Деньги получены», инкассация отмечена как неподтверждённая.</p>':''}
    <button class="btn primary" id="cs-save" ${CS.busy?'disabled':''}>${CS.dir==='in'?'Записать внесение':'Записать расход'}</button>
   </div>`}
  </div><div>
   <h2>Журнал</h2>
   <div class="filters">${[[1,'Сегодня'],[7,'7 дней'],[30,'30 дней']].map(([k,v])=>`<button class="btn small ${CS.days===k?'primary':''}" data-csdays="${k}">${v}</button>`).join('')}</div>
   ${!CS.list?'<div class="empty">Загружаем…</div>':!CS.list.length?'<div class="empty">Записей нет</div>':`<div class="scroll"><table><tbody>
     ${CS.list.map(m=>`<tr><td class="num">${tm(m.created_at)}${isBoss()?`<br><span class="meta">${esc(storeName(m.store_id))}</span>`:''}</td>
       <td><b>${esc(m.category)}</b> ${ST[m.status]||''}${m.collector?`<br><span class="meta">забирает: ${esc(m.collector)}</span>`:''}${m.comment?`<br><span class="meta">${esc(m.comment)}</span>`:''}<br><span class="meta">${esc(m.by||'')}${m.confirmed_by_name?' · проверил(а) '+esc(m.confirmed_by_name):''}</span></td>
       <td class="num" style="color:${m.direction==='in'?'var(--ok)':'var(--bad)'}">${m.direction==='in'?'+':'−'}${fmt(m.amount)}</td>
       <td>${m.photo_path?`<button class="btn small" data-csph="${esc(m.photo_path)}">Фото</button>`:''}
         ${m.status==='pending'&&isBoss()&&!ro?`<button class="btn small primary" data-csok="${m.id}">Получено</button><button class="btn small" data-csno="${m.id}">Нет</button>`:''}</td></tr>`).join('')}
     </tbody></table></div>`}
  </div></div>`;
}

/* ---------- бонусные карты ---------- */
const BK = { brand:'sunshine', q:'', filter:'bonus', sort:'balance', off:0, stats:null, list:null, cur:null, card:null };
const KIND = { earn:'Начисление за покупку', spend:'Списание в чеке', birthday:'День рождения', import:'Перенос из Sagi', manual:'Ручная корректировка', burn:'Сгорание', return:'Возврат' };
async function loadBonus(){
  BK.list = null;
  const [st, ls_] = await Promise.all([ sb.rpc('bonus_stats', { p_brand:BK.brand }), sb.rpc('bonus_clients', { p_brand:BK.brand, p_q:BK.q, p_filter:BK.filter, p_sort:BK.sort, p_offset:BK.off, p_limit:50 }) ]);
  if(st.error) toast(errText(st.error)); if(ls_.error) toast(errText(ls_.error));
  BK.stats = st.data || {}; BK.list = ls_.data || { rows:[], total:0 };
}
async function openBonusClient(id){ BK.cur = id; BK.card = null; render(); const { data, error } = await sb.rpc('bonus_client', { p_customer:id, p_brand:BK.brand }); if(error) toast(errText(error)); BK.card = data; render(); }
const dshort = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
/* ---------- загрузка выгрузок Wipon: продажи и остатки ---------- */
const WU = { store:null, msg:'', last:null };
async function wuLoadLast(){ const { data } = await sb.rpc('wipon_last'); WU.last = data || {}; wuLoadSrv(); if(['sales','wh','day'].includes(S.view)) render(); }
/* обновление из Wipon на сервере (закладка один раз передаёт сеанс Wipon) — статус без токена */
async function wuLoadSrv(){ if(!S.me || S.me.role==='consultant') return; const { data } = await sb.functions.invoke('wipon_srv', { body:{ action:'status' } }).catch(() => ({})); if(data && !data.error){ WU.srv = data; if(['day','sales','wh','po'].includes(S.view)) render(); } }
/* история продаж 2025 года из Wipon: прогресс загрузки (для «как в прошлом году» в закупе) */
function wuBfLine(v){ const b = v && v.backfill; if(!b) return '';
  if(b.done) return ` <span class="chip ok" title="Загружено продаж: ${b.sales}, возвратов: ${b.refunds}">📚 история 2025 загружена${b.luna?'':' (без ИП «Луна»)'}</span>`;
  return ` <span class="chip" title="Загружается по ночам и между обновлениями, примерно 10–20 часов. Уже загружено продаж: ${b.sales}">📚 история 2025: ${b.pct}%${b.luna?'':' · ИП «Луна» ещё не подключено'}</span>`; }
function wuLyReady(){ const b = WU.srv && WU.srv.backfill; if(!b) return false; const ly = new Date(Date.now() - 365*864e5).toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'}); return b.done || b.ready_from <= ly; }
function wuSrvLine(){ const v = WU.srv; if(!v) return '';
  const hm = t => t ? new Date(t).toLocaleString('ru-RU',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Almaty' }) : '—';
  if(v.expired || (!v.active && v.set_at)) return `<div class="card" style="margin-top:12px;border-left:4px solid var(--bad)"><b>⚠ Сеанс Wipon закончился</b><br><span class="meta">Чеки и остатки из Wipon сейчас не приходят. ${S.me.role==='owner'?'Откройте console.wipon.kz и нажмите закладку Silver — сервер снова будет обновлять сам.':'Попросите владельца открыть Wipon и нажать закладку Silver.'}${v.last_ok_at?' Последнее обновление: '+hm(v.last_ok_at)+'.':''}</span></div>`;
  if(v.active) return `<span class="chip ok" title="${esc(v.last_error||'')}">🟢 Обновляется сервером · последнее обновление ${hm(v.last_ok_at)}</span>${v.last_error?` <span class="chip warn" title="${esc(v.last_error)}">была ошибка ${hm(v.last_error_at)}</span>`:''}${wuBfLine(v)}`;
  return ''; }
/* блок «Обновление данных из Wipon» для «Моего дня» владельца: когда последний раз пришли чеки и остатки + закладка */
/* Wipon — одна кнопка и одна галочка: «Все данные получены» / «Получены не все» + причина простыми словами */
function wuState(){ const v = WU.srv; if(!v) return null;
  const hm = t => t ? new Date(t).toLocaleString('ru-RU',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Almaty' }) : '—';
  const sn = ids => (ids||[]).map(i => { const x = S.allStores.find(s => s.id===i); return x ? (BRAND[x.brand]||'')+' '+x.address : ''; }).filter(Boolean).join(', ');
  const why = []; let bm = false;
  if(v.expired || !v.active){ why.push(v.set_at ? 'Сеанс Wipon закончился — нажмите закладку в Wipon' : 'Wipon не подключён — нажмите закладку в Wipon'); bm = true; }
  else {
    const old = !v.last_ok_at || Date.now() - new Date(v.last_ok_at) > 45*6e4;
    if(old) why.push('Давно не обновлялось — нажмите «Обновить сейчас»');
    for(const c of (v.cabs||[])){ if(c.legacy) continue; const cs = [...new Set((c.stores||[]).map(i => [4,5,7].includes(+i) ? 'Астана' : 'Алматы'))]; const w = cs.join(', ') || ('кабинет '+(c.company||c.emp));
      if(!c.ok) why.push(w+': ошибка Wipon');
      else if(c.noitems) why.push(w+': без списка товаров ('+c.noitems+' чек.) — выберите это ИП в Wipon и нажмите закладку'); }
  }
  return { ok: !why.length, why, bm, at: hm(v.last_ok_at) };
}
/* заказы Китай (1688) и Alibaba на главной: загрузка выгрузки одной кнопкой + дата последнего заказа в Silver */
const CHN = { last:null, loading:false };
async function cnLoad(){ if(CHN.loading) return; CHN.loading = true;
  const { data } = await sb.from('purchase_orders').select('created_at,source').in('source',['1688','alibaba']).order('created_at',{ ascending:false }).limit(1);
  CHN.last = (data||[])[0] || { none:true }; CHN.loading = false; if(S.view==='day') render(); }
function chinaHtml(){
  if(!S.me || !['owner','purchaser'].includes(S.me.role)) return '';
  if(!CHN.last) cnLoad();
  const L = CHN.last && !CHN.last.none ? new Date(CHN.last.created_at).toLocaleDateString('ru-RU',{ day:'2-digit', month:'2-digit', timeZone:'Asia/Almaty' }) : null;
  return `<div class="card" style="margin:12px 0"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap">
    <span><b>Заказы Китай и Alibaba</b> <span class="meta">${L ? '· последний заказ в Silver от '+L : CHN.last ? '· заказов ещё нет' : ''}</span></span>
    <label class="btn small primary" style="cursor:pointer">⬆ Загрузить выгрузку<input type="file" id="po-1688" accept=".xlsx,.xls,.csv" hidden></label></div>
    ${PO.imp?`<div class="meta" style="margin-top:6px">${esc(PO.imp)}</div>`:`<div class="meta" style="margin-top:6px">1688: «已买到的货品» → «导出». Alibaba: My Orders → Export. Файл можно загрузить любой — повторы Silver пропустит.</div>`}</div>`;
}
function wiponSyncHtml(){
  if(!S.me || !['owner','manager','purchaser'].includes(S.me.role)) return '';
  const st = wuState(), busy = WU.pulling;
  const btn = `<button class="btn small${st&&!st.ok?' primary':''}" id="wu-pull" ${busy?'disabled':''}>${busy?'⏳ Обновляем…':'🔄 Обновить сейчас'}</button>`;
  if(!st) return `<div class="card wu-one" style="margin:12px 0"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><span><b>Данные Wipon</b> <span class="meta">проверяем…</span></span>${btn}</div></div>`;
  return `<div class="card wu-one ${st.ok?'wu-ok':'wu-bad'}" style="margin:12px 0"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap">
    <span style="font-size:1.05em">${st.ok?`✅ <b>Все данные получены</b> <span class="meta">· последнее обновление ${st.at} · сервер обновляет сам каждые 15 мин</span>`:`⚠️ <b>Получены не все данные</b> <span class="meta">· последнее обновление ${st.at}</span>`}</span>${btn}</div>
    ${st.ok?'':`<ul class="meta" style="margin:8px 0 0 18px;padding:0">${st.why.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`}
    ${WU.pmsg?`<div class="meta" style="margin-top:6px">${esc(WU.pmsg)}</div>`:''}
    ${st.bm&&['owner','manager','purchaser'].includes(S.me.role)?`<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px">${WU.bm?`<a class="btn small primary" href="${esc(WU.bm)}" title="Перетащите на панель закладок" onclick="event.preventDefault();toast('Перетащите эту кнопку на панель закладок Chrome')">⬆ Silver ← Wipon</a><span class="meta">← перетащите на панель закладок (старую удалите)</span>`:`<button class="btn small" id="wu-bm">Получить закладку</button>`}</div>`:''}</div>`;
}
document.addEventListener('click', async e => { const t = e.target.closest && e.target.closest('#wu-pull'); if(!t || WU.pulling) return;
  WU.pulling = true; WU.pmsg = ''; render();
  const { data, error } = await sb.functions.invoke('wipon_srv', { body:{ action:'pull_now' } }).catch(err => ({ error:err }));
  WU.pulling = false;
  if(error || !data) WU.pmsg = 'Не получилось: ' + errText(error || 'нет ответа');
  else if(data.error && !data.sales) WU.pmsg = data.error;
  else WU.pmsg = 'Новых чеков: ' + (data.sales||0) + (data.refunds ? ', возвратов: ' + data.refunds : '') + ' · ' + new Date().toLocaleTimeString('ru-RU',{ hour:'2-digit', minute:'2-digit' });
  await wuLoadSrv(); if(S.view==='day' && typeof loadPulse==='function' && S.me.role==='owner') loadPulse(); render(); });
document.addEventListener('toggle', e => { if(e.target && e.target.id==='wu-day') WU.dopen = e.target.open; }, true);
const wuDt = v => v ? new Date(v).toLocaleString('ru-RU',{ day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Almaty' }) : '—';
const wiponOk = () => S.me && (['owner','manager','purchaser'].includes(S.me.role));
function wiponUpHtml(kind){
  return ''; // загрузка Excel из Wipon больше не нужна — данные приходят закладкой (см. «Мой день»)
  if(!wiponOk()) return '';
  const st = WU.store || S.store, L = WU.last || {}, last = id => L[kind+':'+id];
  if(!WU.last && !WU.loading){ WU.loading = true; wuLoadLast().finally(()=>{ WU.loading = false; }); }
  const allAt = S.allStores.map(x=>last(x.id)&&last(x.id).at).filter(Boolean).sort();
  return `<details class="card" style="margin-bottom:10px" ${WU.open===kind?'open':''} data-wuopen="${kind}"><summary><b>⬆ ${kind==='sales'?'Загрузить продажи из Wipon':'Обновить остатки из Wipon'}</b> <span class="meta">— последняя загрузка: ${allAt.length?wuDt(allAt[allAt.length-1]):'—'}</span></summary>
    <div class="scroll" style="margin-top:8px"><table><thead><tr><th>Магазин</th><th>Последняя загрузка</th>${kind==='sales'?'<th>Продажи в Silver по</th>':''}<th>Кто загрузил</th></tr></thead><tbody>
      ${S.allStores.map(x=>{ const l = last(x.id); return `<tr><td>${esc(BRAND[x.brand]+' · '+x.address)}</td><td class="num">${l?wuDt(l.at):'—'}</td>${kind==='sales'?`<td class="num">${l&&l.to?wuDt(l.to):'—'}</td>`:''}<td>${l&&l.by?esc(l.by):'<span class="meta">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="stack" style="margin-top:8px">
      ${kind==='sales'&&['owner','manager','purchaser'].includes(S.me.role)?`<div class="cust stack" style="gap:6px"><b>⚡ Автозагрузка прямо из кабинета Wipon — без Excel</b>
        <span class="meta">1) Нажмите «Получить закладку» и перетащите появившуюся кнопку на панель закладок Chrome. 2) Откройте console.wipon.kz и нажмите эту закладку. Чеки и возвраты за последние 3 дня сразу попадут в Silver, дальше — каждые 15 минут, а остатки по всем складам — раз в час, пока вкладка Wipon открыта. Внизу справа в Wipon видно время последней загрузки. Переключитесь в кабинете на второе ИП (внизу) хотя бы раз, пока работает закладка, — дальше оба ИП обновляются вместе. Если закладку обновили — перезагрузите страницу Wipon и нажмите её снова.</span>
        <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">${WU.bm?`<a class="btn small primary" href="${esc(WU.bm)}" title="Перетащите на панель закладок" onclick="event.preventDefault();toast('Перетащите эту кнопку на панель закладок Chrome')">⬆ Silver ← Wipon</a><span class="meta">← перетащите на панель закладок</span>`:`<button class="btn small" id="wu-bm">Получить закладку</button>`}</div></div>`:''}
      <span class="meta">${kind==='sales'?'Выгрузите продажи магазина из Wipon за любой период и загрузите файл. Дубликатов не будет: Silver проверяет номер каждого чека Wipon и добавляет только те, которых ещё нет. Даже если тот же файл или пересекающийся период загрузят случайно ещё раз — повторные чеки просто пропустятся.':'Выгрузите остатки магазина из Wipon и загрузите файл. Остатки этого магазина в Silver станут такими же, как в файле. Новые штрихкоды добавятся в базу товаров.'}</span>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
        <select id="wu-store-${kind}">${kind==='sales'?`<option value="" ${!WU.storeSales?'selected':''}>Магазин определить автоматически</option>`:`<option value="" ${!WU.store?'selected':''}>Магазин определить автоматически</option>`}${S.allStores.map(x=>`<option value="${x.id}" ${x.id===(kind==='sales'?WU.storeSales:WU.store)?'selected':''}>${esc(BRAND[x.brand]+' · '+x.city+', '+x.address)}</option>`).join('')}</select>
        ${kind==='stock'?`<label class="meta"><input type="checkbox" id="wu-zero" checked> товары, которых нет в файле, обнулить</label>`:''}
        <label class="btn small primary" style="cursor:pointer">Выбрать файлы Excel (можно сразу все 7)<input type="file" id="wu-file-${kind}" accept=".xlsx,.xls,.csv" multiple hidden></label></div>
      <span class="meta">${kind==='sales'?'Магазин Silver определяет сам по продавцу в файле: «Мун А» — MOON Алматы, «Мун» — MOON Астана; если не понял — по уже загруженным чекам.':'Склад Silver берёт из самого файла: «Мун А» — MOON Алматы, «Мун» — MOON Астана, Sunshine — по адресу склада.'} Если не получится, напишет, и тогда выберите магазин вручную и загрузите тот файл ещё раз.</span>
      ${WU.open===kind&&WU.msg?`<div class="cust">${WU.msg}</div>`:''}</div></details>`;
}
/* закладка «Silver ← Wipon»: работает внутри кабинета console.wipon.kz. Каждые 15 минут: чеки и возвраты за 3 дня; раз в час — остатки по складам.
   Все ИП, которые хоть раз были открыты в кабинете при работающей закладке, обновляются вместе. */
function silverWiponSync(K){
  if(window.__ss){ window.__ss.run(); return; }
  const F = 'https://ottuadjdksxipfjytlyv.supabase.co/functions/v1/ingest?action=';
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;background:#1d2b4f;color:#fff;padding:8px 12px;border-radius:10px;font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:420px';
  document.body.appendChild(b);
  const S = t => { t = ' ' + String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[_.,;:()"«»\-]+/g, ' ').replace(/\s+/g, ' ') + ' '; const W = '(?![а-яa-z])';
    if(new RegExp('(мун|moon)\\s*(а|a)' + W).test(t) || /(мун|moon)\s*алмат/.test(t)) return 6;
    if(/(мун|moon)\s*астан/.test(t) || new RegExp('(мун|moon)' + W).test(t)) return 7;
    if(/курмангаз/.test(t)) return 1; if(/толе\s*би/.test(t)) return 2; if(/гагарин/.test(t)) return 3; if(/республик/.test(t)) return 4; if(/достык/.test(t)) return 5; return null; };
  const day = x => new Date(x.getTime() + 18e6).toISOString().slice(0, 10);
  const L = k => { try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(_){ return null; } }, P = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
  const api = async p => { const tk = JSON.parse(localStorage.getItem('vuex')).user.token; const r = await fetch('https://api.wipon.kz' + p, { headers:{ Accept:'application/json', Authorization:'Bearer ' + tk } }); if(!r.ok) throw Error('Wipon ' + r.status); return r.json(); };
  const all = async p => { const out = []; let pg = 1, total = null; for(;;){ const j = await api(p + '&page=' + pg); out.push(...(j.data || [])); total = j.meta ? j.meta.total : null; if(!j.meta || pg >= j.meta.last_page) break; pg++; } return { rows:out, total }; };
  const post = async (a, st, rows) => { const r = await fetch(F + a, { method:'POST', headers:{ 'content-type':'application/json', 'x-ingest':K }, body:JSON.stringify({ store:+st, rows }) }); const j = await r.json(); if(j.error) throw Error(j.error); return j; };
  async function one(emp){
    const now = new Date(), rng = 'date_from=' + day(new Date(now - 2 * 864e5)) + 'T00:00:00%2B05:00&date_to=' + day(now) + 'T23:59:59%2B05:00&per_page=100';
    let ns = 0, nr = 0, nst = 0;
    const sales = (await all('/v1/employee/' + emp + '/sale?' + rng)).rows, by = {};
    for(const s of sales){ const st = S(s.stock && s.stock.name) || S(s.employee_name); if(!st) continue; const pay = (s.payments || []).map(x => x.name).join(',');
      for(const it of s.item_sale || []){ const q = +it.quantity || 1; (by[st] = by[st] || []).push({ no:String(s.id), emp:s.employee_name, at:s.created_at, pay, name:it.item && it.item.title, cat:it.item && it.item.item_category_name, bc:it.item && it.item.barcode, qty:q, total:Math.round((+it.price || +it.selling_price || 0) * q - (+it.discount_amount || 0)), ret:false }); } }
    for(const st in by) ns += +(await post('wipon_sales', st, by[st])).new || 0;
    const refs = (await all('/v1/employee/' + emp + '/refund?' + rng)).rows, rb = {};
    for(const r of refs){ const st = S(typeof r.stock === 'string' ? r.stock : r.stock && r.stock.name) || S(r.employee_name); if(!st) continue;
      (rb[st] = rb[st] || []).push({ id:r.id, at:r.created_at, emp:r.employee_name, pay:r.payment_name || '', amount:+r.amount, items:(r.item_refund || []).map(i => ({ bc:i.item && i.item.barcode, name:i.item && i.item.title, qty:+i.quantity, total:+i.sum })) }); }
    for(const st in rb) nr += +(await post('wipon_refunds', st, rb[st])).new || 0;
    const lk = 'silver_stock_at_' + emp;
    if(Date.now() - (L(lk) || 0) > 36e5){
      const stocks = (await api('/v2/employee/' + emp + '/stock')).data || [];
      for(const k of stocks){ const st = S(k.name); if(!st) continue;
        const x = await all('/v2/employee/' + emp + '/item?type=0&stock_id=' + k.id + '&per_page=250&positive_balance=1&is_weighted=0&trashed=0&only_parents=1');
        if(x.total != null && x.rows.length < x.total) continue; // загрузилось не всё — остатки не трогаем
        const rows = x.rows.filter(i => i.barcode).map(i => ({ bc:i.barcode, name:i.title, qty:+i.quantity, cost:+i.previous_purchase_price || null, price:+i.selling_price || null, cat:i.item_category_name }));
        if(rows.length){ await post('wipon_stock', st, rows); nst++; } }
      try{ // смены Wipon за 3 дня → Silver (для остатка наличных в кассе)
        const d3 = day(new Date(now - 3 * 864e5)), sh = await api('/v1/employee/' + emp + '/shift?per_page=100&page=1&date_from=' + d3 + 'T00:00:00%2B05:00&date_to=' + day(now) + 'T23:59:59%2B05:00');
        const srows = (sh.data || []).map(r => { const x = JSON.parse(JSON.stringify(r)); if(x.employee && typeof x.employee === 'object') delete x.employee.company; if(x.stock && typeof x.stock === 'object') x.stock = { id:x.stock.id, name:x.stock.name }; return x; });
        if(srows.length) await fetch('https://ottuadjdksxipfjytlyv.supabase.co/functions/v1/wipon_hist', { method:'POST', headers:{ 'content-type':'application/json', 'x-ingest':K }, body:JSON.stringify({ kind:'shift', emp, rows:srows }) });
      }catch(_){ /* смены не критичны */ }
      P(lk, Date.now()); }
    return [ns, nr, nst];
  }
  async function run(){
    try{
      b.textContent = 'Silver: обновляем данные из Wipon…';
      const cur = JSON.parse(localStorage.getItem('vuex')).employee.item.id, E = L('silver_wipon_emps') || [];
      if(!E.includes(cur)){ E.push(cur); P('silver_wipon_emps', E); }
      let t = [0, 0, 0]; const bad = [];
      for(const e of E){ try{ const r = await one(e); t = t.map((x, i) => x + r[i]); }catch(err){ bad.push(err.message); } }
      b.textContent = 'Silver ✓ ' + new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }) + ' · новых чеков: ' + t[0] + ' · возвратов: ' + t[1] + (t[2] ? ' · остатки обновлены (' + t[2] + ' скл.)' : '') + ' · кабинетов ИП: ' + E.length + (bad.length ? ' · ошибка: ' + bad[0] : '') + ' · следующая через 15 мин';
    }catch(e){ b.textContent = 'Silver: ошибка — ' + e.message + ' (повторим через 15 мин)'; }
  }
  // новый режим: передаём сеанс Wipon серверу Silver — дальше он обновляет сам, вкладку можно закрыть
  const SRV = 'https://ottuadjdksxipfjytlyv.supabase.co/functions/v1/wipon_srv';
  const call = async body => { const r = await fetch(SRV, { method:'POST', headers:{ 'content-type':'application/json', 'x-ingest':K }, body:JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if(!r.ok || j.error) throw Error(j.error || ('Silver ' + r.status)); return j; };
  async function srv(){
    b.textContent = 'Silver: передаём сеанс Wipon серверу…';
    const v = JSON.parse(localStorage.getItem('vuex')), cur = v.employee.item.id, E = L('silver_wipon_emps') || [];
    if(!E.includes(cur)){ E.push(cur); P('silver_wipon_emps', E); }
    const it = (v.employee && v.employee.item) || {}, co = String((it.company && (it.company.name || it.company.title)) || it.company_name || (v.company && (v.company.name || v.company.title)) || '');
    const s = await call({ action:'set_token', token:v.user.token, emps:E, cos:{ [cur]: co } });
    b.textContent = 'Silver: сеанс передан (кабинетов ИП: ' + s.cabinets + '), загружаем данные…';
    let p = null; try{ p = await call({ action:'pull_now' }); }catch(_){ /* сервер повторит сам через 15 мин */ }
    b.textContent = 'Silver ✓ будет обновляться сам каждые 15 минут — вкладку можно закрыть' + (p && p.sales != null ? ' · новых чеков: ' + p.sales + ' · возвратов: ' + p.refunds : '') + ' · переключитесь по очереди на каждое ИП (включая ИП «Луна») и нажмите закладку ещё раз';
  }
  srv().then(() => { window.__ss = { run: () => srv().catch(e => { b.textContent = 'Silver: ' + e.message; }) }; })
    .catch(e => { b.textContent = 'Silver: сервер не принял сеанс (' + e.message + ') — обновляем из этой вкладки'; window.__ss = { run }; run(); setInterval(run, 9e5); });
}
function wiponBookmarklet(key){ return 'javascript:' + encodeURIComponent('(' + silverWiponSync.toString() + ')(' + JSON.stringify(key) + ')'); }
document.addEventListener('click', async e => { const t = e.target.closest('button'); if(!t || t.id!=='wu-bm') return; t.disabled = true;
  const { data, error } = await sb.rpc('wipon_sync_key'); t.disabled = false; if(error || !data) return toast(error ? errText(error) : 'Нет доступа');
  WU.bm = wiponBookmarklet(data); render(); });
function wuNorm(h){ return String(h==null?'':h).toLowerCase().replace(/\s+/g,' ').trim(); }
function wuCol(H, tests, not){ for(const t of tests){ const i = H.findIndex(h => (typeof t==='function' ? t(h) : h.includes(t)) && !(not||[]).some(n=>h.includes(n))); if(i>=0) return i; } return -1; }
function wuDate(v){ if(v instanceof Date){ const p = n => String(n).padStart(2,'0'); return `${v.getFullYear()}-${p(v.getMonth()+1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`; }
  const m = String(v||'').trim().match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})[ ,T]*(\d{1,2})?:?(\d{2})?:?(\d{2})?/); if(m){ const y = m[3].length===2 ? '20'+m[3] : m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')} ${(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:${m[6]||'00'}`; }
  const m2 = String(v||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/); if(m2) return `${m2[1]}-${m2[2]}-${m2[3]} ${m2[4]}:${m2[5]}:${m2[6]||'00'}`; return null; }
const wuNum = v => typeof v==='number' ? v : +String(v??'').replace(/\s/g,'').replace(',','.').replace(/[^\d.\-]/g,'') || 0;
async function wuRead(file){
  await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const wb = XLSX.read(await file.arrayBuffer(), { type:'array', cellDates:true });
  const A = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:true, defval:null });
  const hi = A.slice(0, 25).findIndex(r => (r||[]).some(c => /штрих/.test(wuNorm(c))));
  if(hi < 0) throw new Error('В файле не нашлась колонка со штрихкодом — это точно выгрузка из Wipon?');
  const H = A[hi].map(wuNorm), rows = A.slice(hi+1).filter(r => r && r.some(c => c!=null && c!==''));
  const wc = H.findIndex(h => /склад|магазин|точка/.test(h));
  const head = A.slice(0, hi).flat().filter(c => c!=null && c!=='').map(String);
  const col = wc>=0 ? [...new Set(rows.slice(0, 50).map(r => r[wc]).filter(Boolean).map(String))] : [];
  return { H, rows, place: [...col, ...head, wb.SheetNames[0]].join(' | '), fname: file.name };
}
// Склад по тексту внутри файла: «Мун А» = MOON Алматы, «Мун» = MOON Астана, Sunshine — по адресу
function wuStoreFromText(t){
  const s = ' ' + String(t||'').toLowerCase().replace(/ё/g,'е').replace(/[_.,;:()"«»\-]+/g,' ').replace(/\s+/g,' ') + ' ';
  const W = '(?![а-яa-z])';
  if(new RegExp('(мун|moon)\\s*(а|a)'+W).test(s) || /(мун|moon)\s*алмат/.test(s)) return 6;
  if(/(мун|moon)\s*астан/.test(s) || new RegExp('(мун|moon)'+W).test(s)) return 7;
  const A = [[1,/курмангаз/],[2,/толе\s*би/],[3,/гагарин/],[4,/республик/],[5,/достык/]];
  const hit = A.filter(([,r]) => r.test(s)); return hit.length===1 ? hit[0][0] : null;
}
async function wuImportMany(kind, files){
  const sel = $('#wu-store-'+kind).value; if(sel && files.length>1) toast('Файлов несколько — магазин для каждого Silver определит сам'); if(kind==='sales') WU.storeSales = sel ? +sel : null; else WU.store = sel ? +sel : null; WU.open = kind; const out = [];
  for(let k=0; k<files.length; k++){ WU.pre = files.length>1 ? `Файл ${k+1} из ${files.length} «${esc(files[k].name)}»: ` : ''; await wuImport(kind, files[k], sel && files.length===1 ? +sel : null); out.push(WU.msg); }
  WU.pre = ''; WU.msg = out.join('<br>'); await wuLoadLast(); render();
}
async function wuImport(kind, file, forceStore){
  let store = forceStore || null; const zero = !!($('#wu-zero')||{}).checked; WU.open = kind; WU.msg = (WU.pre||'')+'Читаем файл…'; render();
  try{
    const { H, rows, place, fname } = await wuRead(file), name = c => c>=0 ? H[c] : '—';
    if(kind==='sales'){
      const K = { no: wuCol(H, [h=>/продаж/.test(h)&&/(номер|№|id)/.test(h), h=>/чек/.test(h)&&/(номер|№)/.test(h), 'номер', '№'], ['фиск']), emp: wuCol(H, ['продавец','сотрудник','кассир']),
        at: wuCol(H, ['дата']), pay: wuCol(H, ['оплат']), nm: wuCol(H, ['наимен','товар','назван'], ['штрих','катег','колич']), cat: wuCol(H, ['категор']), bc: wuCol(H, ['штрих']),
        qty: wuCol(H, ['колич','кол-во','кол.'], ['сумм']), total: wuCol(H, ['сумма','итого','стоимость'], ['скид','себест']), ret: wuCol(H, ['возврат']) };
      if(K.no<0 || K.at<0 || K.bc<0 || K.total<0) throw new Error(`Не нашлись нужные колонки (номер продажи: ${name(K.no)}, дата: ${name(K.at)}, штрихкод: ${name(K.bc)}, сумма: ${name(K.total)}). Пришлите файл в чат — я подстрою загрузку.`);
      const R = rows.map(r => ({ no: String(r[K.no]??'').replace(/\D/g,''), emp: K.emp>=0 ? r[K.emp] : null, at: wuDate(r[K.at]), pay: K.pay>=0 ? String(r[K.pay]??'') : '', name: K.nm>=0 ? r[K.nm] : null,
        cat: K.cat>=0 ? r[K.cat] : null, bc: String(r[K.bc]??'').trim(), qty: K.qty>=0 ? wuNum(r[K.qty]) || 1 : 1, total: wuNum(r[K.total]), ret: K.ret>=0 ? /^(да|yes|true|1)$/i.test(String(r[K.ret]??'').trim()) : false }))
        .filter(r => r.no && r.at);
      if(!R.length) throw new Error('В файле нет строк продаж');
      const nos = [...new Set(R.map(r=>r.no))], dates = R.map(r=>r.at).sort();
      // в одном файле Wipon бывают чеки разных магазинов (один ИП = несколько точек): делим по продавцу
      const stOf = r => r.emp ? wuStoreFromText(r.emp) : null;
      const bySt = {}; R.forEach(r => { const st = stOf(r); if(st) (bySt[st] ||= []).push(r); });
      const sts = Object.keys(bySt).map(Number), unk = R.filter(r => !stOf(r));
      let groups;
      if(sts.length>1 || (sts.length===1 && store && store!==sts[0] && !unk.length)){
        if(store && !(sts.length===1 && sts[0]===store)) WU.pre = (WU.pre||'') + `в файле чеки нескольких магазинов — разложили по продавцам (выбранный магазин не применён). `;
        if(unk.length){ const ue = [...new Set(unk.map(r=>String(r.emp||'не указан')))];
          if(!store) throw new Error(`в файле несколько магазинов, и у части чеков продавец не опознан (${esc(ue.join(', '))}). Выберите магазин для них и загрузите файл ещё раз.`);
          (bySt[store] ||= []).push(...unk); }
        groups = Object.entries(bySt).map(([st, rows]) => [+st, rows]);
      } else {
        if(!store && sts.length===1 && !unk.length){ store = sts[0]; WU.pre = (WU.pre||'') + `${esc(storeName(store))} (по продавцу) — `; }
        if(!store){ const emps = [...new Set(R.map(r=>r.emp).filter(Boolean).map(String))];
          const { data:det, error:de } = await sb.rpc('wipon_detect_store', { p_nos: nos.slice(0, 3000), p_emps: emps }); if(de) throw de;
          if(!det || !det.store) throw new Error(`не удалось понять, какой это магазин (продавцы в файле: ${esc(emps.join(', ')||'не указаны')}). Выберите магазин в списке и загрузите этот файл ещё раз.`);
          store = det.store; WU.pre = (WU.pre||'') + `${esc(storeName(store))} (определён ${det.how}) — `; }
        groups = [[store, R]];
      }
      WU.msg = (WU.pre||'')+`нашли ${nos.length} чеков (${R.length} строк) за ${dates[0].slice(0,10)} — ${dates[dates.length-1].slice(0,10)}. Загружаем…`; render();
      const res = [];
      for(const [gst, GR] of groups){
        const tot = { new:0, skipped:0, returns:0, new_products:0 }, gnos = [...new Set(GR.map(r=>r.no))];
        for(let i=0; i<gnos.length; i+=400){
          const part = new Set(gnos.slice(i, i+400)), { data, error } = await sb.rpc('wipon_sales_import', { p_store:gst, p_rows: GR.filter(r=>part.has(r.no)) });
          if(error) throw error; for(const k in tot) tot[k] += +(data||{})[k]||0;
          WU.msg = (WU.pre||'')+`${esc(storeName(gst))}: загружаем… ${Math.min(i+400, gnos.length)} из ${gnos.length} чеков`; render();
        }
        res.push(`✅ ${esc(storeName(gst))}: новых чеков ${tot.new}${tot.returns?', из них с возвратом '+tot.returns:''}; уже были в Silver и пропущены — ${tot.skipped}.${tot.new_products?` Новых товаров добавлено в базу: ${tot.new_products} (проверьте их в «Номенклатуре»).`:''}`);
      }
      WU.msg = (WU.pre||'') + res.join('<br>');
      if(S.view==='sales'){ await loadSales(); }
    } else {
      const K = { bc: wuCol(H, ['штрих']), nm: wuCol(H, ['наимен','товар','назван'], ['штрих','катег']), qty: wuCol(H, ['остат','колич','кол-во'], ['сумм','стоим']),
        cost: wuCol(H, ['себестоим','закуп']), price: wuCol(H, ['розн','цена прод','цена'], ['закуп','себест']), cat: wuCol(H, ['категор']) };
      if(K.bc<0 || K.qty<0) throw new Error(`Не нашлись колонки штрихкода или остатка (штрихкод: ${name(K.bc)}, остаток: ${name(K.qty)}). Пришлите файл в чат — я подстрою загрузку.`);
      const R = rows.map(r => ({ bc: String(r[K.bc]??'').trim(), name: K.nm>=0 ? r[K.nm] : null, qty: wuNum(r[K.qty]), cost: K.cost>=0 ? wuNum(r[K.cost]) || null : null, price: K.price>=0 ? wuNum(r[K.price]) || null : null, cat: K.cat>=0 ? r[K.cat] : null }))
        .filter(r => r.bc);
      if(!R.length) throw new Error('В файле нет строк с товарами');
      if(!store){ store = wuStoreFromText(place) || wuStoreFromText(fname);
        if(!store) throw new Error(`в файле не написано, какой это склад${place.trim()?` (нашли текст: «${esc(place.slice(0,120))}»)`:''}. Выберите магазин в списке и загрузите этот файл ещё раз.`);
        WU.pre = (WU.pre||'') + `${esc(storeName(store))} (склад указан в файле) — `; }
      WU.msg = (WU.pre||'')+`нашли ${R.length} позиций, ${R.reduce((a,r)=>a+r.qty,0)} шт. Обновляем остатки…`; render();
      const { data, error } = await sb.rpc('wipon_stock_import', { p_store:store, p_rows:R, p_zero_missing: zero });
      if(error) throw error;
      WU.msg = (WU.pre||'')+`✅ остатки обновлены · ${esc(storeName(store))}: позиций в файле ${data.positions} (${data.units} шт.), изменилось ${data.changed}${data.zeroed?', обнулено отсутствующих в файле '+data.zeroed:''}.${data.new_products?` Новых товаров добавлено в базу: ${data.new_products}.`:''}`;
      if(S.view==='wh' && S.wmode==='stock'){ await loadStockView(); }
    }
  }catch(e){ WU.msg = (WU.pre||'')+'❌ '+esc(errText(e)); }

}
document.addEventListener('change', async e => { const id = e.target.id||'';
  if(['sf-from','sf-to','sf-kind'].includes(id)){ const F = (S.sf ||= { from:'', to:'', kind:'', lim:100 }); F[id.slice(3)] = e.target.value; F.lim = 100; await loadSales(); render(); return; }
  const m = id.match(/^wu-file-(sales|stock)$/); if(m && e.target.files[0]){ const F = [...e.target.files]; e.target.value=''; wuImportMany(m[1], F); }
  if(id==='wu-store-sales') WU.storeSales = e.target.value ? +e.target.value : null; else if(id==='wu-store-stock') WU.store = e.target.value ? +e.target.value : null; });
document.addEventListener('toggle', e => { const d = e.target; if(d.dataset && d.dataset.wuopen){ WU.open = d.open ? d.dataset.wuopen : (WU.open===d.dataset.wuopen ? null : WU.open); } }, true);
/* ---------- контент-план: идеи → пост → дата выкладки ---------- */
const CT = { brand:'moon', list:null, ai:null, busy:'', add:false, ig:null, sure:'' };
const IG_NAME = { moon:'moon.collection.kz', sunshine:'sunshine_jewelry_kz' };
const CT_FMT = { reels:'Рилс', carousel:'Карусель', stories:'Сторис', photo:'Фото' };
const ctEdit = () => S.me && ['owner','manager','purchaser'].includes(S.me.role);
const ctLocal = v => v ? new Date(v).toLocaleString('sv-SE',{ timeZone:'Asia/Almaty' }).slice(0,16).replace(' ','T') : '';
const ctNice = v => v ? new Date(v).toLocaleString('ru-RU',{ timeZone:'Asia/Almaty', weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'дата не выбрана';
async function loadContent(){
  const [l, st] = await Promise.all([ sb.rpc('content_list', { p_brand:CT.brand }), CT.ai===null ? sb.functions.invoke('content', { body:{ action:'status' } }) : null ]);
  if(l.error) toast(errText(l.error)); CT.list = l.data || [];
  if(st) CT.ai = !!(st.data && st.data.ai);
  if(CT.banned==null){ const b = await sb.rpc('content_banned_get'); CT.banned = b.data || ''; }
  if(CT.ig===null){ const r = await sb.functions.invoke('ig', { body:{ action:'status' } }); CT.ig = (r.data && r.data.brands) ? r.data : { brands:{} }; }
}
async function igCall(body){
  const { data, error } = await sb.functions.invoke('ig', { body });
  if(error){ let m = error.message; try{ m = (await error.context.json()).error || m; }catch(_){} throw new Error(m); }
  return data;
}
/* фото для Instagram: приводим к JPEG 1080×1350 (4:5) и кладём в публичное хранилище ig-media */
async function igPrep(src){
  const img = await new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
  x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); if(!blob) throw new Error('canvas');
  const path = CT.brand + '/' + crypto.randomUUID() + '.jpg';
  const { error } = await sb.storage.from('ig-media').upload(path, blob, { contentType:'image/jpeg' }); if(error) throw error;
  return sb.storage.from('ig-media').getPublicUrl(path).data.publicUrl;
}
async function ctMediaAdd(c, srcs){
  const add = [];
  for(const s of srcs){ try{ add.push({ url: await igPrep(s) }); }catch(_){ if(typeof s==='string') add.push({ url:s, raw:true }); else toast('Не удалось обработать фото'); } }
  const media = [...(c.media||[]), ...add].slice(0, 10);
  const { error } = await sb.rpc('content_save', { p:{ id:c.id, media } }); if(error) throw error; c.media = media;
  if(add.some(m=>m.raw)) toast('Фото добавлено как есть — Instagram примет его, только если пропорции от 4:5 до 1.91:1');
}
function ctMedia(c, ed){
  const M = c.media || [];
  return `<div class="stack" style="gap:4px"><span class="label">Фото к посту ${M.length?`(${M.length}${c.format==='carousel'?' из 10':''})`:''}</span>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">${M.map((m,i)=>`<span style="position:relative;display:inline-block"><img src="${esc(m.url)}" alt="" style="width:72px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">${ed?`<span class="row" style="position:absolute;left:2px;right:2px;bottom:2px;gap:2px">${i?`<button class="btn small" data-ctmv="${c.id}:${i}:-1" style="min-height:24px;padding:0 6px">←</button>`:''}<button class="btn small" data-ctrm="${c.id}:${i}" style="min-height:24px;padding:0 6px">✕</button></span>`:''}</span>`).join('') || '<span class="meta">Пока нет фото — без них пост не выложить</span>'}</div>
    ${ed?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">${(c.products||[]).filter(p=>p.photo_url).map(p=>`<button class="btn small" data-ctpp="${c.id}:${p.id}" title="${esc(p.name)}">+ фото «${esc(p.name.slice(0,18))}»</button>`).join('')}
      <label class="btn small" style="cursor:pointer">+ Загрузить<input type="file" accept="image/*" multiple data-ctup="${c.id}" hidden></label>${CT.busy==='m'+c.id?'<span class="meta">Готовим фото…</span>':''}</div>`:''}</div>`;
}
function ctIgBar(){
  const b = (CT.ig && CT.ig.brands || {})[CT.brand] || {}, own = S.me.role==='owner', need = IG_NAME[CT.brand];
  if(b.connected) return `<div class="card row" style="flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:8px 12px"><span style="flex:1;min-width:200px">📷 Instagram <b>@${esc(b.username||need)}</b> подключён${b.expires?` <span class="meta">· доступ до ${new Date(b.expires).toLocaleDateString('ru-RU')}, продлевается сам</span>`:''}</span>
    <button class="btn small" id="ct-ins">${CT.busy==='ins'?'Собираем…':'📊 Обновить статистику постов'}</button></div>`;
  return `<div class="card" style="margin-bottom:10px"><b>📷 Instagram @${need} не подключён</b> <span class="meta">— пока посты выкладываются вручную (кнопка «Текст» копирует подпись).</span>
    ${own?`<p class="meta" style="margin:6px 0">developers.facebook.com → ваше приложение → Instagram → «API setup with Instagram login» → Generate token у @${need}. Вставьте токен сюда — он хранится на сервере и в браузер не возвращается.</p>
    <div class="row" style="gap:6px;flex-wrap:wrap"><input id="ct-igtok" type="password" placeholder="Токен Instagram (IGAA…)" autocomplete="off" style="flex:1;min-width:200px"><button class="btn small primary" id="ct-igtok-save">Подключить</button></div>`:'<span class="meta"> Подключает владелец.</span>'}</div>`;
}
const ctIgChip = c => c.ig_status==='posted'?'<span class="chip ok">выложено</span>':c.ig_status==='publishing'?'<span class="chip warn">выкладывается…</span>':c.ig_status==='error'?'<span class="chip zero">ошибка</span>':c.status==='posted'?'<span class="chip ok">выложено</span>':c.auto_publish?'<span class="chip">выложится само</span>':'<span class="chip warn">ждёт</span>';
async function ctAI(body){
  const { data, error } = await sb.functions.invoke('content', { body });
  if(error){ let m = error.message; try{ const j = await error.context.json(); m = j.error || m; }catch(_){} throw new Error(m==='no_key' ? 'ИИ ещё не подключён — владелец вписывает ключ Anthropic в «Контенте» или «Моём дне»' : m); }
  return data;
}
function ctProducts(c){ return (c.products||[]).length ? `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-top:6px">${c.products.map(p=>`<span class="row" style="gap:6px;border:1px solid var(--line);border-radius:10px;padding:4px 8px 4px 4px">${thumb(p)}<span style="font-size:13px">${pcl(p.id, esc(p.name))}<br><span class="meta">${fmt(p.price)} · в наличии ${p.stock}</span></span></span>`).join('')}</div>` : ''; }
function ctCard(c){
  const ed = ctEdit(), chip = `<span class="chip">${CT_FMT[c.format]||c.format}</span>${c.source==='ai'?' <span class="chip ok">ИИ</span>':c.source==='data'?' <span class="chip">из данных</span>':''}`;
  if(c.status==='idea') return `<div class="card" style="margin-bottom:8px"><div class="row" style="flex-wrap:wrap"><b>${esc(c.title)}</b><span>${chip}</span></div>
    ${c.publish_at?`<div class="meta">предложено на ${ctNice(c.publish_at)}</div>`:''}<div style="margin-top:4px">${esc(c.idea||'')}</div>${ctProducts(c)}
    ${ed?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-top:8px">
      <button class="btn small primary" data-ctgen="${c.id}" ${CT.ai?'':'disabled title="Нужен ключ ИИ"'}>${CT.busy===c.id?'Пишем…':'✨ Написать пост'}</button>
      <button class="btn small" data-ctst="${c.id}:draft">✍ Написать вручную</button><button class="btn small" data-ctst="${c.id}:rejected">✕ Не нужно</button></div>`:''}</div>`;
  if(c.status==='draft' && ed) return `<div class="card stack" style="margin-bottom:8px;gap:6px"><div class="row" style="flex-wrap:wrap"><input data-ctf="${c.id}:title" value="${esc(c.title)}" style="flex:1;font-weight:600"><span>${chip}</span></div>
    <span class="meta">${esc(c.idea||'')}</span>${ctProducts(c)}
    <label class="stack" style="gap:2px"><span class="label">Текст поста</span><textarea data-ctf="${c.id}:caption" rows="7" placeholder="Подпись к посту">${esc(c.caption||'')}</textarea></label>
    <label class="stack" style="gap:2px"><span class="label">Что снять</span><textarea data-ctf="${c.id}:shot_list" rows="4">${esc(c.shot_list||'')}</textarea></label>
    <label class="stack" style="gap:2px"><span class="label">Хэштеги</span><input data-ctf="${c.id}:hashtags" value="${esc(c.hashtags||'')}"></label>
    ${ctMedia(c, true)}
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
      <label class="meta">Формат <select data-ctf="${c.id}:format">${Object.entries(CT_FMT).map(([k,v])=>`<option value="${k}" ${c.format===k?'selected':''}>${v}</option>`).join('')}</select></label>
      <label class="meta">Дата и время выкладки <input type="datetime-local" data-ctf="${c.id}:publish_at" value="${ctLocal(c.publish_at)}"></label>
      <label class="meta" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-ctauto="${c.id}" ${c.auto_publish?'checked':''}>выложить в Instagram автоматически в эту дату</label></div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
      <button class="btn small primary" data-ctok="${c.id}">✅ Утвердить и поставить в план</button>
      <button class="btn small" data-ctgen="${c.id}" ${CT.ai?'':'disabled title="Нужен ключ ИИ"'}>${CT.busy===c.id?'Пишем…':(c.caption?'✨ Переписать ИИ':'✨ Написать ИИ')}</button>
      <button class="btn small" data-ctcopy="${c.id}">Копировать текст</button><button class="btn small" data-ctst="${c.id}:rejected">✕ Убрать</button></div></div>`;
  return '';
}
function renderContent(){
  const L = CT.list, by = st => (L||[]).filter(c=>c.status===st), plan = (L||[]).filter(c=>['approved','posted'].includes(c.status)).sort((a,b)=>String(a.publish_at).localeCompare(String(b.publish_at)));
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap"><h2>Контент-план</h2><div class="seg">${[['moon','MOON'],['sunshine','Sunshine']].map(([k,v])=>`<button data-ctbrand="${k}" aria-pressed="${CT.brand===k}">${v}</button>`).join('')}</div></div>
  ${ctEdit()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:10px">
    <button class="btn primary" id="ct-ai" ${CT.ai?'':'disabled'}>${CT.busy==='ideas'?'Думаем…':'✨ Идеи ИИ на неделю'}</button>
    <button class="btn" id="ct-data">${CT.busy==='data'?'Собираем…':'💡 Идеи из данных Silver'}</button>
    <button class="btn" id="ct-add">+ Своя идея</button></div>
  <details class="card" style="margin-bottom:10px"><summary style="cursor:pointer"><b>🚫 Нельзя в Instagram</b> <span class="meta">— товары с этими словами в названии не попадают в идеи и посты</span></summary>
    <textarea id="ct-banned" rows="3" style="width:100%;margin-top:6px">${esc(CT.banned||'')}</textarea>
    <div class="row"><span class="meta">Слова через запятую: бренды и узнаваемые модели (клевер, гвоздь…).</span><button class="btn small primary" id="ct-banned-save">Сохранить</button></div></details>`:''}
  ${CT.ig?ctIgBar():''}
  ${CT.ai===false?`<div class="card" style="margin-bottom:10px"><span class="meta">✨ ИИ (Claude) пока не подключён. «Идеи из данных Silver» и ручные посты уже работают.${S.me.role==='owner'?' Впишите ключ Anthropic (console.anthropic.com → API Keys → Create Key) — он хранится на сервере и в браузер не возвращается.':' Ключ Anthropic вписывает владелец.'}</span>
    ${S.me.role==='owner'?`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><input id="ct-key" type="password" placeholder="sk-ant-…" autocomplete="off" style="flex:1;min-width:200px"><button class="btn small primary" id="ct-key-save">Сохранить ключ</button></div>`:''}</div>`:''}
  ${CT.add?`<div class="card stack" style="margin-bottom:10px;gap:6px"><b>Своя идея</b><input id="ct-n-title" placeholder="Коротко: о чём пост"><textarea id="ct-n-idea" rows="2" placeholder="Что снять, зачем"></textarea>
    <div class="row" style="justify-content:flex-start;gap:6px"><select id="ct-n-fmt">${Object.entries(CT_FMT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><button class="btn small primary" id="ct-n-save">Добавить</button><button class="btn small" id="ct-n-cancel">Отмена</button></div></div>`:''}
  ${!L?'<div class="empty">Загружаем…</div>':`<div class="grid2"><div>
    <h3>💡 Идеи (${by('idea').length})</h3>${by('idea').map(ctCard).join('') || '<div class="empty">Идей пока нет — нажмите «Идеи из данных Silver» или «Идеи ИИ»</div>'}
    ${by('draft').length?`<h3 style="margin-top:14px">✍ Посты в работе (${by('draft').length})</h3>${by('draft').map(ctCard).join('')}`:''}
  </div><div>
    <h3>📅 План выкладки</h3>
    ${plan.length?`<div class="scroll"><table><tbody>${plan.map(c=>`<tr><td class="num" style="white-space:nowrap">${ctNice(c.publish_at)}</td><td><b>${esc(c.title)}</b> <span class="chip">${CT_FMT[c.format]||c.format}</span><br>
      <span class="meta">${esc((c.caption||'').slice(0,120))}${(c.caption||'').length>120?'…':''}</span>${(c.media||[]).length?`<br>${(c.media||[]).slice(0,5).map(m=>`<img src="${esc(m.url)}" alt="" style="width:36px;height:45px;object-fit:cover;border-radius:4px;margin:4px 2px 0 0">`).join('')}`:''}${c.posted_url?`<br><a href="${esc(c.posted_url)}" target="_blank" rel="noopener">пост в Instagram ↗</a>`:''}${c.ig_status==='error'&&c.ig_error?`<br><span class="meta" style="color:var(--bad)">${esc(c.ig_error)}</span>`:''}</td>
      <td>${ctIgChip(c)}<br>${ctEdit()?`<button class="btn small" data-ctcopy="${c.id}">Текст</button>${c.status!=='posted'&&c.ig_status!=='posted'?`${((CT.ig||{}).brands||{})[CT.brand]&&CT.ig.brands[CT.brand].connected&&c.ig_status!=='publishing'?` <button class="btn small primary" data-ctpub="${c.id}">${CT.busy==='p'+c.id?'Выкладываем…':CT.sure===c.id?'Точно выложить?':'📤 Выложить сейчас'}</button>`:''}
        <label class="meta" style="display:inline-flex;gap:4px;align-items:center;margin-top:4px"><input type="checkbox" data-ctauto="${c.id}" ${c.auto_publish?'checked':''}>авто в дату</label>
        <br><button class="btn small" data-ctdone="${c.id}">✓ Выложено вручную</button> <button class="btn small" data-ctst="${c.id}:draft">Править</button>`:''}`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Утверждённых постов пока нет</div>'}
  </div></div>`}`;
}
document.addEventListener('click', async e => {
  if(S.view!=='content') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset;
  const find = id => (CT.list||[]).find(x=>x.id===id);
  try{
    if(d.ctbrand){ CT.brand = d.ctbrand; CT.list = null; render(); await loadContent(); render(); }
    else if(t.id==='ct-igtok-save'){ const k = ($('#ct-igtok').value||'').trim(); if(!k) return; t.disabled = true;
      const r = await igCall({ action:'set_token', brand:CT.brand, token:k }).catch(err => { t.disabled = false; throw err; }); CT.ig = null; toast('Instagram @'+(r.username||'')+' подключён'); await loadContent(); render(); }
    else if(t.id==='ct-ins'){ CT.busy = 'ins'; render(); await igCall({ action:'insights', brand:CT.brand }).finally(()=>{ CT.busy=''; }); toast('Статистика постов обновлена — ИИ учтёт её в новых идеях'); render(); }
    else if(d.ctpub){ if(CT.sure!==d.ctpub){ CT.sure = d.ctpub; render(); setTimeout(()=>{ if(CT.sure===d.ctpub){ CT.sure=''; render(); } }, 5000); return; }
      CT.sure = ''; CT.busy = 'p'+d.ctpub; render(); const r = await igCall({ action:'publish', id:d.ctpub }).finally(()=>{ CT.busy=''; }); toast('Выложено в Instagram'); await loadContent(); render(); if(r && r.url) window.open(r.url, '_blank', 'noopener'); }
    else if(d.ctpp){ const [id, pid] = d.ctpp.split(':'), c = find(id), p = (c.products||[]).find(x=>x.id===pid); if(!p) return; CT.busy = 'm'+id; render(); await ctMediaAdd(c, [p.photo_url]).finally(()=>{ CT.busy=''; }); render(); }
    else if(d.ctrm){ const [id, i] = d.ctrm.split(':'), c = find(id); const media = (c.media||[]).filter((_,k)=>k!==+i); const { error } = await sb.rpc('content_save', { p:{ id, media } }); if(error) throw error; c.media = media; render(); }
    else if(d.ctmv){ const [id, i] = d.ctmv.split(':'), c = find(id), M = [...(c.media||[])], k = +i; [M[k-1], M[k]] = [M[k], M[k-1]]; const { error } = await sb.rpc('content_save', { p:{ id, media:M } }); if(error) throw error; c.media = M; render(); }
    else if(t.id==='ct-key-save'){ const k = ($('#ct-key').value||'').trim(); if(!k) return; t.disabled = true; await ctAI({ action:'set_key', key:k }).catch(err => { t.disabled = false; throw err; }); CT.ai = null; AN.st = null; toast('Ключ Claude сохранён'); await loadContent(); render(); }
    else if(t.id==='ct-add'){ CT.add = true; render(); }
    else if(t.id==='ct-banned-save'){ const v = $('#ct-banned').value; const { error } = await sb.rpc('content_banned_set', { p:v }); if(error) throw error; CT.banned = v; toast('Список сохранён'); }
    else if(t.id==='ct-n-cancel'){ CT.add = false; render(); }
    else if(t.id==='ct-n-save'){ const title = $('#ct-n-title').value.trim(); if(!title) return toast('Напишите, о чём пост');
      const { error } = await sb.rpc('content_save', { p:{ brand:CT.brand, title, idea:$('#ct-n-idea').value, format:$('#ct-n-fmt').value, status:'idea' } }); if(error) throw error; CT.add = false; await loadContent(); render(); }
    else if(t.id==='ct-data'){ CT.busy = 'data'; render(); const { data, error } = await sb.rpc('content_suggest', { p_brand:CT.brand }); CT.busy = ''; if(error) throw error; toast('Новых идей: '+data); await loadContent(); render(); }
    else if(t.id==='ct-ai'){ CT.busy = 'ideas'; render(); const r = await ctAI({ action:'ideas', brand:CT.brand, count:7 }).finally(()=>{ CT.busy=''; }); toast('ИИ предложил идей: '+(r.created||0)); await loadContent(); render(); }
    else if(d.ctgen){ CT.busy = d.ctgen; render(); await ctAI({ action:'post', brand:CT.brand, id:d.ctgen }).finally(()=>{ CT.busy=''; }); toast('Пост написан — проверьте и утвердите'); await loadContent(); render(); }
    else if(d.ctst){ const [id, st] = d.ctst.split(':'); const { error } = await sb.rpc('content_save', { p:{ id, status:st } }); if(error) throw error; await loadContent(); render(); }
    else if(d.ctok){ const c = find(d.ctok); if(!c.publish_at) return toast('Поставьте дату и время выкладки'); if(!(c.caption||'').trim()) return toast('Напишите текст поста');
      const { error } = await sb.rpc('content_save', { p:{ id:c.id, status:'approved' } }); if(error) throw error; toast('Пост утверждён и стоит в плане'); await loadContent(); render(); }
    else if(d.ctdone){ const { error } = await sb.rpc('content_save', { p:{ id:d.ctdone, status:'posted' } }); if(error) throw error; toast('Отмечено: выложено'); await loadContent(); render(); }
    else if(d.ctcopy){ const c = find(d.ctcopy); const txt = (c.caption||'') + (c.hashtags ? '\n\n'+c.hashtags : ''); try{ await navigator.clipboard.writeText(txt); toast('Текст скопирован'); }catch(_){ toast('Не удалось скопировать — выделите текст вручную'); } }
  }catch(err){ CT.busy=''; toast(errText(err)); render(); }
});
document.addEventListener('change', async e => {
  if(S.view!=='content') return; const t = e.target;
  if(t.dataset.ctauto){ const id = t.dataset.ctauto, c = (CT.list||[]).find(x=>x.id===id), v = t.checked;
    if(v && !(((CT.ig||{}).brands||{})[CT.brand]||{}).connected) toast('Instagram ещё не подключён — пост выложится, когда подключите');
    const { error } = await sb.rpc('content_save', { p:{ id, auto_publish:v } }); if(error){ t.checked = !v; return toast(errText(error)); } if(c) c.auto_publish = v; render(); return; }
  if(t.dataset.ctup){ const c = (CT.list||[]).find(x=>x.id===t.dataset.ctup), files = [...(t.files||[])]; if(!c || !files.length) return;
    CT.busy = 'm'+c.id; render(); try{ await ctMediaAdd(c, files.map(f => URL.createObjectURL(f))); }catch(err){ toast(errText(err)); } CT.busy = ''; render(); return; }
  const f = t.dataset.ctf; if(!f) return; const [id, k] = f.split(':');
  let v = t.value; if(k==='publish_at') v = v ? v + ':00+05:00' : '';
  const { error } = await sb.rpc('content_save', { p:{ id, [k]: v } }); if(error) return toast(errText(error));
  const c = (CT.list||[]).find(x=>x.id===id); if(c) c[k] = k==='publish_at' ? (v||null) : v;
  if(k==='format' || k==='publish_at') render(); else toast('Сохранено');
});

/* ---------- консультанты: список, телефоны, магазины — для доступа к Telegram-боту ---------- */
const CN = { q:'', store:'', show:'active' };
function renderCons(){
  if(!S.emps){ $('#main').innerHTML = '<div class="empty">Загружаем…</div>'; return; }
  if(!document.getElementById('emp-css')){ const st = document.createElement('style'); st.id = 'emp-css'; st.textContent = `.emp-tbl td,.emp-tbl th{padding:5px 8px;vertical-align:middle}.emp-tbl td{white-space:nowrap}.emp-tbl input,.emp-tbl select{padding:4px 6px;font-size:13px}.emp-tbl details.dd summary{padding:4px 8px;font-size:13px}.emp-tbl tr.off td{opacity:.5}.emp-add>summary,.emp-acc>summary{cursor:pointer;font-weight:600;list-style:none}.emp-add>summary::-webkit-details-marker,.emp-acc>summary::-webkit-details-marker{display:none}`; document.head.append(st); }
  const all = (S.emps||[]).filter(e=>e.role==='consultant'), ids = e => e.store_ids||(e.home_store_id?[e.home_store_id]:[]);
  const q = CN.q.trim().toLowerCase();
  const C = all.filter(e => (CN.show==='all' || (CN.show==='active' ? e.active : CN.show==='nophone' ? e.active && !e.phone : CN.show==='notg' ? e.active && !e.telegram_id : !e.active))
    && (!CN.store || ids(e).includes(+CN.store)) && (!q || (e.full_name||'').toLowerCase().includes(q) || (e.phone||'').includes(q.replace(/\D/g,''))))
    .sort((a,b)=>(b.active-a.active)||a.full_name.localeCompare(b.full_name,'ru'));
  const act = all.filter(e=>e.active), noPh = act.filter(e=>!e.phone).length, noTg = act.filter(e=>!e.telegram_id).length;
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Консультанты <span class="meta">${act.length}</span></h2></div>
  <p class="meta" style="margin:4px 0 10px">Консультант пользуется ботом так: вы вписываете его телефон и магазины → он открывает Telegram-бота и жмёт «Поделиться номером». Бот узнаёт его по номеру. В саму программу консультанты не входят.</p>
  <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:8px">
    <div class="seg">${[['active','Работают'],['nophone',`Без телефона${noPh?' ('+noPh+')':''}`],['notg',`Без Telegram${noTg?' ('+noTg+')':''}`],['off','Уволены'],['all','Все']].map(([k,v])=>`<button data-cnshow="${k}" aria-pressed="${CN.show===k}">${v}</button>`).join('')}</div>
    <select id="cn-store"><option value="">Все магазины</option>${S.allStores.map(x=>`<option value="${x.id}" ${String(CN.store)===String(x.id)?'selected':''}>${esc(BRAND[x.brand]+' · '+x.address)}</option>`).join('')}</select>
    <input id="cn-q" type="search" placeholder="Поиск по имени или телефону" value="${esc(CN.q)}" style="min-width:200px"></div>
  <details class="card emp-add" style="margin-bottom:10px"><summary>+ Добавить консультанта</summary>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-top:8px"><input id="nc-name" placeholder="Имя и фамилия" style="min-width:180px"><input id="nc-phone" placeholder="+7 7__ ___ __ __" inputmode="tel" style="width:150px">
      ${storesDD([], id=>`class="nc-store" value="${id}"`)}<button class="btn primary small" id="nc-add">Добавить</button></div></details>
  <div class="scroll"><table class="emp-tbl"><thead><tr><th>Имя</th><th>Телефон</th><th>Магазины</th><th>Telegram</th><th title="Официально трудоустроен">Офиц.</th><th title="Снимите галочку, если уволен">Работает</th></tr></thead><tbody>
  ${C.map(e=>`<tr class="${e.active?'':'off'}"><td><input data-ename="${e.id}" value="${esc(e.full_name)}" style="min-width:170px;font-weight:600;border-color:transparent;background:transparent"></td>
    <td><input data-ephone="${e.id}" value="${esc(e.phone||'')}" placeholder="нет телефона" inputmode="tel" style="width:140px;${e.active&&!e.phone?'border-color:var(--warn,#d90)':''}"></td>
    <td>${storesDD(ids(e), id=>`data-estores="${e.id}:${id}"`)}</td>
    <td>${e.telegram_id?'<span class="chip ok">✓ подключён</span>':e.phone?'<span class="meta">ждём «Поделиться номером»</span>':'<span class="meta">—</span>'}</td>
    <td style="text-align:center"><input type="checkbox" data-eoff="${e.id}" ${e.official?'checked':''} aria-label="официально"></td>
    <td style="text-align:center"><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''} aria-label="работает"></td></tr>`).join('') || '<tr><td colspan="6" class="meta">Никого не найдено</td></tr>'}</tbody></table></div>`;
}
document.addEventListener('click', e => { if(S.view!=='cons') return; const t = e.target.closest('button[data-cnshow]'); if(t){ CN.show = t.dataset.cnshow; render(); } });
document.addEventListener('input', e => { if(S.view!=='cons' || e.target.id!=='cn-q') return; CN.q = e.target.value; clearTimeout(CN.t); CN.t = setTimeout(()=>{ render(); const i = $('#cn-q'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); });
document.addEventListener('change', async e => { const t = e.target;
  if(S.view==='cons' && t.id==='cn-store'){ CN.store = t.value; render(); return; }
  if(t.dataset && t.dataset.ename){ const v = t.value.trim(); const em = (S.emps||[]).find(x=>x.id===t.dataset.ename); if(!v || !em){ if(em) t.value = em.full_name; return; } em.full_name = v; await updEmp(em.id, { full_name:v }); }
});

/* ---------- приёмки в пути (Астана): пересчитать и подтвердить ---------- */
function transitHtml(){
  const L = S.trIn || []; if(!L.length) return '';
  const can = r => !isViewer() && canEdit(r.store_id) && (S.me.role!=='purchaser');
  S.trc = S.trc || {};
  return `<div class="card stack" style="margin:8px 0 12px;border-color:var(--warn,#d90);gap:8px"><b>🚚 Ожидают приёмки (${L.length})</b>
    <span class="meta">Товар отправлен в магазин, но ещё не на остатках. Когда коробка придёт — пересчитайте, впишите фактическое количество и подтвердите. Только после этого товар можно продавать.</span>
    ${L.map(r=>{ const open = S.trOpen===r.id, C = S.trc[r.id] || {}, units = (r.items||[]).reduce((a,i)=>a+i.qty,0);
      return `<div style="border-top:1px solid var(--line);padding-top:8px"><div class="row" style="flex-wrap:wrap;gap:6px">
        <button class="btn small" data-rcopen="${r.id}" style="border:0;background:none;padding:0;font-weight:600;text-align:left">${open?'▾':'▸'} №${r.number||''} · ${esc(r.store)} · ${units} шт.</button>
        <span class="meta">${new Date(r.created_at).toLocaleDateString('ru-RU')}${r.by?' · отправил(а) '+esc(r.by):''}${r.note?' · '+esc(r.note):''}</span></div>
      ${open?`<div class="scroll" style="margin-top:6px"><table><thead><tr><th></th><th>Товар</th><th>Отправлено</th><th>Пришло</th></tr></thead><tbody>${(r.items||[]).map(i=>`<tr><td>${thumb(i)}</td><td>${esc(i.name)}<br><span class="meta num">${esc(i.barcode||'')}${+i.price>0?' · '+fmt(i.price):' · <span style="color:var(--bad)">нет цены</span>'}</span></td><td class="num">${i.qty}</td>
        <td>${can(r)?`<input type="number" min="0" inputmode="numeric" data-rcc="${r.id}:${i.product_id}" value="${C[i.product_id]??''}" placeholder="${i.qty}" style="width:70px;${C[i.product_id]!=null&&+C[i.product_id]!==i.qty?'border-color:var(--bad)':''}">`:'<span class="meta">—</span>'}</td></tr>`).join('')}</tbody></table></div>
        ${can(r)?`<div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn small" data-rcall="${r.id}">Всё сходится</button><button class="btn small primary" data-rcok="${r.id}">✅ Подтвердить приёмку</button></div>`:'<span class="meta">Подтверждает менеджер этого магазина.</span>'}`:''}</div>`; }).join('')}</div>`;
}
document.addEventListener('click', async e => { if(S.view!=='wh') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset; S.trc = S.trc || {};
  if(d.rcopen){ S.trOpen = S.trOpen===d.rcopen ? null : d.rcopen; render(); }
  else if(d.rcall){ const r = (S.trIn||[]).find(x=>x.id===d.rcall); if(!r) return; S.trc[r.id] = {}; r.items.forEach(i=>S.trc[r.id][i.product_id]=i.qty); render(); }
  else if(d.rcok){ const r = (S.trIn||[]).find(x=>x.id===d.rcok); if(!r) return; const C = S.trc[r.id] || {};
    const miss = r.items.filter(i=>C[i.product_id]==null||C[i.product_id]==='').length; if(miss) return toast(`Впишите, сколько пришло, по всем товарам (осталось ${miss}) или нажмите «Всё сходится»`);
    t.disabled = true; const { data, error } = await sb.rpc('receipt_confirm', { p_id:r.id, p_items:r.items.map(i=>({ product_id:i.product_id, counted:+C[i.product_id] })) });
    if(error){ t.disabled = false; return toast(errText(error)); }
    const diff = (data&&data.diff)||[]; toast(diff.length ? `Принято с расхождениями: ${diff.length} поз. — владелец увидит в приёмке` : 'Приёмка подтверждена, товар на остатках');
    delete S.trc[r.id]; S.trOpen = null; await loadWhSide(); render(); }
});
document.addEventListener('change', e => { const t = e.target; if(S.view!=='wh' || !t.dataset || !t.dataset.rcc) return; const [rid, pid] = t.dataset.rcc.split(':'); S.trc = S.trc || {}; S.trc[rid] = S.trc[rid] || {}; S.trc[rid][pid] = t.value===''?null:+t.value; render(); });

/* ---------- «Требует внимания»: всё, что ждёт действия, на одном экране ---------- */
async function loadAttn(){ const { data, error } = await sb.rpc('attention'); if(error) toast(errText(error)); S.attn = data || {};
  if(S.me.role==='owner'){ const [b, d] = await Promise.all([ sb.rpc('backup_status'), sb.rpc('my_day', { p_store:null }) ]); S.attn.backups = b.data || []; S.attn.team = d.data || null; } }
function renderAttn(){ $('#main').innerHTML = attnHtml(false); }
/* embed: блок внизу «Моего дня» — без пунктов, которые уже есть в списке дел этой роли или в «Пульсе» владельца */
function attnHtml(embed, role){
  const A = S.attn; if(!A) return embed ? '<h3 style="margin:18px 0 6px">Требует внимания</h3><div class="meta">Проверяем…</div>' : '<h2>Требует внимания</h2><div class="empty">Проверяем…</div>';
  const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'}), dayOf = t => t ? new Date(t).toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'}) : null;
  const ago = t => { if(!t) return 'ни разу'; const d = Math.round((new Date(today) - new Date(dayOf(t)))/864e5); return d<=0 ? 'сегодня '+new Date(t).toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit'}) : d===1 ? 'вчера' : d+' дн. назад'; };
  const items = [];
  // владельцу не показываем то, что уже есть в списках дел менеджера и закупа (team) — только просрочки и своё
  const own = S.me.role==='owner';
  // в «Пульсе» владельца уже есть: просроченные приёмки и перемещения, свежесть загрузок Wipon
  const inPulse = (lvl, view, btn) => view==='day' || (view==='wh' && (btn==='К перемещениям' || (btn==='К приёмкам' && lvl==='bad' && own)));
  const add = (lvl, title, text, view, btn, team) => { if(own && team) return; if(embed && team && team===role) return;
    if(embed && role==='own' && inPulse(lvl, view, btn)) return;
    items.push({ lvl, title, text, view, btn }); };
  const hp = (A.hours||[]).reduce((a,h)=>a+h.pending,0), ho = (A.hours||[]).reduce((a,h)=>a+h.open_old,0);
  if(hp || ho) add('warn', `Часы консультантов: ждут подтверждения ${hp}${ho?`, не отмечен уход ${ho}`:''}`, (A.hours||[]).map(h=>esc(storeName(h.store_id))+': '+(h.pending?h.pending+' ждут':'')+(h.open_old?' · без ухода '+h.open_old:'')).join(' · '), 'pay', 'Открыть табель', 'mgr');
  if(A.transit) add(A.transit_old?'bad':'warn', `Товар едет в магазин, не принят: ${A.transit}${A.transit_old?` (из них ${A.transit_old} дольше 4 дней)`:''}`, 'Пока приёмку не подтвердили после пересчёта, товар не на остатках и его нельзя продать.', 'wh', 'К приёмкам', 'mgr');
  if(own && A.transit_old) add('bad', `Просрочено у менеджера: товар в пути не принят дольше 4 дней — ${A.transit_old}`, 'Менеджер видит это в своём списке дел, но не закрыл.', 'wh', 'К приёмкам');
  if(A.transfers_old) add('bad', `${own?'Просрочено у менеджера: перемещения':'Перемещения'} в пути дольше 3 дней: ${A.transfers_old}`, 'Отправлены, но не приняты в магазине-получателе.', 'wh', 'К перемещениям');
  if(A.writeoffs) add('warn', `Списания ждут ${own?'вашего ':''}решения: ${A.writeoffs}`, '', 'wh', 'К списаниям');
  if(A.requests) add('warn', `Запросы на оприходование: ${A.requests}`, 'Продавцы просят поставить товар на остаток.', 'wh', 'К запросам', 'mgr');
  if(A.noprice) add('bad', `Товары в наличии без розничной цены: ${A.noprice}`, 'Касса не продаст товар с ценой 0. Найдите их в «Номенклатуре» и поставьте цену: '+(A.noprice_names||[]).map(esc).join(', '), 'nom', 'Номенклатура', 'buy');
  const W = (A.wipon||[]).filter(w => dayOf(w.sales)!==today);
  if(W.length) add('warn', `Продажи из Wipon сегодня не загружены: ${W.length} маг.`, W.map(w=>esc(storeName(w.store_id))+' — '+ago(w.sales)).join(' · ')+'. Откройте кабинет Wipon и нажмите закладку «Silver ← Wipon».', 'day', 'Мой день');
  if(A.cons_nophone) add('warn', `Консультанты без телефона: ${A.cons_nophone}`, 'Без телефона консультант не сможет пользоваться ботом смен и зарплаты.', 'cons', 'Вписать телефоны', 'mgr');
  if(A.cons_notg) add('', `Телефон есть, но бот не подключён: ${A.cons_notg}`, 'Попросите открыть бота и нажать «Поделиться номером».', 'cons', 'Список', 'mgr');
  if(A.nophoto) add('', `Товары в наличии без фото: ${A.nophoto.toLocaleString('ru-RU')}`, 'Без фото товар не выложить на сайт и в Instagram. Начните с ходовых — «Путь товара» покажет их первыми.', 'flow', 'Путь товара', 'mgr');
  for(const x of (A.site||[])){ const nm = x.site==='moon'?'MOON':'Sunshine', days = x.loaded ? Math.floor((Date.now()-new Date(x.loaded))/864e5) : null;
    if(x.review) add('warn', `Сайт ${nm}: связи ждут проверки — ${x.review}`, 'Silver нашёл похожий товар в базе, но не уверен. Подтвердите или исправьте связь.', 'site', 'Проверить', 'buy');
    if(x.siteonly) add('', `Сайт ${nm}: карточки без привязки к базе — ${x.siteonly}`, 'На сайте есть, в базе не найден. Привяжите к товару или отметьте общий штрихкод.', 'site', 'Связать', 'buy');
    if(x.baseonly) add('', `Сайт ${nm}: товары в наличии, которых нет на сайте — ${x.baseonly.toLocaleString('ru-RU')}`, 'Есть в магазинах, но не выставлены на сайте.', 'site', 'Открыть', 'buy');
    if(days!=null && days>=2) add('warn', `Данные сайта ${nm} устарели: обновлялись ${days} дн. назад`, 'Каталог сайта загружен '+new Date(x.loaded).toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'. Пока каталог сайта подгружается в Silver вручную, автообновление — следующий шаг.', 'site', 'Сайт', 'buy'); }
  const col = { bad:'var(--bad)', warn:'var(--warn,#d90)', '':'var(--line)' };
  const list = items.length ? `<div class="stack" style="gap:8px">${items.sort((a,b)=>({bad:0,warn:1,'':2}[a.lvl]-{bad:0,warn:1,'':2}[b.lvl])).map(i=>`<div class="card row" style="flex-wrap:wrap;gap:10px;border-left:4px solid ${col[i.lvl]}"><div style="flex:1;min-width:220px"><b>${i.title}</b>${i.text?`<br><span class="meta">${i.text}</span>`:''}</div><button class="btn small" data-attngo="${i.view}">${i.btn} →</button></div>`).join('')}</div>` : '';
  if(embed) return `<div class="row" style="flex-wrap:wrap;margin:18px 0 6px"><h3 style="margin:0">Требует внимания</h3><span class="meta" style="flex:1">— то, чего нет в списке дел выше</span><button class="btn small" id="attn-ref">Обновить</button></div>
    ${list || '<div class="card meta">✅ Сверх списка дел ничего не ждёт</div>'}
    <details style="margin-top:10px"><summary class="meta" style="cursor:pointer">Сайты${S.me.role==='owner'?', резервные копии':''} и загрузки из Wipon</summary>${attnTables(A, ago, today, dayOf)}</details>`;
  return `<div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Требует внимания</h2><button class="btn small" id="attn-ref">Обновить</button></div>
  <p class="meta" style="margin:4px 0 12px">${own?'Только то, что ждёт именно вас: просрочки команды и вопросы, которых нет ни в чьём списке дел.':'Всё, что ждёт действия, по вашим магазинам.'} Когда пункт закрыт — он исчезает отсюда.</p>
  ${own&&A.team?teamLine(A.team).replace(/data-dayrole=/g,'data-attnteam='):''}
  ${list || '<div class="card" style="text-align:center;padding:24px">✅ Всё в порядке — ничего не ждёт</div>'}
  ${attnTables(A, ago, today, dayOf)}`;
}
function attnTables(A, ago, today, dayOf){
  return `${(A.site||[]).length?`<div class="card" style="margin-top:14px"><b>Сайты</b><div class="scroll"><table style="margin-top:6px"><thead><tr><th>Сайт</th><th>Каталог обновлён</th><th>Проверить связи</th><th>Без привязки</th><th>Нет на сайте</th></tr></thead><tbody>
    ${A.site.map(x=>`<tr><td>${x.site==='moon'?'MOON':'Sunshine'}</td><td>${ago(x.loaded)}</td><td class="num">${x.review}</td><td class="num">${x.siteonly}</td><td class="num">${(+x.baseonly).toLocaleString('ru-RU')}</td></tr>`).join('')}</tbody></table></div></div>`:''}
  ${S.me.role==='owner'?`<div class="card" style="margin-top:14px"><b>🛟 Резервные копии базы</b><p class="meta" style="margin:4px 0">Каждую ночь в 03:00 Silver сохраняет копию всех данных и хранит 7 дней. Видите только вы.</p>${gdHtml()}
    ${(A.backups||[]).length?`<div class="scroll"><table style="margin-top:4px"><tbody>${A.backups.map(b=>`<tr><td>${b.day.split('-').reverse().join('.')}</td><td>${b.ok===b.parts?`<span class="chip ok">✓ полная</span>`:`<span class="chip warn">${b.ok} из ${b.parts} частей</span>`}</td><td class="meta">${(+b.rows||0).toLocaleString('ru-RU')} строк${b.at?' · '+new Date(b.at).toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit'}):''}</td><td><button class="btn small" data-bkday="${b.day}">⬇ Скачать</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="meta">Первая копия появится сегодня ночью.</div>'}</div>`:''}
  <div class="card" style="margin-top:14px"><b>Загрузки из Wipon</b><div class="scroll"><table style="margin-top:6px"><thead><tr><th>Магазин</th><th>Продажи</th><th>Остатки</th></tr></thead><tbody>
    ${(A.wipon||[]).map(w=>`<tr><td>${esc(storeName(w.store_id))}</td><td style="color:${dayOf(w.sales)===today?'var(--ok)':'inherit'}">${ago(w.sales)}</td><td>${ago(w.stock)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
document.addEventListener('click', async e => { if(S.view!=='day') return; const t = e.target.closest('button[data-attnteam]'); if(!t) return;
  DAY.role = t.dataset.attnteam; S.view = 'day'; (S.lastView ||= {})[groupOf('day')[0]] = 'day'; render(); scrollTo(0,0); await loadView(); });
document.addEventListener('click', async e => { if(S.view!=='day') return; const t = e.target.closest('button'); if(!t) return;
  if(t.id==='attn-ref'){ S.attn = null; render(); await loadAttn(); render(); }
  else if(t.dataset.bkday){ const day = t.dataset.bkday; const { data:files } = await sb.storage.from('backups').list(day, { limit:500 }); const paths = (files||[]).filter(f=>/\.\d{3}\.ndjson\.gz$/.test(f.name)).map(f=>day+'/'+f.name);
    const { data:urls, error } = await sb.storage.from('backups').createSignedUrls(paths, 3600); if(error) return toast(errText(error));
    modal(`<div class="row"><h3 style="margin:0">Копия за ${day.split('-').reverse().join('.')}</h3><button class="btn small" data-close>✕</button></div>
      <p><button class="btn primary" data-bktar="${day}">⬇ Скачать всё одним файлом (.tar)</button></p>
      <p class="meta">Или по отдельности: каждая таблица — отдельный файл (сжатый JSON). Ссылки действуют 1 час.</p><div class="stack" style="gap:4px;max-height:60vh;overflow:auto">${(urls||[]).map(u=>`<a href="${esc(u.signedUrl)}" target="_blank" rel="noopener">${esc(u.path.split('/')[1])}</a>`).join('')}</div>`); }
  else if(t.dataset.attngo){ const v = t.dataset.attngo; if(v==='day'){ scrollTo(0,0); return; } if(!(S.tabs||[]).some(x=>x[0]===v)) return toast('У вас нет доступа к этой вкладке'); S.view = v; (S.lastView ||= {})[groupOf(v)[0]] = v; render(); scrollTo(0,0); await loadView(); }
});

/* ---------- резервная копия одним файлом: все части за день → .tar (без сторонних библиотек) ---------- */
const BKI = { info:null, busy:'' };
async function bkInfo(){ const { data } = await sb.rpc('backup_info'); BKI.info = data || null; if(S.view==='day') render(); }
function bkTarHeader(name, size){
  const h = new Uint8Array(512), enc = new TextEncoder(), put = (s, off, len) => { const b = enc.encode(s); h.set(b.slice(0, len), off); };
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100); put(oct(0o644, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8); put(oct(size, 12), 124, 12);
  put(oct(Math.floor(Date.now()/1000), 12), 136, 12); put('        ', 148, 8); put('0', 156, 1); put('ustar\0', 257, 6); put('00', 263, 2);
  let sum = 0; for(const b of h) sum += b; put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8); return h;
}
async function bkTar(day){
  if(BKI.busy) return; BKI.busy = day; render(); toast('Собираем копию — это займёт до минуты');
  try{
    const { data:files, error:le } = await sb.storage.from('backups').list(day, { limit:1000 }); if(le) throw le;
    const paths = (files||[]).filter(f => /\.ndjson\.gz$/.test(f.name)).map(f => day + '/' + f.name);
    if(!paths.length) throw new Error('В копии за этот день нет файлов');
    const { data:urls, error } = await sb.storage.from('backups').createSignedUrls(paths, 3600); if(error) throw error;
    const parts = []; let total = 0;
    for(const u of urls){ const r = await fetch(u.signedUrl); if(!r.ok) throw new Error('Не скачался файл ' + u.path); const b = new Uint8Array(await r.arrayBuffer());
      const pad = (512 - b.length % 512) % 512; parts.push(bkTarHeader('silver-' + u.path, b.length), b, new Uint8Array(pad)); total += b.length; }
    parts.push(new Uint8Array(1024));
    const blob = new Blob(parts, { type:'application/x-tar' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `silver-backup-${day}.tar`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
    await sb.rpc('backup_mark_downloaded'); BKI.info = { ...(BKI.info||{}), downloaded_at: new Date().toISOString() };
    toast(`Скачано: ${paths.length} файлов, ${(total/1e6).toFixed(1)} МБ. Сохраните файл на свой компьютер или Google Drive.`);
  }catch(err){ toast(errText(err)); }
  BKI.busy = ''; render();
}
/* ---------- копия на Google Диск владельца: скрипт Google Apps Script в её аккаунте сам забирает архив каждый день ---------- */
const gdFresh = I => !!(I && I.gdrive_at && Date.now() - new Date(I.gdrive_at) < 36 * 3600e3);
function gdHtml(){
  const I = BKI.info || {}, b = I.bundle, at = I.gdrive_at ? new Date(I.gdrive_at).toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
  return `<div class="card" style="margin:8px 0;padding:8px 12px;border-left:4px solid ${gdFresh(I)?'var(--ok)':'var(--warn,#e2a400)'}"><b>☁️ Копия на Google Диск каждый день</b><br>
    <span class="meta">${I.gdrive_at ? `Последняя копия на Диске: ${esc(at)}${I.gdrive_name?' · '+esc(I.gdrive_name):''}${gdFresh(I)?'':' — давно не обновлялась, проверьте скрипт'}` : 'Ещё не настроено.'}${b&&b.bytes?` Размер архива: ${(b.bytes/1e6).toFixed(1)} МБ, на Диске хранится 10 последних (≈ ${(b.bytes*10/1e6).toFixed(0)} МБ).`:''}</span>
    <div class="row" style="justify-content:flex-start;gap:6px;margin-top:6px"><button class="btn small" data-gdscript="1">${I.gdrive_at?'Показать скрипт':'Настроить — показать скрипт'}</button></div></div>`;
}
function gdScript(key){
  return `// Silver → Google Диск: каждый день сохраняет свежую резервную копию базы Silver
// в папку «Silver — резервные копии» и хранит 10 последних (старые уходят в корзину Диска).
// Ключ ниже даёт право только скачать архив копии — не храните скрипт в общих папках.
const SILVER_URL = 'https://ottuadjdksxipfjytlyv.supabase.co/functions/v1/backup_pull';
const SILVER_KEY = '${key}';
const FOLDER = 'Silver — резервные копии';
const KEEP = 10;

// Главная функция: её запускает расписание раз в день.
function silverBackup() {
  // 1. Спрашиваем у Silver ссылку на свежий архив
  const r = UrlFetchApp.fetch(SILVER_URL, { method: 'get', headers: { 'x-backup-key': SILVER_KEY }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Silver не отдал копию: ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  const info = JSON.parse(r.getContentText());
  // 2. Папка на Диске (создаём, если её ещё нет)
  const it = DriveApp.getFoldersByName(FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
  // 3. Если копия за этот день уже лежит — второй раз не качаем
  if (!folder.getFilesByName(info.name).hasNext()) {
    const f = UrlFetchApp.fetch(info.url, { muteHttpExceptions: true });
    if (f.getResponseCode() !== 200) throw new Error('Не скачался архив: ' + f.getResponseCode());
    folder.createFile(f.getBlob().setName(info.name));
  }
  // 4. Оставляем 10 последних копий, остальные — в корзину Диска (30 дней можно восстановить)
  const files = [];
  const fi = folder.getFiles();
  while (fi.hasNext()) { const x = fi.next(); if (/^silver-\d{4}-\d{2}-\d{2}\.tar$/.test(x.getName())) files.push(x); }
  files.sort((a, b) => b.getName().localeCompare(a.getName()));
  files.slice(KEEP).forEach(x => x.setTrashed(true));
  // 5. Сообщаем Silver, что копия сохранена (чтобы в «Моём дне» было видно)
  UrlFetchApp.fetch(SILVER_URL, { method: 'post', contentType: 'application/json', headers: { 'x-backup-key': SILVER_KEY },
    payload: JSON.stringify({ action: 'done', name: info.name, kept: Math.min(files.length, KEEP) }), muteHttpExceptions: true });
}

// Запустите ОДИН раз: ставит ежедневный запуск около 04:00 по Алматы и сразу делает первую копию.
function install() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'silverBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('silverBackup').timeBased().everyDays(1).atHour(4).inTimezone('Asia/Almaty').create();
  silverBackup();
}
`;
}
document.addEventListener('click', async e => { const t = e.target.closest && e.target.closest('button[data-gdscript],button[data-gdcopy]'); if(!t) return;
  if(t.dataset.gdcopy){ const ta = $('#gd-code'); try{ await navigator.clipboard.writeText(ta.value); toast('Скрипт скопирован'); }catch(_){ ta.select(); toast('Выделено — нажмите Ctrl+C / ⌘C'); } return; }
  t.disabled = true; const { data:key, error } = await sb.rpc('backup_gdrive_script'); t.disabled = false; if(error || !key) return toast(error ? errText(error) : 'Нет доступа');
  modal(`<div class="row"><h3 style="margin:0">Копия на Google Диск</h3><button class="btn small" data-close>✕</button></div>
    <ol class="meta" style="margin:8px 0;padding-left:18px;line-height:1.6">
      <li>Откройте <b>script.google.com</b> под своим Google-аккаунтом → <b>Новый проект</b>.</li>
      <li>Сотрите всё в редакторе и вставьте скрипт ниже (кнопка «Скопировать»).</li>
      <li>Нажмите <b>Сохранить</b> (значок дискеты), назовите проект, например «Silver копии».</li>
      <li>Сверху выберите функцию <b>install</b> и нажмите <b>Выполнить</b>.</li>
      <li>Google попросит разрешения — выберите свой аккаунт и разрешите доступ к Диску (если пишет «приложение не проверено» — «Дополнительно» → «Перейти»). Готово: папка «Silver — резервные копии» появится на Диске, дальше копия сохраняется каждый день около 04:00.</li></ol>
    <textarea id="gd-code" readonly rows="14" style="width:100%;font-family:ui-monospace,monospace;font-size:12px">${esc(gdScript(key))}</textarea>
    <div class="row" style="justify-content:flex-start;gap:6px;margin-top:8px"><button class="btn primary" data-gdcopy="1">Скопировать</button><span class="meta">В скрипте ключ доступа к копиям — не пересылайте его никому.</span></div>`); });
function bkRemind(){
  const I = BKI.info; if(!I || !I.last_day) return '';
  if(gdFresh(I)) return '';  // копия на Google Диске свежая — это и есть копия «на стороне»
  const days = I.downloaded_at ? Math.floor((Date.now() - new Date(I.downloaded_at)) / 864e5) : null;
  if(days !== null && days < 7) return '';
  return `<div class="card row" style="flex-wrap:wrap;gap:8px;margin-top:12px;border-left:4px solid var(--warn,#e2a400)"><span style="flex:1;min-width:220px">🛟 <b>Скачайте резервную копию себе</b><br><span class="meta">Копии хранятся там же, где сама база. Раз в неделю сохраняйте свежую копию на компьютер или Google Drive — ${days===null?'ещё ни разу не скачивали':'последний раз '+days+' дн. назад'}.</span></span>
    <button class="btn small" data-gdscript="1">☁️ Копировать на Google Диск каждый день</button><button class="btn small primary" data-bktar="${I.last_day}">${BKI.busy?'Собираем…':'⬇ Скачать копию за '+String(I.last_day).split('-').reverse().join('.')}</button></div>`;
}
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-bktar]'); if(!t) return; e.preventDefault(); bkTar(t.dataset.bktar); });

/* ---------- фотосессия: товары в наличии без фото, самые продаваемые первыми ---------- */
const PH = { store:null, q:'', data:null, i:0, busy:false, done:0 };
async function loadPhoto(){ if(PH.store===null) PH.store = S.store || ''; const { data, error } = await sb.rpc('photo_queue', { p_store: PH.store ? +PH.store : null, p_q: PH.q || null, p_limit: 60 }); if(error) toast(errText(error)); PH.data = data || { total:0, rows:[] }; PH.i = 0; }
function renderPhoto(){
  const D = PH.data, R = (D&&D.rows)||[], p = R[PH.i];
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap;gap:8px"><h2 style="margin:0">📷 Фотосессия</h2>${D?`<span class="meta">без фото в наличии: <b>${D.total.toLocaleString('ru-RU')}</b>${PH.done?` · снято сегодня: <b>${PH.done}</b>`:''}</span>`:''}</div>
  <p class="meta" style="margin:4px 0 10px">Сначала идут товары, которые чаще продаются. Снимайте на светлом фоне, украшение крупно. Можно отсканировать штрихкод — откроется именно этот товар.</p>
  <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:10px">
    <select id="ph-store"><option value="">Все магазины</option>${S.stores.map(x=>`<option value="${x.id}" ${String(PH.store)===String(x.id)?'selected':''}>${esc(BRAND[x.brand]+' · '+x.address)}</option>`).join('')}</select>
    <input id="ph-q" placeholder="Скан штрихкода или название" value="${esc(PH.q)}" style="flex:1;min-width:200px" autocomplete="off"><button class="btn" id="ph-find">Найти</button>${PH.q?'<button class="btn small" id="ph-clear">Сбросить</button>':''}</div>
  ${!D?'<div class="empty">Загружаем…</div>':!p?`<div class="card" style="text-align:center;padding:24px">${PH.q?'Такого товара без фото нет — возможно, фото уже есть':'✅ Здесь все товары с фото'}</div>`:`
  <div class="card stack" style="gap:10px;max-width:560px">
    <div class="meta">${PH.i+1} из ${R.length}${D.total>R.length?' (показаны первые '+R.length+')':''}</div>
    <div style="font-size:20px;font-weight:600;line-height:1.25">${esc(p.name)}</div>
    <div class="row" style="justify-content:flex-start;gap:14px;flex-wrap:wrap"><span class="num" style="font-size:18px">${esc(p.barcode||'')}</span><span><b>${+p.price>0?fmt(p.price):'нет цены'}</b></span><span class="meta">в наличии ${p.stock} · продано за 30 дн. ${p.sold30}</span></div>
    <label class="btn primary" style="cursor:pointer;text-align:center;padding:16px;font-size:17px">${PH.busy?'Загружаем…':'📷 Снять фото'}<input type="file" id="ph-file" accept="image/*" capture="environment" hidden ${PH.busy?'disabled':''}></label>
    <div class="row" style="gap:8px"><button class="btn" id="ph-prev" ${PH.i?'':'disabled'}>← Назад</button><button class="btn" id="ph-skip">Пропустить →</button></div>
    <button class="btn small" id="ph-grp" title="Под этим штрихкодом много разных изделий (например «Брелок Сделай сам») — одно фото не подойдёт. Товар уйдёт из фотосессии и не будет выводиться на сайт.">🧩 Сборный товар — фото не нужно</button>
  </div>
  ${R.length>1?`<details style="margin-top:12px"><summary class="meta" style="cursor:pointer">Вся очередь (${R.length})</summary><div class="scroll"><table>${R.map((x,n)=>`<tr style="${n===PH.i?'background:var(--soft)':''}"><td><button class="btn small" data-phgo="${n}" style="border:0;background:none;padding:0;text-align:left">${esc(x.name)}</button></td><td class="num meta">${esc(x.barcode||'')}</td><td class="num">${x.sold30}</td></tr>`).join('')}</table></div></details>`:''}`}`;
}
async function photoUpload(file){
  const p = ((PH.data||{}).rows||[])[PH.i]; if(!file || !p) return;
  PH.busy = true; render();
  try{
    const img = await createImageBitmap(file); const k = Math.min(1, 1200/Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    const path = `${p.id}/${Date.now()}.jpg`;
    const { error } = await sb.storage.from('product-photos').upload(path, blob, { contentType:'image/jpeg', upsert:true }); if(error) throw error;
    const url = sb.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
    const r = await sb.rpc('product_photo_set', { p_id:p.id, p_url:url }); if(r.error) throw r.error;
    const cp = S.catalog && S.catalog.find(x=>x.id===p.id); if(cp) cp.photo_url = url;
    PH.data.rows.splice(PH.i, 1); PH.data.total--; PH.done++; if(PH.i >= PH.data.rows.length) PH.i = Math.max(0, PH.data.rows.length-1);
    toast('✅ Фото сохранено — следующий товар');
    if(!PH.data.rows.length && !PH.q){ PH.busy = false; await loadPhoto(); }
  }catch(err){ toast('Фото не сохранилось: '+errText(err)); }
  PH.busy = false; render();
}
document.addEventListener('click', async e => { if(S.view!=='photo') return; const t = e.target.closest('button'); if(!t) return; const R = (PH.data&&PH.data.rows)||[];
  if(t.id==='ph-skip'){ PH.i = Math.min(R.length-1, PH.i+1); render(); }
  else if(t.id==='ph-grp'){ const p = R[PH.i]; if(!p) return; t.disabled = true; const { error } = await sb.rpc('product_mark_group', { p_id:p.id, p_on:true }); if(error){ t.disabled = false; return toast(errText(error)); }
    R.splice(PH.i, 1); if(PH.data.total) PH.data.total--; if(PH.i >= R.length) PH.i = Math.max(0, R.length-1); toast(`«${p.name}» отмечен как сборный товар (общий штрихкод) — фото больше не попросит`); render(); }
  else if(t.id==='ph-prev'){ PH.i = Math.max(0, PH.i-1); render(); }
  else if(t.id==='ph-find'){ PH.q = $('#ph-q').value.trim(); PH.data = null; render(); await loadPhoto(); render(); }
  else if(t.id==='ph-clear'){ PH.q = ''; PH.data = null; render(); await loadPhoto(); render(); }
  else if(t.dataset.phgo){ PH.i = +t.dataset.phgo; render(); scrollTo(0,0); }
});
document.addEventListener('change', async e => { if(S.view!=='photo') return; const t = e.target;
  if(t.id==='ph-file'){ const f = t.files[0]; t.value = ''; photoUpload(f); }
  else if(t.id==='ph-store'){ PH.store = t.value; PH.data = null; render(); await loadPhoto(); render(); }
});
document.addEventListener('keydown', async e => { if(S.view!=='photo' || e.target.id!=='ph-q' || e.key!=='Enter') return; e.preventDefault(); PH.q = e.target.value.trim(); PH.data = null; render(); await loadPhoto(); render(); });

/* ---------- логин и пароль для сотрудника (задаёт владелец) ---------- */
document.addEventListener('click', async e => { const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.epass){ const em = (S.emps||[]).find(x=>x.id===t.dataset.epass); if(!em) return;
    const sug = (em.full_name||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'').replace(/[а-яё]/g, c => ({а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sh',ы:'y',э:'e',ю:'yu',я:'ya'})[c]||'').slice(0,20);
    modal(`<div class="row"><h3 style="margin:0">🔑 Вход для «${esc(em.full_name)}»</h3><button class="btn small" data-close>✕</button></div>
      <div class="stack" style="gap:8px;margin-top:10px"><span class="meta">Сотрудник сможет входить без Telegram: на экране входа ввести логин и пароль. Регистрация не нужна. Если пароль уже был — он заменится.</span>
      <label class="stack" style="gap:2px"><span class="label">Логин (латиницей)</span><input id="ep-login" value="${esc(sug)}" autocapitalize="off" spellcheck="false"></label>
      <label class="stack" style="gap:2px"><span class="label">Пароль (от 6 символов)</span><input id="ep-pass" type="text" autocomplete="off"></label>
      <div class="row"><span></span><button class="btn primary" id="ep-save" data-id="${em.id}">Сохранить</button></div></div>`); }
  else if(t.id==='ep-save'){ t.disabled = true; const { data, error } = await sb.functions.invoke('staff', { body:{ employee_id:t.dataset.id, login:$('#ep-login').value, password:$('#ep-pass').value } });
    let msg = error ? error.message : null; if(error){ try{ const j = await error.context.json(); msg = j.error || msg; }catch(_){} }
    t.disabled = false; if(msg) return toast(msg); closeModal(); toast(`Готово: логин «${data.login}» — передайте сотруднику логин и пароль`); await loadEmps(); render(); }
});

document.addEventListener('click', e => { if(S.view!=='po') return; const t = e.target.closest('button[data-poopen]'); if(!t) return; PO.openO = PO.openO || {}; PO.openO[t.dataset.poopen] = !PO.openO[t.dataset.poopen]; render(); });

/* ---------- закуп: группы «что дозаказать» и справочник поставщиков ---------- */
document.addEventListener('click', async e => { if(S.view!=='po') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset;
  if('poscat' in d){ PO.scat = d.poscat; render(); }
  else if('posbrand' in d || d.posper || d.posdays){ if('posbrand' in d) PO.sbrand = d.posbrand; if(d.posper){ if(d.posper==='ly') PO.smode = 'ly'; else { PO.smode = 'recent'; PO.sper = +d.posper; } } if(d.posdays) PO.sdays = +d.posdays; PO.sug = null; PO.scat = ''; render(); await loadPo(); render(); }
  else if(t.id==='po-supmore'){ PO.supLim = (PO.supLim||100) + 100; render(); }
  else if(d.supoq){ const s = (PO.sups||[]).find(x=>x.name===d.supoq); PO.mode = 'orders'; PO.filter = 'all'; PO.oq = s ? (s.name) : ''; PO.list = null; render(); await loadPo(); render(); }
  else if(d.supedit){ const s = (PO.sups||[]).find(x=>x.name===d.supedit); if(!s) return;
    modal(`<div class="row"><h3 style="margin:0">Поставщик</h3><button class="btn small" data-close>✕</button></div>
      <div class="stack" style="gap:8px;margin-top:10px"><span class="meta">${esc(noZh(s.ru)||'')}${s.login?' · '+esc(s.login):''}</span>
      <label class="stack" style="gap:2px"><span class="label">Как называем у себя</span><input id="sp-alias" value="${esc(s.alias||noZh(s.ru)||'')}" placeholder="например, «Мейди — серьги смола»"></label>
      <label class="stack" style="gap:2px"><span class="label">Ссылка на магазин</span><input id="sp-shop" value="${esc(s.shop_url||s.url||'')}" placeholder="https://…"></label>
      <label class="stack" style="gap:2px"><span class="label">Контакт (WeChat, телефон, менеджер)</span><input id="sp-contact" value="${esc(s.contact||'')}"></label>
      <label class="stack" style="gap:2px"><span class="label">Заметки</span><textarea id="sp-notes" rows="3">${esc(s.notes||'')}</textarea></label>
      <div class="row"><span></span><button class="btn primary" id="sp-save" data-name="${esc(s.name)}">Сохранить</button></div></div>`); }
  else if(t.id==='sp-save'){ const { error } = await sb.rpc('supplier_save', { p:{ name:t.dataset.name, alias:$('#sp-alias').value, shop_url:$('#sp-shop').value, contact:$('#sp-contact').value, notes:$('#sp-notes').value } });
    if(error) return toast(errText(error)); closeModal(); toast('Сохранено'); const r = await sb.rpc('suppliers_list'); PO.sups = r.data||PO.sups; render(); }
});
document.addEventListener('toggle', e => { const t = e.target; if(S.view!=='po' || !t.dataset || !t.dataset.posgrp) return; PO.sopen = PO.sopen || {}; PO.sopen[t.dataset.posgrp] = t.open; }, true);
document.addEventListener('input', e => { if(S.view!=='po') return; const t = e.target; if(t.id!=='po-sq' && t.id!=='po-supq') return;
  if(t.id==='po-sq') PO.sq = t.value; else PO.supq = t.value; clearTimeout(PO.qt); PO.qt = setTimeout(()=>{ render(); const i = $('#'+t.id); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); });
async function importSuppliers(raw){ try{ const p = JSON.parse(decodeURIComponent(raw)); const { data, error } = await sb.rpc('suppliers_import', { p }); if(error) throw error; toast('Магазины поставщиков добавлены: '+data); }catch(e){ toast('Поставщики не загрузились: '+errText(e)); } }

function loadScriptOnce(src){ return new Promise((ok,no)=>{ if(document.querySelector(`script[src="${src}"]`)) return ok(); const el=document.createElement('script'); el.src=src; el.onload=ok; el.onerror=no; document.head.appendChild(el); }); }
async function sagiImport(file){
  const brand = BK.brand; BK.imp = 'Читаем файл…'; render();
  try{
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
    const A = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:false });
    const h = (A[0]||[]).map(x=>String(x||'').toLowerCase()), col = re => h.findIndex(x=>re.test(x));
    const iN=col(/имя/), iP=col(/телефон/), iC=col(/транзак/), iT=col(/сумма/), iL=col(/последн/), iB=col(/бонус/);
    if(iP<0) throw new Error('В файле нет колонки «Номер телефона» — это точно выгрузка клиентов из Sagi?');
    const rows = [];
    for(const r of A.slice(1)){ const d = String(r[iP]||'').replace(/\D/g,''); if(d.length<10) continue;
      rows.push([d.slice(-10), String(r[iN]||'').trim(), +String(r[iC]||0).replace(/[^\d.]/g,'')||0, +String(r[iT]||0).replace(/[^\d.]/g,'')||0, String(r[iL]||'').slice(0,16), +String(r[iB]||0).replace(/[^\d.]/g,'')||0]); }
    let tot = { new_customers:0, brand_rows:0, bonus_rows:0 };
    for(let i=0;i<rows.length;i+=4000){
      BK.imp = `Загружаем ${Math.min(i+4000, rows.length)} из ${rows.length}…`; render();
      const { data, error } = await sb.rpc('sagi_import', { p_brand: brand, p_rows: rows.slice(i, i+4000) });
      if(error) throw error; for(const k in tot) tot[k] += +(data[k]||0);
    }
    BK.imp = `Готово: в файле ${rows.length} клиентов. Новых клиентов в базе: ${tot.new_customers}, добавлено в ${brand==='moon'?'MOON':'Sunshine'}: ${tot.brand_rows}, перенесено бонусов: ${tot.bonus_rows}. Повторная загрузка того же файла ничего не задвоит.`;
    BK.stats = null; await loadBonus();
  }catch(e){ BK.imp = 'Ошибка импорта: ' + errText(e); }
  render();
}
function renderBonus(){
  const T = BK.stats || {}, L = BK.list, C = BK.card, ro = isViewer();
  const n = v => Math.round(+v||0).toLocaleString('ru-RU');
  $('#main').innerHTML = `<h2>Бонусные карты</h2>
  <div class="filters"><div class="seg">${[['sunshine','Sunshine'],['moon','MOON']].map(([k,v])=>`<button data-bkbrand="${k}" aria-pressed="${BK.brand===k}">${v}</button>`).join('')}</div>
    <span class="meta" style="align-self:center">Бонусы у брендов раздельные, база клиентов общая.</span>
    ${S.me.role==='owner'?`<label class="btn small" style="margin-left:auto;cursor:pointer">⬆ Импорт клиентов из Sagi (${BK.brand==='moon'?'MOON':'Sunshine'})<input type="file" id="sg-import" accept=".xlsx" hidden></label>`:''}</div>
  ${BK.imp?`<div class="card meta" style="margin-bottom:10px">${esc(BK.imp)}</div>`:''}
  <div class="pays" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
    ${[['Клиентов',n(T.clients)],['С бонусами',n(T.with_bonus)],['Бонусов на счетах',n(T.balance)],['Ждут активации',n(T.pending)],['Сгорят за 30 дней',n(T.burn30)],['Начислено за 30 дней',n(T.accrued30)],['Списано за 30 дней',n(T.spent30)],['Новых за 30 дней',n(T.new30)],['Дни рождения в базе',n(T.birthdays)+(T.bday_week?` · ${T.bday_week} на этой неделе`:'')]]
      .map(([k,v])=>`<div class="card"><div class="label">${k}</div><div class="total num" style="font-size:20px">${v}</div></div>`).join('')}
  </div>
  <div class="grid2" style="margin-top:12px"><div>
    <div class="filters"><input id="bk-q" placeholder="Телефон или имя" value="${esc(BK.q)}" style="flex:1;min-width:160px" inputmode="search">
      <select id="bk-filter">${[['bonus','С бонусами'],['all','Все клиенты'],['nobonus','Без бонусов'],['birthday','ДР в ближайшие 7 дней'],['nobday','Без даты рождения']].map(([k,v])=>`<option value="${k}" ${BK.filter===k?'selected':''}>${v}</option>`).join('')}</select>
      <select id="bk-sort">${[['balance','По бонусам'],['purchases','По числу покупок'],['total','По сумме покупок'],['last','По последней покупке'],['name','По имени']].map(([k,v])=>`<option value="${k}" ${BK.sort===k?'selected':''}>${v}</option>`).join('')}</select></div>
    ${!L?'<div class="empty">Загружаем…</div>':L.need_q?'<div class="card" style="padding:14px">🔎 Введите телефон или имя (от 4 символов), чтобы найти клиента</div>':`<p class="meta">Найдено: ${n(L.total)}</p>
    <div class="list">${L.rows.map(c=>`<button class="prod" style="grid-template-columns:minmax(0,1fr) auto;${BK.cur===c.id?'background:var(--soft)':''}" data-bkopen="${c.id}"><span><b>${esc(c.name||'Без имени')}</b><br>
      <span class="meta num">${esc(c.phone)} · покупок ${c.purchases||0} на ${fmt(c.total||0)}${c.last_at?' · последняя '+dshort(c.last_at):''}${c.birthday?' · ДР '+new Date(c.birthday).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):''}</span>
      ${c.next_burn?`<br><span class="meta">ближайшее сгорание ${dshort(c.next_burn)}</span>`:''}</span><span class="price num">${n(c.balance)} б.</span></button>`).join('') || '<div class="empty">Никого не найдено</div>'}</div>
    ${BK.off||L.rows.length===50?`<div class="row" style="margin-top:8px"><button class="btn" data-bkpage="-1" ${BK.off?'':'disabled'}>Назад</button><span class="meta">${BK.off+1}–${BK.off+L.rows.length}</span><button class="btn" data-bkpage="1" ${L.rows.length===50?'':'disabled'}>Дальше</button></div>`:''}`}
  </div><div>
    ${!BK.cur?'<div class="card empty">Выберите клиента слева</div>':!C?'<div class="card empty">Загружаем…</div>':(()=>{ const k=C.client||{}; return `<div class="card stack">
      <div class="row"><h2 style="margin:0">${esc(k.name||'Без имени')}</h2><span class="chip">${{new:'новый',regular:'постоянный',imported:'из Sagi'}[k.status]||k.status||''}</span></div>
      <div class="meta num">${esc(k.phone)} · покупок ${k.purchases||0} на ${fmt(k.total||0)}${k.last_at?' · последняя '+dshort(k.last_at):''}</div>
      <div class="total num">${n(k.available)} бонусов доступно</div>
      ${ro?'':`<div class="row" style="flex-wrap:wrap;justify-content:flex-start"><input id="bk-name" value="${esc(k.name||'')}" placeholder="Имя" style="flex:1;min-width:140px">
        <label class="meta">День рождения <input id="bk-bd" type="date" value="${esc(k.birthday||'')}"></label><button class="btn small" id="bk-save">Сохранить</button></div>
      <div class="cust stack"><span class="label">Корректировка бонусов</span>
        <div class="row" style="flex-wrap:wrap;justify-content:flex-start"><input id="bk-amt" type="number" placeholder="+500 или −500" style="width:140px" inputmode="numeric">
        <input id="bk-ttl" type="number" value="91" min="1" style="width:80px" title="Срок действия начисления, дней"><span class="meta">дней</span>
        <input id="bk-reason" placeholder="Причина *" style="flex:1;min-width:140px"><button class="btn small primary" id="bk-adj">Провести</button></div>
        <span class="meta">Плюс — начислить (действует указанное число дней), минус — списать.</span></div>`}
      <h2 style="margin:8px 0 0">История бонусов</h2>
      <div class="scroll"><table><thead><tr><th>Дата</th><th>Операция</th><th>Сумма</th><th>Остаток</th><th>Срок</th></tr></thead><tbody>
      ${(C.history||[]).map(h=>`<tr><td class="num">${dshort(h.at)}</td><td>${esc(KIND[h.kind]||h.kind)}${h.reason&&h.reason!==KIND[h.kind]?`<br><span class="meta">${esc(h.reason)}</span>`:''}${h.by?`<br><span class="meta">${esc(h.by)}${h.store?' · '+esc(storeName(h.store)):''}</span>`:''}</td>
        <td class="num" style="color:${h.amount<0?'var(--bad)':'var(--ok)'}">${h.amount>0?'+':''}${n(h.amount)}</td><td class="num">${h.amount>0?n(h.remaining):''}</td>
        <td class="meta">${h.amount>0?(new Date(h.available_at)>new Date()?'с '+dshort(h.available_at)+'<br>':'')+(h.expires_at?'до '+dshort(h.expires_at):''):''}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Операций нет</td></tr>'}</tbody></table></div>
      <h2 style="margin:8px 0 0">Покупки в ${BK.brand==='moon'?'MOON':'Sunshine'}</h2>
      <div class="scroll"><table><tbody>${(C.sales||[]).map(x=>`<tr><td class="num">${dshort(x.at)}</td><td>${x.kind==='return'?'Возврат':'Чек'} ${x.number?'№'+x.number:''}</td><td>${esc(storeName(x.store))}</td><td class="num">${fmt(x.total)}</td></tr>`).join('') || '<tr><td class="meta">Покупок в новой кассе пока нет (история Sagi — только итоги)</td></tr>'}</tbody></table></div>
    </div>`; })()}
  </div></div>`;
}

/* ---------- закуп ---------- */
/* закуп → «Все остатки»: весь ассортимент с остатками и продажами, решение о дозаказе — вручную */
const PA = { brand:'', per:30, q:'', cat:'', sup:'', sort:'sold', dir:-1, lim:100, list:null, flt:'' };
function paHtml(){
  const A = PA.list, q = PA.q.trim().toLowerCase(), segB = (k, cur, arr) => `<div class="seg">${arr.map(([v,t])=>`<button data-${k}="${v}" aria-pressed="${String(cur)===String(v)}">${t}</button>`).join('')}</div>`;
  const cats = A ? [...A.reduce((m,p)=>m.set(p.cat,(m.get(p.cat)||0)+1), new Map())].sort((a,b)=>b[1]-a[1]) : [];
  const F = { '':()=>true, low:p=>p.per_day>0 && (p.days_left??0) < 30, out:p=>p.stock<=0 && p.sold>0, dead:p=>p.stock>0 && !(p.sold>0), over:p=>p.per_day>0 && p.days_left>120 };
  let L = A ? A.filter(p => (!PA.cat || p.cat===PA.cat) && (!PA.sup || (PA.sup==='—' ? !p.sup : p.sup===PA.sup)) && F[PA.flt||''](p) && (!q || q.split(/\s+/).every(w => (p.name+' '+p.barcode).toLowerCase().includes(w)))) : null;
  const key = { sold:p=>+p.sold||0, stock:p=>+p.stock||0, days:p=>p.days_left==null?1e9:+p.days_left, name:p=>p.name, cost:p=>(+p.cost||0)*Math.max(+p.stock||0,0) };
  if(L){ const f = key[PA.sort]||key.sold; L = [...L].sort((a,b)=>{ const x=f(a), y=f(b); return (x>y?1:x<y?-1:0)*PA.dir; }); }
  const th = (k,t) => `<th><button data-pasort="${k}" style="border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;white-space:nowrap">${t} ${PA.sort===k?(PA.dir<0?'▼':'▲'):'<span class="meta">↕</span>'}</button></th>`;
  const inPO = id => (PO.d&&PO.d.items||[]).some(i=>i.pid===id);
  const tot = L ? L.reduce((a,p)=>a+Math.max(+p.stock||0,0)*(+p.cost||0),0) : 0;
  return `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px 14px;margin-bottom:8px">
      <span class="row" style="gap:6px"><span class="meta">Бренд:</span>${segB('pabrand', PA.brand, [['','Все'],['moon','MOON'],['sunshine','Sunshine']])}</span>
      <span class="row" style="gap:6px"><span class="meta">Продажи за:</span>${segB('paper', PA.per, [[30,'30 дн.'],[60,'60 дн.'],[90,'90 дн.']])}</span></div>
    <p class="meta" style="margin:0 0 8px">Весь ассортимент, который есть в магазинах, продавался за ${PA.per} дн. или уже едет. «Хватит на» = (остаток + едет) ÷ продажи в день. Наведите на остаток или продажи — покажет по магазинам. Нажмите на название — откроется карточка товара.</p>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:8px"><input id="pa-q" type="search" placeholder="🔍 Название или штрихкод" value="${esc(PA.q)}" style="flex:1;min-width:200px" autocomplete="off">
      ${segB('paflt', PA.flt, [['','Все'],['low','Хватит < 30 дн.'],['out','Закончились, но продаются'],['dead','Лежат без продаж'],['over','Запас > 120 дн.']])}</div>
    ${A?(()=>{ const sm = [...A.reduce((m,p)=>m.set(p.sup||'—',(m.get(p.sup||'—')||0)+1), new Map())].sort((a,b)=>b[1]-a[1]); return `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:8px"><span class="meta">Поставщик:</span><select id="pa-sup" style="max-width:420px"><option value="">Все поставщики (${sm.length})</option>${sm.map(([k,n])=>`<option value="${esc(k)}" ${PA.sup===k?'selected':''}>${k==='—'?'Поставщик не указан':esc(k)} · ${n}</option>`).join('')}</select></div>`; })():''}
    ${A?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:10px"><button class="btn small ${!PA.cat?'primary':''}" data-pacat="">Все категории</button>${cats.map(([c,n])=>`<button class="btn small ${PA.cat===c?'primary':''}" data-pacat="${esc(c)}">${esc(c)} (${n})</button>`).join('')}</div>`:''}
    ${!L?'<div class="empty">Загружаем весь ассортимент…</div>':!L.length?'<div class="empty">Ничего не найдено</div>':`
    <p class="meta">Найдено ${L.length.toLocaleString('ru-RU')} товаров${tot?` · в остатке на ${fmt(tot)} по закупу`:''}</p>
    <div class="scroll"><table class="mc"><thead><tr><th></th>${th('name','Товар')}${th('sold','Продано '+PA.per+' дн.')}${th('stock','Остаток')}<th>Едет</th>${th('days','Хватит на')}${th('cost','Закуп')}<th></th></tr></thead><tbody>
    ${L.slice(0, PA.lim).map(p=>`<tr><td data-l="">${thumb(p)}</td><td class="mc-t">${pcl(p.id, esc(p.name))}<br><span class="meta">${esc(p.cat)} · ${esc(p.barcode||'')} · ${fmt(p.price)}</span>${p.purchase_url?` · <a href="${esc(p.purchase_url)}" target="_blank" rel="noopener" class="meta">товар у поставщика ↗</a>`:''}${p.sup?`<br><span class="meta">🏪 ${p.sup_url?`<a href="${esc(p.sup_url)}" target="_blank" rel="noopener">${esc(p.sup)} ↗</a>`:esc(p.sup)}</span>`:''}</td>
      <td class="num" data-l="Продано ${PA.per} дн.">${poByStore(p,'sold',p.sold)}${p.per_day>0?`<br><span class="meta">≈ ${(+p.per_day).toLocaleString('ru-RU')}/день</span>`:''}${p.last?`<br><span class="meta">посл. ${dshort(p.last)}</span>`:''}</td>
      <td class="num" data-l="Остаток" ${p.stock<=0?'style="color:var(--bad)"':''}>${poByStore(p,'stock',p.stock)}</td><td class="num" data-l="Едет">${p.incoming||'—'}</td>
      <td class="num" data-l="Хватит на">${p.days_left==null?'<span class="meta">нет продаж</span>':`<b style="color:${p.days_left<14?'var(--bad)':p.days_left<30?'#c08a00':'inherit'}">${p.days_left} дн.</b>`}</td>
      <td class="num" data-l="Закуп">${p.cost!=null?fmt(p.cost):'—'}</td>
      <td class="mc-a">${poEdit()?`<span class="row" style="gap:4px"><input type="number" min="1" class="small" data-paqty="${p.id}" value="${Math.max(1, Math.ceil((+p.per_day||0)*30 - Math.max(+p.stock||0,0) - (+p.incoming||0)))}" style="width:64px" inputmode="numeric"><button class="btn small" data-paadd="${p.id}" ${inPO(p.id)?'disabled':''}>${inPO(p.id)?'В заказе':'В заказ'}</button></span>`:''}</td></tr>`).join('')}</tbody></table></div>
    ${L.length>PA.lim?`<button class="btn" data-pamore="1" style="width:100%;margin-top:8px">Показать ещё (${L.length-PA.lim})</button>`:''}
    ${PO.d&&PO.d.items.length?`<div class="card row" style="margin-top:10px;position:sticky;bottom:70px"><span style="flex:1">В новом заказе ${PO.d.items.length} поз.</span><button class="btn small primary" data-pomode="new">Открыть заказ →</button></div>`:''}`}`;
}
document.addEventListener('click', async e => { if(S.view!=='po' || PO.mode!=='all') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset;
  if('pabrand' in d || d.paper){ if('pabrand' in d) PA.brand = d.pabrand; if(d.paper) PA.per = +d.paper; PA.lim = 100; PA.cat = ''; render(); await loadPo(); render(); }
  else if('pacat' in d){ PA.cat = d.pacat; PA.lim = 100; render(); }
  else if('paflt' in d){ PA.flt = d.paflt; PA.lim = 100; render(); }
  else if(d.pasort){ if(PA.sort===d.pasort) PA.dir = -PA.dir; else { PA.sort = d.pasort; PA.dir = d.pasort==='days'||d.pasort==='name' ? 1 : -1; } render(); }
  else if(d.pamore){ PA.lim += 200; render(); }
  else if(d.paadd){ const p = (PA.list||[]).find(x=>x.id===d.paadd); if(!p) return; const q = Math.max(1, +(document.querySelector(`[data-paqty="${p.id}"]`)||{}).value||1);
    const dd = PO.d || (PO.d = poNew()); if(!dd.items.some(i=>i.pid===p.id)) dd.items.push({ pid:p.id, name:p.name, barcode:p.barcode, qty:q, cost:p.cost??'' }); toast('Добавлено в новый заказ ('+dd.items.length+' поз.)'); render(); }
});
document.addEventListener('change', e => { if(S.view!=='po' || e.target.id!=='pa-sup') return; PA.sup = e.target.value; PA.lim = 100; render(); });
let paTimer; document.addEventListener('input', e => { if(S.view!=='po' || e.target.id!=='pa-q') return; PA.q = e.target.value; clearTimeout(paTimer); paTimer = setTimeout(() => { PA.lim = 100; render(); }, 250); });
/* ---------- закуп → идеи и тренды: что растёт, что заканчивается, что брали в это время год назад + идеи ИИ с поиском трендов ---------- */
const PI = { brand:'', per:30, t:null, ai:null, busy:false, err:'', hist:null, open:{} };
async function piLoad(){ const k = PI.brand+'|'+PI.per; PI.t = null; PI.ai = undefined;
  if(PI.hist==null){ const h = await sb.rpc('sales_history_from'); PI.hist = h.data || ''; }
  const [a, b] = await Promise.all([ sb.rpc('po_trends', { p_brand:PI.brand||null, p_days:PI.per }), sb.functions.invoke('po_ideas', { body:{ action:'get', brand:PI.brand } }) ]);
  if(k !== PI.brand+'|'+PI.per) return;
  if(a.error) toast(errText(a.error)); PI.t = a.data || { cats:[], bands:[], rising:[], runout:[], ly_next:[] }; PI.ai = b.error ? null : (b.data || null); }
const pn = x => Math.round(+x||0).toLocaleString('ru-RU');
const piPct = (a, b) => { a = +a||0; b = +b||0; if(!b) return a ? '<span class="chip ok">новое</span>' : '—'; const v = Math.round((a-b)/b*100); return `<span style="color:${v>=10?'var(--ok,#1a7f4b)':v<=-10?'var(--bad)':'inherit'};font-weight:600">${v>0?'+':''}${v}%</span>`; };
const piZh = s => `https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=${encodeURIComponent(s)}`;
function piList(L, cols){ return !L || !L.length ? '<div class="meta" style="padding:6px 0">Нет таких товаров</div>' : `<div class="scroll"><table class="mc"><thead><tr><th></th><th>Товар</th>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${L.map(p=>`<tr><td data-l="">${thumb(p)}</td><td class="mc-t">${pcl(p.id, esc(p.name))}<br><span class="meta">${esc(p.cat)} · ${fmt(p.price)}</span></td>${cols.map(c=>`<td class="num" data-l="${c[0]}">${c[1](p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function piHtml(){
  const T = PI.t, A = PI.ai, segB = (k, cur, arr) => `<div class="seg">${arr.map(([v,t])=>`<button data-${k}="${v}" aria-pressed="${String(cur)===String(v)}">${t}</button>`).join('')}</div>`;
  const short = PI.hist && PI.hist > '2025-11-01';
  const sec = (id, title, html, open) => `<details class="card" data-pisec="${id}" style="margin-bottom:10px" ${(PI.open[id] ?? open)?'open':''}><summary style="cursor:pointer;font-weight:700">${title}</summary><div style="margin-top:8px">${html}</div></details>`;
  const ai = A===undefined ? '<p class="meta">Загружаю…</p>' : PI.busy ? '<p class="meta">Claude смотрит продажи и ищет тренды в интернете… (~1–2 мин)</p>' : PI.err ? `<p class="meta" style="color:var(--bad)">${esc(PI.err)}</p>` : !A ? '<p class="meta">Идей ещё нет — нажмите «Собрать идеи». Claude посмотрит цифры ниже, найдёт в интернете актуальные тренды украшений и предложит: что дозаказать, что новое успеть заказать к праздникам и что искать у поставщиков в Китае.</p>' : (()=>{ const d = A.data||{}, li = (a, f) => (a||[]).length ? `<ul style="margin:4px 0 10px;padding-left:20px">${a.map(f).join('')}</ul>` : '';
      return `<p class="meta" style="margin:0 0 6px">Собрано ${anAt(A.created_at)} · продажи за ${A.days} дн.</p>${d.summary?`<p style="margin:0 0 10px;line-height:1.5"><b>${esc(d.summary)}</b></p>`:''}
        ${(d.reorder||[]).length?`<div class="label">Дозаказать из нашего</div>${li(d.reorder, x=>`<li><b>${esc(x.name)}</b> — ${esc(x.why||'')}${x.qty_hint?` <span class="chip">${esc(x.qty_hint)}</span>`:''}</li>`)}`:''}
        ${(d.trends||[]).length?`<div class="label">Тренды и новинки — успеть заказать</div>${li(d.trends, x=>`<li><b>${esc(x.title)}</b>${x.fit?` <span class="chip">${esc(x.fit)}</span>`:''} — ${esc(x.why||'')}${x.deadline?`<br><span class="meta">⏰ ${esc(x.deadline)}</span>`:''}${x.price?` <span class="meta">· цена на полке ${esc(x.price)}</span>`:''}</li>`)}`:''}
        ${(d.search||[]).length?`<div class="label">Что искать у поставщиков в Китае</div><div class="scroll"><table class="mc"><thead><tr><th>Что</th><th>Запрос по-китайски</th><th>Закупка</th><th></th></tr></thead><tbody>${d.search.map(x=>`<tr><td class="mc-t"><b>${esc(x.ru)}</b><br><span class="meta">${esc(x.why||'')}</span></td><td data-l="Запрос"><span class="num" style="user-select:all">${esc(x.zh||'')}</span></td><td class="num" data-l="Закупка">${esc(x.cny||'—')}</td><td class="mc-a">${x.zh?`<a class="btn small" href="${esc(piZh(x.zh))}" target="_blank" rel="noopener">Искать ↗</a>`:''}</td></tr>`).join('')}</tbody></table></div>`:''}
        ${(d.stop||[]).length?`<div class="label" style="margin-top:8px">Не дозаказывать</div>${li(d.stop, x=>`<li><b>${esc(x.name)}</b> — ${esc(x.why||'')}</li>`)}`:''}
        ${(d.supplier_tips||[]).length?`<div class="label">Как выбрать хорошего поставщика</div>${li(d.supplier_tips, x=>`<li>${esc(x)}</li>`)}`:''}
        ${(d.sources||[]).length?`<details><summary class="meta" style="cursor:pointer">Источники трендов (${d.sources.length})</summary>${li(d.sources, x=>`<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`)}</details>`:''}`; })();
  const canRun = S.me && ['owner','purchaser'].includes(S.me.role);
  const cats = T && T.cats || [], bands = T && T.bands || [];
  return `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px 14px;margin-bottom:10px">
      <span class="row" style="gap:6px"><span class="meta">Бренд:</span>${segB('pibrand', PI.brand, [['','Все'],['moon','MOON'],['sunshine','Sunshine']])}</span>
      <span class="row" style="gap:6px"><span class="meta">Период:</span>${segB('piper', PI.per, [[30,'30 дн.'],[60,'60 дн.'],[90,'90 дн.']])}</span></div>
    <div class="card" style="margin-bottom:10px"><div class="row" style="flex-wrap:wrap;gap:8px"><b style="flex:1">✨ Идеи к заказу от ИИ</b>${canRun?`<button class="btn small primary" id="pi-run" ${PI.busy||A===undefined?'disabled':''}>${PI.busy?'Думает…':A?'Собрать заново':'Собрать идеи'}</button>`:''}</div>${ai}</div>
    ${!T ? '<div class="empty">Считаем тренды…</div>' : `
    ${sec('cats', 'Категории: растут или падают', `<p class="meta" style="margin:0 0 6px">Последние ${PI.per} дн. против предыдущих ${PI.per} дн.${short?'':' и что брали в ближайшие 60 дн. год назад'}</p><div class="scroll"><table class="mc"><thead><tr><th>Категория</th><th>Продано</th><th>Было</th><th>Изменение</th><th>Выручка</th><th>${short?'Год назад*':'Год назад, след. 60 дн.'}</th><th>Склад</th></tr></thead><tbody>${cats.map(c=>`<tr><td class="mc-t"><b>${esc(c.cat)}</b><br><span class="meta">${c.skus} поз. в наличии</span></td><td class="num" data-l="Продано">${pn(c.q_cur)}</td><td class="num" data-l="Было">${pn(c.q_prev)}</td><td data-l="Изменение">${piPct(c.q_cur, c.q_prev)}</td><td class="num" data-l="Выручка">${fmt(c.r_cur)}</td><td class="num" data-l="Год назад">${c.q_ly_next?pn(c.q_ly_next):'—'}</td><td class="num" data-l="Склад">${pn(c.stock)}</td></tr>`).join('')}</tbody></table></div>${short?`<p class="meta">* Продажи в Silver есть только с ${dshort(PI.hist)} — сравнение с прошлым годом станет полным после загрузки продаж 2025 (закладка Wipon в каждом ИП).</p>`:''}`, true)}
    ${sec('bands', 'Ценовые сегменты', `<div class="scroll"><table class="mc"><thead><tr><th>Цена</th><th>Продано</th><th>Было</th><th>Изменение</th><th>Выручка</th><th>Склад</th></tr></thead><tbody>${bands.map(b=>`<tr><td class="mc-t"><b>${esc(b.band)} ₸</b></td><td class="num" data-l="Продано">${pn(b.q_cur)}</td><td class="num" data-l="Было">${pn(b.q_prev)}</td><td data-l="Изменение">${piPct(b.q_cur, b.q_prev)}</td><td class="num" data-l="Выручка">${fmt(b.r_cur)}</td><td class="num" data-l="Склад">${pn(b.stock)}</td></tr>`).join('')}</tbody></table></div>`, false)}
    ${sec('runout', `Хиты заканчиваются · ${(T.runout||[]).length}`, piList(T.runout, [['Продано', p=>pn(p.q_cur)], ['Остаток', p=>pn(p.stock)+(p.incoming?` <span class="meta">+${p.incoming} едет</span>`:'')], ['Хватит на', p=>`<b style="color:${p.days_left<14?'var(--bad)':'#c08a00'}">${p.days_left} дн.</b>`]]), true)}
    ${sec('rising', `Набирают продажи · ${(T.rising||[]).length}`, piList(T.rising, [['Сейчас', p=>pn(p.q_cur)], ['Было', p=>pn(p.q_prev)], ['Остаток', p=>pn(p.stock)+(p.incoming?` <span class="meta">+${p.incoming} едет</span>`:'')], ['Хватит на', p=>p.days_left==null?'—':p.days_left+' дн.']]), false)}
    ${sec('ly', `Что брали в это время год назад · ${(T.ly_next||[]).length}`, (short?`<p class="meta">Пока видно только январь 2026 — продаж за 2025 в Silver ещё нет.</p>`:'')+piList(T.ly_next, [['Год назад, 60 дн.', p=>pn(p.q_ly_next)], ['Остаток', p=>pn(p.stock)+(p.incoming?` <span class="meta">+${p.incoming} едет</span>`:'')]]), false)}`}`;
}
document.addEventListener('click', async e => { if(S.view!=='po' || PO.mode!=='ideas') return; const t = e.target.closest('button'); if(!t) return; const d = t.dataset;
  if('pibrand' in d || d.piper){ if('pibrand' in d) PI.brand = d.pibrand; if(d.piper) PI.per = +d.piper; PI.err = ''; render(); await piLoad(); render(); }
  else if(t.id==='pi-run'){ PI.busy = true; PI.err = ''; render();
    const { data, error } = await sb.functions.invoke('po_ideas', { body:{ action:'run', brand:PI.brand, days:PI.per } }); PI.busy = false;
    if(error){ let m = error.message; try{ m = (await error.context.json()).error || m; }catch(_){} PI.err = m; } else PI.ai = data; render(); }
});
document.addEventListener('toggle', e => { const el = e.target; if(el && el.dataset && el.dataset.pisec) PI.open[el.dataset.pisec] = el.open; }, true);
/* что дозаказать: при наведении — остаток и продажи по каждому магазину */
function poByStore(p, k, total){ const B = p.by_store || {}, ids = Object.keys(B); if(!ids.length) return `${total}`;
  return `<span class="nm-st" tabindex="0">${total}<span class="nm-st-pop">${S.allStores.filter(st=>B[st.id]).map(st=>{ const b = B[st.id]; return `<span class="row" style="gap:12px"><span>${esc(BRAND[st.brand]+' · '+st.address)}</span><span class="num">остаток <b>${+b.stock||0}</b> · продано <b>${+b.sold||0}</b></span></span>`; }).join('')}</span></span>`; }
const PO = { mode:'orders', filter:'open', list:null, sug:null, an:null, anPer:'month', q:'', found:[], d:null, sbrand:'', sper:30, sdays:30, smode:'recent' };
const PO_ST = { ordered:['warn','заказано'], transit:['warn','в пути'], received:['ok','получено'], cancelled:['zero','отменён'] };
const poNew = () => ({ supplier:'', store:S.store, eta:'', cargo:'', note:'', items:[], cur:'CNY', rate:'', pct:10 });
const CUR = { KZT:'₸', CNY:'¥', USD:'$', RUB:'₽' };
const fxNow = c => c==='KZT' ? 1 : +(((PO.fx||{})[c]||{}).rate)||0;
const poRate = d => +d.rate || fxNow(d.cur) || 1;
// себестоимость единицы: цена × курс × (1 + % доставки до Казахстана) + доставка по Китаю (в валюте заказа) поровну на каждую единицу
const poLanded = (price, rate, pct, cargo, units) => (+price||0)*rate*(1+(+pct||0)/100) + (units ? (+cargo||0)*rate/units : 0);
const poEdit = () => S.me && ['owner','manager','purchaser'].includes(S.me.role);
async function loadPo(){
  if(!PO.fx){ const r = await sb.rpc('fx_current'); PO.fx = r.data || {}; }
  if(PO.mode==='orders'){ const { data, error } = await sb.rpc('po_list', { p_status: PO.filter==='all'?null:PO.filter }); if(error) toast(errText(error)); PO.list = data||[]; }
  if(PO.mode==='suggest'){ if(!WU.srv) wuLoadSrv(); const k = [PO.sdays, PO.sbrand, PO.sper, PO.smode].join('|');
    const { data, error } = await sb.rpc('po_suggest3', { p_days:PO.sdays||30, p_brand:PO.sbrand||null, p_sales_days:PO.sper||30, p_mode:PO.smode==='ly'?'ly':'recent' }); if(error) toast(errText(error));
    if(k===[PO.sdays, PO.sbrand, PO.sper, PO.smode].join('|')) PO.sug = data||[]; }
  if(PO.mode==='all'){ const k = [PA.brand, PA.per].join('|'); PA.list = null; const { data, error } = await sb.rpc('po_stock_all', { p_brand:PA.brand||null, p_sales_days:PA.per||30 }); if(error) toast(errText(error)); if(k===[PA.brand, PA.per].join('|')) PA.list = data||[]; }
  if(PO.mode==='ideas') await piLoad();
  if(PO.mode==='sup'){ const { data, error } = await sb.rpc('suppliers_list'); if(error) toast(errText(error)); PO.sups = data||[]; }
  if(PO.mode==='an'){ const now = new Date(), iso = x => x.toLocaleDateString('sv-SE'); const from = PO.anPer==='month' ? new Date(now.getFullYear(), now.getMonth(), 1) : PO.anPer==='q' ? new Date(now.getFullYear(), now.getMonth()-2, 1) : new Date(now.getFullYear(), 0, 1);
    const { data, error } = await sb.rpc('po_analytics', { p_from: iso(from), p_to: iso(now) }); if(error) toast(errText(error)); PO.an = data||{}; }
}
function renderPo(){
  const modes = [['orders','Заказы'],['new','Новый заказ'],['suggest','Что дозаказать'],['all','Все остатки'],['ideas','✨ Идеи и тренды'],['sup','Поставщики'],['an','Аналитика закупа']].filter(([k])=>poEdit() || k!=='new');
  const head = `<div class="row" style="flex-wrap:wrap"><h2>Закуп</h2><span class="row" style="gap:6px">${(PO.list||[]).some(o=>(o.supplier&&/[\u4e00-\u9fff]/.test(o.supplier)&&!o.supplier_ru)||(o.items||[]).some(i=>i.supplier_title&&!i.title_ru))?`<button class="btn small" id="po-tr">🌐 Перевести названия на русский</button>`:''}${poEdit()?`<label class="btn small" style="cursor:pointer">⬆ Загрузить заказы: 1688 или Alibaba (Excel)<input type="file" id="po-1688" accept=".xlsx,.xls,.csv" hidden></label>`:''}</span></div>
  ${PO.imp?`<div class="card meta" style="margin-bottom:8px">${esc(PO.imp)}</div>`:''}
  <div class="seg" style="display:inline-flex;margin-bottom:10px">${modes.map(([k,v])=>`<button data-pomode="${k}" aria-pressed="${PO.mode===k}">${v}</button>`).join('')}</div>`;
  let body = '';
  if(PO.mode==='orders'){
    const q = (PO.oq||'').trim().toLowerCase(), all = PO.list;
    const hay = o => [o.number, o.ext_no, o.track, o.supplier, o.supplier_ru, o.note, storeName(o.store), ...(o.items||[]).flatMap(i=>[i.name, i.title_ru, i.supplier_title, i.barcode, i.spec, i.supplier_art])].filter(Boolean).join(' ').toLowerCase();
    const F = all && q ? all.filter(o => q.split(/\s+/).every(w => hay(o).includes(w))) : all;
    const L = F && F.slice(0, PO.lim || 40);
    body = `<div class="row" style="margin-bottom:8px"><input id="po-oq" placeholder="🔍 Поиск: номер заказа, трек, магазин или поставщик, товар" value="${esc(PO.oq||'')}" style="flex:1" autocomplete="off"></div>
    ${F&&q?`<div class="meta" style="margin-bottom:6px">Найдено заказов: ${F.length}</div>`:''}
    ${poBulkOk()&&F&&F.some(o=>['ordered','transit'].includes(o.status))?(()=>{ const nSel = Object.values(PO.sel||{}).filter(Boolean).length; return `<div class="card row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;margin-bottom:8px">
      <span class="meta">Уже приняли раньше?</span>
      <button class="btn small" id="po-sel-all">Выбрать все показанные</button>
      <label class="meta">или все заказы до даты <input type="date" id="po-arch-date" value="${esc(PO.archDate||'')}"></label>
      <button class="btn small primary" id="po-arch-go" ${nSel||PO.archDate?'':'disabled'}>Отметить как уже принятые${nSel?` (${nSel})`:PO.archDate?` (до ${new Date(PO.archDate).toLocaleDateString('ru-RU')})`:''}</button>
      <span class="meta">Остатки не меняются — заказы просто уходят из «в пути».</span></div>`; })():''}
    <div class="filters">${[['open','Заказано и в пути'],['received','Получены'],['cancelled','Отменённые'],['all','Все']].map(([k,v])=>`<button class="btn small ${PO.filter===k?'primary':''}" data-pofilter="${k}">${v}</button>`).join('')}</div>
    ${!L?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">Заказов нет</div>':L.map(o=>{ const goods=(o.items||[]).reduce((a,i)=>a+i.qty*(+i.unit_cost||0),0), units=(o.items||[]).reduce((a,i)=>a+i.qty,0);
      const nl = (o.items||[]).filter(i=>!i.product_id).length, open = (PO.openO||{})[o.id] || (PO.rcv&&PO.rcv.id===o.id);
      return `<div class="card" style="margin-bottom:8px;padding:10px 12px"><div class="row" style="flex-wrap:wrap;gap:6px"><b>${poBulkOk()&&['ordered','transit'].includes(o.status)?`<input type="checkbox" data-posel="${o.id}" ${(PO.sel||{})[o.id]?'checked':''} style="margin-right:6px" aria-label="Выбрать заказ">`:''}№${o.number} · ${esc(poSupplier(o))} → ${o.store?esc(storeName(o.store)):'<span class="meta">магазин при приёмке</span>'}</b><span class="chip ${PO_ST[o.status][0]}">${PO_ST[o.status][1]}${o.status==='received'&&!o.receipt_id&&o.source==='1688'?' · история':''}</span></div>
        <div class="meta">${dshort(o.created_at)}${o.source==='1688'?' · Китай №'+esc(o.ext_no):o.source==='alibaba'?' · Alibaba №'+esc(o.ext_no):''}${o.track?' · трек '+esc(o.track):''}${o.eta?' · ждём к '+dshort(o.eta):''}${o.received_at?' · получен '+dshort(o.received_at):''}${noZh(o.note)&&!/Китай №/.test(o.note)?' · '+esc(o.note):''}</div>
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px;justify-content:flex-start"><button class="btn small" data-poopen="${o.id}" style="border:0;background:none;padding:0;font-weight:600">${open?'▾':'▸'} ${(o.items||[]).length} поз. · ${units} шт. · ${fmt(goods)}</button>
          ${nl?`<span class="chip zero">не связано: ${nl}</span>`:''}${!open?`<span style="display:flex;gap:3px">${(o.items||[]).slice(0,10).map(i=>thumb(i)).join('')}${(o.items||[]).length>10?`<span class="meta">+${(o.items||[]).length-10}</span>`:''}</span>`:''}</div>
        ${open?`<div class="scroll" style="margin-top:6px"><table class="mc"><tbody>${(o.items||[]).map(i=>poItemRow(o,i)).join('')}</tbody></table></div>`:''}
        ${PO.rcv&&PO.rcv.id===o.id?poRcvHtml(o):''}
        <div class="row" style="flex-wrap:wrap;margin-top:6px"><span class="meta">${open?`${o.currency&&o.currency!=='KZT'?'курс '+o.currency+' '+(+o.rate).toFixed(2)+' · ':''}${+o.cargo?'доставка по Китаю '+(+o.cargo).toLocaleString('ru-RU')+' '+(CUR[o.currency]||'₸')+' · ':''}+${o.delivery_pct??10}% до Казахстана`:''}</span>
          <span>${poEdit()&&o.status==='ordered'?`<button class="btn small" data-postatus="${o.id}:transit">Отправлен — в пути</button>`:''}
          ${isBoss()&&!isViewer()&&['ordered','transit'].includes(o.status)&&!(PO.rcv&&PO.rcv.id===o.id)?`<button class="btn small primary" data-poreceive="${o.id}">Получить на склад</button>`:''}
          ${isBoss()&&!isViewer()&&['ordered','transit'].includes(o.status)?`<button class="btn small" data-poarch="${o.id}" title="Заказ уже принят и оприходован раньше — убрать из ожидаемых, остатки не меняются">Отметить как уже принятый</button>`:''}
          ${poEdit()&&['ordered','transit'].includes(o.status)?`<button class="btn small" data-postatus="${o.id}:cancelled">Отменить</button>`:''}</span></div></div>`; }).join('')}
    ${F&&F.length>L.length?`<button class="btn" id="po-more" style="width:100%">Показать ещё (${F.length-L.length})</button>`:''}`;
  }
  if(PO.mode==='new'){
    const d = PO.d || (PO.d = poNew()), tot = d.items.reduce((a,i)=>a+i.qty*(+i.cost||0),0);
    body = `<div class="card stack">
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
        <input id="po-supplier" placeholder="Поставщик (Китай, Иу, рынок…)" value="${esc(d.supplier)}" style="flex:1;min-width:180px">
        <label class="meta">Куда <select id="po-store">${S.allStores.map(st=>`<option value="${st.id}" ${+d.store===st.id?'selected':''}>${esc(storeName(st.id))}</option>`).join('')}</select></label>
        <label class="meta">Ждём к <input type="date" id="po-eta" value="${d.eta}"></label>
        <label class="meta">Валюта <select id="po-cur">${Object.keys(CUR).map(c=>`<option ${d.cur===c?'selected':''}>${c}</option>`).join('')}</select></label>
        ${d.cur!=='KZT'?`<label class="meta">Курс <input id="po-rate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(d.rate)}" placeholder="${fxNow(d.cur)||''}" style="width:90px"></label>`:''}
        <label class="meta">Доставка по Китаю, ${CUR[d.cur]} <input id="po-cargo" type="number" min="0" inputmode="numeric" value="${esc(d.cargo)}" style="width:110px"></label>
        <label class="meta">+ % доставка до Казахстана <input id="po-pct" type="number" min="0" step="1" inputmode="numeric" value="${esc(d.pct)}" style="width:60px"></label></div>
      <span class="meta">Курс Нацбанка сегодня: ${['CNY','USD','RUB'].map(c=>c+' '+(fxNow(c)?fxNow(c).toFixed(2):'—')).join(' · ')}. Себестоимость пересчитается по курсу на день приёмки.</span>
      <input id="po-note" placeholder="Комментарий (номер заказа в Китае, трек-номер…)" value="${esc(d.note)}">
      <div class="row"><input id="po-q" placeholder="Добавить товар: штрихкод или название" value="${esc(PO.q)}" style="flex:1" autocomplete="off"></div>
      ${PO.found.length?`<div class="list">${PO.found.slice(0,10).map(p=>`<button class="prod" data-poadd="${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}</div>`:''}
      ${d.items.length?(()=>{ const rt = poRate(d), un = d.items.reduce((a,i)=>a+(+i.qty||0),0); return `<div class="scroll"><table><thead><tr><th>Товар</th><th>Кол-во</th><th>Цена за шт., ${CUR[d.cur]}</th><th>Сумма, ${CUR[d.cur]}</th><th>Себестоимость шт. ≈</th><th></th></tr></thead><tbody>
        ${d.items.map((i,n)=>`<tr><td>${esc(i.name)}<br><span class="meta num">${esc(i.barcode)}</span></td><td><input class="small" type="number" min="1" data-poqty="${n}" value="${i.qty}" inputmode="numeric" style="width:70px"></td>
          <td><input class="small" type="number" min="0" step="0.01" data-pocost="${n}" value="${i.cost??''}" inputmode="decimal" style="width:90px"></td><td class="num">${((+i.qty||0)*(+i.cost||0)).toLocaleString('ru-RU')}</td>
          <td class="num">${i.cost!==''&&i.cost!=null?fmt(poLanded(i.cost, rt, d.pct, d.cargo, un)):'—'}</td><td><button class="btn small" data-podel="${n}">✕</button></td></tr>`).join('')}</tbody></table></div>`; })():'<div class="empty">Добавьте товары поиском или из вкладки «Что дозаказать»</div>'}
      <div class="row"><span class="meta">Позиций ${d.items.length} · ${d.items.reduce((a,i)=>a+i.qty,0)} шт. · товар ${tot.toLocaleString('ru-RU')} ${CUR[d.cur]}${d.cur!=='KZT'?' ≈ '+fmt(tot*poRate(d)):''}${+d.cargo?' + доставка по Китаю '+d.cargo+' '+CUR[d.cur]:''} + ${d.pct||0}% до Казахстана</span>
        <button class="btn primary" id="po-save" ${d.items.length?'':'disabled'}>Оформить заказ</button></div></div>`;
  }
  if(PO.mode==='all') body = paHtml();
  if(PO.mode==='ideas') body = piHtml();
  if(PO.mode==='suggest'){
    const A = PO.sug, q = (PO.sq||'').trim().toLowerCase(), cat = PO.scat||'';
    const cats = A ? [...A.reduce((m,p)=>m.set(p.cat,(m.get(p.cat)||0)+1), new Map())].sort((a,b)=>b[1]-a[1]) : [];
    const L = A && A.filter(p => (!cat || p.cat===cat) && (!q || q.split(/\s+/).every(w => (p.name+' '+p.barcode).toLowerCase().includes(w))));
    const bySup = PO.sgrp==='sup', gk = p => bySup ? (p.sup||'') : p.cat;
    const groups = L ? [...L.reduce((m,p)=>{ (m.get(gk(p)) || m.set(gk(p), []).get(gk(p))).push(p); return m; }, new Map())].sort((a,b)=> bySup ? ((!a[0])-(!b[0]) || b[1].reduce((s,p)=>s+(+p.need||0),0)-a[1].reduce((s,p)=>s+(+p.need||0),0)) : b[1].length-a[1].length) : [];
    const gTitle = (k, ps) => !bySup ? esc(k) : !k ? 'Поставщик не известен' : esc(ps[0].sup_ru && !/[\u4e00-\u9fff]/.test(ps[0].sup_ru) ? ps[0].sup_ru : 'Поставщик из Китая');
    const row = p => `<tr><td data-l="">${thumb(p)}</td><td class="mc-t">${pcl(p.id, esc(p.name))}<br><span class="meta num">${esc(p.barcode)}${p.cost?' · закуп '+fmt(p.cost):''}</span>${p.purchase_url?` · <a href="${esc(p.purchase_url)}" target="_blank" rel="noopener" class="meta">у поставщика ↗</a>`:''}</td>
        <td class="num" data-l="Продано ${PO.sper||30} дн.">${poByStore(p, 'sold', p.sold??p.sold30)}${PO.smode==='ly'?`<br><span class="meta">${p.ly_missing?'прошлого года нет — по последним '+(PO.sper||30)+' дн.: ':'прошлый год ≈ '+(+p.per_day_ly).toLocaleString('ru-RU')+'/день · '}сейчас ≈ ${(+p.per_day_recent).toLocaleString('ru-RU')}/день</span>`:p.per_day!=null?`<br><span class="meta">≈ ${(+p.per_day).toLocaleString('ru-RU')} в день</span>`:''}</td><td class="num" data-l="Остаток" ${p.stock<=0?'style="color:var(--bad)"':''}>${poByStore(p, 'stock', p.stock)}${p.days_left!=null?`<br><span class="meta">на ${p.days_left} дн.</span>`:''}</td><td class="num" data-l="Едет">${p.incoming||'—'}</td><td class="num" data-l="Дозаказать"><b>${p.need}</b></td>
        <td class="mc-a">${poEdit()?`<button class="btn small" data-posug="${p.id}" data-need="${p.need}" data-cost="${p.cost??''}">В заказ</button>`:''}</td></tr>`;
    const segB = (k, cur, arr) => `<div class="seg">${arr.map(([v,t])=>`<button data-${k}="${v}" aria-pressed="${String(cur)===String(v)}">${t}</button>`).join('')}</div>`;
    body = `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px 14px;margin-bottom:8px">
      <span class="row" style="gap:6px"><span class="meta">Бренд:</span>${segB('posbrand', PO.sbrand||'', [['','Все'],['moon','MOON'],['sunshine','Sunshine']])}</span>
      <span class="row" style="gap:6px"><span class="meta">Скорость продаж за:</span><div class="seg">${[[30,'30 дн.'],[60,'60 дн.'],[90,'90 дн.']].map(([v,t])=>`<button data-posper="${v}" aria-pressed="${PO.smode!=='ly' && +(PO.sper||30)===v}">${t}</button>`).join('')}${(()=>{ const ok = wuLyReady(), b = WU.srv && WU.srv.backfill;
        return `<button data-posper="ly" aria-pressed="${PO.smode==='ly'}" ${ok||PO.smode==='ly'?'':'disabled'} title="${ok?'Продажи в те же дни год назад — для сезонных товаров':esc(b?'Прошлый год ещё загружается из Wipon: '+b.pct+'%':'Прошлый год появится после подключения Wipon к серверу (закладка Silver)')}">как в прошлом году (те же дни)</button>`; })()}</div></span>
      <span class="row" style="gap:6px"><span class="meta">Заказать запас на:</span>${segB('posdays', PO.sdays||30, [[30,'30 дн.'],[45,'45 дн.'],[60,'60 дн.'],[90,'90 дн.']])}</span></div>
    <p class="meta" style="margin:0 0 8px">Как считается: ${PO.smode==='ly'?`средние продажи в день за те же ${PO.sdays||30} дн. год назад (если товара тогда не было — за последние ${PO.sper||30} дн.)`:`средние продажи в день за последние ${PO.sper||30} дн.`} × ${PO.sdays||30} дн. запаса − остаток по всей сети − то, что уже едет. В списке только то, чего не хватит на ${PO.sdays||30} дн.${PO.sbrand?' Бренд: '+(PO.sbrand==='moon'?'MOON':'Sunshine')+' (и общие товары).':''} Наведите на «Продано» или «Остаток» — покажет по магазинам.</p>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:8px"><input id="po-sq" type="search" placeholder="🔍 Слово из названия или штрихкод" value="${esc(PO.sq||'')}" style="flex:1;min-width:220px" autocomplete="off">
      <span class="meta">Группировать:</span><div class="seg"><button data-posgrpby="cat" aria-pressed="${!bySup}">по категориям</button><button data-posgrpby="sup" aria-pressed="${bySup}">по поставщикам</button></div></div>
    ${A?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-bottom:10px"><button class="btn small ${!cat?'primary':''}" data-poscat="">Все (${A.length})</button>${cats.map(([c,n])=>`<button class="btn small ${cat===c?'primary':''}" data-poscat="${esc(c)}">${esc(c)} (${n})</button>`).join('')}</div>`:''}
    ${!A?'<div class="empty">Считаем…</div>':!L.length?'<div class="empty">Ничего не найдено</div>':groups.map(([c,ps])=>`<details class="card" style="margin-bottom:8px;padding:8px 12px" ${groups.length===1||(PO.sopen||{})[(bySup?'s:':'')+c]?'open':''} data-posgrp="${esc((bySup?'s:':'')+c)}"><summary style="cursor:pointer;font-weight:600">${gTitle(c, ps)} <span class="meta">· ${ps.length} поз. · дозаказать ${ps.reduce((a,p)=>a+(+p.need||0),0)} шт.</span></summary>
      ${bySup&&c?`<div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-top:6px">${ps[0].sup_url?`<a class="btn small" href="${esc(ps[0].sup_url)}" target="_blank" rel="noopener">Магазин ↗</a>`:''}${poEdit()?`<button class="btn small primary" data-posupall="${esc(c)}">Сформировать заказ у этого поставщика (${ps.length} поз.)</button>`:''}</div>`:''}
      ${bySup&&!c?'<div class="meta" style="margin-top:6px">У этих товаров нет связи с заказами из Китая — поставщик не определён. Ссылка «у поставщика ↗» ведёт на товар.</div>':''}
      <div class="scroll" style="margin-top:6px"><table class="mc"><thead><tr><th></th><th>Товар</th><th>Продано ${PO.sper||30} дн.${PO.smode==='ly'?' / год назад':''}</th><th>Остаток</th><th>Едет</th><th>Дозаказать</th><th></th></tr></thead><tbody>${ps.map(row).join('')}</tbody></table></div></details>`).join('')}`;
  }
  if(PO.mode==='sup'){
    const A = PO.sups, q = (PO.supq||'').trim().toLowerCase();
    const nm = s => s.alias || noZh(s.ru) || noZh(s.login) || s.name;
    const L = A && A.filter(s => !q || [s.name, s.ru, s.alias, s.login, s.contact, s.notes].filter(Boolean).join(' ').toLowerCase().includes(q));
    body = `<p class="meta" style="margin:0 0 8px">Все поставщики из заказов. Нажмите ✎, чтобы дать понятное название, записать контакт и заметки. «Магазин ↗» открывает магазин поставщика.</p>
    <div class="row" style="margin-bottom:8px"><input id="po-supq" type="search" placeholder="🔍 Поиск поставщика" value="${esc(PO.supq||'')}" style="flex:1" autocomplete="off"></div>
    ${!A?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">Не найдено</div>':`<div class="scroll"><table class="mc"><thead><tr><th>Поставщик</th><th>Заказов</th><th>Последний</th><th>Сумма</th><th></th></tr></thead><tbody>
      ${L.slice(0, PO.supLim||100).map(s=>`<tr><td class="mc-t"><b>${esc(nm(s))}</b>${s.alias&&noZh(s.ru)?`<br><span class="meta">${esc(s.ru)}</span>`:''}${nm(s)===s.name?' <span class="meta">(перевода ещё нет)</span>':''}${s.contact?`<br><span class="meta">📞 ${esc(s.contact)}</span>`:''}${s.notes?`<br><span class="meta">${esc(s.notes)}</span>`:''}</td>
        <td class="num" data-l="Заказов">${s.orders}${s.open?`<br><span class="meta">в пути ${s.open}</span>`:''}</td><td class="num" data-l="Последний">${dshort(s.last)}</td><td class="num" data-l="Сумма">${fmt(s.goods)}</td>
        <td class="mc-a" style="white-space:nowrap">${s.shop_url||s.url?`<a class="btn small" href="${esc(s.shop_url||s.url)}" target="_blank" rel="noopener">Магазин ↗</a> `:''}<button class="btn small" data-supoq="${esc(s.name)}" title="Заказы этого поставщика">Заказы</button> ${poEdit()?`<button class="btn small" data-supedit="${esc(s.name)}">✎</button>`:''}</td></tr>`).join('')}</tbody></table></div>
      ${L.length>(PO.supLim||100)?`<button class="btn" id="po-supmore" style="width:100%;margin-top:6px">Показать ещё (${L.length-(PO.supLim||100)})</button>`:''}`}`;
  }
  if(PO.mode==='an'){
    const A = PO.an, n = v => (+v||0).toLocaleString('ru-RU');
    body = `<div class="filters">${[['month','Этот месяц'],['q','3 месяца'],['year','С начала года']].map(([k,v])=>`<button class="btn small ${PO.anPer===k?'primary':''}" data-poper="${k}">${v}</button>`).join('')}</div>
    ${!A?'<div class="empty">Считаем…</div>':`<div class="pays" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${[['Заказов',n(A.orders)],['Закуплено товара',fmt(A.goods||0)],['Карго',fmt(A.cargo||0)],['Штук',n(A.units)],['Заказано, ещё не отправлено',n(A.ordered_units)+' шт.'],['В пути',n(A.transit_units)+' шт.'],['Не получено на сумму',fmt(A.open_goods||0)],['Средний срок доставки',A.lead_days!=null?A.lead_days+' дн.':'—']]
        .map(([k,v])=>`<div class="card"><div class="label">${k}</div><div class="total num" style="font-size:20px">${v}</div></div>`).join('')}</div>
      <h2 style="margin-top:14px">По поставщикам</h2>${(A.by_supplier||[]).length?`<div class="scroll"><table><thead><tr><th>Поставщик</th><th>Заказов</th><th>Товар</th><th>Карго</th></tr></thead><tbody>${A.by_supplier.map(r=>`<tr><td>${esc(r.supplier)}</td><td class="num">${r.orders}</td><td class="num">${fmt(r.goods)}</td><td class="num">${fmt(r.cargo)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">За период заказов нет</div>'}`}
    <p class="meta">Закуп в рентабельности считается по фактической приёмке на склад; здесь — по оформленным заказам.</p>`;
  }
  $('#main').innerHTML = head + body;
}

/* ---------- рентабельность ---------- */
const PF = { per:'month', from:'', to:'', data:null, costs:null, add:{ store:'', month:new Date().toISOString().slice(0,7), cat:'Аренда', amount:'', note:'' } };
const PF_CATS = ['Аренда','Коммунальные','Налоги','Интернет и связь','Охрана','Реклама','Банк и эквайринг','Другое'];
function pfRange(){
  const d = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Almaty'})), iso = x => x.toLocaleDateString('sv-SE');
  const y = d.getFullYear(), m = d.getMonth();
  if(PF.per==='month') return [iso(new Date(y,m,1)), iso(d)];
  if(PF.per==='prev') return [iso(new Date(y,m-1,1)), iso(new Date(y,m,0))];
  if(PF.per==='q') return [iso(new Date(y,m-2,1)), iso(d)];
  if(PF.per==='year') return [iso(new Date(y,0,1)), iso(d)];
  return [PF.from || iso(new Date(y,m,1)), PF.to || iso(d)];
}
async function loadProfit(){
  const [f,t] = pfRange(); PF.data = null;
  const [p, c] = await Promise.all([ sb.rpc('profitability', { p_from:f, p_to:t, p_stores: selStores() }), sb.rpc('store_costs_list', { p_from:f, p_to:t }) ]);
  if(p.error) toast(errText(p.error)); PF.data = p.data || []; PF.costs = c.data || [];
}
/* точка безубыточности — в «Рентабельности» (данные из сводки владельца owner_pulse) */
function pfBeHtml(){
  const P = DAY.pulse; if(!P){ if(S.me && S.me.role==='owner' && !PF.beLoading){ PF.beLoading = true; sb.rpc('owner_pulse').then(({ data }) => { PF.beLoading = false; if(data){ DAY.pulse = data; if(S.view==='profit') render(); } }); } return S.me && S.me.role==='owner' ? '<div class="meta" style="margin:8px 0">Считаем точку безубыточности…</div>' : ''; }
  const St = (P.stores||[]).filter(x => !(PF.sel && PF.sel.length) || PF.sel.includes(x.id));
  return `<div class="card" style="margin:12px 0"><b>Точка безубыточности — этот месяц</b>
    <div class="scroll"><table class="mc" style="margin-top:6px"><thead><tr><th>Магазин</th><th>Продано с начала месяца</th><th>Нужно продать за месяц</th></tr></thead><tbody>
    ${St.map(x=>`<tr><td class="mc-t">${esc(BRAND[x.brand]+' · '+x.address)}</td><td class="num" data-l="С начала месяца">${fmt(x.mtd)}</td><td data-l="Безубыточность">${beCell(x)}</td></tr>`).join('')}</tbody></table></div>
    <p class="meta" style="margin:8px 0 0">Безубыточность = (аренда, коммуналка и другие расходы из «Рентабельности» + хозрасходы магазина из журнала «Расходы магазинов», в среднем за 3 мес.) ÷ доля, что остаётся с продажи после себестоимости и налога (по продажам за 90 дней). Зарплаты пока не учтены — впишите их в расходы магазина, и точка станет точной.</p></div>`;
}
function renderProfit(){
  const D = PF.data, [f,t] = pfRange(), sum = o => Object.values(o||{}).reduce((a,v)=>a+ +v,0);
  const rows = (D||[]).map(r => { const gross = r.revenue - r.cogs, tax = r.tax ?? Math.round(Math.max(r.revenue,0)*0.03), cash = sum(r.cash), fixed = sum(r.fixed), net = gross - tax - r.wages - cash - fixed;
    return { ...r, tax, gross, cashT:cash, fixedT:fixed, net, margin: r.revenue ? net/r.revenue*100 : 0 }; });
  const T = rows.reduce((a,r)=>{ for(const k of ['revenue','cogs','gross','tax','wages','cashT','fixedT','net','purchases']) a[k]=(a[k]||0)+r[k]; return a; }, {});
  T.margin = T.revenue ? T.net/T.revenue*100 : 0;
  const cell = (v, neg) => `<td class="num" ${neg&&v<0?'style="color:var(--bad)"':''}>${fmt(v)}</td>`;
  const lines = [['Выручка','revenue'],['Себестоимость проданного','cogs',-1],['Валовая прибыль','gross'],[`Налог ${(D&&D[0]&&D[0].tax_rate)||3}% с выручки`,'tax',-1],['Зарплата (по табелю)','wages',-1],['Расходы из кассы','cashT',-1],['Аренда и постоянные расходы','fixedT',-1],['Чистая прибыль','net'],['Рентабельность','margin']];
  const per = [['month','Этот месяц'],['prev','Прошлый месяц'],['q','3 месяца'],['year','С начала года'],['custom','Свой период']];
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Рентабельность магазинов</h2>${(S.tabs||[]).some(x=>x[0]==='cash')?'<button class="btn small" data-gocash>Журнал расходов →</button>':''}</div>
  <div class="filters">${per.map(([k,v])=>`<button class="btn small ${PF.per===k?'primary':''}" data-pfper="${k}">${v}</button>`).join('')}
    ${PF.per==='custom'?`<input type="date" id="pf-from" value="${f}"><input type="date" id="pf-to" value="${t}">`:''}<span class="meta" style="align-self:center">${new Date(f).toLocaleDateString('ru-RU')} — ${new Date(t).toLocaleDateString('ru-RU')}</span></div>
  ${!D?'<div class="empty">Считаем…</div>':`<div class="scroll"><table><thead><tr><th></th>${rows.map(r=>`<th>${esc(storeName(r.store))}</th>`).join('')}${rows.length>1?'<th>Итого</th>':''}</tr></thead><tbody>
    ${lines.map(([t,k,sign])=>`<tr ${['gross','net'].includes(k)?'style="font-weight:700"':''}><td>${t}</td>${rows.map(r=>k==='margin'?`<td class="num" style="font-weight:700;color:${r.margin<0?'var(--bad)':'var(--ok)'}">${r.margin.toFixed(1)}%</td>`:cell(sign?-r[k]:r[k], k==='net')).join('')}${rows.length>1?(k==='margin'?`<td class="num" style="font-weight:700">${T.margin.toFixed(1)}%</td>`:cell(sign?-T[k]:T[k], k==='net')):''}</tr>`).join('')}
    <tr><td class="meta">Закуп по приёмке (справочно)</td>${rows.map(r=>`<td class="num meta">${fmt(r.purchases)}</td>`).join('')}${rows.length>1?`<td class="num meta">${fmt(T.purchases)}</td>`:''}</tr>
  </tbody></table></div>
  ${pfBeHtml()}
  <details style="margin:8px 0"><summary class="meta">Расшифровка расходов по магазинам</summary>
    ${rows.map(r=>`<div class="meta" style="margin:6px 0"><b>${esc(storeName(r.store))}:</b> ${[...Object.entries(r.cash).map(([k,v])=>k+' (касса) '+fmt(v)), ...Object.entries(r.fixed).map(([k,v])=>k+' '+fmt(v))].join(' · ') || 'расходов нет'}</div>`).join('')}</details>
  <p class="meta">Налог — ${(D&&D[0]&&D[0].tax_rate)||3}% с выручки (продажи минус возвраты). Себестоимость — по закупочной цене проданных товаров. Зарплата — начислено по табелю (без бонусов и штрафов). Из расходов кассы не учитываются инкассация, зарплата и закуп — они считаются отдельно. Постоянные расходы за неполный месяц берутся пропорционально дням.</p>`}
  <div class="grid2" style="margin-top:14px"><div class="card stack"><b>Добавить постоянный расход</b>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
      <select id="pf-store">${S.allStores.map(st=>`<option value="${st.id}" ${String(PF.add.store)===String(st.id)?'selected':''}>${esc(storeName(st.id))}</option>`).join('')}</select>
      <input type="month" id="pf-month" value="${PF.add.month}">
      <select id="pf-cat">${PF_CATS.map(c=>`<option ${PF.add.cat===c?'selected':''}>${c}</option>`).join('')}</select>
      <input id="pf-amount" type="number" min="1" inputmode="numeric" placeholder="сумма за месяц, ₸" value="${esc(PF.add.amount)}" style="width:160px">
      <input id="pf-note" placeholder="комментарий" value="${esc(PF.add.note)}" style="flex:1;min-width:120px">
      <button class="btn primary" id="pf-add">Добавить</button></div>
    <span class="meta">Аренду и другие ежемесячные расходы вносите на каждый месяц. Расходы из журнала кассы («Расходы») подтягиваются сами.</span></div>
  <div><b>Постоянные расходы за период</b>${(PF.costs||[]).length?`<table><tbody>${PF.costs.map(c=>`<tr><td class="num">${new Date(c.month).toLocaleDateString('ru-RU',{month:'short',year:'numeric'})}</td><td>${esc(storeName(c.store))}</td><td>${esc(c.category)}${c.note?'<br><span class="meta">'+esc(c.note)+'</span>':''}</td><td class="num">${fmt(c.amount)}</td><td><button class="btn small" data-pfdel="${c.id}">✕</button></td></tr>`).join('')}</tbody></table>`:'<div class="meta">Пока ничего не внесено</div>'}</div></div>`;
}

/* ---------- зарплата ---------- */
const PYF = { official:false };
const PY = { month: new Date().toISOString().slice(0,7), data:null, open:null, store:null, day:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'}), sheet:null, add:{ emp:'', hours:'', kind:'sale' } };
async function loadPay(){
  const [y,m] = PY.month.split('-').map(Number), from = `${PY.month}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0,10);
  PY.data = null;
  if(!PY.rules){ const { data } = await sb.rpc('get_pay_rules'); PY.rules = data || {}; }
  const jobs = [ sb.rpc('payroll', { p_from:from, p_to:to, p_stores: isBoss() ? selStores() : null }) ];
  const tabel = S.me && ['owner','manager'].includes(S.me.role);
  if(tabel){ PY.store = PY.store || S.store; jobs.push(sb.rpc('work_hours_list', { p_store:PY.store, p_day:PY.day })); if(!S.emps) jobs.push(loadEmps()); }
  jobs.unshift(sb.rpc('pay_adj_list', { p_month: from }));
  const [aj, p, w] = await Promise.all(jobs);
  if(p.error) toast(errText(p.error)); PY.data = p.data || []; PY.adj = aj.data || [];
  // сотрудники, у которых есть выплаты, но нет часов в этом месяце
  const have = new Set(PY.data.map(e=>e.employee));
  for(const a of PY.adj) if(!have.has(a.employee)){ have.add(a.employee);
    const em = (S.emps||[]).find(x=>x.id===a.employee) || (S.me.id===a.employee ? { full_name:S.me.full_name } : null);
    PY.data.push({ employee:a.employee, name: em ? em.full_name : '—', total:0, hours:0, days:[] }); }
  if(w) PY.sheet = w.data || [];
}
const tabelOk = () => S.me && ['owner','manager'].includes(S.me.role);
function payRuleText(r){
  if(!r) return 'для магазина нет правила';
  if(r.mode==='each') return `каждому ${r.pct}% от продаж дня, минимум ${fmt(r.min)}`;
  return `${r.pct_high===r.pct_low?r.pct_high+'%':r.pct_high+'%, если по часам работало больше одного человека, иначе '+r.pct_low+'%'} от продаж дня делится по часам${r.min_div?' (минимум на '+r.min_div+' ч)':''}; минимум ${fmt(r.min_full)} за полную смену ${r.full} ч, за неполную — ${fmt(r.min_hour)}/ч`;
}
function payLine(x){
  const r = x.rule || {}, d = new Date(x.day+'T00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',weekday:'short'});
  let f;
  if(x.kind==='dress') f = `переодевание: ${x.hours} ч × ${fmt(1200)} = ${fmt(x.amount)}`;
  else if(r.mode==='each'){ const base = Math.round(x.sales*x.pct/100); f = `продажи ${fmt(x.sales)} × ${x.pct}% = ${fmt(base)}${x.amount>base?` → минимум ${fmt(x.amount)}`:''}`; }
  else { const div = Math.max(x.team_hours, r.min_div||0), base = Math.round(x.rate*x.hours);
    f = `продажи ${fmt(x.sales)} × ${x.pct}% ÷ ${div} ч${r.min_div&&div>x.team_hours?' (минимум '+r.min_div+')':''} = ${fmt(x.rate)}/ч × ${x.hours} ч = ${fmt(base)}${x.amount>base?` → минимум ${fmt(x.amount)}${x.hours==r.full?' за полную смену':' ('+fmt(r.min_hour)+'/ч)'}`:''}`; }
  const team = (x.team||[]).map(t=>esc(t.name)+' '+t.hours+' ч').join(', ');
  return `<tr><td class="num">${d}</td><td>${esc(storeName(x.store))}<br><span class="meta">${x.kind==='dress'?'переодевание':'на смене: '+team}</span></td><td class="meta">${f}</td><td class="num"><b>${fmt(x.amount)}</b></td></tr>`;
}
const PADJ = { bonus:['Бонус',1], audit:['Доплата за ревизию',1], carry_in:['Долг с прошлого месяца',1], fine:['Штраф',-1], overpay:['Переплата в прошлом месяце',-1], advance:['Аванс',0], paid:['Выплачено наличными',0], card:['Переведено на карту',0] };
function paySum(e){
  const A = (PY.adj||[]).filter(a=>a.employee===e.employee), by = k => A.filter(a=>a.kind===k).reduce((s,a)=>s+ +a.amount,0);
  const plus = by('bonus')+by('audit')+by('carry_in'), minus = by('fine')+by('overpay');
  const due = e.total + plus - minus, paid = by('advance')+by('paid')+by('card');
  return { A, by, plus, minus, due, paid, rest: due - paid };
}
function consHtml(){
  const C = (S.emps||[]).filter(e=>e.role==='consultant').sort((a,b)=>(b.active-a.active)||a.full_name.localeCompare(b.full_name,'ru'));
  const noTg = C.filter(e=>e.active&&!e.telegram_id).length, noPh = C.filter(e=>e.active&&!e.phone).length;
  return `<details class="card" style="margin-top:12px" ${PY.consOpen?'open':''} id="py-cons"><summary><b>Консультанты и Telegram-бот (${C.filter(e=>e.active).length})</b>${noTg?` <span class="chip warn">без Telegram: ${noTg}</span>`:''}</summary>
    <p class="meta">Чтобы консультант пользовался ботом: впишите телефон → консультант открывает бота, жмёт «Поделиться номером». Без телефона${noPh?` (сейчас таких ${noPh})`:''} бот его не узнает.</p>
    <div class="scroll"><table><tbody>${C.map(e=>`<tr style="${e.active?'':'opacity:.55'}"><td>${esc(e.full_name)}<br><input class="small" data-ephone="${e.id}" value="${esc(e.phone||'')}" placeholder="телефон" inputmode="tel" style="width:140px;margin-top:4px"></td>
      <td>${storesDD(e.store_ids||(e.home_store_id?[e.home_store_id]:[]), id=>`data-estores="${e.id}:${id}"`)}</td>
      <td>${e.telegram_id?'<span class="chip ok">Telegram ✓</span>':'<span class="meta">не подключён</span>'}<br><label class="meta"><input type="checkbox" data-eoff="${e.id}" ${e.official?'checked':''}> офиц.</label> <label class="meta"><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''}> работает</label></td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-top:8px"><input id="nc-name" placeholder="Имя консультанта"><input id="nc-phone" placeholder="+7 7__ ___ __ __" inputmode="tel" style="width:150px">
      ${storesDD([], id=>`class="nc-store" value="${id}"`)}<button class="btn primary" id="nc-add">Добавить консультанта</button></div></details>`;
}
function renderPay(){
  const D0 = PY.data, D = D0 && PYF.official ? D0.filter(e=>e.official) : D0, tabel = tabelOk() && !isViewer();
  const mode = tabel ? (PY.mode||'calc') : 'calc';
  const stEmps = (S.emps||[]).filter(e => e.active && (!e.store_ids || !e.store_ids.length || e.store_ids.includes(+PY.store)));
  if(!document.getElementById('pay-css')){ const st = document.createElement('style'); st.id = 'pay-css'; st.textContent = `.pay-tbl td,.pay-tbl th{padding:6px 8px;vertical-align:middle}.pay-tbl th{font-size:12px;white-space:nowrap}.pay-tbl td.num{white-space:nowrap}.pay-tbl tfoot td{border-top:2px solid var(--line);font-weight:600}.pay-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0 10px}.pay-kpi>div{border:1px solid var(--line);border-radius:12px;padding:8px 12px}.pay-kpi b{display:block;font-size:18px}.pay-det{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(260px,1fr);gap:12px;padding:6px 0 12px}@media(max-width:800px){.pay-det{grid-template-columns:1fr}}.pay-det table td{padding:4px 6px;font-size:13px}`; document.head.append(st); }
  const T = (D||[]).map(paySum).reduce((a,p)=>({due:a.due+p.due, cash:a.cash+p.paid-p.by('card'), card:a.card+p.by('card'), rest:a.rest+p.rest}),{due:0,cash:0,card:0,rest:0}), total = (D||[]).reduce((a,e)=>a+e.total,0);
  const head = `<div class="row" style="flex-wrap:wrap;gap:8px"><h2 style="margin:0">${isBoss()?'Зарплата':'Моя зарплата'}</h2>
    ${tabel?`<div class="seg"><button data-pymode="calc" aria-pressed="${mode==='calc'}">Расчёт за месяц</button><button data-pymode="tabel" aria-pressed="${mode==='tabel'}">Табель часов</button></div>`:''}
    ${mode==='calc'?`<label class="meta">Месяц <input type="month" id="py-month" value="${PY.month}"></label>`:''}</div>`;
  if(mode==='tabel'){
    const shift = n => { const d = new Date(PY.day+'T12:00'); d.setDate(d.getDate()+n); return d.toLocaleDateString('sv-SE'); };
    $('#main').innerHTML = `${head}
    <div class="card stack" style="margin-top:10px;gap:10px">
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px"><select id="py-store">${S.stores.map(s=>`<option value="${s.id}" ${+PY.store===s.id?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select>
        <button class="btn small" data-pyday="${shift(-1)}" title="Предыдущий день">‹</button><input type="date" id="py-day" value="${PY.day}"><button class="btn small" data-pyday="${shift(1)}" title="Следующий день">›</button></div>
      <span class="meta">Правило магазина: ${esc(payRuleText((PY.rules||{})[String(PY.store)]))}</span>
      ${(PY.sheet||[]).length?`<table class="pay-tbl"><thead><tr><th>Консультант</th><th>Часы</th><th></th></tr></thead><tbody>${PY.sheet.map(w=>`<tr><td><b>${esc(w.name)}</b>${w.kind==='dress'?' <span class="chip">переодевание</span>':''}${w.status==='open'?` <span class="chip warn">на смене с ${esc(w.from||'')}</span>`:w.status==='pending'?` <span class="chip warn" title="Отмечено в Telegram, ждёт подтверждения">ждёт подтверждения</span>`:''}${w.from&&w.status!=='open'?` <span class="meta">${esc(w.from)}–${esc(w.to||'')} · Telegram</span>`:''}</td>
        <td style="white-space:nowrap"><input type="number" min="0" max="24" step="0.5" value="${w.hours}" data-pyh="${w.employee}:${w.kind}" inputmode="decimal" style="width:70px"> ч</td>
        <td><button class="btn small" data-pydel="${w.employee}:${w.kind}" title="Убрать из табеля">✕</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty" style="padding:10px">В этот день в табеле никого нет. Кто открывает смену в боте — попадает сюда сам.</div>'}
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;border-top:1px solid var(--line);padding-top:10px"><b style="margin-right:4px">Добавить:</b>
        <select id="py-emp"><option value="">Консультант…</option>${stEmps.map(e=>`<option value="${e.id}" ${PY.add.emp===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}</select>
        <input id="py-hours" type="number" min="0.5" max="24" step="0.5" placeholder="часы" value="${esc(PY.add.hours)}" inputmode="decimal" style="width:80px">
        <select id="py-kind"><option value="sale" ${PY.add.kind==='sale'?'selected':''}>продажи</option><option value="dress" ${PY.add.kind==='dress'?'selected':''}>переодевание (1 200/ч)</option></select>
        <button class="btn primary small" id="py-add">Добавить</button></div>
      <span class="meta">Консультанты отмечают приход и уход в Telegram-боте, в 22:30 менеджеру приходит сводка «Подтвердить / Скорректировать». Часы, изменённые здесь, сразу считаются подтверждёнными. Список консультантов и телефоны — во вкладке «Консультанты».</span>
    </div>`;
    return;
  }
  $('#main').innerHTML = `${head}
  ${isBoss()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;margin-top:8px"><label class="chip ${PYF.official?'ok':''}" style="cursor:pointer;padding:4px 10px"><input type="checkbox" id="py-official" ${PYF.official?'checked':''} style="margin-right:4px">только официальные</label></div>`:''}
  ${D&&D.length?`<div class="pay-kpi"><div><span class="meta">Начислено</span><b>${fmt(total)}</b></div><div><span class="meta">К выплате</span><b>${fmt(T.due)}</b></div><div><span class="meta">Выдано наличными</span><b>${fmt(T.cash)}</b></div><div><span class="meta">Переведено на карту</span><b>${fmt(T.card)}</b></div><div><span class="meta">Осталось выплатить</span><b style="color:${T.rest>0?'inherit':'var(--ok)'}">${fmt(T.rest)}</b></div></div>`:''}
  <p class="meta" style="margin:0 0 8px">💰 ${advanceText(PY.month)} · <details style="display:inline"><summary style="display:inline;cursor:pointer;text-decoration:underline dotted">как считается</summary> ${['Курмангазы, Толе би, Гагарина — 12/10% от продаж дня по часам','MOON Курмангазы — 5%','Астана — 6% Sunshine, 3% MOON'].join(' · ')}. Без штрафов и удержаний.</details></p>
  ${!D?'<div class="empty">Считаем…</div>':!D.length?'<div class="empty">За этот месяц нет часов в табеле</div>':`<div class="scroll"><table class="pay-tbl"><thead><tr><th>Сотрудник</th><th>Часы</th><th>Начислено</th><th>Бонусы</th><th>К выплате</th><th>Наличными</th><th>На карту</th><th>Остаток</th></tr></thead><tbody>
   ${D.map(e=>{ const P = paySum(e), open = PY.open===e.employee || D.length===1; return `<tr style="${open?'background:var(--soft)':''}"><td><button class="btn small" data-pyopen="${e.employee}" style="border:0;background:none;padding:0;font-weight:600;text-align:left">${open?'▾':'▸'} ${esc(e.name)}</button>${e.official?' <span class="chip ok" title="Официально трудоустроен">офиц.</span>':''}</td><td class="num">${e.hours}</td><td class="num">${fmt(e.total)}</td>
     <td class="num">${P.plus?'+'+fmt(P.plus):''}${P.minus?' <span style="color:var(--bad)">−'+fmt(P.minus)+'</span>':''}</td><td class="num"><b>${fmt(P.due)}</b></td><td class="num">${P.paid-P.by('card')?fmt(P.paid-P.by('card')):'—'}</td><td class="num">${P.by('card')?fmt(P.by('card')):'—'}</td>
     <td class="num" style="color:${P.rest<0?'var(--bad)':P.rest>0?'inherit':'var(--ok)'}"><b>${P.rest<0?'переплата '+fmt(-P.rest):P.rest===0?'✓':fmt(P.rest)}</b></td></tr>
     ${open?`<tr><td colspan="8" style="background:var(--soft)"><div class="pay-det">
       <div>${e.days.length?`<b>По дням</b><div class="scroll"><table><tbody>${e.days.map(payLine).join('')}</tbody></table></div>`:'<span class="meta">Смен в этом месяце нет</span>'}</div>
       <div class="cust stack" style="gap:6px;align-self:start"><b>Расчёт</b>
         <div class="row"><span>Начислено по продажам</span><span class="num">${fmt(e.total)}</span></div>
         ${P.A.map(a=>`<div class="row"><span>${PADJ[a.kind][0]}${a.note?' <span class="meta">— '+esc(a.note)+'</span>':''} <span class="meta">${dshort(a.at)}</span></span><span class="num">${PADJ[a.kind][1]>0?'+':PADJ[a.kind][1]<0?'−':''}${fmt(a.amount)}${tabelOk()?` <button class="btn small" data-padel="${a.id}" title="Удалить">✕</button>`:''}</span></div>`).join('')}
         <div class="row" style="border-top:1px solid var(--line);padding-top:6px"><b>${P.rest<0?'Переплата (учесть в следующем месяце)':'Остаток к выплате'}</b><b class="num">${fmt(Math.abs(P.rest))}</b></div>
         ${tabelOk()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
           <select id="pa-kind-${e.employee}">${Object.entries(PADJ).filter(([k])=>k!=='fine').map(([k,[t]])=>`<option value="${k}">${t}</option>`).join('')}</select>
           <input id="pa-amt-${e.employee}" type="number" min="1" inputmode="numeric" placeholder="сумма" style="width:100px">
           <input id="pa-note-${e.employee}" placeholder="комментарий" style="flex:1;min-width:110px">
           <button class="btn small primary" data-paadd="${e.employee}">Добавить</button></div>
           ${P.rest>0?`<div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"><button class="btn small" data-papayall="${e.employee}" data-rest="${Math.round(P.rest)}" data-kind="paid">Выдать ${fmt(P.rest)} наличными</button><button class="btn small" data-papayall="${e.employee}" data-rest="${Math.round(P.rest)}" data-kind="card">Перевести ${fmt(P.rest)} на карту</button></div>`:''}`:''}
       </div></div></td></tr>`:''}`; }).join('')}</tbody>
   ${D.length>1?`<tfoot><tr><td>Итого</td><td></td><td class="num">${fmt(total)}</td><td></td><td class="num">${fmt(T.due)}</td><td class="num">${fmt(T.cash)}</td><td class="num">${fmt(T.card)}</td><td class="num">${fmt(T.rest)}</td></tr></tfoot>`:''}</table></div>`}
  ${!tabel && !isBoss()?`<div class="card meta" style="margin-top:10px">Часы в табель ставит менеджер. Если видите ошибку в часах — напишите менеджеру.</div>`:''}`;
}
document.addEventListener('click', async e => { if(S.view!=='pay') return; const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.pymode){ PY.mode = t.dataset.pymode; render(); }
  else if(t.dataset.pyday){ PY.day = t.dataset.pyday; await loadPay(); render(); }
});

/* ---------- мой день: список дел по роли ---------- */
const NM_FLAG = { photo:'с фото', noprice:'без розничной цены', nocost:'без закупочной цены', nourl:'без ссылки на поставщика', nocat:'без категории', nophoto:'без фото' };
const DAY = { role:null, data:null, sug:null, store:null };
const DAY_ROLES = [['own','Владелец'],['mgr','Менеджер магазина'],['buy','Закуп'],['sell','Продавец']];
const dayDefRole = () => ({ owner:'own', viewer:'own', purchaser:'buy', consultant:'sell' })[S.me.role] || 'mgr';
async function loadDay(){
  if(!DAY.role) DAY.role = dayDefRole();
  // сводку показываем сразу из прошлого раза, свежую грузим параллельно с делами (раньше шло по очереди и долго)
  if(DAY.role==='own'){ if(!DAY.pulse){ const c = ls.get('silver_pulse', null); if(c){ DAY.pulse = c; render(); } } loadPulse(); }
  else if(DAY.role!=='sell' && S.me.role!=='consultant') loadSPulse();
  const { data, error } = await sb.rpc('my_day', { p_store: DAY.store || S.store || null });
  if(error){ toast(errText(error)); DAY.data = { mgr:[], buy:[], sell:[] }; } else DAY.data = data;
  if(DAY.role==='buy') loadDaySug();
  if(S.me.role==='owner') wuLoadLast(); else if(S.me.role!=='consultant' && !WU.srv) wuLoadSrv();
  if(S.canAttn && !S.attn) loadAttn().then(() => { if(S.view==='day') render(); });
}
async function loadSPulse(){ if(!DAY.spulse){ DAY.spulse = ls.get('silver_spulse', null); DAY.spulseWait = !DAY.spulse; }
  const { data, error } = await sb.rpc('sales_pulse'); DAY.spulseWait = false; if(!error && data){ DAY.spulse = data; ls.set('silver_spulse', data); } if(S.view==='day') render(); }
async function loadPulse(){ const { data, error } = await sb.rpc('owner_pulse'); if(error) return toast(errText(error)); DAY.pulse = data; ls.set('silver_pulse', data); if(S.view==='day') render(); if(!data.ai) loadAiSpend(); loadCashStat(); anStatus(); bkInfo(); }
/* наличные в кассе: остаток по тетради + наличные продажи Wipon с тех пор − расходы, внесённые в Silver */
async function loadCashStat(){ const { data, error } = await sb.rpc('cash_status'); if(error) return; DAY.cash = {}; (data||[]).forEach(c => DAY.cash[c.store] = c); if(['day','cash'].includes(S.view)) render(); }
function cashCell(x){ const c = (DAY.cash||{})[x.id]; if(!c) return '<span class="meta">…</span>'; if(c.est_kzt == null) return '<span class="meta">нет данных</span>';
  const dd = String(c.snap_day||'').slice(8,10)+'.'+String(c.snap_day||'').slice(5,7);
  const tip = `Остаток по тетради на конец ${dd}: ${fmt(c.snap_kzt)}${+c.snap_usd?' и $'+(+c.snap_usd).toLocaleString('ru-RU'):''}. Плюс наличные продажи по Wipon с тех пор: ${fmt(c.cash_since)}.${+c.moves_since?' Минус расходы и сдача денег, внесённые в Silver: '+fmt(c.moves_since)+'.':''} Расходы после этой даты учтены, только если внесены в Silver, — реальная сумма может быть меньше.${c.snap_note?' Источник: '+c.snap_note:''}`;
  return `<span title="${esc(tip)}"><b class="num">${fmt(c.est_kzt)}</b>${+c.snap_usd?` <b class="num">· $${(+c.snap_usd).toLocaleString('ru-RU')}</b>`:''}<br><span class="meta" style="font-size:11px">по тетради на ${dd}: ${fmt(c.snap_kzt)} + наличные продажи с тех пор ${fmt(c.cash_since)}${+c.moves_since?' − расходы '+fmt(c.moves_since):''}</span></span>`; }
/* расход на Grok (AI): сегодня и с начала месяца — из таблицы ai_usage */
async function loadAiSpend(){
  const now = new Date(), day = now.toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'}), m0 = day.slice(0,8)+'01';
  const [{ data }, { data:rt }] = await Promise.all([ sb.from('ai_usage').select('at,cost_usd').gte('at', m0+'T00:00:00+05:00').limit(10000),
    sb.from('settings').select('value').eq('key','usd_kzt').maybeSingle() ]);
  const R = data || [], sum = L => L.reduce((a,x)=>a+(+x.cost_usd||0),0), td = R.filter(x => new Date(x.at).toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'})===day);
  DAY.ai = { today:sum(td), month:sum(R), n_today:td.length, n_month:R.length, rate:+(rt&&rt.value)||520 }; if(S.view==='day') render(); }
function aiTile(P){ const A = P.ai ? { rate:520, ...(DAY.ai||{}), ...P.ai } : DAY.ai; if(!A) return '';
  const usd = v => '$'+(+v||0).toFixed((+v||0)<10?2:0), kzt = v => fmt(Math.round((+v||0)*(A.rate||520)));
  return `<div class="card" style="flex:1;min-width:170px;padding:10px 12px" title="Grok (xAI): AI-фото и распознавание отчётов смен · Claude: контент-план и разбор"><div class="meta">Расход на ИИ</div><div style="font-size:22px;font-weight:700" class="num">${usd(A.today)} <span class="meta" style="font-size:13px;font-weight:400">≈ ${kzt(A.today)} сегодня</span></div><div class="meta">с начала месяца ${usd(A.month)} ≈ ${kzt(A.month)} · ${(+(A.n_month||0)).toLocaleString('ru-RU')} запросов</div></div>`; }
/* у команды в работе: дела менеджера и закупа (их не дублируем владельцу) */
function teamLine(D){ if(!D) return ''; const c = L => (L||[]).filter(i => +i.n > 0).length, m = c(D.mgr), b = c(D.buy);
  return `<div class="card row" style="flex-wrap:wrap;gap:8px;padding:8px 12px;margin-top:10px"><span style="flex:1;min-width:200px">У команды в работе: менеджер — <b>${m}</b>, закуп — <b>${b}</b> <span class="meta">· эти дела в их списках, вам за ними следить не нужно</span></span>
    <button class="btn small" data-dayrole="mgr">Дела менеджера →</button><button class="btn small" data-dayrole="buy">Дела закупа →</button></div>`; }
/* точка безубыточности магазина: постоянные расходы месяца ÷ доля, что остаётся с продажи после себестоимости и налога */
function beCell(x){
  const m = +x.be_margin, fx = (+x.be_fixed||0) + (+x.be_opex||0); if(!(m>0) || !fx) return '<span class="meta">нет расходов</span>';
  const be = Math.round(fx / m / 1000) * 1000, now = new Date(), dim = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const done = Math.round(+x.mtd / be * 100), need = Math.round((now.getDate() - 1 + now.getHours()/24) / dim * 100);
  const cats = String(x.be_cats||''), miss = [/аренд/i.test(cats)?'':'аренда'].filter(Boolean);
  return `<b class="num">${fmt(be)}</b><br><span class="chip ${done>=100?'ok':done>=need?'ok':'warn'}" title="к этому дню по плану нужно ${need}%">${done>=100?'✓ пройдена':done+'% · надо '+need+'%'}</span>${miss.length?` <span class="chip zero" title="Не внесено в «Рентабельность → расходы магазина»">нет: ${miss.join(', ')}</span>`:''}`;
}
/* разбор ИИ (Claude) для владельца: ежедневный разбор (сервер, 08:05) + вопросы. Карточка — в самом верху «Моего дня» */
const AN = { busy:false, text:'', q:'', st:null, key:false, d:null, dBusy:false, dErr:'' };
/* разбор ИИ всегда открывается свёрнутым; разворачивается по клику (состояние помним только до перезагрузки) */
function anOpen(){ return !!AN.open; }
function anFmt(t){ const out = []; let ul = false;
  for(const raw of String(t||'').split('\n')){ const l = raw.trim();
    const m = l.match(/^[-•*]\s+(.*)$/);
    if(m){ if(!ul){ out.push('<ul style="margin:2px 0 6px;padding-left:20px">'); ul = true; } out.push((/^\s{2,}/.test(raw)?'<li style="margin-left:16px;list-style:circle">':'<li>')+anInl(m[1])+'</li>'); continue; }
    if(ul){ out.push('</ul>'); ul = false; }
    if(!l) continue;
    const h = l.match(/^#+\s*(.*)$/) || l.match(/^\*\*(.+?)\*\*:?$/);
    out.push(h ? `<div style="font-weight:700;margin:10px 0 2px">${anInl(h[1].replace(/\*\*/g,''))}</div>` : `<div style="margin:2px 0">${anInl(l)}</div>`); }
  if(ul) out.push('</ul>'); return out.join(''); }
function anInl(x){ return esc(x).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); }
function anAt(iso){ if(!iso) return ''; const d = new Date(iso); if(isNaN(d)) return '';
  return d.toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit'}); }
function anKeyForm(primary){ return `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><input id="an-key" type="password" placeholder="sk-ant-…" autocomplete="off" style="flex:1;min-width:200px"><button class="btn small${primary?' primary':''}" id="an-key-save">Сохранить ключ</button></div>`; }
function anHtml(){
  const st = AN.st;
  if(st && !st.ai) return `<div class="card" style="margin:0 0 12px"><b>✨ Разбор дня от ИИ</b><p class="meta" style="margin:4px 0 8px">Подключите ключ Anthropic — и Claude каждое утро будет разбирать цифры сети: вчера, неделя, месяц, тенденции и на что обратить внимание. Ключ: console.anthropic.com → API Keys → Create Key. Хранится на сервере, в браузер не возвращается.</p>${anKeyForm(true)}</div>`;
  const d = AN.d, open = anOpen(), off = !st || AN.dBusy || AN.busy;
  const body = AN.dBusy ? `<p class="meta" style="margin:8px 0">Claude разбирает цифры… (~30–60 сек)</p>`
    : AN.dErr ? `<p class="meta" style="margin:8px 0;color:var(--bad,#c33)">${esc(AN.dErr)}</p>`
    : d && d.text ? `<div style="line-height:1.5;margin-top:6px">${anFmt(d.text)}</div>`
    : d ? `<p class="meta" style="margin:8px 0">Разбора ещё нет — он появится завтра в 8:05 или нажмите «Обновить».</p>`
    : `<p class="meta" style="margin:8px 0">Загружаю разбор…</p>`;
  return `<details class="card" id="an-card" style="margin:0 0 12px" ${open?'open':''}>
    <summary class="row" style="cursor:pointer;flex-wrap:wrap;gap:8px;list-style:none"><b style="flex:1">✨ Разбор дня от ИИ</b>${d&&d.at?`<span class="meta">обновлено ${anAt(d.at)}</span>`:''}
      <button class="btn small primary" id="an-daily" ${off?'disabled':''}>${AN.dBusy?'Думает… (~30–60 сек)':'Обновить'}</button></summary>
    ${body}
    <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap"><input id="an-q" placeholder="Спросите: почему просел Толе би? где взять 2 млн до конца месяца?" value="${esc(AN.q)}" style="flex:1;min-width:200px"><button class="btn small" id="an-ask" ${off?'disabled':''}>${AN.busy?'Думает…':'Спросить'}</button></div>
    ${AN.text?`<div style="line-height:1.5;margin-top:10px;padding-top:8px;border-top:1px solid var(--line,#ddd)">${anFmt(AN.text)}</div>`:''}
    <details style="margin-top:8px"><summary class="meta" style="cursor:pointer">Сменить ключ Claude</summary>${anKeyForm(false)}</details></details>`;
}
async function anErr(error){ let m = error.message; try{ m = (await error.context.json()).error || m; }catch(_){} return m==='no_key'?'Ключ Claude не подключён':m; }
async function anStatus(){ if(!AN.st){ const { data } = await sb.functions.invoke('content', { body:{ action:'status' } }); AN.st = data || { ai:false }; }
  if(AN.st.ai && !AN.d && !AN.dBusy){ const { data, error } = await sb.functions.invoke('content', { body:{ action:'daily_get' } }); AN.d = error ? { text:'', at:null } : (data || { text:'', at:null }); }
  if(S.view==='day') render(); }
document.addEventListener('toggle', e => { if(e.target && e.target.id==='an-card') AN.open = e.target.open; }, true);
document.addEventListener('click', async e => { if(S.view!=='day') return; const t = e.target.closest('button'); if(!t) return;
  if(t.id==='an-key-save'){ const k = ($('#an-key').value||'').trim(); if(!k) return; t.disabled = true;
    const { error } = await sb.functions.invoke('content', { body:{ action:'set_key', key:k } });
    if(error){ t.disabled = false; return toast(await anErr(error)); }
    AN.st = null; AN.d = null; CT.ai = null; toast('Ключ Claude сохранён'); await anStatus(); }
  else if(t.id==='an-daily'){ e.preventDefault(); e.stopPropagation(); AN.dBusy = true; AN.dErr = ''; AN.open = true; render();
    const { data, error } = await sb.functions.invoke('content', { body:{ action:'daily' } }); AN.dBusy = false;
    if(error){ AN.dErr = await anErr(error); render(); return; }
    AN.d = { text:data.text||'', at:data.at }; render(); }
  else if(t.id==='an-ask'){ AN.q = ($('#an-q').value||'').trim(); if(!AN.q) return toast('Напишите вопрос');
    AN.busy = true; render();
    const { data, error } = await sb.functions.invoke('content', { body:{ action:'analyze', question:AN.q } }); AN.busy = false;
    if(error){ toast(await anErr(error)); render(); return; }
    AN.text = data.text || ''; DAY.ai = null; render(); }
});
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('button[data-pday]'); if(!t || S.view!=='day') return; DAY.pday = t.dataset.pday; render(); });
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('button[data-pgrp]'); if(!t || S.view!=='day') return; DAY.pgrp = t.dataset.pgrp; try{ localStorage.setItem('silver_pgrp', DAY.pgrp); }catch(_){} render(); });
try{ DAY.pgrp = localStorage.getItem('silver_pgrp') || 'all'; }catch(_){}
/* сводка по магазинам: владельцу — с наличными в кассе; менеджеру и закупу (lite) — только продажи */
function storesHtml(P, lite){
  const St = P.stores || [], sum = k => St.reduce((a,x)=>a+(+x[k]||0),0), pct = (a,b) => b>0 ? Math.round((a-b)/b*100) : null;
  const chip = v => v==null ? '<span class="meta">—</span>' : `<span class="chip ${v>=0?'ok':'zero'}">${v>0?'+':''}${v}%</span>`;
  const yd = DAY.pday==='y' && St.some(x => 'yday' in x);
  return `    <div class="row" style="margin:16px 0 6px;gap:10px;flex-wrap:wrap;justify-content:flex-start"><h3 style="margin:0">Магазины</h3><div class="seg" role="group" aria-label="День">${[['t','Сегодня'],['y','Вчера']].map(([k,t])=>`<button data-pday="${k}" aria-pressed="${(DAY.pday||'t')===k}">${t}</button>`).join('')}</div>${yd?`<span class="meta">вчера всего ${fmt(sum('yday'))} · чеков ${sum('chk_yday').toLocaleString('ru-RU')}</span>`:''}</div>
    ${(()=>{ // коротко: выручка + % к прошлой неделе, месяц в млн + %, наличные одной цифрой; группировка: все / по городам / по брендам, с итогами
      const mln = v => (+v||0) >= 1e6 ? ((+v)/1e6).toLocaleString('ru-RU',{maximumFractionDigits:2})+' млн ₸' : fmt(v);
      const cashV = x => { const c = (DAY.cash||{})[x.id]; return c && c.est_kzt!=null ? +c.est_kzt : null; };
      const cashN = x => { const c = (DAY.cash||{})[x.id]; return !c?'…':c.est_kzt==null?'—':fmt(c.est_kzt)+(+c.snap_usd?' · $'+(+c.snap_usd).toLocaleString('ru-RU'):''); };
      const city = x => { const z = (S.allStores||[]).find(q => q.id===x.id); return (z && z.city) || x.city || ([4,5,7].includes(+x.id) ? 'Астана' : 'Алматы'); };
      const g = DAY.pgrp || 'all';
      const dv = x => yd ? [+x.yday||0, +x.yday_week_ago||0] : [+x.today||0, +x.week_ago||0];
      const flags = x => (+x.returns_2d?` <span class="chip warn" title="Возвраты за 2 дня">↩ ${x.returns_2d}</span>`:'');
      const nm = x => `<b style="font-weight:600">${esc(x.address)}</b> <span class="meta">${esc(g==='brand'?city(x):g==='city'?(BRAND[x.brand]||''):(BRAND[x.brand]||'')+' · '+city(x))}</span>${flags(x)}`;
      const tot = L => { const d = L.reduce((a,x)=>{ const [v,w] = dv(x); a[0]+=v; a[1]+=w; a[2]+=+x.mtd||0; a[3]+=+x.mtd_prev||0; const c = cashV(x); if(c!=null) a[4]+=c; return a; }, [0,0,0,0,0]); return d; };
      const groups = g==='all' ? [['', St]] : [...St.reduce((m,x)=>{ const k = g==='city' ? city(x) : (BRAND[x.brand]||x.brand); (m.get(k) || m.set(k, []).get(k)).push(x); return m; }, new Map())];
      const seg = `<div class="seg" role="group" aria-label="Группировка" style="margin:0 0 8px">${[['all','Все магазины'],['city','По городам'],['brand','По брендам']].map(([k,t])=>`<button data-pgrp="${k}" aria-pressed="${g===k}">${t}</button>`).join('')}</div>`;
      const T0 = tot(St);
      if(isPhone()){
        const card = x => { const [v,w] = dv(x); return `<div class="pc"><div class="pc-h">${nm(x)}</div><div class="pc-g">
          <div><span class="pc-l">${yd?'Вчера':'Сегодня'}</span><b class="num">${fmt(v)}</b> ${chip(pct(v,w))}</div>
          <div><span class="pc-l">Месяц</span><b class="num">${mln(x.mtd)}</b> ${chip(pct(+x.mtd,+x.mtd_prev))}</div>
          ${lite?'':`<div><span class="pc-l">В кассе</span><b class="num">${cashN(x)}</b></div>`}</div></div>`; };
        const sumLine = (t, d) => `<div class="pc st-tot"><div class="pc-h"><b>${esc(t)}</b></div><div class="pc-g"><div><span class="pc-l">${yd?'Вчера':'Сегодня'}</span><b class="num">${fmt(d[0])}</b> ${chip(pct(d[0],d[1]))}</div><div><span class="pc-l">Месяц</span><b class="num">${mln(d[2])}</b> ${chip(pct(d[2],d[3]))}</div>${lite?'':`<div><span class="pc-l">В кассе</span><b class="num">${fmt(d[4])}</b></div>`}</div></div>`;
        return seg + `<div class="pc-list">${groups.map(([k,L]) => (k?sumLine(k, tot(L)):'') + L.map(card).join('')).join('')}${sumLine('Итого по сети', T0)}</div>`;
      }
      const row = x => { const [v,w] = dv(x); return `<tr><td>${nm(x)}</td><td class="num"><b style="font-size:16px">${fmt(v)}</b> ${chip(pct(v,w))}</td><td class="num">${mln(x.mtd)} ${chip(pct(+x.mtd,+x.mtd_prev))}</td>${lite?'':`<td class="num">${cashN(x)}</td>`}</tr>`; };
      const trow = (t, d, cls) => `<tr class="${cls}"><td><b>${esc(t)}</b></td><td class="num"><b style="font-size:16px">${fmt(d[0])}</b> ${chip(pct(d[0],d[1]))}</td><td class="num"><b>${mln(d[2])}</b> ${chip(pct(d[2],d[3]))}</td>${lite?'':`<td class="num"><b>${fmt(d[4])}</b></td>`}</tr>`;
      return seg + `<div class="scroll"><table class="st-sum"><thead><tr><th>Магазин</th><th>${yd?'Вчера':'Сегодня'} <span class="meta">к прошл. неделе</span></th><th>Месяц <span class="meta">к прошл. месяцу</span></th>${lite?'':'<th title="Остаток по последней странице тетради + наличные продажи Wipon после неё − расходы, внесённые в Silver">В кассе</th>'}</tr></thead><tbody>
        ${groups.map(([k,L]) => (k?trow(k, tot(L), 'st-grp'):'') + L.map(row).join('')).join('')}${trow('Итого по сети', T0, 'st-total')}</tbody></table></div>`; })()}`;
}
function pulseHtml(P){
  if(!P) return '<div class="empty">Собираем картину по сети…</div>';
  const St = P.stores || [], sum = k => St.reduce((a,x)=>a+(+x[k]||0),0), pct = (a,b) => b>0 ? Math.round((a-b)/b*100) : null;
  const chip = v => v==null ? '<span class="meta">—</span>' : `<span class="chip ${v>=0?'ok':'zero'}">${v>0?'+':''}${v}%</span>`;
  const T = sum('today'), W = sum('week_ago'), M = sum('mtd'), MP = sum('mtd_prev'), C = sum('chk_today');
  const yd = DAY.pday==='y' && St.some(x => 'yday' in x);
  const fresh = t => { if(!t) return '<span class="chip zero">нет</span>'; const h = (Date.now()-new Date(t))/36e5; return `<span class="chip ${h>3?'warn':'ok'}">${h<1?'<1 ч':Math.round(h)+' ч'} назад</span>`; };
  // владельцу — только просрочки и то, что не входит ни в чей список; обычные дела менеджера и закупа не дублируем
  const k = P.stuck || {}, stuck = [
    [k.transit_old, 'Просрочено у менеджера: товар в пути не принят дольше 4 дней', 'wh'], [k.transfers_old, 'Просрочено у менеджера: перемещения не приняты дольше 3 дней', 'wh'],
    [k.writeoffs_old, 'Ваше решение: списания ждут дольше 2 дней', 'wh'], [k.negative, 'Отрицательные остатки — проверить пересортицу (ни в чьём списке)', 'wh:stock'] ].filter(x => +x[0] > 0);
  const tile = (t, v, sub) => `<div class="card" style="flex:1;min-width:170px;padding:10px 12px"><div class="meta">${t}</div><div style="font-size:22px;font-weight:700" class="num">${v}</div><div class="meta">${sub}</div></div>`;
  return `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:stretch">
      ${tile('Выручка сегодня', fmt(T), `${chip(pct(T,W))} к прошлой неделе на это время`)}
      ${tile('Чеков сегодня', C.toLocaleString('ru-RU'), T&&C?'средний чек '+fmt(Math.round(T/C)):'')}
      ${tile('С начала месяца', fmt(M), `${chip(pct(M,MP))} к тому же периоду прошлого месяца`)}${aiTile(P)}</div>
    ${storesHtml(P)}
    ${(()=>{ const C = Object.values(DAY.cash||{}).filter(c=>c.est_kzt!=null); if(!C.length) return ''; const k = C.reduce((a,c)=>a+(+c.est_kzt||0),0), u = C.reduce((a,c)=>a+(+c.snap_usd||0),0);
      return `<p style="margin:8px 0 0"><b>Наличных по сети ≈ ${fmt(k)}${u?' и $'+u.toLocaleString('ru-RU'):''}</b></p>`; })()}
    <details style="margin:6px 0 0"><summary class="meta" style="cursor:pointer">Как считается?</summary>
    <p class="meta" style="margin:6px 0 0">Наличные в кассе = остаток по последней странице тетради + наличные продажи Wipon после неё − расходы и сдача денег, внесённые в Silver. Расходы учтены, только если внесены в Silver, — реальная сумма может быть меньше.</p>
</details>
    <h3 style="margin:16px 0 6px">Где застряла работа <span class="meta">— только просрочки и то, что не в списках команды</span></h3>
    ${stuck.length?`<div class="stack" style="gap:6px">${stuck.map(([n,t,v])=>`<div class="card row" style="flex-wrap:wrap;gap:8px;padding:8px 12px"><span style="flex:1;min-width:200px">${t}</span><span class="chip warn">${(+n).toLocaleString('ru-RU')}</span><button class="btn small" data-pulsego="${v}">Открыть →</button></div>`).join('')}</div>`:'<div class="card">✅ Ничего не застряло</div>'}
    <h3 style="margin:16px 0 6px">Команда: что сделано за вчера и сегодня</h3>
    ${(P.team||[]).length?`<div class="scroll"><table><tbody>${P.team.map(m=>`<tr><td><b>${esc(m.name)}</b><br><span class="meta">${esc(ROLE[m.role]||m.role||'')}</span></td><td>${Object.entries(m.acts||{}).map(([a,c])=>`<span class="chip">${esc(a)}: ${c}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card meta">За вчера и сегодня действий в Silver не было (приёмки, перемещения, списания, заказы). Продажи идут через Wipon и видны в таблице магазинов выше.</div>'}
    <p class="meta" style="margin-top:10px">Обновлено ${new Date(P.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}. Задачи сотрудников — переключите «Посмотреть как» выше.</p>`;
}
document.addEventListener('click', async e => { const t = e.target.closest('button[data-pulsego]'); if(!t || S.view!=='day') return; const [v, m] = t.dataset.pulsego.split(':');
  if(!(S.tabs||[]).some(x=>x[0]===v)) return toast('Нет доступа к этой вкладке'); if(v==='po'){ PO.mode = m || 'orders'; PO.list = null; } if(v==='wh' && m) S.wmode = m;
  S.view = v; (S.lastView ||= {})[groupOf(v)[0]] = v; render(); scrollTo(0,0); await loadView(); });
async function loadDaySug(){ if(DAY.sug) return; DAY.sug = 'wait';
  const { data, error } = await sb.rpc('po_suggest', { p_days:30 }); if(error){ DAY.sug = null; return toast(errText(error)); }
  const L = (data||[]).filter(p => +p.need > 0); DAY.sug = { n:L.length, units:L.reduce((a,p)=>a+(+p.need||0),0) }; if(S.view==='day') render(); }
/* ---------- инструкции для команды: кнопка «📖 Инструкции» в «Моём дне» ---------- */
const HELP = {
  mgr: { t:'Менеджер', who:'Менеджер магазинов своего города (Алматы или Астана)', b:[
    ['☀️ Каждое утро, до 11:00', [
      'Откройте «Мой день». Всё красное и жёлтое — сделать сегодня. Кнопка «Открыть» ведёт прямо туда, где это делается.',
      'Проверьте, что во всех магазинах открыта смена. Если есть «Магазины, где сегодня не открыта смена» — позвоните продавцу.',
      '«Не закрыта смена с прошлых дней» — выясните у продавца и закройте смену, сверьте кассу.']],
    ['🕐 В течение дня', [
      'Пришёл товар → «Товары → Склад → Приёмка»: пересчитайте, впишите количество, подтвердите. Не совпало с накладной — сразу напишите закупу.',
      '«Принять перемещения» — товар из другого магазина: пересчитайте и примите.',
      'Запросы продавцов (оприходовать, списать) — решите в тот же день: принять или отклонить с причиной. Дорогие списания ждут решения директора.',
      '«Товары в наличии без цены» — касса их не продаст. Поставьте цену или напишите закупу.']],
    ['📅 Раз в неделю (понедельник)', [
      '«Склад → Перемещение → Сравнить остатки магазинов»: переложите товар туда, где он продаётся. Только внутри своего города и своего бренда (MOON → MOON, Sunshine → Sunshine).',
      'Подтвердите часы консультантов за неделю («Команда»).',
      '«Аналитика»: какой магазин просел и почему. Придумайте одно действие: выкладка, акция, пост, обучение продавца.']],
    ['🗓 Раз в месяц', [
      'Пересчёт: «Склад → На пересчёт», закройте ревизию до конца месяца.',
      'До 1-го числа проверьте табель и зарплату консультантов.']],
    ['⚠️ Если что-то случилось', [
      'Касса не сходится — продавец фотографирует отчёт смены в чат магазина, вы пишете владельцу.',
      'Брак или поломка — запрос на списание с фото.',
      'Клиент вернул товар — «Чеки → Чеки и возвраты», найдите чек и оформите возврат. Пробитый чек менять нельзя.']]]},
  buy: { t:'Закуп', who:'Закупщик: что заказать, у кого, и чтобы товар был в базе правильно', b:[
    ['☀️ Каждый день', [
      'Откройте «Мой день» (вид «Закуп») и сделайте всё красное и жёлтое.',
      '«Дозаказать — товар заканчивается» — посмотрите и включите в ближайший заказ.',
      '«Поставщик не отправил дольше 5 дней» — напишите поставщику. «В пути дольше 45 дней» — проверьте, пришёл ли заказ, и закройте его.',
      'У каждого нового товара должны быть: розничная цена, закупочная цена, категория, ссылка на поставщика и фото. Без розничной цены касса его не продаст.']],
    ['📦 Когда пришёл заказ', [
      'Убедитесь, что магазин принял товар (приёмка). Если количество не совпало — сразу пишите поставщику.',
      'Новые товары сфотографируйте (вкладка «Фотосессия») и проверьте карточку в «Номенклатуре».']],
    ['📅 Раз в неделю', [
      '«Закуп → Что дозаказать»: выберите бренд и период. Обычно 30 дней, для сезонного товара — 60–90 дней.',
      '«Закуп → Все остатки»: фильтры «Закончились, но продаются» и «Хватит < 30 дн.» — дозаказ. «Лежат без продаж» и «Запас > 120 дн.» — не заказывать, предложить акцию или перемещение.',
      'В «Все остатки» выберите «Поставщик» — увидите всё, что у него заканчивается. Удобно собирать заказ сразу на одного поставщика.',
      'Загрузите новые заказы из Китая (Excel): «Закуп → Загрузить заказы». Проверьте, что все позиции связаны с товаром в базе.',
      '«Товары → Сайт → Проверить»: подтвердите связи «сайт ↔ база» — «Верно» или выберите другой товар.']],
    ['🗓 Раз в месяц и к сезону', [
      '«Закуп → ✨ Идеи и тренды»: что растёт и падает по категориям и ценам. Кнопка «Собрать идеи» стоит денег (~$0,25) — согласуйте с владельцем.',
      'К праздникам заказывайте за 6–8 недель. К 8 марта — до начала февраля: перед китайским Новым годом фабрики закрыты около месяца.',
      '«Закуп → Поставщики»: дайте поставщикам понятные имена («Как называем у себя») и проверьте ссылки на магазины.']],
    ['✋ Правила закупа', [
      'Не заказываем мировые бренды и узнаваемые копии (клевер, гвозди, пантера и т. п.) — их нельзя показывать в Instagram.',
      'Качество важнее цены: нержавеющая сталь 316L, серебро 925 с пробой, покрытие не темнеет.',
      'MOON — серебро, муассанит, студия; Sunshine — доступная сталь, шармы, заколки, подарки. Не путаем ассортимент.']]]},
  sell: { t:'Продавец', who:'Продавец-консультант в магазине', b:[
    ['☀️ Начало дня', ['Откройте смену: посчитайте наличные в кассе и впишите сумму.', 'Проверьте витрину и ценники.']],
    ['🛍 В течение дня', ['Каждая продажа — через кассу. Найдите товар по штрихкоду или названию.', 'Спросите телефон клиента — начислим бонусы.', 'Брак, недостача, лишний товар — отправьте запрос менеджеру (оприходование или списание).']],
    ['🌙 Конец дня', ['Закройте смену: пересчитайте наличные, впишите расходы за день.', 'Сфотографируйте отчёт смены и отправьте в чат своего магазина.']]]}
};
function helpHtml(k){ const H = HELP[k] || HELP.mgr;
  return `<div class="row" style="gap:8px;flex-wrap:wrap"><b style="flex:1;font-size:17px">📖 Инструкции</b><button class="btn small" id="help-close">Закрыть</button></div>
    <div class="seg" style="display:inline-flex;align-self:flex-start">${Object.entries(HELP).map(([x,h])=>`<button data-help="${x}" aria-pressed="${x===k}">${h.t}</button>`).join('')}</div>
    <p class="meta" style="margin:0">${esc(H.who)}</p>
    ${H.b.map(([t,L])=>`<div><div style="font-weight:700;margin:6px 0 4px">${t}</div><ol style="margin:0;padding-left:20px;line-height:1.5">${L.map(x=>`<li style="margin-bottom:4px">${esc(x)}</li>`).join('')}</ol></div>`).join('')}
    <p class="meta" style="margin:4px 0 0">Если что-то непонятно или кнопка не работает — напишите владельцу.</p>`; }
function helpOpen(k){ modal(helpHtml(k)); const d = document.querySelector('#modal .dialog'); if(d) d.style.maxWidth = '640px'; }
const helpDef = () => { const r = S.me && S.me.role; return r==='purchaser' ? 'buy' : r==='consultant' ? 'sell' : (DAY.role==='buy' ? 'buy' : DAY.role==='sell' ? 'sell' : 'mgr'); };
document.addEventListener('click', e => { const t = e.target.closest('#help-open,#help-close,[data-help]'); if(!t) return;
  if(t.id==='help-open') helpOpen(helpDef()); else if(t.id==='help-close') closeModal(); else helpOpen(t.dataset.help); });
function renderDay(){
  const D = DAY.data, own = S.me.role==='owner', r = DAY.role || dayDefRole(), st = DAY.store || S.store;
  const today = new Date().toLocaleDateString('ru-RU',{timeZone:'Asia/Almaty',weekday:'long',day:'numeric',month:'long'});
  if(r==='own'){ $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap;gap:8px;justify-content:flex-start"><h2 style="margin:0">Мой день</h2><span class="meta">${today}</span><span style="flex:1"></span><button class="btn small" id="help-open">📖 Инструкции</button><button class="btn small" id="day-ref">Обновить</button></div>
    <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin:10px 0"><span class="meta">Посмотреть как:</span><div class="seg" style="display:inline-flex">${DAY_ROLES.map(([k,t])=>`<button data-dayrole="${k}" aria-pressed="${k===r}">${t}</button>`).join('')}</div></div>
    ${wiponSyncHtml()}${chinaHtml()}${anHtml()}${pulseHtml(DAY.pulse)}${DAY.pulse?teamLine(D):''}${DAY.pulse?bkRemind():''}${S.canAttn?attnHtml(true,'own'):''}`; DAY.items = []; return; }
  let items = D ? [...(D[r]||[])] : [];
  if(r==='buy'){ const sg = DAY.sug && DAY.sug!=='wait' ? DAY.sug : null;
    items.unshift({ k:'sug', t:'Дозаказать — товар заканчивается', n: sg ? sg.n : 1, wait: !sg, h: sg ? (sg.n ? `Всего ${sg.units.toLocaleString('ru-RU')} шт. Удобно формировать заказ сразу по поставщику.` : '') : 'Считаем…', go:'po', mode:'suggest', lvl:'warn' }); }
  const has = v => (S.tabs||[]).some(t => t[0]===v);
  items = items.filter(i => own || has(i.go==='stock' ? 'wh' : i.go==='attn' ? 'day' : i.go));
  const ord = { bad:0, warn:1, '':2 }, col = { bad:'var(--bad)', warn:'var(--warn,#d90)', '':'var(--accent)' };
  const todo = items.filter(i => i.wait || +i.n > 0).sort((a,b) => ord[a.lvl] - ord[b.lvl]), done = items.filter(i => !i.wait && !(+i.n > 0));
  DAY.items = items;
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap;gap:8px;justify-content:flex-start"><h2 style="margin:0">Мой день</h2><span class="meta">${today}</span><span style="flex:1"></span><button class="btn small" id="help-open">📖 Инструкции</button><button class="btn small" id="day-ref">Обновить</button></div>
    ${own?`<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;margin:10px 0"><span class="meta">Посмотреть как:</span><div class="seg" style="display:inline-flex">${DAY_ROLES.map(([k,t])=>`<button data-dayrole="${k}" aria-pressed="${k===r}">${t}</button>`).join('')}</div>
      ${r==='sell'?`<select id="day-store" aria-label="Магазин">${(S.stores||[]).map(s=>`<option value="${s.id}" ${s.id===st?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select>`:''}</div>`:''}
    ${r!=='sell'?wiponSyncHtml():''}${r==='buy' ? chinaHtml() : ''}
    <p class="meta" style="margin:4px 0 12px">${r==='sell'?'Дела по магазину '+esc(storeName(st)):r==='buy'?'Дела по закупу, по всем магазинам':'Дела по вашим магазинам'}. Нажмите «Открыть» — попадёте сразу туда, где это делается. Сделанное уходит вниз само.</p>
    ${!D?'<div class="empty">Собираем дела…</div>':`${todo.length?`<div class="stack" style="gap:8px">${todo.map(i=>`<div class="card row" style="flex-wrap:wrap;gap:10px;border-left:4px solid ${col[i.lvl]||col['']}"><div style="flex:1;min-width:220px"><b>${esc(i.t)}</b>${i.wait||i.k==='open'||i.k==='close'?'':` <span class="chip ${i.lvl==='bad'?'zero':'warn'}">${(+i.n).toLocaleString('ru-RU')}</span>`}${i.h?`<br><span class="meta">${esc(i.h)}</span>`:''}</div><button class="btn small primary" data-daygo="${esc(i.k)}" ${i.wait?'disabled':''}>Открыть →</button></div>`).join('')}</div>`
      :'<div class="card" style="text-align:center;padding:24px">✅ На сегодня всё сделано</div>'}
    ${done.length?`<details style="margin-top:14px"><summary class="meta" style="cursor:pointer">Сделано: ${done.length}</summary><div class="stack" style="gap:4px;margin-top:6px">${done.map(i=>`<div class="meta">✓ ${esc(i.t)}</div>`).join('')}</div></details>`:''}`}
    ${r!=='sell' && DAY.spulse ? storesHtml(DAY.spulse, true) : r!=='sell' && DAY.spulseWait ? '<div class="empty">Собираем продажи…</div>' : ''}
    ${S.canAttn && r!=='sell' ? attnHtml(true, r) : ''}
`;
}
document.addEventListener('click', async e => { if(S.view!=='day') return; const t = e.target.closest('button'); if(!t) return;
  if(t.id==='day-ref'){ DAY.data = null; DAY.sug = null; DAY.pulse = null; DAY.ai = null; S.attn = null; render(); await loadDay(); render(); }
  else if(t.dataset.dayrole){ DAY.role = t.dataset.dayrole; render(); if(DAY.role==='buy') loadDaySug(); if(DAY.role==='own' && !DAY.pulse) loadPulse(); if(['mgr','buy'].includes(DAY.role) && !DAY.spulse) loadSPulse(); }
  else if(t.dataset.daygo){ const i0 = (DAY.items||[]).find(x => x.k===t.dataset.daygo); if(!i0) return;
    const i = i0.go==='stock' ? { ...i0, go:'wh', mode:'stock' } : i0.go==='attn' ? { ...i0, go:'day' } : i0;
    if(!(S.tabs||[]).some(x => x[0]===i.go)) return toast('У вас нет доступа к этой вкладке');
    if(i.go==='wh' && i.mode) S.wmode = i.mode;
    if(i.go==='po'){ PO.mode = i.mode || 'orders'; if(!i.mode) PO.filter = 'open'; PO.list = null; }
    if(i.go==='nom'){ Object.assign(S.nm, { flag:i.flag||null, off:0, q:'', cat:'', data:null }); }
    S.view = i.go; (S.lastView ||= {})[groupOf(S.view)[0]] = S.view; render(); scrollTo(0,0); await loadView(); }
});
document.addEventListener('change', async e => { if(S.view==='day' && e.target.id==='day-store'){ DAY.store = +e.target.value; DAY.data = null; render(); await loadDay(); render(); } });

/* ---------- доступ к вкладкам по ролям ---------- */
const ALL_TABS = [['pos','Продажа'],['analytics','Аналитика'],['shifts','Смены'],['cash','Расходы'],['sales','Чеки и возвраты'],['stock','Остатки (в «Складе»)'],['wh','Склад'],['certs','Сертификаты'],['bonus','Бонусные карты'],['nom','Номенклатура'],['site','Сайт'],['emps','Сотрудники']];
const EXTRA_TABS = [['day','Мой день'],['attn','Требует внимания (в «Моём дне»)'],['photo','Фотосессия'],['pay','Зарплата'],['cons','Консультанты'],['po','Закуп'],['promo','Акции'],['content','Контент'],['flow','Путь товара'],['profit','Рентабельность'],['bot','Бот']];
const EXTRA_DEF = { day:['manager','purchaser','consultant','viewer','accountant'], attn:['manager','purchaser','viewer','accountant'], photo:['manager','purchaser'], pay:['manager','purchaser','viewer','accountant'], cons:['manager'], po:['manager','purchaser','viewer','accountant'], promo:['manager','purchaser','viewer','accountant'], content:['manager','purchaser','viewer'], flow:['manager','viewer','accountant'], profit:['viewer'], bot:['manager'] };
ALL_TABS.push(...EXTRA_TABS);
const BOSS_ONLY = ['analytics','bonus','nom','site','emps'];
function defaultTabs(role){ const boss = ['manager','viewer','accountant'].includes(role);
  return ALL_TABS.map(([v])=>v).filter(v => EXTRA_DEF[v] ? EXTRA_DEF[v].includes(role) : (boss || !BOSS_ONLY.includes(v)) && !(['viewer','accountant'].includes(role) && v==='pos') && !(role==='viewer' && v==='emps')); }
function canEditTab(v){ if(!S.me || S.me.role==='owner') return true; const E=(S.tabEdit||{})[S.me.role]; return Array.isArray(E) ? E.includes(v) : true; }
function accessHtml(){
  if(S.me.role!=='owner') return '';
  const roles = ['manager','purchaser','viewer','accountant'], A = S.tabAccess || {};
  const has = (r,v) => Array.isArray(A[r]) ? A[r].includes(v) : defaultTabs(r).includes(v);
  const E = S.tabEdit || {}, can = (r,v) => has(r,v) && r!=='viewer' && (Array.isArray(E[r]) ? E[r].includes(v) : true);
  return `<div class="stack" style="margin-top:8px">
    <p class="meta" style="margin:0">Владелец видит и меняет всё. В каждой ячейке две галочки: 👁 — вкладка видна (только смотреть), ✎ — можно и менять (кнопки сохранения, проведения и т.п.). Данные защищены и в базе: например, консультант не увидит выручку и закупочные цены, даже если открыть ему «Аналитику».</p>
    <div class="scroll"><table><thead><tr><th>Вкладка</th>${roles.map(r=>`<th>${ROLE[r]}<br><span class="meta">👁 смотреть · ✎ менять</span></th>`).join('')}</tr></thead><tbody>
    ${ALL_TABS.map(([v,t])=>`<tr><td>${t}</td>${roles.map(r=>`<td style="white-space:nowrap"><label title="Видит"><input type="checkbox" data-acc="${r}:${v}" ${has(r,v)?'checked':''} aria-label="${ROLE[r]}: ${t} — видит"> 👁</label>
      <label title="Может менять" style="margin-left:8px"><input type="checkbox" data-accedit="${r}:${v}" ${can(r,v)?'checked':''} ${has(r,v)&&r!=='viewer'?'':'disabled'} aria-label="${ROLE[r]}: ${t} — может менять"> ✎</label></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="meta" style="margin:0">«Административный штат» всегда видите только вы. Консультанты в программу не входят — им доступен только Telegram-бот.</p>
    <div class="row"><button class="btn small" id="acc-reset">Вернуть по умолчанию</button><span class="meta">Изменения сохраняются сразу; сотрудник увидит их после обновления страницы.</span></div></div>`;
}

async function loadEmps(){ const { data } = await sb.from('employees').select('*').order('created_at'); S.emps = data || []; }
function renderEmps(){
  const list = S.emps.filter(e => e.role!=='consultant').sort((a,b)=>(b.active-a.active) || String(a.full_name).localeCompare(String(b.full_name),'ru'));
  if(!document.getElementById('emp-css')){ const st = document.createElement('style'); st.id = 'emp-css'; st.textContent = `.emp-tbl td,.emp-tbl th{padding:5px 8px;vertical-align:middle}.emp-tbl td{white-space:nowrap}.emp-tbl input,.emp-tbl select{padding:4px 6px;font-size:13px}.emp-tbl details.dd summary{padding:4px 8px;font-size:13px}.emp-tbl tr.off td{opacity:.5}.emp-add>summary,.emp-acc>summary{cursor:pointer;font-weight:600;list-style:none}.emp-add>summary::-webkit-details-marker,.emp-acc>summary::-webkit-details-marker{display:none}`; document.head.append(st); }
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Сотрудники с доступом к Silver <span class="meta">${list.filter(e=>e.active).length}</span></h2></div>
    <p class="meta" style="margin:4px 0 10px">Консультанты здесь не показываются — они в «Зарплате» и работают через Telegram-бота.</p>
    <details class="card emp-add" style="margin-bottom:10px"><summary>+ Добавить сотрудника</summary>
      <div class="stack" style="margin-top:8px;gap:6px"><div class="row" style="flex-wrap:wrap;justify-content:flex-start">
        <input id="ne-phone" placeholder="+7 7__ ___ __ __" inputmode="tel"><input id="ne-name" placeholder="Имя и фамилия" style="flex:1;min-width:160px">
        <select id="ne-role">${Object.entries(ROLE).filter(([k])=>k!=='consultant'&&(k!=='owner'||S.me.role==='owner')).map(([k,v])=>`<option value="${k}" ${k==='manager'?'selected':''}>${v}</option>`).join('')}</select>
        ${storesDD([], id=>`class="ne-store" value="${id}"`)}<button class="btn primary small" id="ne-add">Добавить</button></div>
      <span class="meta">Сотрудник входит кнопкой «Войти через Telegram» и делится этим же номером в боте — пароль не нужен.</span></div></details>
    <div class="scroll"><table class="emp-tbl"><thead><tr><th>Имя</th><th>Телефон</th><th>Роль</th><th>Магазины</th><th title="Может входить">Вкл.</th><th title="Официально трудоустроен">Офиц.</th>${S.me.role==='owner'?'<th>Вход</th>':''}</tr></thead><tbody>
    ${list.map(e=>`<tr class="${e.active?'':'off'}"><td><b>${esc(e.full_name)}</b> <span class="meta" title="${e.telegram_id?'Telegram привязан':'Telegram не привязан'}${!e.auth_user_id?' · ещё не входил':''}">${e.telegram_id?'✈':''}${!e.auth_user_id?' · не входил':''}</span></td>
      <td><input data-ephone="${e.id}" value="${esc(e.phone||'')}" placeholder="нет телефона" inputmode="tel" style="width:135px"></td>
      <td><select data-erole="${e.id}">${Object.entries(ROLE).filter(([k])=>k!=='consultant').map(([k,v])=>`<option value="${k}" ${e.role===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td>${['owner','viewer'].includes(e.role)?'<span class="meta">все</span>':(()=>{ const ids=e.store_ids||(e.home_store_id?[e.home_store_id]:[]); return storesDD(ids, id=>`data-estores="${e.id}:${id}"`); })()+(e.role==='manager'?' <span class="meta" title="Менеджер видит все магазины; отмеченные — подтверждает перемещения">ⓘ</span>':'')}</td>
      <td style="text-align:center"><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''} aria-label="включён"></td>
      <td style="text-align:center"><input type="checkbox" data-eoff="${e.id}" ${e.official?'checked':''} aria-label="официально"></td>
      ${S.me.role==='owner'?`<td><button class="btn small" data-epass="${e.id}" title="Задать логин и пароль для входа без Telegram">🔑 Логин</button></td>`:''}</tr>`).join('')}</tbody></table></div>
    ${S.me.role==='owner'?`<details class="card emp-acc" style="margin-top:12px"><summary>⚙ Какие вкладки видит каждая роль</summary>${accessHtml()}</details>`:''}`;
}
async function updEmp(id, patch){ const { error } = await sb.from('employees').update(patch).eq('id', id); if(error) toast(errText(error)); else toast('Сохранено'); }

/* ---------- модальное окно ---------- */
function modal(html){ $('#modal').innerHTML = `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true">${html}</div></div>`; }
function closeModal(){ $('#modal').innerHTML = ''; }

/* ---------- события ---------- */
let searchTimer;
document.addEventListener('click', async e => {
  if(e.target.closest('button')) return;
  const tr = e.target.closest('[data-sakey]'); if(!tr) return;
  const k = tr.dataset.sakey; S.saKey=k; S.saItems=null; render();
  const { data, error } = await sb.rpc('stock_group_items', { p_stores: selStores(), p_group: S.saGroup, p_key: k, p_filter: S.saFilter, p_limit: 100 });
  if(error) toast(errText(error)); S.saItems = data || []; render();
  const h = document.querySelector('#main h2:last-of-type'); h && h.scrollIntoView({behavior:'smooth'});
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button,input[type=checkbox]'); if(!t) return;
  const d = t.dataset;
  if('close' in d) return closeModal();
  if(d.view) return;
  if(d.add){ const p = S.found.find(x=>x.id===d.add); addToCart(p); S.q=''; S.found=[]; render(); $('#q') && $('#q').focus(); }
  else if(t.id==='q-add'){ const r = searchCatalog(S.q); if(r.length===1 || (r[0] && (r[0].barcode===S.q.trim()))){ addToCart(r[0]); S.q=''; S.found=[]; render(); } else doSearch(); }
  else if(d.inc){ S.cart[+d.inc].qty++; syncPays(); render(); }
  else if(d.dec){ const l=S.cart[+d.dec]; if(l.qty>1) l.qty--; syncPays(); render(); }
  else if(d.del){ S.cart.splice(+d.del,1); syncPays(); render(); }
  else if(d.dt){ S.discType=d.dt; syncPays(); render(); }
  else if(d.pay==='certificate' && !('certificate' in S.pays)){ S.pays.certificate=0; S.cert=null; S.certCode=''; S.certQ=''; render(); await loadCertList(); render(); }
  else if(d.pay){ const k=d.pay; if(k in S.pays){ delete S.pays[k]; if(k==='certificate'){ S.cert=null; S.certCode=''; } } else S.pays[k] = k==='bonus' ? Math.min(maxBonus(), Math.max(0, totals().total-paid())) : Math.max(0, totals().total-paid()); syncPays(); render(); }
  else if(t.id==='cust-find') lookupCustomer();
  else if(t.id==='cust-clear'){ S.cust=null; S.phone=''; S.custMsg=''; delete S.pays.bonus; syncPays(); render(); }
  else if(t.id==='cust-create'){
    const p = normPhone(S.phone); const { error } = await sb.rpc('customer_upsert', { p_phone:p, p_name:$('#new-name').value, p_birthday:$('#new-bd').value||null });
    if(error) return toast(errText(error)); toast('Клиент создан'); lookupCustomer();
  }
  else if(d.ldt){ const [i,v]=d.ldt.split(':'); S.cart[+i].dt=v; syncPays(); render(); }
  else if(d.certpick){ const c=(S.certList||[]).find(x=>x.code===d.certpick); if(c){ S.cert=c; S.certCode=c.code; const other=Object.entries(S.pays).filter(([k])=>k!=='certificate').reduce((a,[,v])=>a+(+v||0),0); S.pays.certificate=Math.max(0,Math.min(+c.balance, totals().total-other)); syncPays(); render(); } }
  else if(t.id==='cert-change'){ S.cert=null; S.certCode=''; S.pays.certificate=0; syncPays(); render(); }
  else if(t.id==='clear'){ S.cart=[]; S.disc=0; S.pays={}; S.certCode=''; S.cert=null; S.certQ=''; render(); }
  else if(t.id==='checkout') checkout();
  else if(t.id==='sq-go'){ (S.sf ||= {lim:100}).lim = 100; await loadSales(); render(); }
  else if(t.id==='sf-more'){ S.sf.lim += 100; t.disabled = true; await loadSales(); render(); }
  else if(t.id==='sf-reset'){ S.sf = { from:'', to:'', kind:'', lim:100 }; S.salesQ = ''; await loadSales(); render(); }
  else if(d.ret) openReturn(d.ret);
  else if(t.id==='stq-go'){ await loadStockView(); render(); }
  else if(t.id==='stf-clear'){ S.stockF={}; await loadStockView(); render(); }
  else if(d.hist) openHistory(d.hist);
  else if(t.id==='cc-go'){ const v=$('#cc').value.trim(); if(v) checkCert(v); }
  else if(d.ck){ document.querySelectorAll('#ck-kind button').forEach(b=>b.setAttribute('aria-pressed', b===t)); }
  else if(t.id==='c-sell') sellCert(t);
  else if(t.id==='c-open'){ const sh = S.posShift && S.posShift[S.store]; if(sh===false) return toast('Сначала откройте смену'); modal(certSellHtml()); setTimeout(()=>$('#c-code')&&$('#c-code').focus(), 50); }
  else if(d.cpay){ document.querySelectorAll('#c-pay button').forEach(b=>b.setAttribute('aria-pressed', b===t)); }
  else if(d.eact){ updEmp(d.eact, { active:t.checked }); }
  else if(d.eoff){ updEmp(d.eoff, { official:t.checked }); }
  else if(d.estores){ const [eid, sid] = d.estores.split(':'); const e = S.emps.find(x=>x.id===eid); if(e){ const cur = new Set(e.store_ids||(e.home_store_id?[e.home_store_id]:[])); t.checked ? cur.add(+sid) : cur.delete(+sid); e.store_ids=[...cur].sort((a,b)=>a-b); updEmp(eid, { store_ids: e.store_ids }); const sm=t.closest('details.dd'); if(sm) sm.querySelector('summary').textContent=ddSummary(e.store_ids); } }
  else if(d.sgroup){ const g=d.sgroup; S.sel = S.stores.filter(st => g==='all' || st.brand===g || st.city===g).map(st=>st.id); onSelChange(); }
  else if(d.sone){ const id=+d.sone; const wasAll = selStores().length === S.stores.length; // были выбраны все — нажатие на магазин оставляет только его; дальше нажатия добавляют/убирают
    S.sel = wasAll ? [id] : t.checked ? [...new Set([...S.sel, id])] : S.sel.filter(x=>x!==id); if(!S.sel.length) S.sel=[id]; onSelChange(); }
  else if(t.id==='nm-new'){ nmOpen({}); }
  else if(d.nmsort){ const f = S.nm, k = d.nmsort; if(f.sort===k) f.desc = !f.desc; else { f.sort = k; f.desc = ['cost','price','stock','site'].includes(k); } f.off = 0; render(); await loadNom(); render(); }
  else if(t.id==='nm-close') nmClose();
  else if(t.id==='nm-save'){ t.disabled=true; await nmSave(); }
  else if(d.nmopen){ const p=(S.nm.data&&S.nm.data.rows||[]).find(r=>r.id===d.nmopen); if(p) nmOpen(p); }
  else if(d.nmpage){ S.nm.off=Math.max(0,(+d.nmpage-1)*(S.nm.lim||50)); render(); await loadNom(); render(); scrollTo(0,0); }
  else if(d.nmlink||d.nmunlink){ const key=d.nmlink||d.nmunlink, [site,uid]=key.split(':');
    const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product: d.nmlink?S.nm.ed.id:null, p_status: d.nmlink?'confirmed':'rejected' });
    if(error) toast(errText(error)); else { toast(d.nmlink?'Связано с сайтом':'Отвязано'); S.nm.sq=''; S.nm.sfound=[]; await loadNom(); const fr=S.nm.data.rows.find(r=>r.id===S.nm.ed.id); if(fr) nmOpen(fr); else render(); } }
  else if(d.wook||d.wono){ t.disabled=true; const { data, error } = await sb.rpc('decide_writeoff', { p_id:d.wook||d.wono, p_approve:!!d.wook, p_note:null }); if(error){ toast(errText(error)); t.disabled=false; return; } toast(data); await loadWhSide(); render(); }
  else if(d.pomode){ PO.mode=d.pomode; render(); await loadPo(); render(); }
  else if(d.pofilter){ PO.filter=d.pofilter; PO.list=null; render(); await loadPo(); render(); }
  else if(d.poper){ PO.anPer=d.poper; PO.an=null; render(); await loadPo(); render(); }
  else if(d.poadd){ const p = PO.found.find(x=>x.id===d.poadd); const dd = PO.d || (PO.d=poNew()); if(p){ const ex = dd.items.find(i=>i.pid===p.id); if(ex) ex.qty++; else dd.items.push({ pid:p.id, name:p.name, barcode:p.barcode, qty:1, cost:'' }); } PO.q=''; PO.found=[]; render(); }
  else if(d.podel!=null){ PO.d.items.splice(+d.podel,1); render(); }
  else if(d.posgrpby){ PO.sgrp = d.posgrpby; render(); }
  else if(d.posupall){ const ps = (PO.sug||[]).filter(x=>x.sup===d.posupall && (!PO.scat || x.cat===PO.scat)); const dd = PO.d = poNew();
    dd.supplier = d.posupall;
    ps.forEach(p => dd.items.push({ pid:p.id, name:p.name, barcode:p.barcode, qty:Math.max(1,+p.need||1), cost:p.cost??'' }));
    PO.mode = 'new'; render(); scrollTo(0,0); toast(`Новый заказ: ${ps.length} поз. — проверьте количество и оформите`); }
  else if(d.posug){ const p = (PO.sug||[]).find(x=>x.id===d.posug); const dd = PO.d || (PO.d=poNew()); if(p && !dd.items.some(i=>i.pid===p.id)) dd.items.push({ pid:p.id, name:p.name, barcode:p.barcode, qty:Math.max(1,+d.need||1), cost:p.cost??'' }); toast('Добавлено в новый заказ ('+dd.items.length+' поз.)'); t.disabled=true; }
  else if(t.id==='po-save'){ const dd = PO.d; t.disabled=true;
    const { data, error } = await sb.rpc('po_save', { p:{ supplier:dd.supplier, store_id:+dd.store, eta:dd.eta, cargo_cost:dd.cargo, note:dd.note, currency:dd.cur, rate:dd.cur==='KZT'?1:poRate(dd), delivery_pct:dd.pct, items:dd.items.map(i=>({ product_id:i.pid, qty:+i.qty, price_cur:i.cost===''?null:+i.cost })) } });
    if(error){ toast(errText(error)); t.disabled=false; return; } toast('Заказ оформлен'); PO.d=null; PO.mode='orders'; PO.filter='open'; await loadPo(); render(); }
  else if(d.postatus){ const [id, st] = d.postatus.split(':'); const { error } = await sb.rpc('po_set_status', { p_id:id, p_status:st }); if(error) return toast(errText(error)); toast(st==='transit'?'Отмечено: в пути':'Заказ отменён'); await loadPo(); render(); }
  else if(d.poreceive){ const o = (PO.list||[]).find(x=>x.id===d.poreceive); PO.rcv = { id:d.poreceive, rate: o && o.currency!=='KZT' ? (+o.rate_now||+o.rate||'') : 1, qty:{} }; render(); }
  else if(t.id==='po-rcv-cancel'){ PO.rcv = null; render(); }
  else if(t.id==='po-tr'){ translate1688(); }
  else if(t.id==='po-more'){ PO.lim = (PO.lim||40) + 40; render(); }
  else if(t.id==='po-sel-all'){ const q = (PO.oq||'').trim().toLowerCase(); PO.sel = PO.sel || {}; document.querySelectorAll('[data-posel]').forEach(c=>{ PO.sel[c.dataset.posel] = true; }); render(); }
  else if(t.id==='po-arch-go'){ let ids = Object.entries(PO.sel||{}).filter(([,v])=>v).map(([k])=>k);
    if(!ids.length && PO.archDate) ids = (PO.list||[]).filter(o=>['ordered','transit'].includes(o.status) && o.created_at.slice(0,10) <= PO.archDate).map(o=>o.id);
    if(!ids.length) return toast('Нечего отмечать');
    if(t.dataset.sure!=='1'){ t.dataset.sure='1'; t.textContent=`Точно отметить ${ids.length} заказ(ов) как уже принятые?`; return; }
    t.disabled = true; const { data, error } = await sb.rpc('po_close_archive_many', { p_ids:ids }); if(error){ t.disabled=false; return toast(errText(error)); }
    toast(`Отмечено как уже принятые: ${data}`); PO.sel = {}; PO.archDate = ''; await loadPo(); render(); }
  else if(d.pocreate){ const o = (PO.list||[]).find(x=>(x.items||[]).some(i=>i.item_id===d.pocreate)), i = o.items.find(x=>x.item_id===d.pocreate);
    if(!PO.cats){ const { data } = await sb.from('categories').select('id,name').eq('hidden',false).order('name'); PO.cats = data||[]; }
    const landed = poLanded(i.price_cur!=null?i.price_cur:(i.unit_cost||0)/(+o.rate||1), +o.rate_now||+o.rate||1, o.delivery_pct??10, o.cargo, (o.items||[]).reduce((a,x)=>a+x.qty,0));
    PO.mk = { item:i.item_id, name:(i.title_ru||i.supplier_title||'').replace(/цвет:.*$/i,'').slice(0,70).trim(), color:colorRu(i.spec||i.title_ru||''), brand:'', cat:'', price:'', landed:Math.round(landed) }; PO.lnk = null; render();
    if(i.spec && /[\u4e00-\u9fff]/.test(i.spec)) trZh(i.spec).then(ru => { if(ru && PO.mk && PO.mk.item===i.item_id){ PO.mk.specRu = ru; if(!PO.mk.color) PO.mk.color = colorRu(ru); render(); } }); }
  else if(t.id==='po-mk-cancel'){ PO.mk = null; render(); }
  else if(t.id==='po-mk-save'){ const m = PO.mk, o = (PO.list||[]).find(x=>(x.items||[]).some(i=>i.item_id===m.item)), i = o.items.find(x=>x.item_id===m.item);
    m.name = $('#po-mk-name').value.trim(); m.price = $('#po-mk-price').value; m.cat = $('#po-mk-cat').value; m.color = $('#po-mk-color').value.trim(); m.brand = $('#po-mk-brand').value;
    if(!m.name) return toast('Укажите название'); if(!m.brand) return toast('Отметьте бренд: MOON, Sunshine или оба'); if(/[\u4e00-\u9fff]/.test(m.color)) return toast('Цвет напишите по-русски'); t.disabled = true;
    const { data, error } = await sb.rpc('product_save', { p:{ name:m.name, price:+m.price||0, brand:m.brand, category_id:m.cat||null, color:m.color||null, photo_url:i.supplier_photo||null, purchase_url:i.supplier_url||null, supplier:o.supplier||null } });
    if(error){ t.disabled=false; return toast(errText(error)); }
    const l = await sb.rpc('po_link_item', { p_item:i.item_id, p_product:data.id }); if(l.error){ t.disabled=false; return toast(errText(l.error)); }
    S.catalog.push([data.id, data.barcode, '', m.name, +m.price, i.supplier_photo||'', m.cat?+m.cat:null]);
    toast('Товар создан, штрихкод '+data.barcode+(+m.price>0?'':' · розничную цену поставит Анна')); PO.mk = null; await loadPo(); render(); }
  else if(d.poarch){ if(t.dataset.sure!=='1'){ t.dataset.sure='1'; t.textContent='Закрыть без приёмки?'; return; } const { error } = await sb.rpc('po_close_archive', { p_id:d.poarch }); if(error) return toast(errText(error)); toast('Заказ закрыт без оприходования'); await loadPo(); render(); }
  else if(t.id==='po-rcv-ok'){ const r = PO.rcv, o = (PO.list||[]).find(x=>x.id===r.id); t.disabled=true;
    const main = +(r.store||o.store||S.store);
    const items = (o.items||[]).map(i=>{ const A = (r.al||{})[i.item_id] || { [main]: i.qty }; return { item_id:i.item_id, alloc: Object.entries(A).filter(([,v])=>+v>0).map(([s,v])=>({ store:+s, qty:+v })) }; });
    const { error } = await sb.rpc('po_receive', { p_id:r.id, p_items:items, p_rate: o.currency==='KZT' ? 1 : +r.rate, p_store: main });
    if(error){ toast(errText(error)); t.disabled=false; return; } PO.rcv = null; toast('Товар принят, себестоимость пересчитана'); await loadPo(); render(); }
  else if(d.polink){ const [item, pid] = d.polink.split(':'); const { error } = await sb.rpc('po_link_item', { p_item:item, p_product:pid||null }); if(error) return toast(errText(error)); PO.lnk = null; toast(pid?'Связано с товаром базы':'Связь снята'); await loadPo(); render(); }
  else if(d.polinkopen){ PO.lnk = { item:d.polinkopen, q:'', found:[] }; render(); const el = document.getElementById('po-lnk-q'); if(el) el.focus(); }
  else if(d.pfper){ PF.per=d.pfper; await loadProfit(); render(); }
  else if(t.id==='pf-add'){ const a = PF.add; a.store = a.store || (S.allStores[0]||{}).id; if(!(+a.amount>0)) return toast('Укажите сумму');
    const { error } = await sb.rpc('store_cost_add', { p_store:+a.store, p_month:a.month+'-01', p_category:a.cat, p_amount:+a.amount, p_note:a.note });
    if(error) return toast(errText(error)); toast('Расход добавлен'); a.amount=''; a.note=''; await loadProfit(); render(); }
  else if(d.pfdel){ const { error } = await sb.rpc('store_cost_del', { p_id:d.pfdel }); if(error) return toast(errText(error)); await loadProfit(); render(); }
  else if(d.trg){ S.trG=d.trg; S.trend=null; render(); loadTrends(); }
  else if(d.paadd){ const id=d.paadd, amt=+($('#pa-amt-'+id)||{}).value; if(!(amt>0)) return toast('Укажите сумму');
    const { error } = await sb.rpc('pay_adj_add', { p_employee:id, p_month:PY.month+'-01', p_kind:$('#pa-kind-'+id).value, p_amount:amt, p_note:$('#pa-note-'+id).value });
    if(error) return toast(errText(error)); toast('Добавлено'); PY.open=id; await loadPay(); render(); }
  else if(d.papayall){ const { error } = await sb.rpc('pay_adj_add', { p_employee:d.papayall, p_month:PY.month+'-01', p_kind:d.kind||'paid', p_amount:+d.rest, p_note:'остаток' });
    if(error) return toast(errText(error)); toast('Отмечено как выплачено'); PY.open=d.papayall; await loadPay(); render(); }
  else if(d.padel){ const { error } = await sb.rpc('pay_adj_del', { p_id:d.padel }); if(error) return toast(errText(error)); await loadPay(); render(); }
  else if(d.pyopen){ PY.open = PY.open===d.pyopen ? null : d.pyopen; render(); }
  else if(d.pydel){ const [emp,kind]=d.pydel.split(':'); const { error } = await sb.rpc('work_hours_set', { p_store:+PY.store, p_day:PY.day, p_employee:emp, p_hours:0, p_kind:kind }); if(error) toast(errText(error)); else { await loadPay(); render(); } }
  else if(t.id==='py-add'){ if(!PY.add.emp || !(+PY.add.hours>0)) return toast('Выберите сотрудника и часы');
    const { error } = await sb.rpc('work_hours_set', { p_store:+PY.store, p_day:PY.day, p_employee:PY.add.emp, p_hours:+PY.add.hours, p_kind:PY.add.kind });
    if(error) return toast(errText(error)); PY.add = { emp:'', hours:'', kind:'sale' }; toast('Добавлено в табель'); await loadPay(); render(); }
  else if(d.csdir){ CS.dir=d.csdir; CS.cat=''; render(); }
  else if(d.cscat!=null){ CS.cat=d.cscat; render(); }
  else if(d.csdays){ CS.days=+d.csdays; await loadCash(); render(); }
  else if(d.csph){ openCashPhoto(d.csph); }
  else if(d.csok||d.csno){ const { error } = await sb.rpc('cash_move_confirm', { p_id:d.csok||d.csno, p_ok:!!d.csok }); if(error) toast(errText(error)); else { toast(d.csok?'Подтверждено':'Отмечено: не получено'); await loadCash(); render(); } }
  else if(t.id==='cs-save'){ t.disabled=true;
    const { error } = await sb.rpc('cash_move_add', { p_store:S.store, p_direction:CS.dir, p_category:CS.cat, p_amount:+CS.amount, p_comment:CS.comment, p_collector:CS.collector, p_photo:CS.photo });
    if(error){ toast(errText(error)); t.disabled=false; return; }
    toast(CS.dir==='in'?'Внесение записано':'Расход записан'); Object.assign(CS, { cat:'', amount:'', comment:'', collector:'', photo:null, photoUrl:'', cats:null }); await loadCash(); render(); }
  else if(t.id==='go-shift'){ S.view='shifts'; render(); await loadShifts(); render(); }
  else if(d.bkbrand){ BK.brand=d.bkbrand; BK.off=0; BK.cur=null; BK.card=null; render(); await loadBonus(); render(); }
  else if(d.bkopen){ await openBonusClient(d.bkopen); }
  else if(d.bkpage){ BK.off=Math.max(0,BK.off+50*(+d.bkpage)); render(); await loadBonus(); render(); }
  else if(t.id==='bk-save'){ const { error } = await sb.rpc('customer_edit', { p_customer:BK.cur, p_name:$('#bk-name').value, p_birthday:$('#bk-bd').value||null }); if(error) toast(errText(error)); else { toast('Сохранено'); await openBonusClient(BK.cur); } }
  else if(t.id==='bk-adj'){ const amt=+$('#bk-amt').value; t.disabled=true;
    const { error } = await sb.rpc('bonus_adjust', { p_customer:BK.cur, p_brand:BK.brand, p_amount:amt, p_reason:$('#bk-reason').value, p_ttl_days:+$('#bk-ttl').value||91 });
    if(error){ toast(errText(error)); t.disabled=false; } else { toast('Бонусы скорректированы'); await openBonusClient(BK.cur); loadBonus().then(render); } }
  else if(t.id==='acc-reset'){ const [a,b] = await Promise.all([sb.rpc('set_tab_access', { p:{} }), sb.rpc('set_tab_edit', { p:{} })]); if(a.error||b.error) toast(errText(a.error||b.error)); else { S.tabAccess={}; S.tabEdit={}; toast('Доступы по умолчанию'); render(); } }
  else if(t.id==='nc-add'){ const ids=[...document.querySelectorAll('.nc-store:checked')].map(x=>+x.value); PY.consOpen = true;
    const { error } = await sb.rpc('employee_add', { p_phone:$('#nc-phone').value, p_name:$('#nc-name').value, p_role:'consultant', p_store_ids:ids });
    if(error) toast(errText(error)); else { toast('Консультант добавлен'); await loadEmps(); render(); } }
  else if(t.id==='ne-add'){ const ids=[...document.querySelectorAll('.ne-store:checked')].map(x=>+x.value);
    const { error } = await sb.rpc('employee_add', { p_phone:$('#ne-phone').value, p_name:$('#ne-name').value, p_role:$('#ne-role').value, p_store_ids:ids });
    if(error) toast(errText(error)); else { toast('Сотрудник добавлен'); await loadEmps(); render(); } }
  else if(d.reqcap!=null){ const l=S.cart[+d.reqcap]; if(!l) return; t.disabled=true;
    const { error } = await sb.rpc('request_capitalize', { p_store:S.store, p_product:l.pid, p_qty:+d.need||1, p_note:'Пробивали на кассе' });
    if(error) { toast(errText(error)); t.disabled=false; } else { (S.reqSent ||= {})[l.pid+':'+S.store]=true; toast('Запрос отправлен менеджеру'); render(); } }
  else if(d.reqst){ S.reqSt=d.reqst; await loadReqs(); render(); }
  else if(d.reqok||d.reqno){ const id=d.reqok||d.reqno; const q=+(document.getElementById('rq-'+id)||{}).value||null;
    const { error } = await sb.rpc('decide_request', { p_id:id, p_approve:!!d.reqok, p_qty:q, p_note:null });
    if(error) toast(errText(error)); else { toast(d.reqok?'Оприходовано':'Отклонено'); S.stock={}; await loadReqs(); render(); } }
  else if(d.bmode){ if(d.bmode==='spend'){ S.pays.bonus = Math.min(maxBonus(), totals().total); } else { delete S.pays.bonus; } syncPays(); render(); }
  else if(d.cfst){ S.cf.st=d.cfst; render(); await loadCerts(); render(); }
  else if(t.id==='st-grp'){ t.disabled = true; const { data, error } = await sb.rpc('site_group_match', { p_site:S.st.site, p_apply:false }); t.disabled = false; if(error) return toast(errText(error));
    modal(`<h2>Общие штрихкоды · ${esc(SITE_NAME[S.st.site]||S.st.site)}</h2>
      <p>Несвязанные карточки сайта, для которых в базе есть ровно один общий штрихкод того же типа и цены (например, «Серьги Веер» за 3 500 ₸ → «Серьги 3500»): <b>${data.n}</b>.</p>
      ${data.examples.length?`<ul class="meta">${data.examples.map(x=>`<li>${esc(x.title)} · ${fmt(x.price)} → ${esc(x.to)}</li>`).join('')}</ul>`:''}
      ${data.ambiguous?`<p class="meta">Ещё ${data.ambiguous} карточек подходят сразу к нескольким одинаковым общим штрихкодам — их свяжите вручную: при открытии карточки они будут первыми в списке.</p>`:''}
      <p class="meta">Связи можно поправить потом по одной — они попадут в статус «авто».</p>
      <div class="row"><button class="btn" data-close>Отмена</button>${data.n?`<button class="btn primary" id="st-grp-go">Связать ${data.n}</button>`:''}</div>`); }
  else if(t.id==='st-grp-go'){ t.disabled = true; const { data, error } = await sb.rpc('site_group_match', { p_site:S.st.site, p_apply:true }); closeModal(); if(error) return toast(errText(error)); toast('Связано: '+data.n); S.st.off=0; await loadSite(); render(); }
  else if(t.id==='st-part-save'){ const r = await sb.rpc('site_part_name_set', { p_part:S.st.part, p_name:$('#st-part-name').value }); if(r.error) return toast(errText(r.error)); toast('Название раздела сохранено'); S.st.parts=null; await loadSite(); render(); }
  else if(d.stsite){ S.st.site=d.stsite; S.st.off=0; S.st.open=null; render(); await loadSite(); render(); }
  else if('stsort' in d){ const k = d.stsort; if(!k){ S.st.sort = null; S.st.desc = false; } else if(S.st.sort===k) S.st.desc = !S.st.desc; else { S.st.sort = k; S.st.desc = ['price','stock'].includes(k); } S.st.off = 0; render(); await loadSite(); render(); }
  else if(d.ststatus){ S.st.status=d.ststatus; S.st.off=0; S.st.open=null; render(); await loadSite(); render(); }
  else if(d.stpage){ S.st.off=Math.max(0,S.st.off+50*(+d.stpage)); S.st.open=null; render(); await loadSite(); render(); window.scrollTo(0,0); }
  else if(d.stok){ await siteSet(d.stok, d.pid, 'confirmed'); }
  else if(d.stpick){ await siteSet(d.stpick, d.pid, 'confirmed'); }
  else if(d.stno){ await siteSet(d.stno, null, 'rejected'); }
  else if(d.stopen){ if(S.st.open===d.stopen){ S.st.open=null; render(); } else { S.st.open=d.stopen; S.st.cands=null; S.st.cq=''; S.st.cfound=[]; render();
      const [site,uid]=d.stopen.split(':'); const { data } = await sb.rpc('site_candidates', { p_site:site, p_uid:+uid }); S.st.cands=data||[]; render(); } }
  else if(d.anmode){ S.anMode=d.anmode; render(); await loadAnalytics(); render(); }
  else if(d.sagroup){ S.saGroup=d.sagroup; render(); await loadStockAn(); render(); }
  else if(d.safilter!=null){ e.stopPropagation(); S.saFilter={...S.saFilter, [S.saGroup]:d.safilter}; S.saGroup = S.saGroup==='category'?'material':'category'; render(); await loadStockAn(); render(); }
  else if(d.saunf){ const f={...S.saFilter}; delete f[d.saunf]; S.saFilter=f; render(); await loadStockAn(); render(); }
  else if(d.wmode){ S.wmode=d.wmode; S.dq=''; S.dfound=[]; await loadWhSide(); render(); }
  else if(d.dadd){ const p=S.dfound.find(x=>x.id===d.dadd); if(p) docAdd(p); }
  else if(t.id==='dq-add'){ const r=searchCatalog(S.dq); if(r.length===1 || (r[0]&&r[0].barcode===S.dq.trim())) docAdd(r[0]); else { S.dfound=r; render(); } }
  else if(d.ddel){ S.doc.items.splice(+d.ddel,1); render(); }
  else if(t.id==='d-post'){ t.disabled=true; await postDoc(); }
  else if(d.trok || d.trno){ const note = d.trno ? (prompt('Причина отказа (необязательно)')||'') : null; const { error } = await sb.rpc('transfer_decide', { p_transfer:d.trok||d.trno, p_approve:!!d.trok, p_note:note }); if(error) toast(errText(error)); else { toast(d.trok?'Перемещение подтверждено, товар списан с отправителя':'Перемещение отклонено'); await loadWhSide(); render(); } }
  else if(d.trrecv){ const { error } = await sb.rpc('receive_transfer', { p_transfer:d.trrecv }); if(error) toast(errText(error)); else { toast('Перемещение принято'); await loadWhSide(); render(); } }
  else if(d.labels){ printLabels(JSON.parse(d.labels)); }
  else if(t.id==='au-start'){ const { error } = await sb.rpc('audit_start', { p_store:S.auStore||S.store }); if(error) toast(errText(error)); await loadAudit(); render(); }
  else if(t.id==='au-close'||t.id==='au-close-full'){ const full=t.id==='au-close-full';
    modal(`<h2>Закрыть ревизию?</h2><p>${full?'Все товары, которые не посчитали, будут обнулены в этом магазине.':'Остатки поправятся только по посчитанным товарам.'}</p>
      <div class="row"><button class="btn" data-close>Отмена</button><button class="btn primary" data-auclose="${full?1:0}">Закрыть ревизию</button></div>`); }
  else if(d.auclose!=null){ const { error } = await sb.rpc('close_audit', { p_audit:S.audit.id, p_full:d.auclose==='1' }); closeModal(); if(error) toast(errText(error)); else { toast('Ревизия закрыта, остатки поправлены'); await loadAudit(); render(); } }
  else if(d.ssort){ if(String(S.stockSort)===d.ssort) S.stockDir = S.stockDir==='desc'?'asc':'desc'; else { S.stockSort = d.ssort; S.stockDir = 'desc'; } await loadStockView(); render(); }
  else if(d.period){ S.period=d.period; if(d.period!=='custom'){ S.an=null; render(); await loadAnalytics(); } render(); }
  else if(t.id==='an-go'){ S.from=$('#an-from').value; S.to=$('#an-to').value; S.an=null; render(); await loadAnalytics(); render(); }
});
document.addEventListener('change', async e => {
  const t = e.target, d = t.dataset;
  if(t.id==='st-part'){ S.st.part=t.value||null; S.st.off=0; S.st.open=null; render(); await loadSite(); render(); return; }
  if(d.erole) updEmp(d.erole, { role:t.value });
  if(d.ephone){ const p = normPhone(t.value); if(t.value.trim() && !p) return toast('Телефон: 10 цифр после +7'); if(p && S.emps.some(x=>x.id!==d.ephone && x.phone===p)) return toast('Этот телефон уже у другого сотрудника'); t.value = p||''; const e2 = S.emps.find(x=>x.id===d.ephone); if(e2) e2.phone = p; updEmp(d.ephone, { phone: p }); }
  if(d.stf){ (S.stockF ||= {})[d.stf]=t.value; await loadStockView(); render(); }
  if(d.accedit){ const [r,v]=d.accedit.split(':'); const E={...(S.tabEdit||{})}; const vis=Array.isArray((S.tabAccess||{})[r])?S.tabAccess[r]:defaultTabs(r);
    const cur=new Set(Array.isArray(E[r])?E[r]:vis); t.checked?cur.add(v):cur.delete(v); E[r]=ALL_TABS.map(([x])=>x).filter(x=>cur.has(x));
    const { error } = await sb.rpc('set_tab_edit', { p:E }); if(error){ toast(errText(error)); t.checked=!t.checked; } else { S.tabEdit=E; toast(t.checked?'Может менять':'Только смотреть'); } }
  if(d.acc){ const [r,v]=d.acc.split(':'); const A={...(S.tabAccess||{})}; const cur=new Set(Array.isArray(A[r])?A[r]:defaultTabs(r)); t.checked?cur.add(v):cur.delete(v);
    A[r]=ALL_TABS.map(([x])=>x).filter(x=>cur.has(x)); const { error } = await sb.rpc('set_tab_access', { p:A }); if(error){ toast(errText(error)); t.checked=!t.checked; } else { S.tabAccess=A; toast('Сохранено'); } }
  if(t.id==='cs-photo'){ cashPhoto(t.files[0]); }
  if(t.id==='sg-import' && t.files[0]){ sagiImport(t.files[0]); }
  if(t.id==='pf-from'){ PF.from=t.value; await loadProfit(); render(); } if(t.id==='pf-to'){ PF.to=t.value; await loadProfit(); render(); }
  if(t.id==='pf-store'){ PF.add.store=t.value; } if(t.id==='pf-month'){ PF.add.month=t.value; } if(t.id==='pf-cat'){ PF.add.cat=t.value; }
  if(t.classList && t.classList.contains('nc-store')){ const ids=[...document.querySelectorAll('.nc-store:checked')].map(x=>+x.value); const sm=t.closest('details.dd'); if(sm) sm.querySelector('summary').textContent=ddSummary(ids); }
  if(t.classList && t.classList.contains('ne-store')){ const ids=[...document.querySelectorAll('.ne-store:checked')].map(x=>+x.value); const sm=t.closest('details.dd'); if(sm) sm.querySelector('summary').textContent=ddSummary(ids); }
  if(t.id==='po-store' && PO.d){ PO.d.store=+t.value; } if(t.id==='po-eta' && PO.d){ PO.d.eta=t.value; }
  if(t.dataset && t.dataset.poqty!=null && PO.d){ PO.d.items[+t.dataset.poqty].qty = Math.max(1, +t.value||1); render(); }
  if(t.dataset && t.dataset.pocost!=null && PO.d){ PO.d.items[+t.dataset.pocost].cost = t.value; render(); }
  if(t.id==='po-cur' && PO.d){ PO.d.cur = t.value; PO.d.rate = ''; render(); } if(t.id==='po-rate' && PO.d){ PO.d.rate = t.value; render(); } if(t.id==='po-pct' && PO.d){ PO.d.pct = t.value; render(); }
  if(t.id==='po-rcv-rate' && PO.rcv){ PO.rcv.rate = t.value; render(); }
  if(t.dataset && t.dataset.posel){ PO.sel = PO.sel || {}; PO.sel[t.dataset.posel] = t.checked; render(); }
  if(t.id==='po-arch-date'){ PO.archDate = t.value; render(); }
  if(t.id==='po-rcv-store' && PO.rcv){ PO.rcv.store = +t.value; PO.rcv.al = {}; render(); }
  if(t.dataset && t.dataset.poal && PO.rcv){ const [it, st] = t.dataset.poal.split(':'); const o = (PO.list||[]).find(x=>x.id===PO.rcv.id), i = o && (o.items||[]).find(x=>x.item_id===it);
    const main = +(PO.rcv.store||o.store||S.store); PO.rcv.al = PO.rcv.al || {}; const A = PO.rcv.al[it] || (PO.rcv.al[it] = { [main]: i ? i.qty : 0 });
    A[st] = Math.max(0, +t.value||0);
    // если меняют не основной магазин — остаток автоматически остаётся в основном
    if(+st !== main && i){ const others = Object.entries(A).filter(([s])=>+s!==main).reduce((a,[,v])=>a+(+v||0),0); A[main] = Math.max(0, i.qty - others); }
    render(); }
  if(t.id==='po-1688' && t.files[0]){ import1688(t.files[0]); t.value=''; }
  if(t.dataset && t.dataset.porcvqty && PO.rcv){ PO.rcv.qty[t.dataset.porcvqty] = Math.max(0, +t.value||0); render(); }
  if(t.id==='py-official'){ PYF.official = t.checked; render(); }
  if(t.id==='py-month'){ PY.month = t.value || PY.month; PY.open=null; await loadPay(); render(); }
  if(t.id==='py-store'){ PY.store = +t.value; await loadPay(); render(); }
  if(t.id==='py-day'){ PY.day = t.value; await loadPay(); render(); }
  if(t.id==='py-emp'){ PY.add.emp = t.value; } if(t.id==='py-kind'){ PY.add.kind = t.value; }
  if(t.dataset && t.dataset.pyh){ const [emp,kind]=t.dataset.pyh.split(':'); const { error } = await sb.rpc('work_hours_set', { p_store:+PY.store, p_day:PY.day, p_employee:emp, p_hours:+t.value, p_kind:kind }); if(error) toast(errText(error)); else { toast('Часы сохранены'); await loadPay(); render(); } }
  if(t.id==='bk-filter'){ BK.filter=t.value; BK.off=0; render(); await loadBonus(); render(); }
  if(t.id==='bk-sort'){ BK.sort=t.value; BK.off=0; render(); await loadBonus(); render(); }
  if(t.id==='cf-store'){ S.cf.store=t.value; await loadCerts(); render(); }
  if(t.id==='nm-cat'){ S.nm.cat=t.value; S.nm.off=0; render(); await loadNom(); render(); }
  if(t.id==='nm-arch'){ S.nm.arch=t.checked; S.nm.off=0; render(); await loadNom(); render(); }
  if(t.id==='nm-photo'){ nmPhoto(t.files[0]); }
  if(d.nf && (t.type==='checkbox' || t.tagName==='SELECT')){ S.nm.ed[d.nf] = t.type==='checkbox' ? t.checked : t.value; }
  if(t.id==='d-store'){ S.doc.store=+t.value; }
  if(t.id==='d-to'){ S.doc.to=+t.value; }
  if(t.id==='au-store'){ S.auStore = +t.value; S.audit = null; S.auditRows = []; render(); await loadAudit(); render(); }
  if(t.id==='stsort'){ S.stockSort = t.value; S.stockDir='desc'; loadStockView().then(render); }
});
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if(t.id==='q'){ S.q = t.value; clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 200); }
  else if(d.ldisc!=null){ S.cart[+d.ldisc].dv = Math.max(0,+t.value||0); syncPays(); render(); }
  else if(t.id==='disc'){ S.disc = Math.max(0,+t.value||0); syncPays(); render(); }
  else if(t.id==='phone'){ S.phone = t.value; if(normPhone(t.value) && t.value.replace(/\D/g,'').length>=10){ clearTimeout(searchTimer); searchTimer=setTimeout(lookupCustomer, 300); } }
  else if(d.pamt){ S.pays[d.pamt] = Math.max(0,+t.value||0); if(d.pamt==='bonus') S.pays.bonus = Math.min(S.pays.bonus, maxBonus()); render(); }
  else if(t.id==='cert-code'){ S.certCode = t.value; }
  else if(t.id==='cert-q'){ S.certQ = t.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 200); }
  else if(t.id==='cs-cat'){ CS.cat=t.value; }
  else if(t.id==='py-hours'){ PY.add.hours=t.value; }
  else if(t.id==='po-q'){ PO.q=t.value; clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ PO.found = searchCatalog(PO.q); render(); }, 200); }
  else if(t.id==='po-supplier' && PO.d){ PO.d.supplier=t.value; } else if(t.id==='po-cargo' && PO.d){ PO.d.cargo=t.value; } else if(t.id==='po-note' && PO.d){ PO.d.note=t.value; }
  else if(t.id==='pf-amount'){ PF.add.amount=t.value; } else if(t.id==='pf-note'){ PF.add.note=t.value; }
  else if(t.id==='cs-amount'){ CS.amount=t.value; } else if(t.id==='cs-comment'){ CS.comment=t.value; } else if(t.id==='cs-collector'){ CS.collector=t.value; }
  else if(t.id==='bk-q'){ BK.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ BK.off=0; await loadBonus(); render(); }, 400); }
  else if(t.id==='cf-q'){ S.cf.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ await loadCerts(); render(); }, 400); }
  else if(t.id==='nm-q'){ S.nm.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ S.nm.off=0; await loadNom(); render(); }, 400); }
  else if(d.nf && t.type!=='checkbox' && t.tagName!=='SELECT'){ S.nm.ed[d.nf]=t.value; }
  else if(t.id==='nm-sq'){ S.nm.sq=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ if(S.nm.sq.trim().length<2){ S.nm.sfound=[]; return render(); } const { data } = await sb.rpc('site_search', { p_q:S.nm.sq.trim() }); S.nm.sfound=data||[]; render(); }, 400); }
  else if(t.id==='st-q'){ S.st.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ S.st.off=0; await loadSite(); render(); }, 400); }
  else if(t.id==='st-cq'){ S.st.cq=t.value; clearTimeout(searchTimer); searchTimer = setTimeout(()=>{ S.st.cfound=searchCatalog(S.st.cq); render(); }, 200); }
  else if(t.id==='dq'){ S.dq=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(()=>{ S.dfound=searchCatalog(S.dq); render(); }, 200); }
  else if(d.dqty!=null){ S.doc.items[+d.dqty].qty = Math.max(1,+t.value||1); }
  else if(d.dcost!=null){ S.doc.items[+d.dcost].cost = t.value===''?null:Math.max(0,+t.value); }
  else if(t.id==='d-supplier'){ S.doc.supplier=t.value; } else if(t.id==='d-reason'){ S.doc.reason=t.value; } else if(t.id==='d-note'){ S.doc.note=t.value; }
  else if(t.id==='sq'){ S.salesQ = t.value; }
  else if(t.id==='stq'){ S.stockQ = t.value; clearTimeout(searchTimer); searchTimer = setTimeout(async()=>{ await loadStockView(); render(); }, 300); }
});
document.addEventListener('keydown', e => {
  if(e.key!=='Enter') return;
  if(e.target.id==='q'){ e.preventDefault(); $('#q-add').click(); }
  if(e.target.id==='dq'){ e.preventDefault(); if(S.view==='wh' && S.wmode==='audit' && auScan(e.target)) return; $('#dq-add').click(); }
  if(e.target.id==='phone'){ e.preventDefault(); lookupCustomer(); }
  if(e.target.id==='sq'){ e.preventDefault(); $('#sq-go').click(); }
  if(e.target.id==='cc'){ e.preventDefault(); $('#cc-go').click(); }
});
// при переключении вкладок подгружаем данные
document.addEventListener('click', async e => {
  if(e.target.closest('[data-moreclose]')){ S.moreOpen = false; renderNav(); return; }
  const b = e.target.closest('nav.tabs button, nav.subtabs button'); if(!b) return;
  if(b.dataset.more){ S.moreOpen = !S.moreOpen; renderNav(); return; }
  S.moreOpen = false;
  if(b.dataset.group){ const g = GROUPS.find(x=>x[0]===b.dataset.group), av = g[3].filter(v => (S.tabs||[]).some(t=>t[0]===v)); const last = (S.lastView||{})[g[0]]; S.view = av.includes(last) ? last : av[0]; }
  else S.view = b.dataset.view;
  render(); scrollTo(0,0); await loadView();
});
// данные для открытой вкладки (при переходе и после обновления страницы)
/* на телефоне тяжёлые отчёты грузятся только по кнопке */
const LAZY_VIEWS = ['analytics','profit','flow'];
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const lazyPending = v => isPhone() && LAZY_VIEWS.includes(v) && !(S.lazyOk||{})[v];
document.addEventListener('click', async e => { const t = e.target.closest('button[data-lazyload]'); if(!t) return; (S.lazyOk ||= {})[t.dataset.lazyload] = true; render(); await loadView(); });
/* кэш вкладок: вернулись на вкладку в течение минуты — показываем уже загруженное, без запроса.
   Любое действие (кнопка, ссылка, поле), кроме переходов по меню, сбрасывает кэш — после записи данные всегда свежие. */
const VC = {}, VC_TTL = 60e3;
const VC_OK = { sales:() => Array.isArray(S.sales), day:() => !!DAY.data && (DAY.role!=='own' || !!DAY.pulse), nom:() => !!(S.nm && S.nm.data),
  site:() => !!(S.st && S.st.data), analytics:() => S.anMode==='stock' ? !!S.sa : !!S.an, profit:() => !!PF.data, flow:() => !!FL.data, content:() => !!CT.list };
const vcKey = () => JSON.stringify([S.view, selStores(), S.store, S.anMode, DAY.role, DAY.store, CT.brand]);
const vcDrop = () => { for(const k in VC) delete VC[k]; };
document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('button, a, input, label, select, [role=button]'); if(!t) return;
  if(t.closest('nav.tabs, nav.subtabs, [data-pcard], [data-more], [data-moreclose]')) return; vcDrop(); }, true);
document.addEventListener('change', vcDrop, true); document.addEventListener('submit', vcDrop, true);
async function loadView(){
  viewAlias();
  if(lazyPending(S.view)){ render(); return; }
  const v = S.view, c = VC[v];
  if(VC_OK[v] && c && c.k===vcKey() && Date.now()-c.t < VC_TTL && VC_OK[v]()){ render(); return; }
  await loadView0();
  if(VC_OK[v] && S.view===v) VC[v] = { k:vcKey(), t:Date.now() };
}
async function loadView0(){
  viewAlias();
  if(S.view==='shifts'){ await loadShifts(); render(); }
  if(S.view==='sales'){ await loadSales(); render(); }
  if(S.view==='certs'){ await loadCerts(); render(); }
  if(S.view==='emps'){ await loadEmps(); render(); }
  if(S.view==='cons'){ render(); await loadEmps(); render(); }
  if(S.view==='day'){ render(); await loadDay(); render(); }
  if(S.view==='photo'){ render(); await loadPhoto(); render(); }
  if(S.view==='pay'){ render(); await loadPay(); render(); }
  if(S.view==='profit'){ render(); await loadProfit(); render(); }
  if(S.view==='po'){ render(); await loadPo(); render(); }
  if(S.view==='promo'){ render(); await loadPromos(); render(); }
  if(S.view==='content'){ render(); await loadContent(); render(); }
  if(S.view==='me'){ render(); await loadMe(); render(); }
  if(S.view==='adm'){ render(); await loadAdm(); render(); }
  if(S.view==='audit'){ render(); await loadAudit(); render(); }
  if(S.view==='bot'){ render(); await loadBot(); render(); }
  if(S.view==='flow'){ render(); await loadFlow(); render(); }
  if(S.view==='wh'){ if(!S.wmode) S.wmode=whModes()[0][0]; await loadWhSide(); render(); }
  if(S.view==='site'){ render(); await loadSite(); render(); }
  if(S.view==='nom'){ render(); await loadNom(); render(); }
  if(S.view==='bonus'){ render(); await loadBonus(); render(); }
  if(S.view==='cash'){ render(); await loadCash(); render(); }
  if(S.view==='analytics'){ S.an=null; render(); await loadAnalytics(); render(); }
}

sb.auth.onAuthStateChange((ev) => { if(ev==='SIGNED_OUT') renderLogin(); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
boot();


/* ---------- акции ---------- */
const PR = { list:null, cats:null, edit:null };
const todayAlm = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Almaty'});
async function loadPromos(){
  const [a, c] = await Promise.all([sb.from('promotions').select('*').order('created_at',{ascending:false}), PR.cats ? null : sb.from('categories').select('id,name').eq('hidden',false).order('name')]);
  if(a.error){ PR.list = PR.list||[]; return; } PR.list = a.data || []; if(c) PR.cats = c.data || [];
}
const promoLive = (p, store) => { const d = todayAlm(); return p.active && (!p.starts || p.starts <= d) && (!p.ends || p.ends >= d) && (!p.stores || !p.stores.length || p.stores.includes(store)); };
const catName = id => ((PR.cats||[]).find(c=>c.id===id)||{}).name || ('категория '+id);
function promoBase(p, t){
  if(!p.category_ids || !p.category_ids.length) return t.total;
  const k = t.sub ? t.total / Math.max(1, t.sub - t.lineDisc) : 1;
  return Math.round(S.cart.filter(l => p.category_ids.includes(l.cat)).reduce((a,l)=>a + (l.price*l.qty - (l.disc||0)), 0) * k);
}
function promoHintHtml(t){
  if(!S.cart.length || !PR.list) return '';
  const L = PR.list.filter(p => promoLive(p, S.store)); if(!L.length) return '';
  const out = L.map(p => { const b = promoBase(p, t), need = (+p.min_total||0) - b;
    if(need <= 0 && (b > 0 || !p.min_total)) return `<div class="promo-hit">🎁 <b>${esc(p.title)}</b>${p.gift?' — '+esc(p.gift):''}<br><span class="meta">Условие выполнено — не забудьте предложить клиенту</span></div>`;
    if(need > 0 && need <= Math.max(+p.min_total*0.6, 5000)) return `<div class="promo-near">✨ До акции «${esc(p.title)}» не хватает <b class="num">${fmt(need)}</b>${p.category_ids&&p.category_ids.length?' в категории '+esc(p.category_ids.map(catName).join(', ')):''}${p.gift?' · '+esc(p.gift):''}</div>`;
    return ''; }).join('');
  return out ? `<div class="stack" style="gap:6px">${out}</div>` : '';
}
const promoCanEdit = () => S.me && ['owner','manager'].includes(S.me.role);
function promoCond(p){ return [p.min_total>0?'чек от '+fmt(p.min_total):'любая покупка', p.category_ids&&p.category_ids.length?'в категории '+p.category_ids.map(catName).join(', '):'', p.stores&&p.stores.length?ddSummary(p.stores):'все магазины',
  p.starts||p.ends?`${p.starts?'с '+new Date(p.starts).toLocaleDateString('ru-RU'):''} ${p.ends?'по '+new Date(p.ends).toLocaleDateString('ru-RU'):''}`.trim():'без срока'].filter(Boolean).join(' · '); }
function renderPromo(){
  const L = PR.list, e = PR.edit, ed = promoCanEdit();
  const live = (L||[]).filter(p => promoLive(p, S.store)), other = (L||[]).filter(p => !live.includes(p));
  const card = p => `<div class="card stack" style="gap:4px;margin-bottom:8px;${promoLive(p,S.store)?'':'opacity:.65'}"><div class="row"><b>🎁 ${esc(p.title)}</b>${p.active?'':'<span class="chip zero">выключена</span>'}</div>
    ${p.gift?`<div>Что даём: <b>${esc(p.gift)}</b></div>`:''}<div class="meta">${esc(promoCond(p))}</div>${p.description?`<div>${esc(p.description)}</div>`:''}
    ${ed?`<div class="row" style="justify-content:flex-start"><button class="btn small" data-predit="${p.id}">Изменить</button><button class="btn small" data-prdel="${p.id}">Удалить</button></div>`:''}</div>`;
  $('#main').innerHTML = `<div class="row"><h2>Акции</h2>${ed&&!e?'<button class="btn primary" id="pr-new">+ Новая акция</button>':''}</div>
  <p class="meta">Активные акции подсказываются прямо в чеке на кассе: когда покупка подходит — «🎁 предложите подарок», когда немного не хватает — «до акции не хватает …».</p>
  <div class="grid2"><div>${!L?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">Акций пока нет</div>':`${live.length?`<h3>Действуют сейчас · ${esc(storeName(S.store))}</h3>${live.map(card).join('')}`:'<div class="empty">Сейчас в этом магазине акций нет</div>'}${other.length?`<h3>Другие</h3>${other.map(card).join('')}`:''}`}</div>
  <div>${e?`<div class="card stack"><b>${e.id?'Изменить акцию':'Новая акция'}</b>
    <input id="pr-title" placeholder="Название, напр. «Подарок от 30 000»" value="${esc(e.title||'')}">
    <input id="pr-gift" placeholder="Что даём: пакет-подарок, браслет, скидка 10%…" value="${esc(e.gift||'')}">
    <textarea id="pr-desc" rows="2" placeholder="Описание для консультантов (необязательно)">${esc(e.description||'')}</textarea>
    <label class="meta">Сумма чека от, ₸ <input id="pr-min" type="number" min="0" inputmode="numeric" value="${e.min_total||''}" style="width:140px"></label>
    <div class="meta">Только на товары категорий (если пусто — весь чек):</div>
    <details class="dd"><summary>${e.cats.length?esc(e.cats.map(catName).join(', ')):'все категории'}</summary><div class="dd-panel">${(PR.cats||[]).map(c=>`<label><input type="checkbox" data-prcat="${c.id}" ${e.cats.includes(c.id)?'checked':''}> ${esc(c.name)}</label>`).join('')}</div></details>
    <div class="meta">Магазины (если пусто — все):</div>${storesDD(e.stores, id=>`data-prst="${id}"`)}
    <div class="row" style="justify-content:flex-start;flex-wrap:wrap"><label class="meta">С <input type="date" id="pr-from" value="${e.starts||''}"></label><label class="meta">по <input type="date" id="pr-to" value="${e.ends||''}"></label></div>
    <label><input type="checkbox" id="pr-active" ${e.active!==false?'checked':''}> акция включена</label>
    <div class="row"><button class="btn" id="pr-cancel">Отмена</button><button class="btn primary" id="pr-save">Сохранить</button></div></div>`
    :`<div class="card meta">${ed?'Нажмите «Новая акция», чтобы добавить условия и подарок.':'Акции добавляет менеджер. Подсказки появятся в чеке автоматически.'}</div>`}</div></div>`;
}
function prReadForm(){ const e = PR.edit; if(!e) return; const v = id => ($('#'+id)||{}).value;
  Object.assign(e, { title:v('pr-title'), gift:v('pr-gift'), description:v('pr-desc'), min_total:v('pr-min'), starts:v('pr-from'), ends:v('pr-to'), active:($('#pr-active')||{}).checked }); }
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if(!t || S.view!=='promo') return; const d = t.dataset;
  if(t.id==='pr-new'){ PR.edit = { cats:[], stores:[], active:true }; render(); }
  else if(t.id==='pr-cancel'){ PR.edit = null; render(); }
  else if(d.predit){ const p = PR.list.find(x=>x.id===d.predit); PR.edit = { ...p, cats:[...(p.category_ids||[])], stores:[...(p.stores||[])] }; render(); scrollTo(0,0); }
  else if(d.prdel){ if(t.dataset.sure!=='1'){ t.dataset.sure='1'; t.textContent='Точно удалить?'; return; } const { error } = await sb.rpc('promo_del', { p_id:d.prdel }); if(error) return toast(errText(error)); toast('Акция удалена'); await loadPromos(); render(); }
  else if(t.id==='pr-save'){ prReadForm(); const x = PR.edit; if(!(x.title||'').trim()) return toast('Укажите название');
    t.disabled = true; const { error } = await sb.rpc('promo_save', { p:{ id:x.id||null, title:x.title.trim(), gift:x.gift, description:x.description, min_total:x.min_total, category_ids:x.cats, stores:x.stores, starts:x.starts, ends:x.ends, active:x.active } });
    if(error){ t.disabled=false; return toast(errText(error)); } toast('Акция сохранена'); PR.edit = null; await loadPromos(); render(); }
});
document.addEventListener('change', e => {
  if(S.view!=='promo' || !PR.edit) return; const t = e.target, d = t.dataset;
  if(d.prcat||d.prst){ prReadForm(); const arr = d.prcat ? PR.edit.cats : PR.edit.stores, id = +(d.prcat||d.prst); const i = arr.indexOf(id); if(t.checked && i<0) arr.push(id); if(!t.checked && i>=0) arr.splice(i,1);
    const sum = t.closest('details').querySelector('summary'); sum.textContent = d.prcat ? (arr.length?arr.map(catName).join(', '):'все категории') : ddSummary(arr); }
});

/* ---------- праздник: лучший чек дня ---------- */
async function celebrate(saleId){
  try{
    const { data } = await sb.rpc('sale_celebrate', { p_sale: saleId }); if(!data) return;
    const k = 'kassa_rec_'+S.store+'_'+todayAlm(), seen = ls.get(k, {});
    if(data.record_day && !seen.day){ seen.day = 1; ls.set(k, seen); confetti(260); bigCheer('🔥 Рекорд дня!', `Магазин продал за сегодня ${fmt(data.day_total)} — больше, чем в любой день за 2 месяца. Команда, вы супер!`); }
    else if(data.best_check){ confetti(160); bigCheer('🏆 Лучший чек дня!', `${fmt(data.total)} — самый большой чек в магазине сегодня. Так держать!`); }
  }catch(_){}
}
function bigCheer(title, text){
  const el = document.createElement('div'); el.className = 'cheer'; el.innerHTML = `<b>${esc(title)}</b><span>${esc(text)}</span>`;
  el.onclick = () => el.remove(); document.body.append(el); setTimeout(() => el.remove(), 5500);
}
function confetti(n){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; document.body.append(c);
  const W = c.width = innerWidth, H = c.height = innerHeight, x = c.getContext('2d');
  const col = ['#f2c94c','#eb5757','#6fcf97','#56ccf2','#bb6bd9','#f2994a','#ffffff'];
  const P = Array.from({length:n}, () => ({ x: W/2 + (Math.random()-.5)*W*0.3, y: H*0.35, vx:(Math.random()-.5)*14, vy: -Math.random()*14-4, r: Math.random()*6+4, a: Math.random()*6, va:(Math.random()-.5)*.3, c: col[Math.random()*col.length|0] }));
  let f = 0; (function tick(){ x.clearRect(0,0,W,H); P.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; x.save(); x.translate(p.x,p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r/2,-p.r/4,p.r,p.r/2); x.restore(); });
    if(++f < 170) requestAnimationFrame(tick); else c.remove(); })();
}

/* ---------- мой кабинет (командные продажи в мои смены) ---------- */
const ME = { month: new Date().toISOString().slice(0,7), data:null, pay:null };
async function loadMe(){
  ME.data = null; const from = ME.month+'-01', [y,m] = ME.month.split('-').map(Number), to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0,10);
  const [c, p, a] = await Promise.all([sb.rpc('my_cabinet', { p_month: from }), sb.rpc('payroll', { p_from:from, p_to:to, p_stores:null }), sb.rpc('pay_adj_list', { p_month: from })]);
  if(c.error) toast(errText(c.error)); ME.data = c.data || { days:[], prev:{}, records:[] };
  const mine = (p.data||[]).find(e => e.employee===S.me.id) || { employee:S.me.id, total:0, hours:0, days:[] };
  const A = (a.data||[]).filter(x => x.employee===S.me.id), by = k => A.filter(x=>x.kind===k).reduce((s,x)=>s+ +x.amount,0);
  const plus = by('bonus')+by('audit')+by('carry_in'), minus = by('fine')+by('overpay'), due = mine.total + plus - minus, paid = by('advance')+by('paid')+by('card');
  ME.pay = { total:mine.total, A, plus, minus, due, paid, rest: due - paid, card: by('card') };
}
function renderMe(){
  const D = ME.data, P = ME.pay;
  const sum = (D&&D.days||[]).reduce((a,d)=>({ total:a.total+ +d.total, checks:a.checks+ +d.checks, hours:a.hours+ +d.hours }), { total:0, checks:0, hours:0 });
  const pv = (D&&D.prev)||{}, avg = sum.checks ? sum.total/sum.checks : 0, pavg = pv.checks ? pv.total/pv.checks : 0;
  const perShift = D&&D.days.length ? sum.total/D.days.length : 0, pPerShift = pv.days ? pv.total/pv.days : 0;
  const delta = (a,b) => b ? `<span class="meta" style="color:${a>=b?'var(--ok)':'var(--bad)'}">${a>=b?'▲':'▼'} ${Math.abs(Math.round((a/b-1)*100))}% к прошлому месяцу</span>` : '<span class="meta">в прошлом месяце смен не было</span>';
  const tile = (t,v,sub) => `<div class="card stack" style="gap:2px"><span class="meta">${t}</span><b class="num" style="font-size:22px">${v}</b>${sub||''}</div>`;
  const dd = d => new Date(d+'T00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',weekday:'short'});
  $('#main').innerHTML = `<div class="row"><h2>Мой кабинет · ${esc(S.me.full_name)}</h2><label class="meta">Месяц <input type="month" id="me-month" value="${ME.month}"></label></div>
  <p class="meta">У нас командная работа, поэтому здесь — продажи всего магазина в те дни, когда вы были на смене.</p>
  ${!D?'<div class="empty">Считаем…</div>':`<div class="kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px">
    ${tile('Смен в этом месяце', D.days.length, `<span class="meta">${sum.hours} ч</span>`)}
    ${tile('Продажи команды в мои смены', fmt(sum.total), delta(perShift, pPerShift).replace('к прошлому','за смену к прошлому'))}
    ${tile('Средний чек в мои смены', fmt(avg), delta(avg, pavg))}
    ${P?tile('Моя зарплата: остаток к выплате', fmt(Math.max(P.rest,0)), `<span class="meta">начислено ${fmt(P.due)} · выплачено ${fmt(P.paid)}</span>`):''}
  </div>
  <div class="grid2"><div>
    <h3>Мои смены</h3>${D.days.length?`<div class="scroll"><table><thead><tr><th>День</th><th>Магазин</th><th>Часы</th><th>Продажи</th><th>Чеков</th><th>Лучший чек</th></tr></thead><tbody>
      ${D.days.map(d=>`<tr><td class="num">${dd(d.day)}</td><td>${esc(storeName(d.store_id))}${d.team?'<br><span class="meta">с вами: '+esc(d.team)+'</span>':''}</td><td class="num">${+d.hours}</td><td class="num"><b>${fmt(d.total)}</b></td><td class="num">${d.checks}</td><td class="num">${fmt(d.best)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">В этом месяце смен в табеле нет</div>'}
  </div><div class="stack">
    ${P?`<div class="card stack" style="gap:6px"><b>Моя зарплата за месяц</b>
      <div class="row"><span>Начислено по продажам</span><span class="num">${fmt(P.total)}</span></div>
      ${P.A.map(a=>`<div class="row"><span>${PADJ[a.kind][0]}${a.note?' <span class="meta">— '+esc(a.note)+'</span>':''}</span><span class="num">${PADJ[a.kind][1]>0?'+':'−'}${fmt(a.amount)}</span></div>`).join('')}
      <div class="row" style="border-top:1px solid var(--line);padding-top:6px"><b>${P.rest<0?'Переплата':'Остаток к выплате'}</b><b class="num">${fmt(Math.abs(P.rest))}</b></div>
      ${P.card?`<div class="meta">из них на карту: ${fmt(P.card)}</div>`:''}
      <button class="btn small" id="me-pay" style="align-self:flex-start">Подробный расчёт по дням →</button></div>`:''}
    <div class="card stack" style="gap:6px"><b>🏆 Рекорды магазинов за месяц</b>
      ${(D.records||[]).filter(r=>r.best_check||r.best_day).map(r=>`<div><b>${esc(storeName(r.store_id))}</b><br><span class="meta">лучший чек ${fmt(r.best_check)} · лучший день ${fmt(r.best_day)}</span></div>`).join('') || '<span class="meta">Пока нет продаж</span>'}
      <span class="meta">Побейте рекорд — на кассе будет салют 🎉</span></div>
  </div></div>`}`;
}
document.addEventListener('click', async e => { if(S.view==='me' && e.target.id==='me-pay'){ S.view='pay'; PY.month = ME.month; render(); await loadPay(); render(); } });
document.addEventListener('change', async e => { if(S.view==='me' && e.target.id==='me-month'){ ME.month = e.target.value || ME.month; render(); await loadMe(); render(); } });


/* ---------- административный штат (видит только владелец) ---------- */
const AD = { month: new Date().toISOString().slice(0,7), list:null };
const AD_F = [['bonus','Премия'],['paid_cash','Выплачено наличными'],['paid_card','Выплачено на карту']];
async function loadAdm(){ AD.list = null; const { data, error } = await sb.rpc('admin_pay_list', { p_month: AD.month+'-01' }); if(error) toast(errText(error)); AD.list = data || []; }
const adCalc = a => { const due = (+a.accrued||0) + (+a.bonus||0) - (+a.deduction||0), card = a.all_card ? due : (+a.official_card||0), paid = (+a.paid_cash||0) + (+a.paid_card||0);
  return { due, card, cash: due - card, paid, rest: due - paid, cost: due + (+a.tax||0) }; };
/* ---------- журнал действий (только владелец): кто и что менял ---------- */
const AU = { ent:'', actor:'', q:'', rows:null, more:false, busy:false };
const AU_GROUPS = [['','Всё'],['product,cost','Цены и товары'],['employee','Сотрудники и права'],['stock','Склад'],['sales','Возвраты'],['settings,secret','Настройки и ключи'],['instagram,content','Instagram'],['certificate,bonus','Сертификаты и бонусы']];
const AU_ENT = { product:'Товар', cost:'Себестоимость', employee:'Сотрудник', settings:'Настройка', secret:'Ключ', instagram:'Instagram', sales:'Чек', certificate:'Сертификат', content:'Пост', bonus:'Бонусы вручную', stock:'Склад' };
const AU_ACT = { insert:'добавлено', update:'изменено', delete:'удалено' };
const AU_F = { price:'Цена', cost:'Себестоимость', name:'Название', barcode:'Штрихкод', sku:'Артикул', brand:'Бренд', category_id:'Категория', archived:'В архиве', is_group:'Общий штрихкод', is_service:'Услуга',
  supplier_id:'Поставщик', purchase_url:'Ссылка на закуп', merged_into:'Объединён с', full_name:'Имя', phone:'Телефон', role:'Роль', active:'Работает', home_store_id:'Основной магазин', store_ids:'Магазины',
  official:'Официально', auth_user_id:'Вход в Silver', value:'Значение', status:'Статус', nominal:'Номинал', balance:'Остаток', expires_at:'Действует до', posted_url:'Ссылка на пост', amount:'Бонусы', reason:'Причина',
  connected:'Подключён', username:'Аккаунт', type:'Операция', store:'Магазин', items:'Позиций', qty:'Штук', number:'Номер', kind:'Тип', total:'Сумма', original_sale_id:'Исходный чек', wipon_id:'Wipon', customer_id:'Клиент', product:'Товар' };
const AU_SET = { tab_access:'Какие вкладки видит каждая роль', tab_edit:'Где роль может менять данные', pos_enabled:'Касса Silver', backup_downloaded_at:'Резервная копия скачана', writeoff_approvers:'Кто подтверждает списания', pay_rules:'Правила зарплаты', tax_rate:'Налог' };
const AU_MOVE = { receipt:'Приёмка', writeoff:'Списание', audit:'Ревизия', capitalize:'Оприходование', transfer_out:'Перемещение' };
function auVal(f, v, a){
  if(v===null || v===undefined || v==='') return '—';
  if(['price','cost','nominal','balance','total'].includes(f)) return fmt(+v);
  if(typeof v==='boolean') return f==='connected' ? (v?'да':'нет') : (v?'да':'нет');
  if(f==='auth_user_id') return 'есть';
  if(f==='role') return ROLE[v] || v;
  if(f==='store' || f==='home_store_id') return storeName(+v);
  if(f==='store_ids') return Array.isArray(v) ? v.map(x=>storeName(+x)).join(', ') : String(v);
  if(f==='type' && a.entity==='stock') return AU_MOVE[v] || v;
  if(f==='expires_at') return new Date(v).toLocaleDateString('ru-RU');
  const t = typeof v==='object' ? JSON.stringify(v) : String(v);
  return t.length > 140 ? `<details><summary class="meta" style="cursor:pointer">${esc(t.slice(0,60))}…</summary><span style="overflow-wrap:anywhere;font-size:12px">${esc(t)}</span></details>` : esc(t);
}
function auChanges(a){
  const C = a.changes || {}, keys = Object.keys(C).filter(k => !(a.entity==='stock' && k==='product') && !(a.entity==='bonus' && k==='customer_id'));
  if(a.entity==='stock'){ const g = k => (C[k]||[])[1]; return `${esc(AU_MOVE[g('type')]||g('type')||'')} · ${esc(storeName(+g('store')))} · позиций ${g('items')||0}, штук ${(+g('qty')>0?'+':'')+(g('qty')||0)}`; }
  if(a.entity==='secret') return 'значение ключа заменено (само значение не хранится)';
  return keys.map(k => { const [o, n] = C[k] || []; const f = a.entity==='settings' ? 'value' : k;
    return `<div><span class="meta">${esc(AU_F[k]||k)}:</span> ${a.action==='insert' ? auVal(f, n, a) : a.action==='delete' ? auVal(f, o, a) : auVal(f, o, a)+' → <b>'+auVal(f, n, a)+'</b>'}</div>`; }).join('') || '<span class="meta">—</span>';
}
function auWhat(a){
  const e = AU_ENT[a.entity] || a.entity, lbl = a.entity==='settings' ? (AU_SET[a.entity_id] || a.entity_id) : a.entity==='secret' ? a.entity_id : a.entity==='instagram' ? (a.entity_id==='moon' ? 'MOON' : 'Sunshine') : (a.label || '');
  return `<b>${esc(e)}</b>${lbl?`: ${a.entity==='stock'||a.entity==='product'||a.entity==='cost' ? pcl(a.entity==='stock' ? ((a.changes||{}).product||[])[1] : a.entity_id, esc(lbl)) : esc(lbl)}`:''} <span class="meta">— ${a.note ? esc(a.note) : AU_ACT[a.action]||a.action}</span>`;
}
async function loadAudit(more){
  if(AU.busy) return; AU.busy = true;
  const before = more && AU.rows && AU.rows.length ? AU.rows[AU.rows.length-1].at : null;
  const { data, error } = await sb.rpc('audit_list', { p_entity:AU.ent||null, p_actor:AU.actor||null, p_q:AU.q||null, p_limit:100, p_before:before });
  AU.busy = false; if(error){ toast(errText(error)); AU.rows = AU.rows || []; return; }
  AU.rows = more ? [...(AU.rows||[]), ...(data||[])] : (data||[]); AU.more = (data||[]).length === 100;
  if(!more) AU.actors = AU.actors || {}; (data||[]).forEach(a => { if(a.actor) (AU.actors ||= {})[a.actor] = a.actor_name; });
}
function renderAudit(){
  const L = AU.rows, A = AU.actors || {};
  $('#main').innerHTML = `<h2>Журнал действий</h2>
  <p class="meta" style="margin:2px 0 10px">Кто и что менял: цены и себестоимость, сотрудников и права, склад вручную (приёмка, списание, ревизия, оприходование, перемещение), возвраты, настройки, ключи, Instagram. Загрузки из Wipon не пишутся. Хранится 400 дней, видите только вы.</p>
  <div class="filters">${AU_GROUPS.map(([k,v])=>`<button class="btn small ${AU.ent===k?'primary':''}" data-auent="${k}">${v}</button>`).join('')}</div>
  <div class="filters"><select id="au-actor" aria-label="Сотрудник"><option value="">Все сотрудники</option>${Object.entries(A).map(([id,n])=>`<option value="${id}" ${AU.actor===id?'selected':''}>${esc(n||'—')}</option>`).join('')}</select>
    <input id="au-q" placeholder="Поиск: товар, сотрудник, значение" value="${esc(AU.q)}" style="flex:1;min-width:180px" inputmode="search"></div>
  ${!L?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">Записей пока нет — журнал ведётся с 20.11.2026</div>':`<div class="scroll"><table class="mc"><thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Было → стало</th></tr></thead><tbody>
    ${L.map(a=>`<tr><td class="num" data-l="Когда" style="white-space:nowrap">${new Date(a.at).toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
      <td data-l="Кто">${esc(a.actor_name||'—')}</td><td class="mc-t">${auWhat(a)}</td><td data-l="Изменения" style="min-width:220px">${auChanges(a)}</td></tr>`).join('')}</tbody></table></div>
    ${AU.more?`<button class="btn" id="au-more" style="width:100%;margin-top:8px">${AU.busy?'Загружаем…':'Показать ещё'}</button>`:''}`}`;
}
let auTimer;
document.addEventListener('click', async e => { if(S.view!=='audit') return; const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.auent!==undefined){ AU.ent = t.dataset.auent; AU.rows = null; render(); await loadAudit(); render(); }
  else if(t.id==='au-more'){ await loadAudit(true); render(); } });
document.addEventListener('change', async e => { if(S.view!=='audit' || e.target.id!=='au-actor') return; AU.actor = e.target.value; AU.rows = null; render(); await loadAudit(); render(); });
document.addEventListener('input', e => { if(S.view!=='audit' || e.target.id!=='au-q') return; AU.q = e.target.value; clearTimeout(auTimer);
  auTimer = setTimeout(async () => { await loadAudit(); render(); }, 350); });

/* ---------- Бот: сообщения и напоминалки консультантам (менеджер — только своим магазинам) ---------- */
const BT = { st:null, busy:false, sel:null, target:'group', when:'now', at:'', text:'' };
const BT_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const BT_TGT = { group:'В группу магазина', staff:'Лично консультантам', both:'В группу и лично' };
const BT_TPL = ['Девочки, не забудьте отметить приход в боте 🟢','Перед закрытием пересчитайте кассу и сфотографируйте отчёт 🧾','Протрите витрины и зеркала перед открытием ✨','Сегодня новая выкладка — фото витрины пришлите в группу 📸','Спасибо за работу сегодня! 💛'];
async function loadBot(){ const { data, error } = await sb.rpc('bot_state'); if(error){ toast(errText(error)); BT.st = { err:errText(error) }; return; }
  BT.st = data; if(!BT.sel){ const sc = data.scope || []; BT.sel = sc.includes(S.store) && sc.length > 1 && !isBoss() ? [S.store] : [...sc]; } }
async function botFn(body){ const { data, error } = await sb.functions.invoke('bot', { body }); if(error){ let m = errText(error); try{ const j = await error.context.json(); if(j && j.error) m = j.error; }catch(_){} throw new Error(m); } if(data && data.error) throw new Error(data.error); return data; }
const btTime = d => d ? new Date(d).toLocaleString('ru-RU',{ timeZone:'Asia/Almaty', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
const btStores = ids => (ids||[]).length === ((BT.st&&BT.st.scope)||[]).length && ids.length > 1 ? 'все мои магазины' : (ids||[]).map(id => esc(storeName(id))).join(', ');
function btReach(ids, target){ const S2 = ((BT.st&&BT.st.stores)||[]).filter(s => (ids||[]).includes(s.id));
  const g = S2.filter(s => s.chat).length, p = S2.reduce((a,s)=>a+(+s.staff_tg||0),0), all = S2.reduce((a,s)=>a+(+s.staff||0),0);
  const parts = []; if(target!=='staff') parts.push(`групп: ${g} из ${S2.length}`); if(target!=='group') parts.push(`лично: ${p} из ${all} консультантов`);
  return { txt: parts.join(' · '), none: (target==='staff' ? p : target==='group' ? g : g+p) === 0 }; }
function renderBot(){
  const D = BT.st;
  if(!D){ $('#main').innerHTML = '<h2>Бот для консультантов</h2><div class="empty">Загружаем…</div>'; return; }
  if(D.err){ $('#main').innerHTML = `<h2>Бот для консультантов</h2><div class="empty">${esc(D.err)}</div>`; return; }
  const ST = D.stores || [], R = D.reminders || [], M = D.msgs || [], reach = btReach(BT.sel, BT.target);
  const noTg = ST.reduce((a,s)=>a+(+s.staff||0)-(+s.staff_tg||0),0);
  const chip = (id, on) => `<label class="chip ${on?'ok':''}" style="cursor:pointer;padding:4px 10px"><input type="checkbox" data-btst="${id}" ${on?'checked':''} style="margin-right:4px">${esc(storeName(id))}</label>`;
  const stLbl = { scheduled:'⏳ запланировано', sending:'… отправляется', sent:'✅ отправлено', error:'⚠️ не отправлено', cancelled:'отменено' };
  $('#main').innerHTML = `<h2>Бот для консультантов</h2>
  <p class="meta" style="margin:2px 0 10px">Сообщения уходят от бота Silver в Telegram: в группу магазина и/или лично консультантам. ${noTg?`Лично пока получат не все: Telegram подключили не все консультанты (не подключено: ${noTg}). Консультанту нужно открыть бота и нажать «Старт» — номер телефона должен совпадать с номером в «Сотрудниках».`:''}</p>
  <div class="card" style="margin-bottom:12px"><h3 style="margin-top:0">✉️ Написать</h3>
    <div class="filters">${ST.map(s => chip(s.id, (BT.sel||[]).includes(s.id))).join('')}</div>
    <div class="filters"><select id="bt-target" aria-label="Куда">${Object.entries(BT_TGT).map(([k,v])=>`<option value="${k}" ${BT.target===k?'selected':''}>${v}</option>`).join('')}</select>
      <select id="bt-when" aria-label="Когда"><option value="now" ${BT.when==='now'?'selected':''}>Отправить сейчас</option><option value="later" ${BT.when==='later'?'selected':''}>Отправить позже</option></select>
      ${BT.when==='later'?`<input type="datetime-local" id="bt-at" value="${esc(BT.at)}" aria-label="Дата и время">`:''}</div>
    <textarea id="bt-text" rows="4" maxlength="3500" placeholder="Текст сообщения консультантам" style="width:100%;box-sizing:border-box">${esc(BT.text)}</textarea>
    <div class="filters" style="margin-top:6px"><span class="meta">Быстрые:</span>${BT_TPL.map((t,i)=>`<button class="btn small" data-bttpl="${i}">${esc(t.length>34?t.slice(0,32)+'…':t)}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px"><button class="btn primary" id="bt-send" ${BT.busy?'disabled':''}>${BT.busy?'Отправляем…':BT.when==='later'?'Запланировать':'Отправить'}</button>
      <span class="meta" style="${reach.none?'color:var(--bad)':''}">${reach.none?'Некому отправить — выберите другой способ':'Получат: '+reach.txt}</span></div></div>
  <div class="card" style="margin-bottom:12px"><div class="row" style="flex-wrap:wrap"><h3 style="margin:0">⏰ Напоминалки</h3><button class="btn small" id="bt-radd">+ Добавить</button></div>
    <p class="meta" style="margin:4px 0 8px">Бот сам отправляет их в выбранные дни и время (по Алматы/Астане).</p>
    ${!R.length?'<div class="empty">Напоминалок пока нет. Например: «10:00 — отметьте приход», «21:45 — пересчитайте кассу».</div>':R.map(r=>`<div class="row" style="border-top:1px solid var(--line);padding:8px 0;flex-wrap:wrap;gap:8px;align-items:flex-start;${r.active?'':'opacity:.55'}">
      <div style="min-width:64px"><b style="font-size:18px">${esc(String(r.at_time).slice(0,5))}</b><br><span class="meta">${(r.days||[]).length===7?'каждый день':(r.days||[]).map(d=>BT_DAYS[d-1]).join(' ')}</span></div>
      <div style="flex:1;min-width:180px">${r.title?`<b>${esc(r.title)}</b><br>`:''}<span style="white-space:pre-wrap">${esc(r.text)}</span><br><span class="meta">${btStores(r.store_ids)} · ${BT_TGT[r.target]}${r.author?' · '+esc(r.author):''}</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn small" data-brtog="${r.id}">${r.active?'Выключить':'Включить'}</button><button class="btn small" data-bred="${r.id}">Изменить</button><button class="btn small" data-brtest="${r.id}" title="Прислать пробу себе в Telegram">Проба мне</button><button class="btn small" data-brdel="${r.id}">Удалить</button></div></div>`).join('')}</div>
  <div class="card" style="margin-bottom:12px"><h3 style="margin-top:0">📜 Отправленные и запланированные</h3>
    ${!M.length?'<div class="empty">Сообщений пока не было</div>':M.map(m=>`<div style="border-top:1px solid var(--line);padding:8px 0">
      <div class="meta">${stLbl[m.status]||esc(m.status)} · ${btTime(m.status==='scheduled'?m.send_at:(m.sent_at||m.created_at))}${m.reminder_id?' · напоминалка':''}${m.author?' · '+esc(m.author):''} · ${btStores(m.store_ids)} · ${BT_TGT[m.target]}${m.status==='sent'?' · доставлено: '+(m.sent||[]).length:''}${m.edited_at?' · исправлено':''}</div>
      <div style="white-space:pre-wrap;margin:4px 0">${esc(m.text)}</div>${m.error?`<div class="meta" style="color:var(--bad)">${esc(m.error)}</div>`:''}
      ${['scheduled','sent'].includes(m.status)?`<div class="row" style="gap:6px"><button class="btn small" data-bmed="${m.id}">Исправить</button><button class="btn small" data-bmdel="${m.id}">${m.status==='scheduled'?'Отменить':'Удалить из чатов'}</button></div>`:''}</div>`).join('')}</div>
  <div class="card" style="margin-bottom:12px"><h3 style="margin-top:0">🤖 Бот присылает сам</h3><ul class="meta" style="margin:0;padding-left:18px;line-height:1.6">
    <li>Отчёт о закрытии смены — владельцу, менеджерам и в группу отчётов.</li><li>Часы консультантов за день — менеджеру вечером, с кнопкой «Подтвердить».</li>
    <li>Консультантам — кнопки «Пришла / Ушла со смены», «Отметить часы», «Моя зарплата».</li><li>Заявки, списания и расходы — руководителям.</li></ul></div>`;
}
function btRemModal(r){ r = r || { store_ids:[...(BT.sel||[])], title:'', text:'', at_time:'10:00', days:[1,2,3,4,5,6,7], target:'group', active:true };
  const ST = (BT.st&&BT.st.stores)||[];
  modal(`<h3 style="margin-top:0">${r.id?'Изменить':'Новая'} напоминалка</h3>
  <label class="meta">Время <input type="time" id="br-time" value="${esc(String(r.at_time).slice(0,5))}"></label>
  <div class="filters" style="margin-top:8px">${BT_DAYS.map((d,i)=>`<label class="chip" style="cursor:pointer;padding:4px 8px"><input type="checkbox" data-brday="${i+1}" ${(r.days||[]).includes(i+1)?'checked':''}> ${d}</label>`).join('')}</div>
  <div class="filters">${ST.map(s=>`<label class="chip" style="cursor:pointer;padding:4px 8px"><input type="checkbox" data-brst="${s.id}" ${(r.store_ids||[]).includes(s.id)?'checked':''}> ${esc(storeName(s.id))}</label>`).join('')}</div>
  <select id="br-target" style="margin-bottom:8px">${Object.entries(BT_TGT).map(([k,v])=>`<option value="${k}" ${r.target===k?'selected':''}>${v}</option>`).join('')}</select>
  <input id="br-title" placeholder="Название (необязательно), например «Приход»" value="${esc(r.title)}" style="width:100%;box-sizing:border-box;margin-bottom:8px">
  <textarea id="br-text" rows="4" maxlength="3500" placeholder="Текст напоминания" style="width:100%;box-sizing:border-box">${esc(r.text)}</textarea>
  <div class="row" style="margin-top:10px;gap:8px;justify-content:flex-end"><button class="btn" data-close="1">Отмена</button><button class="btn primary" id="br-save" data-id="${r.id||''}" data-active="${r.active!==false}">Сохранить</button></div>`); }
function btAsk(text, okTxt, run){ modal(`<p style="margin-top:0">${text}</p><div class="row" style="gap:8px;justify-content:flex-end"><button class="btn" data-close="1">Нет</button><button class="btn primary" id="bt-ok">${okTxt}</button></div>`); BT.ask = run; }
function btEditModal(m){ modal(`<h3 style="margin-top:0">Исправить сообщение</h3>${m.status==='sent'?'<p class="meta">Текст поменяется прямо в Telegram, с пометкой «исправлено».</p>':''}
  <textarea id="bm-text" rows="5" maxlength="3500" style="width:100%;box-sizing:border-box">${esc(m.text)}</textarea>
  <div class="row" style="margin-top:10px;gap:8px;justify-content:flex-end"><button class="btn" data-close="1">Отмена</button><button class="btn primary" id="bm-save" data-id="${m.id}">Сохранить</button></div>`); }
const btClose = () => { $('#modal').innerHTML = ''; };
async function btReload(){ await loadBot(); if(S.view==='bot') render(); }
document.addEventListener('click', async e => { if(S.view!=='bot') return; const t = e.target.closest('button'); if(!t) return; const D = BT.st || {};
  const rem = id => (D.reminders||[]).find(r => r.id===id), msg = id => (D.msgs||[]).find(m => m.id===id);
  try{
    if(t.dataset.close){ btClose(); }
    else if(t.dataset.bttpl!==undefined){ BT.text = BT_TPL[+t.dataset.bttpl]; render(); }
    else if(t.id==='bt-send'){ BT.text = $('#bt-text').value; const text = BT.text.trim();
      if(!text) return toast('Напишите текст'); if(!(BT.sel||[]).length) return toast('Выберите магазин');
      let send_at = null; if(BT.when==='later'){ if(!BT.at) return toast('Укажите дату и время'); send_at = new Date(BT.at).toISOString(); }
      BT.busy = true; render(); const r = await botFn({ action:'send', store_ids:BT.sel, target:BT.target, text, send_at }); BT.busy = false;
      toast(r.scheduled ? 'Запланировано' : r.status==='sent' ? `Отправлено: ${r.sent}` : (r.error || 'Не отправлено')); BT.text = ''; await btReload(); }
    else if(t.id==='bt-radd'){ btRemModal(); }
    else if(t.dataset.bred){ btRemModal(rem(t.dataset.bred)); }
    else if(t.id==='br-save'){ const days = [...document.querySelectorAll('[data-brday]:checked')].map(x=>+x.dataset.brday), st = [...document.querySelectorAll('[data-brst]:checked')].map(x=>+x.dataset.brst);
      if(!days.length) return toast('Выберите дни'); if(!st.length) return toast('Выберите магазин'); if(!$('#br-text').value.trim()) return toast('Напишите текст');
      const p = { store_ids:st, days, at_time:$('#br-time').value || '10:00', target:$('#br-target').value, title:$('#br-title').value.trim(), text:$('#br-text').value.trim(), active:t.dataset.active!=='false' };
      if(t.dataset.id) p.id = t.dataset.id; t.disabled = true;
      const { error } = await sb.rpc('bot_rem_save', { p }); if(error) { t.disabled = false; return toast(errText(error)); } btClose(); toast('Сохранено'); await btReload(); }
    else if(t.dataset.brtog){ const r = rem(t.dataset.brtog); const { error } = await sb.rpc('bot_rem_save', { p:{ ...r, active:!r.active } }); if(error) return toast(errText(error)); await btReload(); }
    else if(t.dataset.brtest){ t.disabled = true; const r = await botFn({ action:'test_reminder', id:t.dataset.brtest }); t.disabled = false; toast(r.ok ? 'Проба отправлена вам в Telegram' : 'Не получилось отправить'); }
    else if(t.dataset.brdel){ const id = t.dataset.brdel; btAsk('Удалить эту напоминалку?', 'Удалить', async () => { const { error } = await sb.rpc('bot_rem_del', { p_id:id }); if(error) return toast(errText(error)); btClose(); await btReload(); }); }
    else if(t.dataset.bmed){ btEditModal(msg(t.dataset.bmed)); }
    else if(t.id==='bm-save'){ t.disabled = true; const r = await botFn({ action:'edit', id:t.dataset.id, text:$('#bm-text').value }); btClose(); toast(r.failed ? `Исправлено: ${r.edited||0}, не получилось: ${r.failed}` : 'Исправлено'); await btReload(); }
    else if(t.dataset.bmdel){ const m = msg(t.dataset.bmdel); btAsk(m.status==='scheduled' ? 'Отменить отправку?' : 'Удалить это сообщение из чатов Telegram? Telegram позволяет удалять только сообщения младше 48 часов.', m.status==='scheduled' ? 'Отменить' : 'Удалить', async () => {
        const r = await botFn({ action:'delete', id:m.id }); btClose(); toast(r.note || 'Готово'); await btReload(); }); }
    else if(t.id==='bt-ok'){ const f = BT.ask; BT.ask = null; t.disabled = true; if(f) await f(); }
  }catch(err){ BT.busy = false; toast(err.message || String(err)); render(); }
});
document.addEventListener('change', e => { if(S.view!=='bot') return; const t = e.target;
  if(t.dataset.btst){ const id = +t.dataset.btst; BT.sel = t.checked ? [...new Set([...(BT.sel||[]), id])] : (BT.sel||[]).filter(x => x!==id); BT.text = ($('#bt-text')||{}).value ?? BT.text; render(); }
  else if(t.id==='bt-target'){ BT.target = t.value; BT.text = $('#bt-text').value; render(); }
  else if(t.id==='bt-when'){ BT.when = t.value; BT.text = $('#bt-text').value; render(); }
  else if(t.id==='bt-at'){ BT.at = t.value; } });
document.addEventListener('input', e => { if(S.view==='bot' && e.target.id==='bt-text') BT.text = e.target.value; });

function renderAdm(){
  if(S.me.role!=='owner'){ $('#main').innerHTML = '<div class="empty">Нет доступа</div>'; return; }
  const L = AD.list, C = (L||[]).map(adCalc), sum = k => C.reduce((t,c)=>t+c[k],0), ep = L&&L[0] ? +L[0].ep_rate : 24.8, taxes = (L||[]).reduce((t,a)=>t+(+a.tax||0),0);
  if(!document.getElementById('adm-css')){ const st = document.createElement('style'); st.id = 'adm-css'; st.textContent = `.adm-tbl td,.adm-tbl th{padding:6px 8px;vertical-align:middle;white-space:nowrap}.adm-tbl th{font-size:12px}.adm-tbl input{padding:4px 6px;font-size:13px;width:95px}.adm-tbl tfoot td{border-top:2px solid var(--line);font-weight:600}.adm-add>summary{cursor:pointer;font-weight:600;list-style:none}.adm-add>summary::-webkit-details-marker{display:none}`; document.head.append(st); }
  const num = (a,k) => `<input type="number" min="0" inputmode="numeric" value="${+a[k]||''}" placeholder="0" data-adf="${a.id}:${k}">`;
  const how = a => a.rule==='pct' ? `${+a.pct||0}% от продаж ${fmt(a.sales)}` : 'оклад';
  $('#main').innerHTML = `<div class="row" style="flex-wrap:wrap"><h2 style="margin:0">Административный штат</h2><label class="meta">Месяц <input type="month" id="ad-month" value="${AD.month}"></label></div>
  <p class="meta" style="margin:6px 0 10px">🔒 Видите только вы · 💰 ${advanceText(AD.month)} · Вводите премию и выплаты — сохраняется сразу.</p>
  ${!L?'<div class="empty">Загружаем…</div>':`<div class="scroll"><table class="adm-tbl"><thead><tr><th>Сотрудник</th><th>Начислено</th><th>Премия</th><th>К выплате</th><th>На карту</th><th>Наличными</th><th>Выплачено нал.</th><th>Выплачено на карту</th><th>Остаток</th><th></th></tr></thead><tbody>
    ${L.map((a,n)=>{ const c = C[n]; return `<tr><td><b>${esc(a.name)}</b>${a.position?`<br><span class="meta">${esc(a.position)}</span>`:''}</td>
      <td class="num">${fmt(a.accrued)}<br><span class="meta">${how(a)}</span></td><td>${num(a,'bonus')}</td><td class="num"><b>${fmt(c.due)}</b></td>
      <td class="num">${fmt(c.card)}</td><td class="num">${fmt(c.cash)}</td><td>${num(a,'paid_cash')}</td><td>${num(a,'paid_card')}</td>
      <td class="num" style="color:${c.rest<0?'var(--bad)':c.rest>0?'inherit':'var(--ok)'}"><b>${c.rest<0?'переплата '+fmt(-c.rest):c.rest===0?'✓ выплачено':fmt(c.rest)}</b></td>
      <td><button class="btn small" data-adedit="${a.id}" title="Оклад, процент, официальная ставка">✎</button></td></tr>`; }).join('') || `<tr><td colspan="10" class="meta">В этом месяце пока никого нет — нажмите «Перенести с прошлого месяца»</td></tr>`}</tbody>
    ${L.length>1?`<tfoot><tr><td>Итого</td><td class="num">${fmt(L.reduce((t,a)=>t+(+a.accrued||0),0))}</td><td></td><td class="num">${fmt(sum('due'))}</td><td class="num">${fmt(sum('card'))}</td><td class="num">${fmt(sum('cash'))}</td><td></td><td></td><td class="num">${fmt(sum('rest'))}</td><td></td></tr></tfoot>`:''}</table></div>
  <p class="meta">Расход компании за месяц: <b>${fmt(sum('cost'))}</b> — выплаты ${fmt(sum('due'))} + налоги ЕП ${fmt(taxes)} (${ep}% от официальной ставки; на карту — ставка минус удержания, остальное наличными).</p>`}
  <div class="row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap">
    <button class="btn small" id="ad-copy" title="Перенести людей, оклады и правила с прошлого месяца">Перенести с прошлого месяца</button>
    <details class="adm-add"><summary class="btn small">+ Добавить сотрудника</summary>
      <div class="row card" style="flex-wrap:wrap;justify-content:flex-start;gap:6px;margin-top:6px"><input id="ad-name" placeholder="Имя и фамилия"><input id="ad-pos" placeholder="Должность"><input id="ad-sal" type="number" min="0" inputmode="numeric" placeholder="оклад, ₸" style="width:120px"><button class="btn primary small" id="ad-add">Добавить</button></div></details></div>`;
}
function admEditHtml(a){
  return `<div class="row"><h3 style="margin:0">${esc(a.name)}</h3><button class="btn small" data-close>✕</button></div>
  <div class="stack" style="gap:8px;margin-top:10px">
    <label class="stack" style="gap:2px"><span class="label">Имя</span><input id="ae-name" value="${esc(a.name)}"></label>
    <label class="stack" style="gap:2px"><span class="label">Должность</span><input id="ae-pos" value="${esc(a.position||'')}"></label>
    <label class="stack" style="gap:2px"><span class="label">Как считается</span><select id="ae-rule"><option value="fixed" ${a.rule!=='pct'?'selected':''}>Оклад</option><option value="pct" ${a.rule==='pct'?'selected':''}>% от продаж</option></select></label>
    <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><label class="meta">Оклад, ₸ <input id="ae-sal" type="number" min="0" value="${+a.salary||''}" style="width:120px"></label><label class="meta">Процент <input id="ae-pct" type="number" min="0" step="0.1" value="${+a.pct||''}" style="width:70px"></label></div>
    <div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><label class="meta">Официальная ставка, ₸ <input id="ae-off" type="number" min="0" value="${+a.official_base||''}" style="width:120px"></label><label class="meta"><input type="checkbox" id="ae-allcard" ${a.all_card?'checked':''}> всё на карту</label></div>
    <div class="row"><button class="btn small" data-addel="${a.id}">Удалить из месяца</button><button class="btn primary" id="ae-save" data-id="${a.id}">Сохранить</button></div></div>`;
}
document.addEventListener('click', async e => {
  if(S.view!=='adm') return; const t = e.target.closest('button'); if(!t) return;
  if(t.id==='ad-add'){ const name = $('#ad-name').value.trim(); if(!name) return toast('Укажите имя');
    const { error } = await sb.rpc('admin_pay_save', { p:{ month:AD.month+'-01', name, position:$('#ad-pos').value.trim(), salary:$('#ad-sal').value } }); if(error) return toast(errText(error)); await loadAdm(); render(); }
  else if(t.id==='ad-copy'){ const { data, error } = await sb.rpc('admin_pay_copy', { p_month:AD.month+'-01' }); if(error) return toast(errText(error)); toast(data ? 'Перенесено: '+data : 'Нечего переносить'); await loadAdm(); render(); }
  else if(t.dataset.adedit){ const a = (AD.list||[]).find(x=>x.id===t.dataset.adedit); if(a) modal(admEditHtml(a)); }
  else if(t.id==='ae-save'){ const a = (AD.list||[]).find(x=>x.id===t.dataset.id); if(!a) return;
    const p = { ...a, name:$('#ae-name').value.trim()||a.name, position:$('#ae-pos').value.trim(), rule:$('#ae-rule').value, salary:$('#ae-sal').value, pct:$('#ae-pct').value, official_base:$('#ae-off').value, all_card:$('#ae-allcard').checked };
    const { error } = await sb.rpc('admin_pay_save', { p }); if(error) return toast(errText(error)); closeModal(); toast('Сохранено'); await loadAdm(); render(); }
  else if(t.dataset.addel){ if(t.dataset.sure!=='1'){ t.dataset.sure='1'; t.textContent='Точно удалить?'; return; } const { error } = await sb.rpc('admin_pay_del', { p_id:t.dataset.addel }); if(error) return toast(errText(error)); closeModal(); await loadAdm(); render(); }
});
document.addEventListener('change', async e => {
  if(S.view!=='adm') return; const t = e.target;
  if(t.id==='ad-month'){ AD.month = t.value || AD.month; render(); await loadAdm(); render(); return; }
  if(!t.dataset.adf) return; const [id, k] = t.dataset.adf.split(':'), a = (AD.list||[]).find(x=>x.id===id); if(!a) return;
  a[k] = t.type==='checkbox' ? t.checked : t.value;
  const { error } = await sb.rpc('admin_pay_save', { p:{ ...a } }); if(error){ toast(errText(error)); return; }
  await loadAdm(); render(); toast('Сохранено');
});


/* ---------- путь товара: инфографика цепочки и что где застряло ---------- */
const FL = { days:30, data:null };
async function loadFlow(){ FL.data = null; const { data, error } = await sb.rpc('product_flow', { p_days:FL.days, p_stores:selStores() }); if(error) toast(errText(error)); FL.data = data || null; }
const nf = n => Math.round(+n||0).toLocaleString('ru-RU');
function flowIdeas(D){
  const I = [], pct = (a,b) => b ? Math.round(a/b*100) : 0, inst = D.instock.pos || 0;
  if(!D.ordered.pos && !D.transit.pos) I.push(['warn','Закупы не заведены в Silver','Заказы поставщикам пока не видны — не видно, что едет и когда придёт.','Заводите каждый заказ во вкладке «Закуп»: тогда здесь будет видно товар в пути, а приёмка подтянет его в один клик.','po']);
  if(D.to_astana && D.to_astana.docs && D.to_astana.oldest && (Date.now()-new Date(D.to_astana.oldest))/864e5 > 4) I.push(['bad','Застряло в пути в Астану',`${nf(D.to_astana.units)} шт. отправлены из Алматы больше 4 дней назад и ещё не приняты в Астане.`,'Айжан: пересчитать и принять перемещение во вкладке «Склад» → «Перемещения». Пока товар не принят, его нельзя продать в Астане.','wh']);
  if(!D.received.pos) I.push(['warn',`Нет приёмок в Silver за ${D.days} дней`,'Новые поступления проходят мимо программы, поэтому не видно, какие новинки ещё не сфотографированы и не на сайте.','Проводите приёмку новых товаров во вкладке «Склад» — после этого они сразу попадут в этот контроль.','wh']);
  if((D.hot_no_site||[]).length) I.push(['bad','Продаются, но нет на сайте',`${(D.hot_no_site||[]).length} ходовых товаров за ${D.days} дней не найдены на сайтах — теряем онлайн-заказы.`,'Добавить их на сайт в первую очередь (список ниже). Позже — автоматически из карточки товара.','site']);
  if(D.photo.no) I.push([pct(D.photo.no,inst)>30?'bad':'warn','Нет фото',`${nf(D.photo.no)} из ${nf(inst)} позиций в наличии (${pct(D.photo.no,inst)}%) без фото.`,'Начать с ходовых и с залежавшихся дорогих — им фото нужнее всего. Следующий этап: загрузка фото с линейкой и красивое фото для сайта через ИИ.','nom']);
  if(D.card.no) I.push(['warn','Карточка не заполнена',`${nf(D.card.no)} позиций без категории или материала — их не найти фильтром и не проанализировать.`,'Дозаполнить в «Номенклатуре». Следующий этап: ИИ сам предложит категорию и характеристики по фото.','nom']);
  if(D.stale.pos) I.push(['bad','Залежи 90+ дней',`${nf(D.stale.pos)} позиций (${nf(D.stale.units)} шт.) не продавались 90 дней — это ${fmt(D.stale.retail)} в рознице. Из них ${nf(D.stale.no_photo)} без фото и ${nf(D.stale.no_site)} не на сайте.`,'Идеи: 1) перевести в магазин, где такой товар продаётся; 2) сделать подборку «последний шанс» в сторис; 3) акция в «Акциях» — подарок или −20% к чеку; 4) сфотографировать и выложить на сайт — часть не продаётся просто потому, что её не видно.','analytics']);
  return I;
}
function renderFlow(){
  const D = FL.data;
  const step = (ico, t, main, sub, state, soon, tip, go) => `<div class="fl-step ${soon?'soon':state||''}" tabindex="0"${go&&(S.tabs||[]).some(x=>x[0]===go)?` data-flgo="${go}" role="button"`:''}><div class="fl-ico">${ico}</div><b>${t}</b><div class="fl-num">${main}</div><div class="meta">${sub}</div>${soon?'<span class="chip">скоро</span>':''}${tip?`<span class="fl-q" aria-hidden="true">?</span><div class="fl-tip" role="tooltip">${tip}</div>`:''}</div>`;
  const TIP = {
    ord:'<b>Что это:</b> товар, который мы уже заказали у поставщика, но он ещё не отправлен.<br><b>Откуда цифра:</b> заказы во вкладке «Закуп» со статусом «заказано».<br><b>Хорошо:</b> здесь всегда что-то есть — значит, ассортимент пополняется.<br><b>Что делать:</b> если поставщик не отправил больше 5 дней — написать ему.',
    tr:'<b>Что это:</b> товар уже едет из Китая к нам.<br><b>Откуда цифра:</b> заказы со статусом «в пути».<br><b>Что делать:</b> если едет дольше 45 дней — проверить у карго и закрыть заказ, когда пришёл.',
    rcv:'<b>Что это:</b> товар, который магазины пересчитали и приняли на склад за выбранный период.<br><b>Откуда цифра:</b> приёмки во вкладке «Склад».<br><b>Почему важно:</b> пока товар не принят, касса не видит остаток, а мы не видим себестоимость.',
    ast:'<b>Что это:</b> товар, отправленный из Алматы в Астану и ещё не принятый там.<br><b>Красный:</b> едет дольше 4 дней — скорее всего, пришёл, но забыли принять.<br><b>Что делать:</b> менеджер Астаны — «Склад → Перемещения → принять».',
    ph:'<b>Что это:</b> сколько товаров в наличии имеют фото в Silver.<br><b>Полоска:</b> доля готовых. Зелёный — от 85%, жёлтый — от 50%, красный — меньше.<br><b>Почему важно:</b> без фото товар нельзя показать на сайте, в посте и продавцу в кассе.<br><b>Что делать:</b> «Фотосессия» — начать с ходовых.',
    card:'<b>Что это:</b> у товара заполнены категория и материал.<br><b>Почему важно:</b> без этого товар не найти фильтром, его не видно в аналитике по категориям и в «Идеях к заказу».<br><b>Что делать:</b> «Номенклатура» → выделить товары → указать категорию.',
    site:'<b>Что это:</b> товар из наличия есть на сайте MOON или Sunshine (связан с карточкой сайта).<br><b>Почему важно:</b> нет на сайте — нет онлайн-заказов.<br><b>Что делать:</b> «Товары → Сайт» — проверить связи и добавить ходовые.',
    post:'<b>Что это:</b> будущий этап — сколько товаров попало в посты и контент-план.<br>Пока в разработке.',
    sold:'<b>Что это:</b> сколько штук продано за выбранный период и сколько было чеков.<br><b>Откуда:</b> продажи из Wipon и кассы Silver.',
    stale:'<b>Что это:</b> товар в наличии, который не продавался 90 дней и больше.<br><b>Сумма:</b> сколько это стоит в розничных ценах — деньги, замороженные на полке.<br><b>Что делать:</b> переложить туда, где продаётся, сделать подборку или акцию, не дозаказывать.'
  };
  const stage = (n, t, c, body) => `<div class="fl-stage fl-s${c}"><div class="fl-stage-h"><span class="fl-stage-n">${n}</span>${t}</div><div class="fl-row">${body}</div></div>`;
  const bar = (ok, no) => { const p = ok+no ? Math.round(ok/(ok+no)*100) : 0; return `<div class="fl-bar"><span style="width:${p}%"></span></div><div class="meta">${p}% готово · не хватает у ${nf(no)}</div>`; };
  const st = (ok,no) => { const p = ok+no ? ok/(ok+no) : 1; return p>=.85?'ok':p>=.5?'warn':'bad'; };
  const list = (L, cols) => `<div class="list" style="margin-top:6px">${L.map(p=>`<div class="prod" style="grid-template-columns:44px minmax(0,1fr) auto">${thumb(p)}<span><b>${pcl(p.id||p.product_id, esc(p.name))}</b><br><span class="meta num">${esc(p.barcode||'')} · в наличии ${nf(p.qty)}${p.units?' · продано '+nf(p.units):''}</span><br>${p.no_photo?'<span class="chip zero">нет фото</span>':''}${p.no_card?'<span class="chip warn">карточка</span>':''}${p.no_site?'<span class="chip warn">нет на сайте</span>':''}</span><span class="price num">${cols==='retail'?fmt(p.retail):fmt(p.price)}</span></div>`).join('')}</div>`;
  $('#main').innerHTML = `<div class="row"><h2>Путь товара</h2><div class="seg">${[30,90].map(d=>`<button data-fldays="${d}" aria-pressed="${FL.days===d}">${d} дней</button>`).join('')}</div></div>
  ${storeFilterHtml()}
  ${!D?'<div class="empty">Считаем…</div>':`
  <p class="meta" style="margin:6px 0 4px">Наведите на карточку (или нажмите на телефоне) — появится объяснение. Клик по карточке открывает нужную вкладку.</p>
  <div class="fl-map">
    ${stage(1,'Закупка','a', step('🧾','Заказано', nf(D.ordered.units)+' шт.', nf(D.ordered.pos)+' позиций у поставщиков', D.ordered.pos?'ok':'warn', false, TIP.ord, 'po') + step('🚚','В пути из Китая', nf(D.transit.units)+' шт.', nf(D.transit.pos)+' позиций', D.transit.pos?'ok':'warn', false, TIP.tr, 'po'))}
    ${stage(2,'Склад','b', step('📥','Принято', nf(D.received.units)+' шт.', `${nf(D.received.pos)} позиций за ${D.days} дней`, D.received.pos?'ok':'warn', false, TIP.rcv, 'wh') + (()=>{ const T = D.to_astana || { units:0, pos:0, docs:0 }, age = T.oldest ? Math.floor((Date.now()-new Date(T.oldest))/864e5) : 0;
      return step('🚛','В пути в Астану', nf(T.units)+' шт.', T.docs ? `${nf(T.pos)} позиций · ${nf(T.docs)} отправок${age?' · самая старая '+age+' дн.':''}` : 'сейчас ничего не едет', T.docs ? (age>4?'bad':'ok') : '', false, TIP.ast, 'wh'); })())}
    ${stage(3,'Готовность к продаже','c', step('📷','Фото', nf(D.photo.ok), bar(D.photo.ok, D.photo.no), st(D.photo.ok, D.photo.no), false, TIP.ph, 'photo') + step('🏷','Карточка', nf(D.card.ok), bar(D.card.ok, D.card.no), st(D.card.ok, D.card.no), false, TIP.card, 'nom') + step('🌐','На сайте', nf(D.site.ok), bar(D.site.ok, D.site.no), st(D.site.ok, D.site.no), false, TIP.site, 'site') + step('📣','Посты','—','публикации по контент-плану','',true, TIP.post))}
    ${stage(4,'Результат','d', step('💰','Продано', nf(D.sold.units)+' шт.', `${nf(D.sold.checks)} чеков за ${D.days} дней`, 'ok', false, TIP.sold, 'analytics') + step('🕸','Залежи 90+ дней', nf(D.stale.pos)+' поз.', fmt(D.stale.retail)+' в рознице', D.stale.pos?'bad':'ok', false, TIP.stale, 'po'))}
  </div>
  <div class="fl-legend meta"><span><i class="fl-dot ok"></i>всё хорошо</span><span><i class="fl-dot warn"></i>стоит заняться</span><span><i class="fl-dot bad"></i>срочно</span></div>
  <p class="meta">В наличии сейчас ${nf(D.instock.pos)} позиций, ${nf(D.instock.units)} шт. на ${fmt(D.instock.retail)}. Фото, карточка и сайт считаются по товарам в наличии.</p>
  <h2 style="margin-top:18px">Где застряло и что сделать</h2>
  <div class="stack">${flowIdeas(D).map(([lvl,t,why,todo,go])=>`<div class="card fl-idea ${lvl}"><b>${lvl==='bad'?'🔴':'🟡'} ${t}</b><div>${why}</div><div class="meta">💡 ${todo}</div>${(S.tabs||[]).some(x=>x[0]===go)?`<button class="btn small" data-flgo="${go}" style="align-self:flex-start">Открыть «${(S.tabs.find(x=>x[0]===go)||[])[1]}»</button>`:''}</div>`).join('') || '<div class="empty">Ничего не застряло 👍</div>'}</div>
  <div class="grid2" style="margin-top:14px">
    <div><h3>🔥 Продаются, но нет на сайте</h3>${(D.hot_no_site||[]).length?list(D.hot_no_site):'<div class="meta">Нет</div>'}</div>
    <div><h3>🕸 Самые дорогие залежи</h3>${(D.stale_top||[]).length?list(D.stale_top,'retail'):'<div class="meta">Нет</div>'}</div>
  </div>
  ${(D.new_not_ready||[]).length?`<h3 style="margin-top:14px">📥 Новые поступления, которые ещё не готовы к продаже онлайн</h3>${list(D.new_not_ready)}`:''}`}`;
}
document.addEventListener('click', async e => {
  if(S.view!=='flow') return; const t = e.target.closest('button,.fl-step[data-flgo]'); if(!t) return;
  if(t.classList.contains('fl-step') && matchMedia('(hover: none)').matches && !t.dataset.tap){ document.querySelectorAll('.fl-step[data-tap]').forEach(x=>delete x.dataset.tap); t.dataset.tap = '1'; t.focus(); return; } // на телефоне: 1-е нажатие — подсказка, 2-е — переход
  if(t.dataset.fldays){ FL.days = +t.dataset.fldays; render(); await loadFlow(); render(); }
  else if(t.dataset.flgo){ const b = document.querySelector(`nav button[data-view="${t.dataset.flgo}"]`); S.view = t.dataset.flgo; const g = groupOf(S.view); (S.lastView ||= {})[g[0]] = S.view; render(); scrollTo(0,0);
    if(S.view==='po'){ await loadPo(); render(); } else if(S.view==='wh'){ if(!S.wmode) S.wmode=whModes()[0][0]; await loadWhSide(); render(); } else if(S.view==='site'){ await loadSite(); render(); } else if(S.view==='nom'){ await loadNom(); render(); } else if(S.view==='analytics'){ S.an=null; await loadAnalytics(); render(); } }
});


/* ---------- закуп: позиции, привязка к базе, приёмка с пересчётом себестоимости ---------- */
const noZh = t => t && !/[\u4e00-\u9fff]/.test(t) ? t : '';
const poSpec = i => { const sp = i.spec||''; if(!sp) return ''; if(!/[\u4e00-\u9fff]/.test(sp)) return sp; const c = colorRu(sp), n = (sp.match(/\d+(\.\d+)?\s*(号|cm|mm|码)?/)||[])[0]; return [c, n&&n.replace('号',' размер').replace('码',' размер')].filter(Boolean).join(', '); };
const poSupplier = o => noZh(o.supplier_ru) || noZh(o.supplier) || (o.source==='1688' ? 'Китай' : o.source==='alibaba' ? 'Alibaba' : 'поставщик не указан');
function poItemRow(o, i){
  const cur = CUR[o.currency||'KZT'] || '₸', open = ['ordered','transit'].includes(o.status), canLink = open && (poEdit() || (isBoss() && !isViewer()));
  const lnk = PO.lnk && PO.lnk.item===i.item_id;
  const cands = !i.product_id && canLink ? (i.candidates||[]) : [];
  return `<tr><td data-l="">${thumb(i)}</td><td class="mc-t">${i.product_id?`<b>${esc(i.name)}</b><br><span class="meta num">${esc(i.barcode||'')}</span>`:`<span class="chip zero">не связан</span> <b>${esc(noZh(i.title_ru)||'товар из Китая')}</b>`}
      ${cands.length?`<div class="meta" style="margin-top:4px">По этой же ссылке в базе ${cands.length===1?'есть товар':'есть товары'} — выберите нужный вариант:</div><div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:4px">${cands.map(p=>`<button class="btn small" data-polink="${i.item_id}:${p.id}" style="display:flex;gap:6px;align-items:center">${thumb(p)}<span style="text-align:left">${esc(p.name)}<br><span class="meta num">${esc(p.barcode)}</span></span></button>`).join('')}</div>`:''}
      ${poSpec(i)?`<br><span class="meta">${esc(poSpec(i))}</span>`:''}${i.purchase_url?` · <a href="${esc(i.purchase_url)}" target="_blank" rel="noopener" class="meta">у поставщика</a>`:''}
      ${canLink&&!i.product_id&&i.suggest?`<br><button class="btn small primary" data-polink="${i.item_id}:${i.suggest.id}">Связать с «${esc(i.suggest.name)}»</button>`:''}
      ${canLink&&!lnk&&!(PO.mk&&PO.mk.item===i.item_id)?`<br><span class="row" style="gap:6px;justify-content:flex-start">${i.product_id?`<button class="btn small" data-polink="${i.item_id}:" title="Связь ошибочная — снять">✕ Отменить связь</button>`:`<button class="btn small" data-polinkopen="${i.item_id}">Найти в базе</button>${isBoss()&&!isViewer()?`<button class="btn small" data-pocreate="${i.item_id}">+ Создать товар</button>`:''}`}</span>`:''}
      ${PO.mk&&PO.mk.item===i.item_id?poCreateHtml(o,i):''}
      ${lnk?`<div class="stack" style="gap:4px;margin-top:6px"><input id="po-lnk-q" placeholder="Штрихкод, артикул или название в нашей базе" value="${esc(PO.lnk.q)}" autocomplete="off">
        ${PO.lnk.found.slice(0,8).map(p=>`<button class="prod" data-polink="${i.item_id}:${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}</div>`:''}</td>
    <td class="num" data-l="Кол-во">${i.qty} шт.${i.received_qty!=null&&i.received_qty!==i.qty?'<br><span class="meta">получено '+i.received_qty+'</span>':''}</td>
    <td class="num" data-l="Цена">${i.price_cur!=null?(+i.price_cur).toLocaleString('ru-RU')+' '+cur:'—'}${i.unit_cost!=null&&o.currency!=='KZT'?'<br><span class="meta">≈ '+fmt(i.unit_cost)+'</span>':''}</td>
    <td class="num" data-l="Себест.">${i.landed_cost!=null?'<b>'+fmt(i.landed_cost)+'</b><br><span class="meta">себестоимость</span>':''}</td></tr>`;
}
function poRcvHtml(o){
  const r = PO.rcv, isK = (o.currency||'KZT')==='KZT', rt = isK ? 1 : (+r.rate||0), main = +(r.store||o.store||S.store);
  const al = i => (r.al||{})[i.item_id] || { [main]: i.qty };   // сколько каждой позиции в какой магазин
  const q = i => Object.values(al(i)).reduce((a,v)=>a+(+v||0),0);
  const units = (o.items||[]).reduce((a,i)=>a+q(i),0), unlinked = (o.items||[]).filter(i=>!i.product_id && q(i)>0).length;
  const stores = S.stores;
  return `<div class="cust stack" style="margin-top:8px"><b>Приёмка заказа №${o.number} на склад</b>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
      <label class="meta">Основной магазин <select id="po-rcv-store">${stores.map(st=>`<option value="${st.id}" ${main===st.id?'selected':''}>${esc(storeName(st.id))}</option>`).join('')}</select></label>
      ${isK?'':`<label class="meta">Курс ${o.currency} на сегодня <input id="po-rcv-rate" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(r.rate)}" style="width:100px"></label>
        <span class="meta">Нацбанк ${(+o.rate_now||0).toFixed(2)} · при заказе ${(+o.rate).toFixed(2)}</span>`}</div>
    <span class="meta">Общий заказ можно разложить по магазинам: впишите, сколько штук идёт в каждый. Пусто или 0 — в этот магазин не идёт.</span>
    <div class="scroll"><table><thead><tr><th>Товар</th><th>Заказано</th>${stores.map(st=>`<th style="font-size:12px">${esc(BRAND[st.brand])}<br>${esc(st.address)}</th>`).join('')}<th>Себестоимость шт.</th></tr></thead><tbody>
      ${(o.items||[]).map(i=>{ const A = al(i), tot = q(i); return `<tr><td>${esc(i.name)}${i.product_id?'':' <span class="chip zero">свяжите с базой</span>'}</td>
        <td class="num">${i.qty}${tot!==i.qty?`<br><span class="meta" style="color:var(--bad)">разложено ${tot}</span>`:''}</td>
        ${stores.map(st=>`<td><input class="small" type="number" min="0" data-poal="${i.item_id}:${st.id}" value="${+A[st.id]||''}" inputmode="numeric" style="width:58px"></td>`).join('')}
        <td class="num">${fmt(poLanded(i.price_cur!=null?i.price_cur:(i.unit_cost||0)/(+o.rate||1), rt, o.delivery_pct??10, o.cargo, units))}</td></tr>`; }).join('')}</tbody></table></div>
    <span class="meta">Себестоимость = цена × курс + ${o.delivery_pct??10}% доставка до Казахстана${+o.cargo?` + доставка по Китаю ${fmt(o.cargo*rt)} ÷ ${units} шт. = ${fmt(units?o.cargo*rt/units:0)} на каждую единицу`:''}. Одинаковая для всех магазинов.</span>
    ${unlinked?`<div class="warn">Свяжите с базой товаров ещё ${unlinked} поз. — без этого приёмку не провести.</div>`:''}
    <div class="row" style="justify-content:flex-start"><button class="btn" id="po-rcv-cancel">Отмена</button><button class="btn primary" id="po-rcv-ok" ${unlinked||(!isK&&!(rt>0))||!units?'disabled':''}>Принять на склад</button></div></div>`;
}
document.addEventListener('input', e => {
  if(S.view!=='po' || e.target.id!=='po-lnk-q' || !PO.lnk) return;
  PO.lnk.q = e.target.value; clearTimeout(PO.lnkT); PO.lnkT = setTimeout(()=>{ PO.lnk.found = searchCatalog(PO.lnk.q); render(); }, 250);
});


/* ---------- загрузка заказов из выгрузки 1688 (已买到的货品 → 导出) ---------- */
const ST1688 = { '等待卖家发货':'ждёт отправки продавцом', '等待买家确认收货':'отправлен, ждёт подтверждения получения', '已收货':'получен', '交易成功':'сделка завершена', '交易关闭':'закрыт' };
async function import1688(file){
  PO.imp = 'Читаем файл заказов…'; render();
  try{
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
    const A = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:false, defval:null });
    const h = (A[0]||[]).map(x=>String(x||'').trim()), c = name => h.indexOf(name);
    if(h.includes('Order No') && h.includes('Product')) return await importAlibaba(A, h);
    const K = { no:c('订单编号'), seller:c('卖家公司名'), login:c('卖家会员名'), ship:c('运费(元)'), adj:c('涨价或折扣(元)'), status:c('订单状态'), created:c('订单创建时间'), track:c('运单号'),
      title:c('货品标题'), price:c('单价(元)'), qty:c('数量'), unit:c('单位'), art:c('货号'), offer:c('Offer ID'), sku:c('SKU ID'), skuArt:c('单品货号') };
    if(K.no<0 || K.title<0 || K.price<0) throw new Error('Это не файл заказов из Китая: нет колонок 订单编号 / 货品标题 / 单价');
    const num = v => +String(v??'').replace(/[^\d.\-]/g,'') || 0, str = v => v==null ? null : String(v).trim() || null;
    const orders = []; let cur = null;
    for(const r of A.slice(1)){
      if(str(r[K.no])){ cur = { no:str(r[K.no]), seller:str(r[K.seller]), seller_login:str(r[K.login]), ship:num(r[K.ship]), adj:num(r[K.adj]), status:str(r[K.status]), created:str(r[K.created]), track:str(r[K.track]), items:[] }; orders.push(cur); }
      if(!cur || !str(r[K.title])) continue;
      cur.items.push({ title:str(r[K.title]), price:num(r[K.price]), qty:num(r[K.qty]), unit:str(r[K.unit]), art:str(r[K.art]), offer:str(r[K.offer]), sku:str(r[K.sku]), sku_art:str(r[K.skuArt]) });
    }
    const tot = { new:0, updated:0, items:0, linked:0 };
    for(let i=0; i<orders.length; i+=80){
      PO.imp = `Загружаем заказы: ${i} из ${orders.length}…`; render();
      const { data, error } = await sb.rpc('po_import_1688', { p: orders.slice(i, i+80) });
      if(error) throw error; for(const k in tot) tot[k] += +(data||{})[k]||0;
    }
    CHN.last = null; PO.imp = `Готово: новых заказов ${tot.new}, обновлено ${tot.updated}. Позиций ${tot.items}, из них сразу связано с базой ${tot.linked}. Остальные свяжите при приёмке — Silver запомнит связь для следующих заказов.`;
    PO.mode = 'orders'; PO.filter = 'open'; PO.list = null; await loadPo(); render();
    if('Translator' in self) translate1688();   // сразу переводим новые названия на русский
  }catch(e){ PO.imp = 'Не загрузилось: '+errText(e); render(); }
}
/* ---------- заказы Alibaba.com: файл-выгрузка (Order No, Supplier, Product, Variant, Unit price USD, Qty …) ---------- */
async function importAlibaba(A, h){
  const c = name => h.indexOf(name), num = v => +String(v??'').replace(/[^\d.\-]/g,'') || 0, str = v => v==null ? null : String(v).trim() || null;
  const K = { no:c('Order No'), seller:c('Supplier'), created:c('Order date'), status:c('Status'), track:c('Tracking'), ship:c('Shipping USD'), fee:c('Fee USD'), discount:c('Discount USD'),
    title:c('Product'), spec:c('Variant'), price:c('Unit price USD'), qty:c('Qty'), unit:c('Unit'), offer:c('Product ID'), sku:c('SKU ID'), photo:c('Photo') };
  const orders = []; let cur = null;
  for(const r of A.slice(1)){ const no = str(r[K.no]); if(!no) continue;
    if(!cur || cur.no !== no){ cur = { no, seller:str(r[K.seller]), created:str(r[K.created]), status:str(r[K.status]), track:str(r[K.track]), ship:num(r[K.ship]), fee:num(r[K.fee]), discount:num(r[K.discount]), items:[] }; orders.push(cur); }
    if(str(r[K.title])) cur.items.push({ title:str(r[K.title]), spec:str(r[K.spec]), price:num(r[K.price]), qty:num(r[K.qty]), unit:str(r[K.unit]), offer:str(r[K.offer]), sku:str(r[K.sku]), photo:str(r[K.photo]) }); }
  const tot = { new:0, updated:0, items:0, linked:0 };
  for(let i=0; i<orders.length; i+=10){ PO.imp = `Загружаем заказы Alibaba: ${i} из ${orders.length}…`; render();
    const { data, error } = await sb.rpc('po_import_alibaba', { p: orders.slice(i, i+10) }); if(error) throw error; for(const k in tot) tot[k] += +(data||{})[k]||0; }
  CHN.last = null; PO.imp = `Alibaba: новых заказов ${tot.new}, обновлено ${tot.updated}. Позиций ${tot.items}, сразу связано с базой ${tot.linked}. Остальные свяжите при приёмке — Silver запомнит связь.`;
  PO.mode = 'orders'; PO.filter = 'open'; PO.list = null; await loadPo(); render();
}
// перевод китайских названий на русский — встроенным переводчиком Chrome (бесплатно, прямо на компьютере)
async function translate1688(){
  const titles = [...new Set([...(PO.list||[]).filter(o=>o.supplier&&/[\u4e00-\u9fff]/.test(o.supplier)&&!o.supplier_ru).map(o=>o.supplier), ...(PO.list||[]).flatMap(o=>(o.items||[]).filter(i=>i.supplier_title&&!i.title_ru).map(i=>i.supplier_title))])];
  if(!titles.length) return toast('Все названия уже переведены');
  if(!('Translator' in self)){ PO.imp = 'Перевод работает в браузере Google Chrome на компьютере. Откройте Silver в Chrome и нажмите кнопку ещё раз.'; return render(); }
  try{
    PO.imp = 'Готовим переводчик Chrome (первый раз скачивается языковой пакет)…'; render();
    const tr = await Translator.create({ sourceLanguage:'zh', targetLanguage:'ru', monitor(m){ m.addEventListener('downloadprogress', e => { PO.imp = `Скачиваем переводчик: ${Math.round(e.loaded*100)}%`; render(); }); } });
    let buf = [], done = 0;
    for(const t of titles){
      let ru = ''; try{ ru = await tr.translate(t.replace(/^[A-Za-z]{0,3}\d{3,}[A-Za-z0-9-]*\s*/,'')); }catch(_){}
      if(ru) buf.push({ title:t, ru: ru.replace(/\s+/g,' ').trim() }); done++;
      if(buf.length>=40 || done===titles.length){ await sb.rpc('po_titles_ru', { p: buf }); buf = []; PO.imp = `Переводим названия: ${done} из ${titles.length}…`; render(); }
    }
    PO.imp = `Переведено названий: ${done}.`; PO.list = null; await loadPo(); render();
  }catch(e){ PO.imp = 'Перевод не получился: '+errText(e)+'. Нажмите «Перевести» ещё раз.'; render(); }
}


/* ---------- фото позиций из кабинета 1688 (передаются ссылкой после сбора на странице заказов 1688) ---------- */
async function importPhotos1688(raw){
  try{
    const data = JSON.parse(decodeURIComponent(raw)); // [[номер заказа, offer, [фото...]], ...]
    const rows = data.map(([o,f,i,sk])=>({ o, f, i: i.map(u => u.startsWith('http') ? u : 'https://'+u), ...(sk ? { s: sk } : {}) }));
    let n = 0;
    for(let k=0; k<rows.length; k+=150){ const { data:d, error } = await sb.rpc('po_photos_set', { p: rows.slice(k, k+150) }); if(error) throw error; n += +d||0; }
    toast(`Фото добавлены к ${n} позициям заказов`); PO.list = null; if(S.view==='po'){ await loadPo(); render(); }
  }catch(e){ toast('Фото не загрузились: '+errText(e)); }
}


/* аванс выдаётся 15-го; если 15-е выпадает на субботу или воскресенье — в пятницу перед ними */
function advanceDate(month){ const [y,m] = month.split('-').map(Number), d = new Date(y, m-1, 15), w = d.getDay(); if(w===6) d.setDate(14); if(w===0) d.setDate(13); return d; }
function advanceText(month){ const d = advanceDate(month), today = new Date(); today.setHours(0,0,0,0);
  const s = d.toLocaleDateString('ru-RU',{ day:'numeric', month:'long', weekday:'long' }), diff = Math.round((d - today)/864e5);
  return `Аванс в этом месяце: <b>${s}</b>${diff>0?` — через ${diff} дн.`:diff===0?' — <b>сегодня</b>':' — уже прошёл'} (обычно 15-го, если выпадает на выходные — в пятницу перед ними).`; }

const COLORS_RU = ['золото','серебро','цветной','черный','белый','розовое золото'];
function colorRu(t){ t = String(t||'').toLowerCase();
  if(/玫瑰金|rose gold|розов\S* золот/.test(t)) return 'розовое золото';
  if(/金|gold|золот/.test(t)) return 'золото'; if(/银|silver|серебр|白金|钢色/.test(t)) return 'серебро';
  if(/黑|black|черн/.test(t)) return 'черный'; if(/白|white|бел/.test(t)) return 'белый';
  if(/彩|多色|红|蓝|绿|粉|紫|黄|color|цвет\S*|красн|син|зел|роз/.test(t)) return 'цветной'; return ''; }
async function trZh(text){ try{ if(!('Translator' in self)) return ''; const tr = await Translator.create({ sourceLanguage:'zh', targetLanguage:'ru' }); return await tr.translate(text); }catch(e){ return ''; } }
function poCreateHtml(o, i){
  const m = PO.mk;
  return `<div class="cust stack" style="gap:6px;margin-top:6px"><b>Новый товар в базу</b>
    <input id="po-mk-name" value="${esc(m.name)}" placeholder="Название по-русски, как у нас в базе">
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
      <select id="po-mk-cat"><option value="">Категория…</option>${(PO.cats||[]).map(c=>`<option value="${c.id}" ${String(m.cat)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <select id="po-mk-brand" aria-label="Бренд">${[['','Бренд…'],['moon','MOON'],['sunshine','Sunshine'],['both','MOON и Sunshine']].map(([k,v])=>`<option value="${k}" ${m.brand===k?'selected':''}>${v}</option>`).join('')}</select>
      <input id="po-mk-color" value="${esc(m.color)}" placeholder="цвет по-русски" list="po-colors" style="width:130px"><datalist id="po-colors">${COLORS_RU.map(c=>`<option value="${c}">`).join('')}</datalist>
      <label class="meta">Розничная цена, ₸ <input id="po-mk-price" type="number" min="0" inputmode="numeric" value="${esc(m.price)}" placeholder="можно позже" style="width:110px"></label>
      <span class="meta">себестоимость ≈ ${fmt(m.landed)}</span></div>
    ${(m.specRu||poSpec(i))?`<span class="meta">Вариант: ${esc(noZh(m.specRu)||poSpec(i))}</span>`:''}
    <span class="meta">Розничную цену можно оставить пустой — её поставит Анна. Фото и ссылка на поставщика сохранятся в карточке, штрихкод создастся автоматически.</span>
    <div class="row" style="justify-content:flex-start"><button class="btn small" id="po-mk-cancel">Отмена</button><button class="btn small primary" id="po-mk-save">Создать и связать</button></div></div>`;
}

document.addEventListener('input', e => { if(S.view==='po' && e.target.id==='po-oq'){ PO.oq = e.target.value; PO.lim = 40; clearTimeout(PO.oqT); PO.oqT = setTimeout(render, 250); } });

const poBulkOk = () => isBoss() && !isViewer();

/* ---------- Liquid Glass: «капля» выделения перетекает к выбранному пункту во всех переключателях ---------- */
const LG = { prev: {}, t: 0, enter: false };
const lgHosts = () => document.querySelectorAll('nav.tabs, nav.subtabs, .seg');
const lgSel = h => h.querySelector(':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]');
const lgKey = h => h.matches('nav.tabs') ? 'tabs' : h.matches('nav.subtabs') ? 'sub' : (h.getAttribute('aria-label') || '') + '|' + [...(h.querySelector(':scope > button')||{attributes:[]}).attributes].map(a => a.name).filter(n => n.startsWith('data-')).join(',');
const lgGeo = b => ({ l: b.offsetLeft, t: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight });
document.addEventListener('pointerdown', e => { const b = e.target.closest && e.target.closest('nav.tabs > button, nav.subtabs > button, .seg > button'); if(!b) return;
  const h = b.parentElement, s = lgSel(h); if(s && s !== b){ LG.prev[lgKey(h)] = lgGeo(s); LG.t = Date.now(); }
  if(h.matches('nav.tabs, nav.subtabs')) LG.enter = true; }, true);
function lgSync(){
  const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const h of lgHosts()){
    const s = lgSel(h); let blob = h.querySelector(':scope > .lg-blob');
    if(!s){ if(blob) blob.style.opacity = '0'; continue; }
    if(!blob){ blob = document.createElement('i'); blob.className = 'lg-blob'; blob.setAttribute('aria-hidden', 'true'); h.prepend(blob); }
    h.classList.add('lg-on'); blob.style.opacity = '1';
    const n = lgGeo(s), k = lgKey(h), p = LG.prev[k], cur = blob.dataset.g;
    const g = n.l + ',' + n.t + ',' + n.w + ',' + n.h; if(cur === g && !p) continue;
    Object.assign(blob.style, { left: n.l + 'px', top: n.t + 'px', width: n.w + 'px', height: n.h + 'px' }); blob.dataset.g = g;
    if(p && Date.now() - LG.t < 1500 && !rm && (p.l !== n.l || p.t !== n.t)){
      delete LG.prev[k];
      const mw = (p.w + n.w) / 2 * 1.45, ml = (p.l + p.w / 2 + n.l + n.w / 2) / 2 - mw / 2;
      blob.animate([
        { left: p.l + 'px', top: p.t + 'px', width: p.w + 'px', height: p.h + 'px', transform: 'scaleY(1)' },
        { offset: .42, left: ml + 'px', width: mw + 'px', transform: 'scaleY(.78)', filter: 'brightness(1.08)' },
        { offset: .78, left: (n.l - 3) + 'px', width: (n.w + 6) + 'px', transform: 'scaleY(1.06)' },
        { left: n.l + 'px', top: n.t + 'px', width: n.w + 'px', height: n.h + 'px', transform: 'scaleY(1)' }
      ], { duration: 560, easing: 'cubic-bezier(.25,.9,.3,1)' });
    }
  }
  if(LG.enter){ LG.enter = false; const m = document.getElementById('main'); if(m && !rm){ m.animate([{ opacity: 0, transform: 'translateY(8px) scale(.995)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' }); } }
}
let lgQ = 0;
new MutationObserver(() => { if(!lgQ) lgQ = requestAnimationFrame(() => { lgQ = 0; lgSync(); }); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected'] });
let lgW = innerWidth; addEventListener('resize', () => { if(innerWidth === lgW) return; lgW = innerWidth; for(const b of document.querySelectorAll('.lg-blob')) delete b.dataset.g; lgSync(); }); // высота меняется при прокрутке на телефоне (панель браузера) — каплю не трогаем
