/* Silver — касса и учёт MOON и Sunshine. Данные: Supabase. */
'use strict';
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
    <span class="meta">${all?'выбраны все магазины':'выбрано: '+sel.length}</span></div>`;
}
async function onSelChange(){
  ls.set('kassa_sel', S.sel);
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
const thumb = p => p.photo_url ? `<img class="thumb" referrerpolicy="no-referrer" src="${esc(thumbUrl(p.photo_url))}" data-full="${esc(p.photo_url)}" alt="" loading="lazy" onerror="if(this.dataset.full&&this.src!==this.dataset.full)this.src=this.dataset.full">` : '<span class="thumb"></span>';
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
  const cached = ls.get('kassa_catalog4', null);
  if(cached && !force){ S.catalog = cached.items; S.catalogAt = cached.at; }
  if(!navigator.onLine) return;
  if(cached && !force && Date.now() - cached.at < 6*3600e3) return;
  const items = []; let from = 0;
  while(true){
    const { data, error } = await sb.from('products').select('id,barcode,sku,name,price,archived,photo_url,category_id').eq('archived', false).order('name').range(from, from+999);
    if(error) { toast('Каталог не загрузился: '+errText(error)); return; }
    data.forEach(p => items.push([p.id, p.barcode, p.sku||'', p.name, Number(p.price), p.photo_url||'', p.category_id||null]));
    if(data.length < 1000) break; from += 1000;
  }
  S.catalog = items; S.catalogAt = Date.now(); ls.set('kassa_catalog4', {at:S.catalogAt, items});
}
const prodObj = a => ({ id:a[0], barcode:a[1], sku:a[2], name:a[3], price:a[4], photo_url:a[5]||null, category_id:a[6]||null });
function searchCatalog(q){
  q = q.trim().toLowerCase(); if(!q) return [];
  const exact = S.catalog.filter(p => p[1] === q || p[2].toLowerCase() === q);
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
    ${mode==='in'?`<button class="btn primary" id="lg-tg">✈️ Войти через Telegram</button><p class="meta">Для сотрудников, которых менеджер добавил по номеру телефона.</p><div class="label">или по почте</div>`:''}
    ${mode==='up'?'<input id="lg-name" placeholder="Имя и фамилия" autocomplete="name"><input id="lg-phone" placeholder="Телефон, который указал менеджер" inputmode="tel" autocomplete="tel">':''}
    <input id="lg-email" type="email" placeholder="Почта" autocomplete="username">
    <input id="lg-pass" type="password" placeholder="Пароль (не меньше 6 символов)" autocomplete="${mode==='in'?'current-password':'new-password'}">
    ${msg?`<div class="${/ошиб|не /i.test(msg)?'warn':'okmsg'}">${esc(msg)}</div>`:''}
    <button class="btn primary" id="lg-go">${mode==='in'?'Войти':'Зарегистрироваться'}</button>
    <button class="btn" id="lg-switch">${mode==='in'?'Я новый сотрудник':'У меня уже есть вход'}</button>
    <p class="meta">Зарегистрироваться можно только с номером телефона, который менеджер заранее добавил во вкладке «Сотрудники».</p>
  </div>`;
  $('#lg-switch').onclick = () => renderLogin(mode==='in'?'up':'in');
  if($('#lg-tg')) $('#lg-tg').onclick = () => tgLogin('login');
  $('#lg-go').onclick = async () => {
    const email = $('#lg-email').value.trim(), password = $('#lg-pass').value;
    if(mode==='in'){
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
  { const [a, e] = await Promise.all([sb.rpc('get_tab_access'), sb.rpc('get_tab_edit')]); S.tabAccess = a.data || {}; S.tabEdit = e.data || {}; }
  const ph1688 = location.hash.startsWith('#ph=') ? location.hash.slice(4) : null; if(ph1688) try{ history.replaceState(null,'','#po'); }catch(_){}
  renderShell(); await loadPosShift(); if(S.view!=='pos') render(); if(ph1688) importPhotos1688(ph1688); await loadCatalog(); loadPromos().then(()=>{ if(S.view==='pos') render(); }); render(); flushQueue(); subscribeReqs(); if(S.view!=='pos') loadView();
}

/* ---------- каркас ---------- */
function renderShell(){
  const tabs = [['pos','Продажа'],['shifts','Смены'],['cash','Расходы'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты']];
  if(isBoss()) { tabs.splice(1,0,['analytics','Аналитика']); tabs.push(['bonus','Бонусные карты']); tabs.push(['nom','Номенклатура']); tabs.push(['site','Сайт']); tabs.push(['emps','Сотрудники']); }
  // настройка владельца: какие вкладки видит каждая роль
  const acc = (S.tabAccess||{})[S.me.role];
  if(S.me.role !== 'owner' && Array.isArray(acc)){ const keep = tabs.filter(([v]) => acc.includes(v)); tabs.splice(0, tabs.length, ...keep); }
  tabs.push(['pay', isBoss() ? 'Зарплата' : 'Моя зарплата']);
  if(['owner','viewer'].includes(S.me.role)) tabs.push(['profit','Рентабельность']);
  if(['owner','manager','purchaser','viewer','accountant'].includes(S.me.role)) tabs.push(['po','Закуп']);
  tabs.push(['promo','Акции']);
  if(isBoss()) tabs.push(['flow','Путь товара']);
  if(S.me.role==='owner') tabs.push(['adm','Административный штат']);
  if(isViewer()){ tabs.splice(0, tabs.length, ...tabs.filter(([v]) => v!=='pos' && (v!=='emps' || S.me.role==='accountant'))); if(!S.view || S.view==='pos' || (S.view==='emps' && S.me.role!=='accountant')) S.view = 'analytics'; }
  if(tabs.length && !tabs.some(([v]) => v===S.view)) S.view = tabs[0][0];

  S.tabs = tabs;
  $('#app').innerHTML = `<header id="hdr"></header><nav class="subtabs" id="subnav" role="tablist"></nav><main id="main"></main>
    <nav class="tabs" id="mainnav" role="tablist"></nav>`;
  renderHeader();
}
// вкладки сгруппированы в разделы: внизу — разделы, сверху — вкладки выбранного раздела
const GROUPS = [['kassa','🧾','Касса',['pos','shifts','cash','sales']],['goods','📦','Товары',['flow','stock','wh','po','nom','site']],
  ['clients','💳','Клиенты',['promo','bonus','certs']],['analytics','📈','Аналитика',['analytics','profit']],['team','👥','Сотрудники',['me','emps','pay','adm']]];
const groupOf = v => GROUPS.find(g => g[3].includes(v)) || GROUPS[0];
function renderNav(){
  const tabs = S.tabs || [], has = v => tabs.some(t => t[0]===v), title = v => (tabs.find(t=>t[0]===v)||[])[1];
  const cur = groupOf(S.view); (S.lastView ||= {})[cur[0]] = S.view;
  const rq = S.reqCount ? ` (${S.reqCount})` : '';
  const mn = $('#mainnav'); if(mn) mn.innerHTML = GROUPS.filter(g => g[3].some(has)).map(g => `<button role="tab" data-group="${g[0]}" aria-selected="${g===cur}"><span class="ico">${g[1]}</span>${g[2]}${g[0]==='goods'?rq:''}</button>`).join('');
  const av = cur[3].filter(has), sn = $('#subnav');
  // магазин выбирают только в разделе «Касса»: чек, смена и расходы относятся к конкретной кассе
  const kassa = cur[0]==='kassa';
  if(sn){ sn.hidden = av.length < 2 && !kassa; sn.innerHTML = av.map(v => `<button role="tab" data-view="${v}" aria-selected="${v===S.view}">${title(v)}${v==='wh'?rq:''}</button>`).join('')
    + (kassa && S.stores && S.stores.length ? `<label class="store-pick"><span class="meta">Магазин</span><select id="store-sel" aria-label="Магазин">${S.stores.map(s=>`<option value="${s.id}" ${s.id===S.store?'selected':''}>${esc(BRAND[s.brand]+' · '+s.city+', '+s.address)}</option>`).join('')}</select></label>` : '');
    const ss = $('#store-sel'); if(ss) ss.onchange = e => { S.store = +e.target.value; ls.set('kassa_store', S.store); S.cust = null; S.bonusSpend = 0; if(S.phone) lookupCustomer(); renderHeader(); render(); loadPosShift().then(render); if(S.view==='shifts') loadShifts().then(render); if(S.view==='cash') loadCash().then(render); };
  }
}
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
  if(S.view!=='nom' && document.getElementById('nm-modal')){ $('#modal').innerHTML = ''; if(S.nm) S.nm.ed = null; }
  if(location.hash.slice(1)!==S.view) try{ history.replaceState(null,'','#'+S.view); }catch(_){}
  document.body.classList.toggle('readonly', !canEdit(S.store) || !canEditTab(S.view));
  renderNav();
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  ({ pos:renderPos, sales:renderSales, stock:renderStock, certs:renderCerts, emps:renderEmps, shifts:renderShifts, analytics:renderAnalytics, wh:renderWh, site:renderSite, nom:renderNom, bonus:renderBonus, cash:renderCash, pay:renderPay, profit:renderProfit, po:renderPo, promo:renderPromo, me:renderMe, adm:renderAdm, flow:renderFlow })[S.view]();
  if(id){ const el = document.getElementById(id); if(el){ el.focus(); try{ if(pos!=null) el.setSelectionRange(pos,pos) }catch(e){} } }
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
     <div class="row"><h2>Товары</h2><span class="meta">${S.catalog.length.toLocaleString('ru-RU')} в каталоге</span></div>
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
        ${(()=>{ const here=(S.stock[l.pid]||{})[S.store]; if(here==null || here>=l.qty) return ''; const need=l.qty-Math.max(0,here);
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
  if(!(+p.price>0)) return toast('У товара «'+p.name+'» ещё нет розничной цены — попросите менеджера поставить её в «Номенклатуре»');
  const l = S.cart.find(x=>x.pid===p.id);
  if(l) l.qty++; else S.cart.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, cat:p.category_id||null, qty:1, disc:0, dt:'pct', dv:0 });
  syncPays(); render();
  if(!S.stock[p.id] || S.stock[p.id][S.store]==null) loadStock([p.id]).then(()=>{ (S.stock[p.id] ||= {}); if(S.stock[p.id][S.store]==null) S.stock[p.id][S.store]=0; if(S.view==='pos') render(); });
}
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
  $('#main').innerHTML = `<h2>Чеки и возвраты</h2>${wiponUpHtml('sales')}${storeFilterHtml()}
    ${(()=>{ const F = S.sf || { from:'', to:'', kind:'' }; return `<div class="filters"><label class="meta">с <input type="date" id="sf-from" value="${F.from}"></label><label class="meta">по <input type="date" id="sf-to" value="${F.to}"></label>
      <select id="sf-kind">${[['','Все чеки'],['sale','Только продажи'],['return','Только возвраты'],['with_return','Продажи, по которым был возврат'],['no_return','Продажи без возврата']].map(([k,v])=>`<option value="${k}" ${F.kind===k?'selected':''}>${v}</option>`).join('')}</select>
      ${F.from||F.to||F.kind||S.salesQ?'<button class="btn small" id="sf-reset">Сбросить</button>':''}</div>`; })()}
    <div class="filters"><input id="sq" style="flex:1" placeholder="Товар (название или штрихкод), номер чека или телефон клиента" value="${esc(S.salesQ)}"><button class="btn" id="sq-go">Найти</button></div>
    ${S.salesTotal!=null?`<p class="meta">Найдено чеков: <b>${(S.salesTotal||0).toLocaleString('ru-RU')}</b> · сумма продаж минус возвраты: <b>${fmt(S.salesSum||0)}</b>${S.salesTotal>S.sales.length?` · показаны последние ${S.sales.length}`:''}</p>`:''}
    ${S.sales.length?`<div class="scroll"><table><thead><tr><th>№</th><th>Когда</th>${isBoss()?'<th>Магазин</th>':''}<th>Товары</th><th>Сумма</th><th>Оплата</th><th>Клиент</th><th></th></tr></thead><tbody>
    ${S.sales.map(s=>`<tr><td class="num">${s.number}${s.kind==='return'?' <span class="chip zero">возврат</span>':''}${s.has_return?' <span class="chip warn">был возврат</span>':''}${s.wipon_id?'<br><span class="meta">Wipon '+esc(String(s.wipon_id).replace('-R',''))+'</span>':''}</td>
      <td class="num">${new Date(s.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}<br><span class="meta">${esc(s.employees&&s.employees.full_name||'')}</span></td>${isBoss()?`<td>${esc(storeName(s.store_id))}</td>`:''}
      <td>${s.is_certificate_sale?esc(s.note):s.sale_items.map(i=>esc(i.products?i.products.name:'')+' × '+i.qty).join('<br>')}</td>
      <td class="num">${fmt(s.total)}</td><td>${s.sale_payments.map(p=>PAY[p.method]+(p.certificate_code?' '+esc(p.certificate_code):'')).join(', ')}</td>
      <td>${s.customers?esc(s.customers.phone):'—'}</td>
      <td>${s.kind==='sale'&&!s.is_certificate_sale?`<button class="btn small" data-ret="${s.id}">Возврат</button>`:''}</td></tr>`).join('')}</tbody></table></div>${S.salesTotal>S.sales.length?`<button class="btn" id="sf-more" style="width:100%;margin-top:8px">Показать ещё</button>`:''}`
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
  S.stockRows = (data||[]).map(r => { S.stock[r.product_id] = Object.fromEntries(Object.entries(r.per_store).map(([k,v])=>[+k,v]));
    const a = byId.get(r.product_id); return a ? prodObj(a) : { id:r.product_id, name:'(нет в кэше — обновите страницу)', barcode:'', price:0 }; });
}
function renderStock(){
  const sortCol = (S.stockSort === 'total' || S.stockSort === 'name') ? null : +S.stockSort;
  const act = key => String(S.stockSort)===String(key);
  const arrow = key => !act(key) ? '↕' : key==='name' ? (S.stockDir==='asc'?'Я→А':'А→Я') : (S.stockDir==='asc'?'↑':'↓');
  const th = (key, label) => `<th><button class="btn small" data-ssort="${key}" style="${act(key)?'background:var(--ink);color:var(--surface)':''}">${label} ${arrow(key)}</button></th>`;
  $('#main').innerHTML = `<h2>Остатки по магазинам</h2>${wiponUpHtml('stock')}
    <div class="filters"><input id="stq" style="flex:1;min-width:200px" placeholder="Название, штрихкод или артикул" value="${esc(S.stockQ)}">
      ${(()=>{ const o=S.fopts||{categories:[],materials:[],colors:[]}, f=S.stockF||{}; const sel=(k,ph,items)=>`<select data-stf="${k}" aria-label="${ph}"><option value="">${ph}</option>${items.map(([v,t])=>`<option value="${esc(v)}" ${String(f[k]||'')===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
        return sel('category','Все категории',(o.categories||[]).map(c=>[c.id,c.name])) + sel('material','Все материалы',(o.materials||[]).map(m=>[m,m])) + sel('color','Все цвета',(o.colors||[]).map(m=>[m,m]))
          + (Object.values(f).some(Boolean)?'<button class="btn small" id="stf-clear">Сбросить фильтры</button>':''); })()}</div>
    <p class="meta">${S.stockQ.trim()||Object.values(S.stockF||{}).some(Boolean)?'Найдено '+S.stockRows.length+(S.stockRows.length===300?' (показаны первые 300)':''):'300 товаров'}: ${S.stockSort==='name'?'по названию':(S.stockDir==='asc'?'от меньшего остатка к большему':'от большего остатка к меньшему')+' '+(sortCol?'в магазине '+esc(storeName(sortCol)):'по всей сети')}. Нажмите на заголовок столбца, чтобы сортировать по нему; повторное нажатие — в обратную сторону.${S.stockDir==='asc'&&S.stockSort!=='name'?' Товары с нулевым остатком не показываются.':''}</p>
    ${S.stockRows.length?`<div class="scroll"><table><thead><tr>${th('name','Товар')}${S.allStores.map(st=>th(st.id, esc(BRAND[st.brand])+'<br>'+esc(st.address))).join('')}${th('total','Всего')}<th></th></tr></thead><tbody>
    ${S.stockRows.map(p=>{ const st=S.stock[p.id]||{}; const qs=S.allStores.map(x=>st[x.id]||0);
      return `<tr><td><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)} · ${fmt(p.price)}</span></td>${qs.map((n,i)=>`<td class="num" style="${n?'':'color:var(--muted)'};${S.allStores[i].id===sortCol?'background:var(--soft)':''}">${n}</td>`).join('')}
      <td class="num" style="${sortCol?'':'background:var(--soft)'}"><b>${qs.reduce((a,b)=>a+b,0)}</b></td><td><button class="btn small" data-hist="${p.id}">История</button></td></tr>`}).join('')}</tbody></table></div>`
    : '<div class="empty">Загружаем остатки…</div>'}`;
}
async function openHistory(pid){
  const p = prodObj(S.catalog.find(x=>x[0]===pid));
  const { data, error } = await sb.from('stock_movements').select('created_at,type,qty,store_id,note,employees(full_name)').eq('product_id', pid).order('created_at',{ascending:false}).limit(100);
  if(error) return toast(errText(error));
  const T = { opening:'Начальный остаток', receipt:'Приёмка', sale:'Продажа', return:'Возврат', transfer_out:'Перемещение (отправлено)', transfer_in:'Перемещение (получено)', writeoff:'Списание', audit:'Ревизия' };
  modal(`<h2>${esc(p.name)}</h2><p class="meta num">${esc(p.barcode)}</p>
    <div class="scroll"><table><thead><tr><th>Когда</th><th>Что</th><th>Магазин</th><th>Шт.</th><th>Кто</th></tr></thead><tbody>
    ${data.map(m=>`<tr><td class="num">${new Date(m.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</td><td>${T[m.type]||m.type}</td>
      <td>${esc((S.allStores.find(s=>s.id===m.store_id)||{}).address||'')}</td><td class="num" style="color:${m.qty>0?'var(--ok)':'var(--bad)'}">${m.qty>0?'+':''}${m.qty}</td><td>${esc(m.employees?m.employees.full_name:'')}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn" data-close>Закрыть</button>`);
}

/* ---------- склад: приёмка, оприходование, списание, перемещение, ревизия ---------- */
const WH = {
  requests:  { t:'Запросы', boss:false, hint:'Консультант на кассе просит оприходовать товар, которого нет по системе. Менеджер подтверждает — товар сразу приходуется в этот магазин.' },
  receipt:   { t:'Приёмка', boss:true, hint:'Товар от поставщика. Закупочная цена обновится, после проведения можно напечатать этикетки.' },
  capitalize:{ t:'Оприходование', boss:true, hint:'Излишки и найденный товар без поставщика.' },
  writeoff:  { t:'Списание', boss:false, hint:'Брак, потеря, подарок. Причина обязательна. Списание сначала уходит на подтверждение директору (Астана — Ирине Николаевне) и проводится только после «Списать».' },
  transfer:  { t:'Перемещение', boss:false, hint:'Создаёт перемещение менеджер. Товар списывается в магазине-отправителе сразу, а в магазине-получателе — когда там нажмут «Принять».' },
  audit:     { t:'Ревизия', boss:false, hint:'Сканируйте товар на полке — каждое сканирование +1. Продажи во время ревизии учитываются. Закрывает менеджер.' },
};
function whModes(){ return Object.entries(WH).filter(([k,v]) => !v.boss || isBoss()); }
function newDoc(mode){ return { mode, store:S.store, to:(S.stores.find(x=>x.id!==S.store)||{}).id, supplier:'', note:'', reason:'', items:[] }; }
async function loadReqs(){ const { data, error } = await sb.rpc('requests_list', { p_status: S.reqSt||'pending' }); if(error) toast(errText(error)); S.reqs = data||[]; if((S.reqSt||'pending')==='pending') setReqBadge(S.reqs.length); }
function setReqBadge(n){ S.reqCount=n; renderNav(); }
function renderReqs(head){
  const st = S.reqSt||'pending';
  $('#main').innerHTML = `<h2>Склад</h2>${head}
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
  if(S.wmode==='requests'){ await loadReqs(); return; }
  if(S.wmode==='transfer'){ const { data } = await sb.rpc('transfers_list', { p_store: isBoss()?null:S.store }); S.trList = data||[]; }
  else if(S.wmode==='audit'){ await loadAudit(); }
  else { const { data } = await sb.rpc('writeoffs_list', { p_store: isBoss()?null:S.store }); S.whList = (data||[]).filter(x => x.kind === S.wmode);
    if(S.wmode==='writeoff'){ const r = await sb.rpc('writeoff_requests_list', { p_status:null }); S.woReqs = r.data||[]; } }
}
setInterval(async () => {
  if(document.hidden || S.view!=='wh' || S.wmode!=='audit' || !S.audit) return;
  const ae = document.activeElement; if(ae && ae.tagName==='INPUT' && ae.id!=='dq') return;
  if(ae && ae.id==='dq' && ae.value) return;
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
  return `<div class="row"><input id="dq" style="flex:1" placeholder="${ph||'Скан штрихкода или название'}" value="${esc(S.dq)}" autocomplete="off"><button class="btn" id="dq-add">Добавить</button></div>
    ${S.dfound.length?`<div class="list">${S.dfound.slice(0,10).map(p=>`<button class="prod" data-dadd="${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}</div>`:''}`;
}
function renderWh(){
  if(!S.wmode) S.wmode = whModes()[0][0];
  const m = S.wmode, d = S.doc && S.doc.mode===m ? S.doc : (S.doc = newDoc(m));
  const head = `<div class="filters">${whModes().map(([k,v])=>`<button class="btn small ${k===m?'primary':''}" data-wmode="${k}">${v.t}</button>`).join('')}</div>
    <p class="meta">${WH[m].hint}</p>`;
  if(m==='requests') return renderReqs(head);
  if(m==='audit') return renderAudit(head);
  if(m==='transfer' && !isBoss()){ $('#main').innerHTML = `<h2>Склад</h2>${head}${renderTransfers()}`; return; }
  const storeSel = (id, val) => `<select id="${id}">${S.stores.map(st=>`<option value="${st.id}" ${st.id===val?'selected':''}>${esc(BRAND[st.brand]+' · '+st.city+', '+st.address)}</option>`).join('')}</select>`;
  const total = d.items.reduce((a,i)=>a+i.qty,0);
  $('#main').innerHTML = `<h2>Склад</h2>${head}<div class="grid2"><div class="card stack">
    <div class="row" style="flex-wrap:wrap"><span class="label">${m==='transfer'?'Откуда':'Магазин'}</span>${storeSel('d-store', d.store)}
      ${m==='transfer'?`<span class="label">Куда</span>${storeSel('d-to', d.to)}`:''}</div>
    ${m==='receipt'?`<input id="d-supplier" placeholder="Поставщик (например, Китай, Иу, рынок, наша студия)" value="${esc(d.supplier)}">`:''}
    ${m==='writeoff'?`<input id="d-reason" placeholder="Причина списания *" value="${esc(d.reason)}">`:''}
    ${m==='capitalize'||m==='receipt'?`<input id="d-note" placeholder="Комментарий" value="${esc(d.note)}">`:''}
    ${docSearchHtml()}
    ${(m==='receipt'||m==='capitalize')&&isBoss()&&!isViewer()?(S.dnew?dnewHtml():`<button class="btn small" id="dn-open" style="align-self:flex-start">+ Новый товар (нет в базе)</button>`):''}
    ${d.items.length?`<div class="scroll"><table><thead><tr><th>Товар</th><th>Кол-во</th>${m==='receipt'?'<th>Закуп, ₸</th>':''}<th></th></tr></thead><tbody>
      ${d.items.map((i,n)=>`<tr><td>${esc(i.name)}<br><span class="meta num">${esc(i.barcode)}</span></td>
        <td><input class="small" type="number" min="1" id="dqty-${n}" data-dqty="${n}" value="${i.qty}" inputmode="numeric"></td>
        ${m==='receipt'?`<td><input class="small" type="number" min="0" id="dcost-${n}" data-dcost="${n}" value="${i.cost??''}" inputmode="numeric"></td>`:''}
        <td><button class="btn small" data-ddel="${n}">✕</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Добавьте товары сканером или поиском</div>'}
    <div class="row"><span class="meta">Позиций: ${d.items.length} · штук: ${total}</span>
      <button class="btn primary" id="d-post" ${d.items.length?'':'disabled'}>${{receipt:'Провести приёмку',capitalize:'Оприходовать',writeoff:'Отправить на подтверждение',transfer:'Отправить'}[m]}</button></div>
  </div><div>${m==='transfer'?renderTransfers():m==='writeoff'?renderWoReqs()+renderWhList():renderWhList()}</div></div>`;
}
function renderWoReqs(){
  const L = S.woReqs||[]; if(!L.length) return '';
  const ST = { pending:['warn','ждёт подтверждения'], approved:['ok','списано'], rejected:['zero','отклонено'] };
  return `<h2>Запросы на списание</h2>${L.slice(0,30).map(r=>`<div class="card" style="margin-bottom:8px">
    <div class="row"><b>${esc(storeName(r.store))}</b><span class="chip ${ST[r.status][0]}">${ST[r.status][1]}</span></div>
    <div class="meta">${tm(r.created_at)} · ${esc(r.by||'')} · причина: ${esc(r.reason)}${r.decided_by?' · решение: '+esc(r.decided_by):''}${r.note?' ('+esc(r.note)+')':''}</div>
    <div>${(r.items||[]).map(i=>esc(i.name)+' × '+i.qty+' <span class="meta num">'+esc(i.barcode||'')+'</span>').join('<br>')}</div>
    <div class="meta">Сумма по рознице: ${fmt((r.items||[]).reduce((a,i)=>a+(+i.price||0)*i.qty,0))}</div>
    ${r.status==='pending'&&r.can_decide?`<div class="row" style="justify-content:flex-start"><button class="btn small primary" data-wook="${r.id}">Списать</button><button class="btn small" data-wono="${r.id}">Отклонить</button></div>`:''}
  </div>`).join('')}`;
}
function renderWhList(){
  return `<h2>Последние документы</h2>${S.whList.length?S.whList.map(x=>`<div class="card" style="margin-bottom:8px">
    <div class="row"><b>${esc(WH[x.kind]?WH[x.kind].t:x.kind)}${x.number?' №'+x.number:''}</b><span class="meta">${new Date(x.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="meta">${esc(storeName(x.store))} · ${esc(x.by||'')}${x.supplier?' · '+esc(x.supplier):''}${x.reason?' · '+esc(x.reason):''}</div>
    <div>${(x.items||[]).map(i=>esc(i.name)+' × '+i.qty).join('<br>')}</div>
    ${x.kind!=='writeoff'&&x.items?`<button class="btn small" data-labels='${esc(JSON.stringify(x.items.map(i=>({n:i.name,b:i.barcode,p:i.price,q:i.qty}))))}'>Этикетки</button>`:''}
  </div>`).join(''):'<div class="empty">Документов пока нет</div>'}`;
}
function renderTransfers(){
  return `<h2>Перемещения</h2>${S.trList.length?S.trList.map(t=>`<div class="card" style="margin-bottom:8px">
    <div class="row"><b>№${t.number}: ${esc(storeName(t.from))} → ${esc(storeName(t.to))}</b>
      <span class="chip ${({received:'ok',rejected:'zero',awaiting:'warn',sent:'warn'})[t.status]||''}">${({received:'принято',sent:'в пути',awaiting:'ждёт подтверждения',rejected:'отклонено'})[t.status]||t.status}</span></div>
    <div class="meta">Отправила ${esc(t.sent_by||'')} ${new Date(t.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${t.received_by?' · приняла '+esc(t.received_by):''}${t.approved_by?(t.status==='rejected'?' · отклонил(а) ':' · подтвердил(а) ')+esc(t.approved_by):''}${t.decision_note?' · «'+esc(t.decision_note)+'»':''}${t.status==='awaiting'?'<br>Между городами: товар спишется со склада после подтверждения менеджера города-получателя.':''}</div>
    <div>${(t.items||[]).map(i=>esc(i.name)+' × '+i.qty).join('<br>')}</div>
    ${t.can_decide&&!isViewer()?`<div class="row" style="justify-content:flex-start;gap:8px"><button class="btn small primary" data-trok="${t.id}">Подтвердить</button><button class="btn small" data-trno="${t.id}">Отклонить</button></div>`:''}
    ${t.status==='sent'&&!isViewer()&&(isBoss()||t.to===S.store)?`<button class="btn small primary" data-trrecv="${t.id}">Принять в ${esc(storeName(t.to))}</button>`:''}
  </div>`).join(''):'<div class="empty">Перемещений пока нет</div>'}`;
}
function renderAudit(head){
  const a = S.audit, A = S.au || {}, boss = S.me && ['owner','manager'].includes(S.me.role);
  const rows = S.auditRows || [], rec = rows.filter(r=>r.recount);
  const sheetName = (A.sheets||[]).find(x=>x.id===A.sheet)?.name;
  const R = A.flt==='diff' ? rows.filter(r=>r.diff!==0) : A.flt==='rec' ? rec : rows;
  $('#main').innerHTML = `<h2>Склад</h2>${head}
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
    if(!S.dnewCats){ const { data } = await sb.from('categories').select('id,name').order('name'); S.dnewCats = data||[]; render(); } $('#dn-name') && $('#dn-name').focus(); }
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
  if(it) it.qty++; else d.items.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, qty:1, cost:null });
  S.dq=''; S.dfound=[]; render(); $('#dq') && $('#dq').focus();
}
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
    <p class="meta">Показано: ${S.certs.length}${S.certs.length===300?' (первые 300 — уточните поиск)':''}. Старые сертификаты перенесены из Google-таблицы; срок действия для них считается 3 месяца от даты покупки.</p>
    ${S.certs.length?`<div class="scroll"><table><thead><tr><th>Номер</th><th>Номинал / остаток</th><th>Статус</th><th>Продан</th><th>Кто купил → кому</th><th>Где использован</th></tr></thead><tbody>
    ${S.certs.map(c=>`<tr style="${c.needs_review?'background:#fff6e5':''}"><td><b>${esc(c.code)}</b><br><span class="meta">${c.kind==='electronic'?'электронный':'физический'}</span>
        ${c.needs_review?`<br><span class="chip warn" title="${esc(c.source||'')}">⚠ ${esc(c.review_note||'проверить')}</span>`:''}${c.note?`<br><span class="meta">${esc(c.note)}</span>`:''}</td>
      <td class="num">${fmt(c.nominal)}<br><span class="meta">осталось ${fmt(c.balance)}</span></td>
      <td><span class="chip ${c.status==='active'?'ok':c.status==='used'?'':'zero'}">${ST[c.status]||c.status}</span><br><span class="meta">${c.expires_at?'до '+new Date(c.expires_at).toLocaleDateString('ru-RU'):'срок не известен'}</span></td>
      <td>${esc(c.sold_city)}, ${esc(c.sold_store)}<br><span class="meta">${c.sold_at?new Date(c.sold_at).toLocaleDateString('ru-RU'):'дата не указана'}${c.sold_by_name?' · '+esc(c.sold_by_name):''}</span></td>
      <td>${esc(c.buyer_name||'')} ${esc(c.buyer_phone||'')}<br>→ ${esc(c.recipient_name||'')} ${esc(c.recipient_phone||'')}</td>
      <td>${esc(c.used_in||'—')}${c.last_used_at?`<br><span class="meta">${new Date(c.last_used_at).toLocaleDateString('ru-RU')}</span>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Сертификатов пока нет</div>'}
  </div>
  <div class="card stack"><h2 style="margin:0">Продать сертификат</h2>
    <div class="seg" id="ck-kind"><button data-ck="physical" aria-pressed="true">Физический</button><button data-ck="electronic" aria-pressed="false">Электронный</button></div>
    <input id="c-code" placeholder="Номер с карточки (пусто — создать автоматически)">
    <input id="c-amount" type="number" min="1" placeholder="Номинал, ₸" inputmode="numeric">
    <div class="label">Кто покупает</div>
    <input id="c-bname" placeholder="Имя покупателя"><input id="c-bphone" placeholder="Телефон покупателя *" inputmode="tel">
    <div class="label">Кому сертификат</div>
    <input id="c-rname" placeholder="Имя получателя"><input id="c-rphone" placeholder="Телефон получателя" inputmode="tel">
    <select id="c-pay">${['cash','card'].map(k=>`<option value="${k}">${PAY[k]}</option>`).join('')}</select>
    <button class="btn primary" id="c-sell">Продать сертификат</button>
    <p class="meta">Бонусы за покупку сертификата не начисляются — они начислятся, когда им оплатят товар.</p>
  </div></div>`;
}
async function sellCert(){
  const bphone = normPhone($('#c-bphone').value), rphone = $('#c-rphone').value ? normPhone($('#c-rphone').value) : null;
  const amount = +$('#c-amount').value;
  if(!bphone) return toast('Укажите телефон покупателя');
  if($('#c-rphone').value && !rphone) return toast('Телефон получателя: 10 цифр после +7');
  const kind = document.querySelector('#ck-kind [aria-pressed="true"]').dataset.ck;
  const { data, error } = await sb.rpc('sell_certificate', { p:{ client_uuid:uuid(), store_id:S.store, code:$('#c-code').value.trim(), kind, amount,
    customer_phone:bphone, customer_name:$('#c-bname').value, recipient_name:$('#c-rname').value, recipient_phone:rphone,
    payments:[{ method:$('#c-pay').value, amount }] } });
  if(error) return toast('Не продан: '+errText(error));
  toast('Сертификат продан'); await loadCerts(); render();
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
  $('#main').innerHTML = `<h2>Аналитика</h2>${anModeHtml()}${storeFilterHtml()}
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
    <h2 style="margin-top:18px">Закрытые и открытые смены</h2>${isBoss()?storeFilterHtml():''}
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
  $('#main').innerHTML = `<h2>Аналитика</h2>${anModeHtml()}${storeFilterHtml()}
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
  if(!f.cats){ const { data } = await sb.from('categories').select('id,name').order('name'); f.cats = data || []; }
  sb.rpc('po_incoming').then(({data}) => { S.inc = data || {}; });
  const { data, error } = await sb.rpc('product_list2', { p_q:f.q.trim(), p_category:f.cat?+f.cat:null, p_archived:f.arch, p_offset:f.off, p_limit:50, p_sort:f.sort||null, p_desc:!!f.desc });
  if(error){ toast(errText(error)); f.data = { rows:[], total:0 }; } else f.data = data;
}
function renderNom(){
  const f = S.nm, D = f.data, e = f.ed, cats = f.cats || [];
  const inp = (k, label, extra='') => `<label class="stack" style="gap:4px"><span class="label">${label}</span><input data-nf="${k}" value="${esc(e[k]??'')}" ${extra}></label>`;
  $('#main').innerHTML = `<div class="row"><h2>Номенклатура</h2><button class="btn primary" id="nm-new">+ Новый товар</button></div>
    <div class="filters"><input id="nm-q" placeholder="Штрихкод, артикул или название" value="${esc(f.q)}" style="flex:1;min-width:180px">
      <select id="nm-cat"><option value="">Все категории</option><option value="-1" ${String(f.cat)==='-1'?'selected':''}>⚠ Без категории</option>${cats.map(c=>`<option value="${c.id}" ${String(f.cat)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <label class="meta" style="align-self:center"><input type="checkbox" id="nm-arch" ${f.arch?'checked':''}> архив</label></div>
    ${!D?'<div class="empty">Загружаем…</div>':`<p class="meta">Найдено: ${D.total.toLocaleString('ru-RU')}. Нажмите на название, чтобы открыть карточку. Категорию можно менять прямо в таблице.</p>
    ${nmCanEdit()&&Object.keys(f.sel||{}).length?`<div class="cust row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;margin-bottom:8px"><b>Выбрано: ${Object.keys(f.sel).length}</b>
      <select id="nm-bulkcat"><option value="">Назначить категорию…</option>${cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <button class="btn small primary" id="nm-bulk-go">Применить</button><button class="btn small" id="nm-bulk-clear">Снять выбор</button></div>`:''}
    <div class="scroll"><table class="nm-table"><thead><tr><th>${nmCanEdit()?`<input type="checkbox" id="nm-selall" title="Выбрать все на странице" ${D.rows.length&&D.rows.every(p=>(f.sel||{})[p.id])?'checked':''}>`:''}</th>${[['name','Название'],['category','Категория'],['barcode','Штрихкод'],['cost','Закуп'],['price','Цена'],['stock','Остаток'],['site','Сайт']].map(([k,v])=>`<th><button data-nmsort="${k}" style="border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;white-space:nowrap" title="Сортировать">${v} ${f.sort===k?(f.desc?'▼':'▲'):'<span class="meta">↕</span>'}</button></th>`).join('')}</tr></thead><tbody>
    ${D.rows.map(p=>{ const inc = (S.inc||{})[p.id], L = (p.sites||[]).filter(x=>x.url);
      return `<tr style="${e&&e.id===p.id?'background:var(--soft)':''}"><td style="white-space:nowrap">${nmCanEdit()?`<input type="checkbox" data-nmsel="${p.id}" ${(f.sel||{})[p.id]?'checked':''}> `:''}${thumb(p)}</td>
      <td style="min-width:200px"><button class="linkbtn" data-nmopen="${p.id}" style="border:0;background:none;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit"><b>${esc(p.name)}</b></button>${p.is_group?' <span class="chip">общий штрихкод</span>':''}<br><span class="meta">${esc([{moon:'MOON',sunshine:'Sunshine',both:'MOON и Sunshine'}[p.brand]||'', p.color, p.material].filter(Boolean).join(' · '))}</span></td>
      <td>${nmCanEdit()?`<select data-nmcat="${p.id}" style="max-width:170px;${p.category_id?'':'border-color:var(--warn,#d90)'}"><option value="">— без категории —</option>${cats.map(c=>`<option value="${c.id}" ${p.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:esc(p.category||'—')}</td>
      <td class="num">${esc(p.barcode)}${p.sku?'<br><span class="meta">арт. '+esc(p.sku)+'</span>':''}</td>
      <td class="num">${p.cost!=null&&p.cost!==''?fmt(p.cost):'<span class="meta">—</span>'}</td>
      <td class="num">${+p.price>0?fmt(p.price):'<span class="chip warn">нет цены</span>'}</td>
      <td class="num"><span class="nm-st" tabindex="0">${p.stock>0?'<span class="chip ok">есть '+p.stock+'</span>':'<span class="chip zero">нет</span>'}<span class="nm-st-pop">${S.allStores.map(st=>{ const q = +((p.by_store||{})[st.id]||0); return `<span class="row" style="gap:12px;${q?'':'opacity:.5'}"><span>${esc(BRAND[st.brand]+' · '+st.address)}</span><b class="num">${q}</b></span>`; }).join('')}</span></span>${inc&&((inc.ordered||0)+(inc.transit||0))?`<br><span class="meta">заказано ${(inc.ordered||0)+(inc.transit||0)}</span>`:''}</td>
      <td style="white-space:nowrap">${L.length?['moon','sunshine'].map(sk=>{ const X = L.filter(x=>x.site===sk); return X.length ? `<a href="${esc(X[0].url)}" target="_blank" rel="noopener">${sk==='moon'?'MOON':'Sunshine'}</a>${X.length>1?` <span class="meta">· ${X.length} карточек</span>`:''}${X.some(x=>x.status==='review')?' <span class="meta">(не проверено)</span>':''}` : ''; }).filter(Boolean).join('<br>'):'<span class="meta">нет на сайте</span>'}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Ничего не найдено</td></tr>'}</tbody></table></div>
    ${f.off||D.rows.length===50?`<div class="row" style="margin-top:8px"><button class="btn" data-nmpage="-1" ${f.off?'':'disabled'}>Назад</button><span class="meta">${f.off+1}–${f.off+D.rows.length}</span><button class="btn" data-nmpage="1" ${D.rows.length===50?'':'disabled'}>Дальше</button></div>`:''}`}`;
  nmModalSync(e, f, cats, inp);
}
(()=>{ const st = document.createElement('style'); st.textContent = `.nm-st{position:relative;display:inline-block;cursor:default}.nm-st-pop{display:none;position:fixed;z-index:20;min-width:240px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 10px;box-shadow:0 6px 24px rgba(0,0,0,.15);text-align:left;font-size:13px;flex-direction:column;gap:4px;white-space:nowrap}.nm-st:hover .nm-st-pop,.nm-st:focus .nm-st-pop{display:flex}`; document.head.appendChild(st);
  const place = el => { const pop = el.querySelector('.nm-st-pop'); if(!pop) return; const r = el.getBoundingClientRect(); pop.style.display = 'flex';
    const w = pop.offsetWidth, h = pop.offsetHeight; pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px'; pop.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + 'px'; pop.style.display = ''; };
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('.nm-st'); if(el) place(el); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('.nm-st'); if(el) place(el); }); })();
document.addEventListener('mousedown', e => { if(e.target && e.target.id==='nm-modal' && S.nm){ S.nm.ed = null; render(); } });
const nmCanEdit = () => S.me && ['owner','manager','purchaser'].includes(S.me.role);
document.addEventListener('change', async e => { if(S.view!=='nom') return; const t = e.target, f = S.nm;
  if(t.dataset.nmcat){ const r = await sb.rpc('products_set_category', { p_ids:[t.dataset.nmcat], p_cat: t.value ? +t.value : null }); if(r.error) return toast(errText(r.error));
    const row = (f.data&&f.data.rows||[]).find(x=>x.id===t.dataset.nmcat); if(row){ row.category_id = t.value ? +t.value : null; row.category = t.value ? t.options[t.selectedIndex].text : null; } toast('Категория сохранена'); render(); }
  else if(t.dataset.nmsel){ f.sel = f.sel || {}; if(t.checked) f.sel[t.dataset.nmsel] = 1; else delete f.sel[t.dataset.nmsel]; render(); }
  else if(t.id==='nm-selall'){ f.sel = f.sel || {}; (f.data&&f.data.rows||[]).forEach(p=>{ if(t.checked) f.sel[p.id] = 1; else delete f.sel[p.id]; }); render(); }
});
document.addEventListener('click', async e => { if(S.view!=='nom') return; const t = e.target.closest('button'); if(!t) return; const f = S.nm;
  if(t.id==='nm-bulk-clear'){ f.sel = {}; render(); }
  else if(t.id==='nm-bulk-go'){ const c = $('#nm-bulkcat').value; if(!c) return toast('Выберите категорию'); t.disabled = true;
    const r = await sb.rpc('products_set_category', { p_ids:Object.keys(f.sel), p_cat:+c }); if(r.error){ t.disabled = false; return toast(errText(r.error)); }
    toast('Категория назначена: '+r.data+' товарам'); f.sel = {}; await loadNom(); render(); }
});
function nmModalSync(e, f, cats, inp){
  const M = $('#modal'), has = !!M.querySelector('#nm-modal');
  if(!e){ if(has) M.innerHTML = ''; return; }
  const ae = document.activeElement, keep = ae && M.contains(ae) && ae.id ? { id:ae.id, s:ae.selectionStart, e:ae.selectionEnd } : null;
  const sc = has ? M.querySelector('.dialog').scrollTop : 0;
  M.innerHTML = `<div class="overlay" id="nm-modal"><div class="dialog" role="dialog" aria-modal="true" style="max-width:820px">${nmEditorHtml(e, f, cats, inp)}</div></div>`;
  M.querySelector('.dialog').scrollTop = sc;
  if(keep){ const el = document.getElementById(keep.id); if(el){ el.focus(); try{ el.setSelectionRange(keep.s, keep.e); }catch(_){} } }
}
function nmEditorHtml(e, f, cats, inp){
  return `<div class="stack">
     <div class="row"><h2 style="margin:0">${e.id?'Карточка товара':'Новый товар'}</h2><button class="btn small" id="nm-close">Закрыть</button></div>
     <div class="row" style="justify-content:flex-start;align-items:flex-start">
       ${e.photo_url?`<img src="${esc(e.photo_url)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px">`:'<span class="thumb" style="width:120px;height:120px"></span>'}
       <div class="stack" style="flex:1"><span class="label">Фото</span>
         <input type="file" id="nm-photo" accept="image/*" aria-label="Загрузить фото">
         <input data-nf="photo_url" placeholder="или ссылка на картинку" value="${esc(e.photo_url||'')}">
         ${f.busy?'<span class="meta">Загружаем фото…</span>':''}</div></div>
     ${e.id?`<div class="cust stack" style="gap:4px"><b>${esc(e.name)}</b><span>${esc(nmInfo(e))||'<span class="meta">категория, цвет и материал не указаны</span>'}</span>
       <span class="meta num">Штрихкод ${esc(e.barcode)}${e.sku?' · артикул '+esc(e.sku):''} · ${fmt(e.price)}${e.cost!==''&&e.cost!=null?' · закуп '+fmt(e.cost):''} · остаток по сети ${e.stock??'—'}</span>${nmSiteLinks(e)||'<span class="meta">На сайте не найден</span>'}</div>`:''}
     ${inp('name','Название *')}
     <div class="grid2" style="grid-template-columns:1fr 1fr;gap:10px">
       ${inp('barcode','Штрихкод', 'placeholder="пусто — создать свой"')}${inp('sku','Артикул')}
       ${inp('price','Розничная цена, ₸ *','type="number" min="0" inputmode="numeric"')}${inp('cost','Закупочная цена, ₸','type="number" min="0" inputmode="numeric"')}
       <label class="stack" style="gap:4px"><span class="label">Бренд${e.id?'':' *'}</span><select data-nf="brand">${[['','—'],['moon','MOON'],['sunshine','Sunshine'],['both','MOON и Sunshine']].map(([k,v])=>`<option value="${k}" ${(e.brand||'')===k?'selected':''}>${v}</option>`).join('')}</select></label>
       <label class="stack" style="gap:4px"><span class="label">Категория</span><select data-nf="category_id"><option value="">—</option>${cats.map(c=>`<option value="${c.id}" ${String(e.category_id)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
       ${inp('material','Материал','list="nm-mats"')}${inp('color','Цвет','list="nm-colors"')}${inp('supplier','Поставщик')}
     </div>
     <datalist id="nm-mats">${['Серебро 925','Нержавейка','Мед сплав','Пластик','мельхиор','Жемчуг','Кожа','другой'].map(m=>`<option value="${m}">`).join('')}</datalist>
     <datalist id="nm-colors">${['золото','серебро','цветной','черный'].map(m=>`<option value="${m}">`).join('')}</datalist>
     ${inp('purchase_url','Ссылка на закуп')}
     <div class="row" style="justify-content:flex-start;gap:16px"><label title="Под одним штрихкодом продаются разные изделия одной цены — на сайте это много карточек"><input type="checkbox" data-nf="is_group" ${e.is_group?'checked':''}> Общий штрихкод (много разных изделий)</label>
       <label><input type="checkbox" data-nf="archived" ${e.archived?'checked':''}> В архиве</label></div>
     <div class="row"><span>${e.id&&e.barcode?`<button class="btn small" data-labels='${esc(JSON.stringify([{n:e.name,b:e.barcode,p:+e.price,q:1}]))}'>Этикетка</button>`:''}</span>
       <button class="btn primary" id="nm-save">${e.id?'Сохранить':'Создать товар'}</button></div>
     <div class="cust stack"><span class="label">Связь с сайтом</span>
       ${!e.id?'<span class="meta">Сначала сохраните товар</span>':`
       ${(e.sites||[]).map(x=>`<div class="row"><span>${x.site==='moon'?'MOON':'Sunshine'}: ${esc(x.title)} ${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">открыть</a>`:''}</span><button class="btn small" data-nmunlink="${x.site}:${x.uid}">Отвязать</button></div>`).join('') || '<span class="meta">Не связан с сайтом</span>'}
       <input id="nm-sq" placeholder="Найти карточку на сайте по названию" value="${esc(f.sq)}" autocomplete="off">
       ${f.sfound.map(x=>`<button class="prod" data-nmlink="${x.site}:${x.uid}">${thumb({photo_url:x.photo})}<span><b>${esc(x.title)}</b><br><span class="meta">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}${x.linked_to?' · сейчас связан с: '+esc(x.linked_to):''}</span></span><span class="price num">${fmt(x.price)}</span></button>`).join('')}`}
     </div>
   </div>`;
}
function nmInfo(p){ return [p.category, p.color, p.material, p.stone, {moon:'MOON',sunshine:'Sunshine',both:'MOON и Sunshine'}[p.brand]||p.brand, +p.price===0?'⚠ нет розничной цены':'', p.supplier?'поставщик '+p.supplier:''].filter(Boolean).join(' · '); }
function nmSiteLinks(p){ const L=(p.sites||[]).filter(x=>x.url); return L.length?`<div class="meta" style="padding:0 10px 8px">${L.map(x=>`🔗 <a href="${esc(x.url)}" target="_blank" rel="noopener">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}${x.status==='review'?' (связь не проверена)':''}</a>`).join(' &nbsp; ')}</div>`:''; }
function nmOpen(p){ S.nm.ed = { ...NM_EMPTY(), ...p, category_id: p.category_id??'', cost: p.cost??'', supplier: p.supplier||'', sites: p.sites||[] }; S.nm.sq=''; S.nm.sfound=[]; render(); }
async function nmSave(){
  const e = S.nm.ed; if(!e) return;
  const { data, error } = await sb.rpc('product_save', { p: { ...e, sites: undefined } });
  if(error) return toast(errText(error));
  toast(e.id ? 'Сохранено' : 'Товар создан, штрихкод '+data.barcode);
  e.id = data.id; e.barcode = data.barcode;
  const row = [e.id, e.barcode, e.sku||'', e.name, Number(e.price), e.photo_url||'', e.category_id||null];
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
const SITE_ST = [['review','Проверить'],['auto','Связано автоматически'],['confirmed','Подтверждено'],['siteonly','Только на сайте — нет в базе'],['baseonly','Только в базе — нет на сайте']];
const SITE_NAME = { moon:'mooncollection.kz', sunshine:'sunshinejewelry.kz' };
async function loadSite(){
  const f = S.st; f.data = null;
  if(!f.parts || f.partsSite!==f.site){ const r = await sb.rpc('site_parts', { p_site:f.site }); f.parts = r.data || []; f.partsSite = f.site; if(!f.parts.some(x=>x.part===f.part)) f.part = null; }
  const bo = f.status==='baseonly';
  const [{ data, error }, b] = await Promise.all([
    sb.rpc('site_list', { p_site:f.site, p_status:bo?'review':f.status, p_q:f.q.trim(), p_offset:f.off, p_limit:bo?0:50, p_part:f.part||null }),
    sb.rpc('site_base_only', { p_site:f.site, p_q:f.q.trim(), p_offset:f.off, p_limit:bo?50:0 }) ]);
  if(error){ toast(errText(error)); f.data = { rows:[], counts:{} }; } else f.data = data;
  f.baseTotal = b.data ? b.data.total : 0; f.base = bo && b.data ? b.data.rows : [];
}
function siteImg(u){ return u ? `<img class="thumb" style="width:64px;height:64px" src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="" loading="lazy" onerror="if(this.dataset.full&&this.src!==this.dataset.full)this.src=this.dataset.full">` : '<span class="thumb" style="width:64px;height:64px"></span>'; }
function renderSite(){
  const f = S.st, D = f.data, c0 = k => (D && D.counts && D.counts[f.site+':'+k]) || 0;
  const cnt = k => k==='siteonly' ? c0('none')+c0('rejected') : k==='baseonly' ? (f.baseTotal||0) : c0(k);
  $('#main').innerHTML = `<h2>Сайт ↔ база товаров</h2>
    <p class="meta">Слева карточка с сайта, справа товар из базы, с которым она связана. Через эту связь на сайт пойдут остатки, а в кассу — фото. Несколько карточек сайта можно связать с одним товаром базы — например, все разные серьги за 3 500 ₸ с общим штрихкодом «Серьги 3500».</p>
    ${isBoss()&&!isViewer()?`<div class="row" style="justify-content:flex-start;margin-bottom:8px"><button class="btn small" id="st-grp">🔗 Связать несвязанные с общими штрихкодами (по типу и цене)</button></div>`:''}
    <div class="filters">${Object.entries(SITE_NAME).map(([k,v])=>`<button class="btn small ${f.site===k?'primary':''}" data-stsite="${k}">${v}</button>`).join('')}</div>
    <div class="filters">${SITE_ST.map(([k,v])=>`<button class="btn small ${f.status===k?'primary':''}" data-ststatus="${k}">${v} · ${cnt(k)}</button>`).join('')}
      <input id="st-q" placeholder="Поиск: название или штрихкод" value="${esc(f.q)}" style="flex:1;min-width:200px"></div>
    <div class="filters"><select id="st-part" aria-label="Категория на сайте"><option value="">Все категории сайта</option>${(f.parts||[]).map(x=>`<option value="${esc(x.part)}" ${f.part===x.part?'selected':''}>${esc(x.name || 'Без названия: '+(x.sample||[]).slice(0,2).join(', '))} · ${x.n}</option>`).join('')}</select>
      ${f.part?(()=>{ const P = (f.parts||[]).find(x=>x.part===f.part); return P && /^\d+$/.test(P.part) ? `<input id="st-part-name" placeholder="Назовите раздел, например «Авторская работа»" value="${esc(P.name||'')}" style="min-width:240px"><button class="btn small" id="st-part-save">Сохранить название</button>` : ''; })():''}</div>
    ${f.status==='baseonly' ? siteBaseOnlyHtml(f) : !D?'<div class="empty">Загружаем…</div>':!D.rows.length?'<div class="empty">Здесь пусто</div>':D.rows.map(r=>{ const key=r.site+':'+r.uid, open=f.open===key;
      return `<div class="card" style="margin-bottom:8px">
      <div class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:center">
        <div class="row" style="justify-content:flex-start;align-items:flex-start">${siteImg(r.photo)}<div><b>${esc(r.title)}</b><br><span class="meta">${esc(r.part||'')}</span><br><span class="num">${fmt(r.price)}</span>
          ${r.url?` · <a href="${esc(r.url)}" target="_blank" rel="noopener">на сайте</a>`:''}</div></div>
        <div class="row" style="justify-content:flex-start;align-items:flex-start">${r.product_id?`${siteImg(r.p_photo)}<div><b>${esc(r.p_name)}</b><br><span class="meta num">${esc(r.p_barcode)}</span><br>
          <span class="num" style="${+r.p_price!==+r.price?'color:var(--bad)':''}">${fmt(r.p_price)}${+r.p_price!==+r.price?' — цена отличается':''}</span>${r.score!=null&&r.status!=='confirmed'?` <span class="chip">сходство ${Math.round(r.score*100)}%</span>`:''}</div>`
          :'<div class="meta">Не связан с базой</div>'}</div>
      </div>
      <div class="row" style="justify-content:flex-end;flex-wrap:wrap;margin-top:8px">
        ${r.product_id&&r.status!=='confirmed'?`<button class="btn small primary" data-stok="${key}" data-pid="${r.product_id}">Верно</button>`:''}
        <button class="btn small" data-stopen="${key}">${open?'Скрыть':'Выбрать другой товар'}</button>
        ${!r.product_id&&isBoss()&&!isViewer()?`<button class="btn small" data-stgrp="${key}" title="Связать с общим штрихкодом того же типа и цены, например «Серьги 3500»">Общий штрихкод</button>`:''}
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
function siteBaseOnlyHtml(f){
  const L = f.base || [];
  return `<p class="meta">Товары из базы, у которых нет карточки на сайте ${esc(SITE_NAME[f.site]||f.site)}. Сверху — те, что есть в наличии. Если карточка на сайте всё-таки есть — нажмите «Найти на сайте» и свяжите.</p>
  ${!f.data?'<div class="empty">Загружаем…</div>':!L.length?'<div class="empty">Здесь пусто</div>':`<div class="scroll"><table><thead><tr><th></th><th>Товар</th><th>Категория</th><th>Штрихкод</th><th>Цена</th><th>Остаток</th><th></th></tr></thead><tbody>
  ${L.map(p=>`<tr><td>${thumb(p)}</td><td><b>${esc(p.name)}</b>${p.is_group?' <span class="chip">общий штрихкод</span>':''}</td><td>${esc(p.category||'—')}</td><td class="num">${esc(p.barcode)}</td><td class="num">${fmt(p.price)}</td>
    <td class="num">${p.stock>0?'<span class="chip ok">'+p.stock+'</span>':'<span class="meta">0</span>'}</td>
    <td style="white-space:nowrap">${wiponOk()&&!isViewer()?`<button class="btn small" data-stbfind="${p.id}">${f.bfind===p.id?'Скрыть':'Найти на сайте'}</button>
      ${p.is_group?`<button class="btn small" data-stbgrp="${p.id}" data-on="0" title="Снять отметку">✓ общий штрихкод</button>`:`<button class="btn small" data-stbgrp="${p.id}" data-on="1" title="Под этим штрихкодом много разных изделий одной цены">Отметить как общий штрихкод</button>`}`:''}</td></tr>
    ${f.bfind===p.id?`<tr><td></td><td colspan="6"><div class="cust stack" style="gap:4px"><input id="st-bq" placeholder="Название карточки на сайте" value="${esc(f.bq||'')}" autocomplete="off">
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
    toast(on ? (data.linked ? `Отмечен как общий штрихкод и сразу связан с ${data.linked} карточками сайта той же цены` : 'Отмечен как общий штрихкод. Карточек сайта с такой же ценой и типом пока не нашлось') : 'Отметка снята'); await loadSite(); render(); }
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
function renderCash(){
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
   <h2>Журнал</h2>${isBoss()?storeFilterHtml():''}
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
async function wuLoadLast(){ const { data } = await sb.rpc('wipon_last'); WU.last = data || {}; if(['sales','stock'].includes(S.view)) render(); }
const wuDt = v => v ? new Date(v).toLocaleString('ru-RU',{ day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Almaty' }) : '—';
const wiponOk = () => S.me && (['owner','manager','purchaser'].includes(S.me.role));
function wiponUpHtml(kind){
  if(!wiponOk()) return '';
  const st = WU.store || S.store, L = WU.last || {}, last = id => L[kind+':'+id];
  if(!WU.last && !WU.loading){ WU.loading = true; wuLoadLast().finally(()=>{ WU.loading = false; }); }
  const allAt = S.allStores.map(x=>last(x.id)&&last(x.id).at).filter(Boolean).sort();
  return `<details class="card" style="margin-bottom:10px" ${WU.open===kind?'open':''} data-wuopen="${kind}"><summary><b>⬆ ${kind==='sales'?'Загрузить продажи из Wipon':'Обновить остатки из Wipon'}</b> <span class="meta">— последняя загрузка: ${allAt.length?wuDt(allAt[allAt.length-1]):'—'}</span></summary>
    <div class="scroll" style="margin-top:8px"><table><thead><tr><th>Магазин</th><th>Последняя загрузка</th>${kind==='sales'?'<th>Продажи в Silver по</th>':''}<th>Кто загрузил</th></tr></thead><tbody>
      ${S.allStores.map(x=>{ const l = last(x.id); return `<tr><td>${esc(BRAND[x.brand]+' · '+x.address)}</td><td class="num">${l?wuDt(l.at):'—'}</td>${kind==='sales'?`<td class="num">${l&&l.to?wuDt(l.to):'—'}</td>`:''}<td>${l&&l.by?esc(l.by):'<span class="meta">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="stack" style="margin-top:8px">
      <span class="meta">${kind==='sales'?'Выгрузите продажи магазина из Wipon за любой период и загрузите файл. Дубликатов не будет: Silver проверяет номер каждого чека Wipon и добавляет только те, которых ещё нет. Даже если тот же файл или пересекающийся период загрузят случайно ещё раз — повторные чеки просто пропустятся.':'Выгрузите остатки магазина из Wipon и загрузите файл. Остатки этого магазина в Silver станут такими же, как в файле. Новые штрихкоды добавятся в базу товаров.'}</span>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
        <select id="wu-store-${kind}">${kind==='sales'?`<option value="" ${!WU.storeSales?'selected':''}>Магазин определить автоматически</option>`:`<option value="" ${!WU.store?'selected':''}>Магазин определить автоматически</option>`}${S.allStores.map(x=>`<option value="${x.id}" ${x.id===(kind==='sales'?WU.storeSales:WU.store)?'selected':''}>${esc(BRAND[x.brand]+' · '+x.city+', '+x.address)}</option>`).join('')}</select>
        ${kind==='stock'?`<label class="meta"><input type="checkbox" id="wu-zero" checked> товары, которых нет в файле, обнулить</label>`:''}
        <label class="btn small primary" style="cursor:pointer">Выбрать файлы Excel (можно сразу все 7)<input type="file" id="wu-file-${kind}" accept=".xlsx,.xls,.csv" multiple hidden></label></div>
      <span class="meta">${kind==='sales'?'Магазин Silver определяет сам — по продавцу в Wipon и по уже загруженным чекам.':'Склад Silver определяет сам — сравнивает остатки в файле с остатками каждого магазина и выбирает самый похожий.'} Если не получится, напишет, и тогда выберите магазин вручную и загрузите тот файл ещё раз.</span>
      ${WU.open===kind&&WU.msg?`<div class="cust">${WU.msg}</div>`:''}</div></details>`;
}
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
  return { H: A[hi].map(wuNorm), rows: A.slice(hi+1).filter(r => r && r.some(c => c!=null && c!=='')) };
}
async function wuImportMany(kind, files){
  const sel = $('#wu-store-'+kind).value; if(sel && files.length>1) toast('Файлов несколько — магазин для каждого Silver определит сам'); if(kind==='sales') WU.storeSales = sel ? +sel : null; else WU.store = sel ? +sel : null; WU.open = kind; const out = [];
  for(let k=0; k<files.length; k++){ WU.pre = files.length>1 ? `Файл ${k+1} из ${files.length} «${esc(files[k].name)}»: ` : ''; await wuImport(kind, files[k], sel && files.length===1 ? +sel : null); out.push(WU.msg); }
  WU.pre = ''; WU.msg = out.join('<br>'); await wuLoadLast(); render();
}
async function wuImport(kind, file, forceStore){
  let store = forceStore || null; const zero = !!($('#wu-zero')||{}).checked; WU.open = kind; WU.msg = (WU.pre||'')+'Читаем файл…'; render();
  try{
    const { H, rows } = await wuRead(file), name = c => c>=0 ? H[c] : '—';
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
      if(!store){ const emps = [...new Set(R.map(r=>r.emp).filter(Boolean).map(String))];
        const { data:det, error:de } = await sb.rpc('wipon_detect_store', { p_nos: nos.slice(0, 3000), p_emps: emps }); if(de) throw de;
        if(!det || !det.store) throw new Error(`не удалось понять, какой это магазин (продавцы в файле: ${esc(emps.join(', ')||'не указаны')}). Выберите магазин в списке и загрузите этот файл ещё раз.`);
        store = det.store; WU.pre = (WU.pre||'') + `${esc(storeName(store))} (определён ${det.how}) — `; }
      WU.msg = (WU.pre||'')+`нашли ${nos.length} чеков (${R.length} строк) за ${dates[0].slice(0,10)} — ${dates[dates.length-1].slice(0,10)}. Загружаем…`; render();
      const tot = { new:0, skipped:0, returns:0, new_products:0 };
      for(let i=0; i<nos.length; i+=400){
        const part = new Set(nos.slice(i, i+400)), { data, error } = await sb.rpc('wipon_sales_import', { p_store:store, p_rows: R.filter(r=>part.has(r.no)) });
        if(error) throw error; for(const k in tot) tot[k] += +(data||{})[k]||0;
        WU.msg = (WU.pre||'')+`загружаем… ${Math.min(i+400, nos.length)} из ${nos.length} чеков`; render();
      }
      WU.msg = (WU.pre||'')+`✅ ${esc(storeName(store))}: новых чеков ${tot.new}${tot.returns?', из них с возвратом '+tot.returns:''}; уже были в Silver и пропущены — ${tot.skipped}.${tot.new_products?` Новых товаров добавлено в базу: ${tot.new_products} (проверьте их в «Номенклатуре»).`:''}`;
      if(S.view==='sales'){ await loadSales(); }
    } else {
      const K = { bc: wuCol(H, ['штрих']), nm: wuCol(H, ['наимен','товар','назван'], ['штрих','катег']), qty: wuCol(H, ['остат','колич','кол-во'], ['сумм','стоим']),
        cost: wuCol(H, ['себестоим','закуп']), price: wuCol(H, ['розн','цена прод','цена'], ['закуп','себест']), cat: wuCol(H, ['категор']) };
      if(K.bc<0 || K.qty<0) throw new Error(`Не нашлись колонки штрихкода или остатка (штрихкод: ${name(K.bc)}, остаток: ${name(K.qty)}). Пришлите файл в чат — я подстрою загрузку.`);
      const R = rows.map(r => ({ bc: String(r[K.bc]??'').trim(), name: K.nm>=0 ? r[K.nm] : null, qty: wuNum(r[K.qty]), cost: K.cost>=0 ? wuNum(r[K.cost]) || null : null, price: K.price>=0 ? wuNum(r[K.price]) || null : null, cat: K.cat>=0 ? r[K.cat] : null }))
        .filter(r => r.bc);
      if(!R.length) throw new Error('В файле нет строк с товарами');
      if(!store){ const { data:det, error:de } = await sb.rpc('wipon_stock_detect', { p_rows: R.map(r=>({ bc:r.bc, qty:r.qty })) }); if(de) throw de;
        const sc = (det && det.scores) || [], a = sc[0], b = sc[1];
        if(!a || a.exact < 10 || (b && a.exact < b.exact * 1.5)) throw new Error('не удалось уверенно понять, какой это склад. Выберите магазин в списке и загрузите этот файл ещё раз.');
        store = a.store; WU.pre = (WU.pre||'') + `${esc(storeName(store))} (определён по остаткам: совпало ${a.exact} позиций) — `; }
      WU.msg = (WU.pre||'')+`нашли ${R.length} позиций, ${R.reduce((a,r)=>a+r.qty,0)} шт. Обновляем остатки…`; render();
      const { data, error } = await sb.rpc('wipon_stock_import', { p_store:store, p_rows:R, p_zero_missing: zero });
      if(error) throw error;
      WU.msg = (WU.pre||'')+`✅ остатки обновлены · ${esc(storeName(store))}: позиций в файле ${data.positions} (${data.units} шт.), изменилось ${data.changed}${data.zeroed?', обнулено отсутствующих в файле '+data.zeroed:''}.${data.new_products?` Новых товаров добавлено в базу: ${data.new_products}.`:''}`;
      if(S.view==='stock'){ await loadStockView(); }
    }
  }catch(e){ WU.msg = (WU.pre||'')+'❌ '+esc(errText(e)); }

}
document.addEventListener('change', async e => { const id = e.target.id||'';
  if(['sf-from','sf-to','sf-kind'].includes(id)){ const F = (S.sf ||= { from:'', to:'', kind:'', lim:100 }); F[id.slice(3)] = e.target.value; F.lim = 100; await loadSales(); render(); return; }
  const m = id.match(/^wu-file-(sales|stock)$/); if(m && e.target.files[0]){ const F = [...e.target.files]; e.target.value=''; wuImportMany(m[1], F); }
  if(id==='wu-store-sales') WU.storeSales = e.target.value ? +e.target.value : null; else if(id==='wu-store-stock') WU.store = e.target.value ? +e.target.value : null; });
document.addEventListener('toggle', e => { const d = e.target; if(d.dataset && d.dataset.wuopen){ WU.open = d.open ? d.dataset.wuopen : (WU.open===d.dataset.wuopen ? null : WU.open); } }, true);
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
    ${!L?'<div class="empty">Загружаем…</div>':`<p class="meta">Найдено: ${n(L.total)}</p>
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
const PO = { mode:'orders', filter:'open', list:null, sug:null, an:null, anPer:'month', q:'', found:[], d:null };
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
  if(PO.mode==='suggest'){ const { data, error } = await sb.rpc('po_suggest', { p_days:30 }); if(error) toast(errText(error)); PO.sug = data||[]; }
  if(PO.mode==='an'){ const now = new Date(), iso = x => x.toLocaleDateString('sv-SE'); const from = PO.anPer==='month' ? new Date(now.getFullYear(), now.getMonth(), 1) : PO.anPer==='q' ? new Date(now.getFullYear(), now.getMonth()-2, 1) : new Date(now.getFullYear(), 0, 1);
    const { data, error } = await sb.rpc('po_analytics', { p_from: iso(from), p_to: iso(now) }); if(error) toast(errText(error)); PO.an = data||{}; }
}
function renderPo(){
  const modes = [['orders','Заказы'],['new','Новый заказ'],['suggest','Что дозаказать'],['an','Аналитика закупа']].filter(([k])=>poEdit() || k!=='new');
  const head = `<div class="row" style="flex-wrap:wrap"><h2>Закуп</h2><span class="row" style="gap:6px">${(PO.list||[]).some(o=>(o.supplier&&/[\u4e00-\u9fff]/.test(o.supplier)&&!o.supplier_ru)||(o.items||[]).some(i=>i.supplier_title&&!i.title_ru))?`<button class="btn small" id="po-tr">🌐 Перевести названия на русский</button>`:''}${poEdit()?`<label class="btn small" style="cursor:pointer">⬆ Загрузить заказы из Китая (Excel)<input type="file" id="po-1688" accept=".xlsx,.xls,.csv" hidden></label>`:''}</span></div>
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
      return `<div class="card" style="margin-bottom:10px"><div class="row" style="flex-wrap:wrap"><b>${poBulkOk()&&['ordered','transit'].includes(o.status)?`<input type="checkbox" data-posel="${o.id}" ${(PO.sel||{})[o.id]?'checked':''} style="margin-right:6px" aria-label="Выбрать заказ">`:''}№${o.number} · ${esc(o.supplier||'поставщик не указан')}${o.supplier_ru?` <span style="font-weight:400">(${esc(o.supplier_ru)})</span>`:''} → ${o.store?esc(storeName(o.store)):'<span class="meta">магазин выберете при приёмке</span>'}</b><span class="chip ${PO_ST[o.status][0]}">${PO_ST[o.status][1]}${o.status==='received'&&!o.receipt_id&&o.source==='1688'?' · история':''}</span></div>
        ${o.source==='1688'?`<div class="meta">Китай, заказ №${esc(o.ext_no)}${o.track?' · трек '+esc(o.track):''}</div>`:''}
        <div class="meta">заказ от ${dshort(o.created_at)}${o.eta?' · ждём к '+dshort(o.eta):''}${o.shipped_at?' · отправлен '+dshort(o.shipped_at):''}${o.received_at?' · получен '+dshort(o.received_at):''} · ${esc(o.by||'')}${o.note?' · '+esc(o.note):''}</div>
        <div class="scroll"><table><tbody>${(o.items||[]).map(i=>poItemRow(o,i)).join('')}</tbody></table></div>
        ${PO.rcv&&PO.rcv.id===o.id?poRcvHtml(o):''}
        <div class="row" style="flex-wrap:wrap"><span class="meta">${units} шт. · товар ${fmt(goods)}${o.currency&&o.currency!=='KZT'?' (курс заказа '+o.currency+' '+(+o.rate).toFixed(2)+')':''}${+o.cargo?' · доставка по Китаю '+(+o.cargo).toLocaleString('ru-RU')+' '+(CUR[o.currency]||'₸'):''} · +${o.delivery_pct??10}% доставка до Казахстана</span>
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
  if(PO.mode==='suggest'){
    const L = PO.sug;
    body = `<p class="meta">Все товары, которые продавались за последние 30 дней и которых по сети не хватит на следующие 30 дней, — по скорости продаж, сверху самые ходовые. Учтено то, что уже заказано и едет. Если товар не нужен или сезон прошёл — просто не заказывайте его.</p>
    ${!L?'<div class="empty">Считаем…</div>':!L.length?'<div class="empty">Всего хватает</div>':`<div class="scroll"><table><thead><tr><th></th><th>Товар</th><th>Продано за 30 дн.</th><th>Остаток</th><th>Заказано / в пути</th><th>Дозаказать</th><th></th></tr></thead><tbody>
      ${L.map(p=>`<tr><td>${thumb(p)}</td><td>${esc(p.name)}<br><span class="meta num">${esc(p.barcode)}${p.cost?' · закуп '+fmt(p.cost):''}</span>${p.purchase_url?` · <a href="${esc(p.purchase_url)}" target="_blank" rel="noopener" class="meta">ссылка</a>`:''}</td>
        <td class="num">${p.sold30}</td><td class="num" ${p.stock<=0?'style="color:var(--bad)"':''}>${p.stock}${p.days_left!=null?`<br><span class="meta">хватит на ${p.days_left} дн.</span>`:''}</td><td class="num">${p.incoming||'—'}</td><td class="num"><b>${p.need}</b></td>
        <td>${poEdit()?`<button class="btn small" data-posug="${p.id}" data-need="${p.need}" data-cost="${p.cost??''}">В заказ</button>`:''}</td></tr>`).join('')}</tbody></table></div>`}`;
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
function renderProfit(){
  const D = PF.data, [f,t] = pfRange(), sum = o => Object.values(o||{}).reduce((a,v)=>a+ +v,0);
  const rows = (D||[]).map(r => { const gross = r.revenue - r.cogs, tax = r.tax ?? Math.round(Math.max(r.revenue,0)*0.03), cash = sum(r.cash), fixed = sum(r.fixed), net = gross - tax - r.wages - cash - fixed;
    return { ...r, tax, gross, cashT:cash, fixedT:fixed, net, margin: r.revenue ? net/r.revenue*100 : 0 }; });
  const T = rows.reduce((a,r)=>{ for(const k of ['revenue','cogs','gross','tax','wages','cashT','fixedT','net','purchases']) a[k]=(a[k]||0)+r[k]; return a; }, {});
  T.margin = T.revenue ? T.net/T.revenue*100 : 0;
  const cell = (v, neg) => `<td class="num" ${neg&&v<0?'style="color:var(--bad)"':''}>${fmt(v)}</td>`;
  const lines = [['Выручка','revenue'],['Себестоимость проданного','cogs',-1],['Валовая прибыль','gross'],[`Налог ${(D&&D[0]&&D[0].tax_rate)||3}% с выручки`,'tax',-1],['Зарплата (по табелю)','wages',-1],['Расходы из кассы','cashT',-1],['Аренда и постоянные расходы','fixedT',-1],['Чистая прибыль','net'],['Рентабельность','margin']];
  const per = [['month','Этот месяц'],['prev','Прошлый месяц'],['q','3 месяца'],['year','С начала года'],['custom','Свой период']];
  $('#main').innerHTML = `<h2>Рентабельность магазинов</h2>${storeFilterHtml()}
  <div class="filters">${per.map(([k,v])=>`<button class="btn small ${PF.per===k?'primary':''}" data-pfper="${k}">${v}</button>`).join('')}
    ${PF.per==='custom'?`<input type="date" id="pf-from" value="${f}"><input type="date" id="pf-to" value="${t}">`:''}<span class="meta" style="align-self:center">${new Date(f).toLocaleDateString('ru-RU')} — ${new Date(t).toLocaleDateString('ru-RU')}</span></div>
  ${!D?'<div class="empty">Считаем…</div>':`<div class="scroll"><table><thead><tr><th></th>${rows.map(r=>`<th>${esc(storeName(r.store))}</th>`).join('')}${rows.length>1?'<th>Итого</th>':''}</tr></thead><tbody>
    ${lines.map(([t,k,sign])=>`<tr ${['gross','net'].includes(k)?'style="font-weight:700"':''}><td>${t}</td>${rows.map(r=>k==='margin'?`<td class="num" style="font-weight:700;color:${r.margin<0?'var(--bad)':'var(--ok)'}">${r.margin.toFixed(1)}%</td>`:cell(sign?-r[k]:r[k], k==='net')).join('')}${rows.length>1?(k==='margin'?`<td class="num" style="font-weight:700">${T.margin.toFixed(1)}%</td>`:cell(sign?-T[k]:T[k], k==='net')):''}</tr>`).join('')}
    <tr><td class="meta">Закуп по приёмке (справочно)</td>${rows.map(r=>`<td class="num meta">${fmt(r.purchases)}</td>`).join('')}${rows.length>1?`<td class="num meta">${fmt(T.purchases)}</td>`:''}</tr>
  </tbody></table></div>
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
  const D0 = PY.data, D = D0 && PYF.official ? D0.filter(e=>e.official) : D0, tabel = S.me && ['owner','manager'].includes(S.me.role) && !isViewer();
  const total = (D||[]).reduce((a,e)=>a+e.total,0);
  const stEmps = (S.emps||[]).filter(e => e.active && (!e.store_ids || !e.store_ids.length || e.store_ids.includes(+PY.store)));
  $('#main').innerHTML = `<div class="row"><h2>${isBoss()?'Зарплата':'Моя зарплата'}</h2><label class="meta">Месяц <input type="month" id="py-month" value="${PY.month}"></label></div>
  ${isBoss()?storeFilterHtml():''}
  ${isBoss()?`<div class="filters"><label class="chip ${PYF.official?'ok':''}" style="cursor:pointer;padding:4px 10px"><input type="checkbox" id="py-official" ${PYF.official?'checked':''} style="margin-right:4px">только официально трудоустроенные</label>
    ${D?`<span class="meta" style="align-self:center">На карту ${PYF.official?'официальным':'всем'} за месяц: <b>${fmt(D.reduce((a,e)=>a+paySum(e).by('card'),0))}</b></span>`:''}</div>`:''}
  <div class="card meta" style="margin-bottom:8px">💰 ${advanceText(PY.month)}</div>
  <p class="meta">Предварительный расчёт по продажам в кассе и табелю часов. Правила: ${['Курмангазы, Толе би, Гагарина — 12/10% по часам','MOON Курмангазы — 5%','Астана — 6% Sunshine, 3% MOON'].join(' · ')}.</p>
  <div class="grid2"><div>
   ${!D?'<div class="empty">Считаем…</div>':!D.length?'<div class="empty">За этот месяц нет часов в табеле</div>':`<div class="scroll"><table><thead><tr><th>Сотрудник</th><th>Часы</th><th>Начислено</th><th>Бонусы / удержания</th><th>К выплате</th><th>Выплачено наличными</th><th>На карту</th><th>Остаток</th></tr></thead><tbody>
     ${D.map(e=>{ const P = paySum(e), open = PY.open===e.employee || D.length===1; return `<tr><td><button class="btn small" data-pyopen="${e.employee}" style="border:0;background:none;padding:0;font-weight:600">${open?'▾':'▸'} ${esc(e.name)}</button>${e.official?' <span class="chip ok" title="Официально трудоустроен">офиц.</span>':''}</td><td class="num">${e.hours}</td><td class="num">${fmt(e.total)}</td>
       <td class="num">${P.plus?'+'+fmt(P.plus):''}${P.plus&&P.minus?'<br>':''}${P.minus?'<span style="color:var(--bad)">−'+fmt(P.minus)+'</span>':''}</td><td class="num"><b>${fmt(P.due)}</b></td><td class="num">${P.paid-P.by('card')?fmt(P.paid-P.by('card')):''}</td><td class="num">${P.by('card')?fmt(P.by('card')):''}</td>
       <td class="num" style="color:${P.rest<0?'var(--bad)':P.rest>0?'inherit':'var(--ok)'}"><b>${P.rest<0?'переплата '+fmt(-P.rest):fmt(P.rest)}</b></td></tr>
       ${open?`<tr><td colspan="8" style="padding:0 0 10px">
         ${e.days.length?`<table style="margin:0 0 6px"><tbody>${e.days.map(payLine).join('')}</tbody></table>`:''}
         <div class="cust stack" style="gap:6px"><b>Расчёт</b>
           <div class="row"><span>Начислено по продажам</span><span class="num">${fmt(e.total)}</span></div>
           ${P.A.map(a=>`<div class="row"><span>${PADJ[a.kind][0]}${a.note?' <span class="meta">— '+esc(a.note)+'</span>':''} <span class="meta">${dshort(a.at)}</span></span><span class="num">${PADJ[a.kind][1]>0?'+':'−'}${fmt(a.amount)}${tabelOk()?` <button class="btn small" data-padel="${a.id}" title="Удалить">✕</button>`:''}</span></div>`).join('')}
           <div class="row" style="border-top:1px solid var(--line);padding-top:6px"><b>${P.rest<0?'Переплата (учесть в следующем месяце)':'Остаток к выплате'}</b><b class="num">${fmt(Math.abs(P.rest))}</b></div>
           ${P.by('card')?`<div class="meta">из них переведено на карту: ${fmt(P.by('card'))}</div>`:''}
           ${tabelOk()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
             <select id="pa-kind-${e.employee}">${Object.entries(PADJ).filter(([k])=>k!=='fine').map(([k,[t]])=>`<option value="${k}">${t}</option>`).join('')}</select>
             <input id="pa-amt-${e.employee}" class="small" type="number" min="1" inputmode="numeric" placeholder="сумма" style="width:110px">
             <input id="pa-note-${e.employee}" placeholder="комментарий" style="flex:1;min-width:120px">
             <button class="btn small primary" data-paadd="${e.employee}">Добавить</button>
             ${P.rest>0?`<button class="btn small" data-papayall="${e.employee}" data-rest="${Math.round(P.rest)}" data-kind="paid">Остаток ${fmt(P.rest)} наличными</button><button class="btn small" data-papayall="${e.employee}" data-rest="${Math.round(P.rest)}" data-kind="card">Остаток ${fmt(P.rest)} на карту</button>`:''}</div>`:''}
         </div></td></tr>`:''}`; }).join('')}
     ${D.length>1?(()=>{ const T = D.map(paySum).reduce((a,p)=>({due:a.due+p.due, cash:a.cash+p.paid-p.by('card'), card:a.card+p.by('card'), rest:a.rest+p.rest}),{due:0,cash:0,card:0,rest:0}); return `<tr><td><b>Итого</b></td><td></td><td class="num"><b>${fmt(total)}</b></td><td></td><td class="num"><b>${fmt(T.due)}</b></td><td class="num">${fmt(T.cash)}</td><td class="num">${fmt(T.card)}</td><td class="num"><b>${fmt(T.rest)}</b></td></tr>`; })():''}</tbody></table></div>`}
  </div><div>
   ${tabel?`<div class="card stack"><b>Табель часов</b>
     <div class="row" style="flex-wrap:wrap;justify-content:flex-start"><select id="py-store">${S.stores.map(s=>`<option value="${s.id}" ${+PY.store===s.id?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select><input type="date" id="py-day" value="${PY.day}"></div>
     <span class="meta">Правило: ${esc(payRuleText((PY.rules||{})[String(PY.store)]))}</span>
     ${(PY.sheet||[]).length?`<table><tbody>${PY.sheet.map(w=>`<tr><td>${esc(w.name)}${w.kind==='dress'?' <span class="chip">переодевание</span>':''}${w.status==='open'?` <span class="chip warn">на смене с ${esc(w.from||'')}</span>`:w.status==='pending'?` <span class="chip warn" title="Отмечено в Telegram, ждёт подтверждения менеджера">ждёт подтверждения</span>`:''}${w.from&&w.status!=='open'?`<br><span class="meta">${esc(w.from)}–${esc(w.to||'')} · из Telegram</span>`:''}</td>
       <td><input class="small" type="number" min="0" max="24" step="0.5" value="${w.hours}" data-pyh="${w.employee}:${w.kind}" inputmode="decimal"> ч</td>
       <td><button class="btn small" data-pydel="${w.employee}:${w.kind}">✕</button></td></tr>`).join('')}</tbody></table>`:'<span class="meta">На этот день в табеле никого нет. Тот, кто открывает смену, попадает в табель автоматически.</span>'}
     <div class="row" style="flex-wrap:wrap;justify-content:flex-start">
       <select id="py-emp"><option value="">Сотрудник…</option>${stEmps.map(e=>`<option value="${e.id}" ${PY.add.emp===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}</select>
       <input id="py-hours" class="small" type="number" min="0.5" max="24" step="0.5" placeholder="часы" value="${esc(PY.add.hours)}" inputmode="decimal">
       <select id="py-kind"><option value="sale" ${PY.add.kind==='sale'?'selected':''}>продажи</option><option value="dress" ${PY.add.kind==='dress'?'selected':''}>переодевание (1 200/ч)</option></select>
       <button class="btn primary" id="py-add">Добавить</button></div>
     <span class="meta">Консультанты отмечают приход и уход в Telegram-боте, вечером менеджеру приходит сводка «Подтвердить / Скорректировать». Изменение часов здесь сразу считается подтверждённым.</span>
   </div>${consHtml()}`:`<div class="card meta">Часы в табель ставит менеджер. Если вы видите ошибку в часах — напишите менеджеру.</div>`}
  </div></div>`;
}

/* ---------- доступ к вкладкам по ролям ---------- */
const ALL_TABS = [['pos','Продажа'],['analytics','Аналитика'],['shifts','Смены'],['cash','Расходы'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты'],['bonus','Бонусные карты'],['nom','Номенклатура'],['site','Сайт'],['emps','Сотрудники']];
const BOSS_ONLY = ['analytics','bonus','nom','site','emps'];
function defaultTabs(role){ const boss = ['manager','viewer','accountant'].includes(role);
  return ALL_TABS.map(([v])=>v).filter(v => (boss || !BOSS_ONLY.includes(v)) && !(['viewer','accountant'].includes(role) && v==='pos') && !(role==='viewer' && v==='emps')); }
function canEditTab(v){ if(!S.me || S.me.role==='owner') return true; const E=(S.tabEdit||{})[S.me.role]; return Array.isArray(E) ? E.includes(v) : true; }
function accessHtml(){
  if(S.me.role!=='owner') return '';
  const roles = ['manager','purchaser','viewer','accountant'], A = S.tabAccess || {};
  const has = (r,v) => Array.isArray(A[r]) ? A[r].includes(v) : defaultTabs(r).includes(v);
  const E = S.tabEdit || {}, can = (r,v) => has(r,v) && r!=='viewer' && (Array.isArray(E[r]) ? E[r].includes(v) : true);
  return `<div class="card stack" style="margin-top:16px"><b>Какие вкладки видит и может менять каждая роль</b>
    <p class="meta" style="margin:0">Владелец видит и меняет всё. В каждой ячейке две галочки: 👁 — вкладка видна (только смотреть), ✎ — можно и менять (кнопки сохранения, проведения и т.п.). Данные защищены и в базе: например, консультант не увидит выручку и закупочные цены, даже если открыть ему «Аналитику».</p>
    <div class="scroll"><table><thead><tr><th>Вкладка</th>${roles.map(r=>`<th>${ROLE[r]}<br><span class="meta">👁 смотреть · ✎ менять</span></th>`).join('')}</tr></thead><tbody>
    ${ALL_TABS.map(([v,t])=>`<tr><td>${t}</td>${roles.map(r=>`<td style="white-space:nowrap"><label title="Видит"><input type="checkbox" data-acc="${r}:${v}" ${has(r,v)?'checked':''} aria-label="${ROLE[r]}: ${t} — видит"> 👁</label>
      <label title="Может менять" style="margin-left:8px"><input type="checkbox" data-accedit="${r}:${v}" ${can(r,v)?'checked':''} ${has(r,v)&&r!=='viewer'?'':'disabled'} aria-label="${ROLE[r]}: ${t} — может менять"> ✎</label></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="row"><button class="btn small" id="acc-reset">Вернуть по умолчанию</button><span class="meta">Изменения сохраняются сразу; сотрудник увидит их после обновления страницы.</span></div></div>`;
}

async function loadEmps(){ const { data } = await sb.from('employees').select('*').order('created_at'); S.emps = data || []; }
function renderEmps(){
  const list = S.emps.filter(e => e.role!=='consultant');
  $('#main').innerHTML = `<h2>Сотрудники с доступом к Silver</h2>
    <p class="meta">Консультанты в программу не входят: они отмечают смены и смотрят зарплату в Telegram-боте. Их список, телефоны и магазины — во вкладке «Зарплата».</p>
    <div class="card stack" style="margin-bottom:12px"><b>Добавить сотрудника по телефону</b>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start">
        <input id="ne-phone" placeholder="+7 7__ ___ __ __" inputmode="tel"><input id="ne-name" placeholder="Имя и фамилия" style="flex:1;min-width:160px">
        <select id="ne-role">${Object.entries(ROLE).filter(([k])=>k!=='consultant'&&(k!=='owner'||S.me.role==='owner')).map(([k,v])=>`<option value="${k}" ${k==='manager'?'selected':''}>${v}</option>`).join('')}</select></div>
      <div><span class="meta">Магазины:</span> ${storesDD([], id=>`class="ne-store" value="${id}"`)}</div>
      <div class="row"><span class="meta">Сотрудник входит кнопкой «Войти через Telegram» и делится этим же номером в боте — пароль не нужен.</span><button class="btn primary" id="ne-add">Добавить</button></div></div>
    <div class="scroll"><table><thead><tr><th>Имя</th><th>Роль</th><th>Доступ к магазинам</th><th>Вход</th></tr></thead><tbody>
    ${list.map(e=>`<tr><td>${esc(e.full_name)}<br><input class="small" data-ephone="${e.id}" value="${esc(e.phone||'')}" placeholder="телефон не указан" inputmode="tel" style="width:150px;margin-top:4px"><br><span class="meta">${e.telegram_id?'Telegram ✓':''}${!e.auth_user_id?(e.telegram_id?' · ':'')+'ещё не входил':''}</span></td>
      <td><select data-erole="${e.id}">${Object.entries(ROLE).filter(([k])=>k!=='consultant').map(([k,v])=>`<option value="${k}" ${e.role===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td>${['owner','viewer'].includes(e.role)?'<span class="meta">все магазины</span>':(e.role==='manager'?'<div class="meta" style="max-width:240px">Видит все; отмеченные — подтверждает перемещения:</div>':'')+(()=>{ const ids=e.store_ids||(e.home_store_id?[e.home_store_id]:[]); return storesDD(ids, id=>`data-estores="${e.id}:${id}"`); })()}</td>
      <td><label><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''}> включён</label><br><label title="Официально трудоустроен — для бухгалтера"><input type="checkbox" data-eoff="${e.id}" ${e.official?'checked':''}> официально</label></td></tr>`).join('')}</tbody></table></div>${accessHtml()}`;
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
  else if(t.id==='c-sell') sellCert();
  else if(d.eact){ updEmp(d.eact, { active:t.checked }); }
  else if(d.eoff){ updEmp(d.eoff, { official:t.checked }); }
  else if(d.estores){ const [eid, sid] = d.estores.split(':'); const e = S.emps.find(x=>x.id===eid); if(e){ const cur = new Set(e.store_ids||(e.home_store_id?[e.home_store_id]:[])); t.checked ? cur.add(+sid) : cur.delete(+sid); e.store_ids=[...cur].sort((a,b)=>a-b); updEmp(eid, { store_ids: e.store_ids }); const sm=t.closest('details.dd'); if(sm) sm.querySelector('summary').textContent=ddSummary(e.store_ids); } }
  else if(d.sgroup){ const g=d.sgroup; S.sel = S.stores.filter(st => g==='all' || st.brand===g || st.city===g).map(st=>st.id); onSelChange(); }
  else if(d.sone){ const id=+d.sone; selStores(); S.sel = t.checked ? [...new Set([...S.sel, id])] : S.sel.filter(x=>x!==id); if(!S.sel.length) S.sel=[id]; onSelChange(); }
  else if(t.id==='nm-new'){ nmOpen({}); }
  else if(d.nmsort){ const f = S.nm, k = d.nmsort; if(f.sort===k) f.desc = !f.desc; else { f.sort = k; f.desc = ['cost','price','stock','site'].includes(k); } f.off = 0; render(); await loadNom(); render(); }
  else if(t.id==='nm-close'){ S.nm.ed=null; render(); }
  else if(t.id==='nm-save'){ t.disabled=true; await nmSave(); }
  else if(d.nmopen){ const p=(S.nm.data&&S.nm.data.rows||[]).find(r=>r.id===d.nmopen); if(p) nmOpen(p); }
  else if(d.nmpage){ S.nm.off=Math.max(0,S.nm.off+50*(+d.nmpage)); render(); await loadNom(); render(); }
  else if(d.nmlink||d.nmunlink){ const key=d.nmlink||d.nmunlink, [site,uid]=key.split(':');
    const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product: d.nmlink?S.nm.ed.id:null, p_status: d.nmlink?'confirmed':'rejected' });
    if(error) toast(errText(error)); else { toast(d.nmlink?'Связано с сайтом':'Отвязано'); S.nm.sq=''; S.nm.sfound=[]; await loadNom(); const fr=S.nm.data.rows.find(r=>r.id===S.nm.ed.id); if(fr) nmOpen(fr); else render(); } }
  else if(d.wook||d.wono){ t.disabled=true; const { data, error } = await sb.rpc('decide_writeoff', { p_id:d.wook||d.wono, p_approve:!!d.wook, p_note:null }); if(error){ toast(errText(error)); t.disabled=false; return; } toast(data); await loadWhSide(); render(); }
  else if(d.pomode){ PO.mode=d.pomode; render(); await loadPo(); render(); }
  else if(d.pofilter){ PO.filter=d.pofilter; PO.list=null; render(); await loadPo(); render(); }
  else if(d.poper){ PO.anPer=d.poper; PO.an=null; render(); await loadPo(); render(); }
  else if(d.poadd){ const p = PO.found.find(x=>x.id===d.poadd); const dd = PO.d || (PO.d=poNew()); if(p){ const ex = dd.items.find(i=>i.pid===p.id); if(ex) ex.qty++; else dd.items.push({ pid:p.id, name:p.name, barcode:p.barcode, qty:1, cost:'' }); } PO.q=''; PO.found=[]; render(); }
  else if(d.podel!=null){ PO.d.items.splice(+d.podel,1); render(); }
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
    if(!PO.cats){ const { data } = await sb.from('categories').select('id,name').order('name'); PO.cats = data||[]; }
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
  else if(t.id==='cert-q'){ S.certQ = t.value; render(); }
  else if(t.id==='cs-cat'){ CS.cat=t.value; }
  else if(t.id==='py-hours'){ PY.add.hours=t.value; }
  else if(t.id==='po-q'){ PO.q=t.value; PO.found = searchCatalog(PO.q); render(); }
  else if(t.id==='po-supplier' && PO.d){ PO.d.supplier=t.value; } else if(t.id==='po-cargo' && PO.d){ PO.d.cargo=t.value; } else if(t.id==='po-note' && PO.d){ PO.d.note=t.value; }
  else if(t.id==='pf-amount'){ PF.add.amount=t.value; } else if(t.id==='pf-note'){ PF.add.note=t.value; }
  else if(t.id==='cs-amount'){ CS.amount=t.value; } else if(t.id==='cs-comment'){ CS.comment=t.value; } else if(t.id==='cs-collector'){ CS.collector=t.value; }
  else if(t.id==='bk-q'){ BK.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ BK.off=0; await loadBonus(); render(); }, 400); }
  else if(t.id==='cf-q'){ S.cf.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ await loadCerts(); render(); }, 400); }
  else if(t.id==='nm-q'){ S.nm.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ S.nm.off=0; await loadNom(); render(); }, 400); }
  else if(d.nf && t.type!=='checkbox' && t.tagName!=='SELECT'){ S.nm.ed[d.nf]=t.value; }
  else if(t.id==='nm-sq'){ S.nm.sq=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ if(S.nm.sq.trim().length<2){ S.nm.sfound=[]; return render(); } const { data } = await sb.rpc('site_search', { p_q:S.nm.sq.trim() }); S.nm.sfound=data||[]; render(); }, 400); }
  else if(t.id==='st-q'){ S.st.q=t.value; clearTimeout(searchTimer); searchTimer=setTimeout(async()=>{ S.st.off=0; await loadSite(); render(); }, 400); }
  else if(t.id==='st-cq'){ S.st.cq=t.value; S.st.cfound=searchCatalog(t.value); render(); }
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
  if(e.target.id==='dq'){ e.preventDefault(); $('#dq-add').click(); }
  if(e.target.id==='phone'){ e.preventDefault(); lookupCustomer(); }
  if(e.target.id==='sq'){ e.preventDefault(); $('#sq-go').click(); }
  if(e.target.id==='cc'){ e.preventDefault(); $('#cc-go').click(); }
});
// при переключении вкладок подгружаем данные
document.addEventListener('click', async e => {
  const b = e.target.closest('nav.tabs button, nav.subtabs button'); if(!b) return;
  if(b.dataset.group){ const g = GROUPS.find(x=>x[0]===b.dataset.group), av = g[3].filter(v => (S.tabs||[]).some(t=>t[0]===v)); const last = (S.lastView||{})[g[0]]; S.view = av.includes(last) ? last : av[0]; }
  else S.view = b.dataset.view;
  render(); scrollTo(0,0); await loadView();
});
// данные для открытой вкладки (при переходе и после обновления страницы)
async function loadView(){
  if(S.view==='shifts'){ await loadShifts(); render(); }
  if(S.view==='sales'){ await loadSales(); render(); }
  if(S.view==='certs'){ await loadCerts(); render(); }
  if(S.view==='emps'){ await loadEmps(); render(); }
  if(S.view==='pay'){ render(); await loadPay(); render(); }
  if(S.view==='profit'){ render(); await loadProfit(); render(); }
  if(S.view==='po'){ render(); await loadPo(); render(); }
  if(S.view==='promo'){ render(); await loadPromos(); render(); }
  if(S.view==='me'){ render(); await loadMe(); render(); }
  if(S.view==='adm'){ render(); await loadAdm(); render(); }
  if(S.view==='flow'){ render(); await loadFlow(); render(); }
  if(S.view==='wh'){ if(!S.wmode) S.wmode=whModes()[0][0]; await loadWhSide(); render(); }
  if(S.view==='stock' && !S.stockRows.length){ await loadStockView(); render(); }
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
  const [a, c] = await Promise.all([sb.from('promotions').select('*').order('created_at',{ascending:false}), PR.cats ? null : sb.from('categories').select('id,name').order('name')]);
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
function renderAdm(){
  if(S.me.role!=='owner'){ $('#main').innerHTML = '<div class="empty">Нет доступа</div>'; return; }
  const L = AD.list, C = (L||[]).map(adCalc), sum = k => C.reduce((t,c)=>t+c[k],0), ep = L&&L[0] ? +L[0].ep_rate : 24.8;
  const num = (a,k,w=100) => `<input class="small" type="number" min="0" inputmode="numeric" value="${+a[k]||''}" data-adf="${a.id}:${k}" style="width:${w}px">`;
  $('#main').innerHTML = `<div class="row"><h2>Административный штат</h2><label class="meta">Месяц <input type="month" id="ad-month" value="${AD.month}"></label></div>
  <div class="card meta" style="margin-bottom:8px">💰 ${advanceText(AD.month)}</div>
  <p class="meta">🔒 Эту вкладку видите только вы. Официальная часть на карту считается по единому платежу (${ep}% от официальной ставки): работнику на руки ставка минус удержанная доля (ОПВ, ВОСМС, ИПН), налоги целиком платит компания. Остаток до управленческой суммы — наличными. Суммы сохраняются сразу при вводе.</p>
  ${!L?'<div class="empty">Загружаем…</div>':`<div class="scroll"><table><thead><tr><th>Сотрудник</th><th>Как считается</th><th>Начислено</th>${AD_F.slice(0,1).map(([,t])=>`<th>${t}</th>`).join('')}<th>К выплате</th><th>Офиц. ставка</th><th>На карту офиц.</th><th>Наличными</th>${AD_F.slice(1).map(([,t])=>`<th>${t}</th>`).join('')}<th>Остаток</th><th>Налоги ЕП</th><th></th></tr></thead><tbody>
    ${L.map((a,n)=>{ const c = C[n]; return `<tr><td><input value="${esc(a.name)}" data-adf="${a.id}:name" style="min-width:130px"><br><input value="${esc(a.position||'')}" data-adf="${a.id}:position" placeholder="должность" class="small" style="min-width:130px">${a.note?`<br><span class="meta">${esc(a.note)}</span>`:''}</td>
      <td><select data-adf="${a.id}:rule"><option value="fixed" ${a.rule!=='pct'?'selected':''}>оклад</option><option value="pct" ${a.rule==='pct'?'selected':''}>% от продаж</option></select><br>
        ${a.rule==='pct'?`${num(a,'pct',60)} % · <span class="meta">${(a.pct_stores||[1,2,3,6]).map(id=>esc((S.allStores.find(x=>x.id===id)||{}).address||id)).join(', ')}<br>продажи ${fmt(a.sales)}</span>`:num(a,'salary',110)}</td>
      <td class="num"><b>${fmt(a.accrued)}</b></td><td>${num(a,'bonus')}</td><td class="num"><b>${fmt(c.due)}</b></td>
      <td>${num(a,'official_base',100)}<br><label class="meta"><input type="checkbox" data-adf="${a.id}:all_card" ${a.all_card?'checked':''}> всё на карту</label></td>
      <td class="num">${fmt(c.card)}</td><td class="num">${fmt(c.cash)}</td><td>${num(a,'paid_cash')}</td><td>${num(a,'paid_card')}</td>
      <td class="num" style="color:${c.rest<0?'var(--bad)':c.rest>0?'inherit':'var(--ok)'}"><b>${c.rest<0?'переплата '+fmt(-c.rest):fmt(c.rest)}</b></td><td class="num">${fmt(a.tax)}</td>
      <td><button class="btn small" data-addel="${a.id}" title="Удалить">✕</button></td></tr>`; }).join('') || `<tr><td colspan="14" class="meta">В этом месяце пока никого нет — нажмите «Перенести с прошлого месяца» или добавьте сотрудника</td></tr>`}
    ${L.length>1?`<tr><td><b>Итого</b></td><td></td><td class="num">${fmt(L.reduce((t,a)=>t+(+a.accrued||0),0))}</td><td></td><td class="num"><b>${fmt(sum('due'))}</b></td><td></td><td class="num">${fmt(sum('card'))}</td><td class="num">${fmt(sum('cash'))}</td><td></td><td></td><td class="num"><b>${fmt(sum('rest'))}</b></td><td class="num">${fmt(L.reduce((t,a)=>t+(+a.tax||0),0))}</td><td></td></tr>`:''}</tbody></table></div>
  <p class="meta">Расход компании на административный штат за месяц: <b>${fmt(sum('cost'))}</b> (выплаты ${fmt(sum('due'))} + налоги ${fmt(L.reduce((t,a)=>t+(+a.tax||0),0))}).</p>`}
  <div class="card stack" style="margin-top:14px"><b>Добавить сотрудника</b>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px"><input id="ad-name" placeholder="Имя и фамилия"><input id="ad-pos" placeholder="Должность: бухгалтер, менеджер, СММ…"><input id="ad-sal" type="number" min="0" inputmode="numeric" placeholder="оклад, ₸" style="width:130px">
      <button class="btn primary" id="ad-add">Добавить</button><button class="btn" id="ad-copy" title="Перенести людей, оклады и правила с прошлого месяца">Перенести с прошлого месяца</button></div></div>`;
}
document.addEventListener('click', async e => {
  if(S.view!=='adm') return; const t = e.target.closest('button'); if(!t) return;
  if(t.id==='ad-add'){ const name = $('#ad-name').value.trim(); if(!name) return toast('Укажите имя');
    const { error } = await sb.rpc('admin_pay_save', { p:{ month:AD.month+'-01', name, position:$('#ad-pos').value.trim(), salary:$('#ad-sal').value } }); if(error) return toast(errText(error)); await loadAdm(); render(); }
  else if(t.id==='ad-copy'){ const { data, error } = await sb.rpc('admin_pay_copy', { p_month:AD.month+'-01' }); if(error) return toast(errText(error)); toast(data ? 'Перенесено: '+data : 'Нечего переносить'); await loadAdm(); render(); }
  else if(t.dataset.addel){ if(t.dataset.sure!=='1'){ t.dataset.sure='1'; t.textContent='Удалить?'; return; } const { error } = await sb.rpc('admin_pay_del', { p_id:t.dataset.addel }); if(error) return toast(errText(error)); await loadAdm(); render(); }
});
document.addEventListener('change', async e => {
  if(S.view!=='adm') return; const t = e.target;
  if(t.id==='ad-month'){ AD.month = t.value || AD.month; render(); await loadAdm(); render(); return; }
  if(!t.dataset.adf) return; const [id, k] = t.dataset.adf.split(':'), a = (AD.list||[]).find(x=>x.id===id); if(!a) return;
  a[k] = t.type==='checkbox' ? t.checked : t.value;
  const { error } = await sb.rpc('admin_pay_save', { p:{ ...a } }); if(error){ toast(errText(error)); return; }
  await loadAdm(); render();
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
  const step = (ico, t, main, sub, state, soon) => `<div class="fl-step ${soon?'soon':state||''}"><div class="fl-ico">${ico}</div><b>${t}</b><div class="fl-num">${main}</div><div class="meta">${sub}</div>${soon?'<span class="chip">скоро</span>':''}</div>`;
  const bar = (ok, no) => { const p = ok+no ? Math.round(ok/(ok+no)*100) : 0; return `<div class="fl-bar"><span style="width:${p}%"></span></div><div class="meta">${p}% готово · не хватает у ${nf(no)}</div>`; };
  const st = (ok,no) => { const p = ok+no ? ok/(ok+no) : 1; return p>=.85?'ok':p>=.5?'warn':'bad'; };
  const list = (L, cols) => `<div class="list" style="margin-top:6px">${L.map(p=>`<div class="prod" style="grid-template-columns:44px minmax(0,1fr) auto">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode||'')} · в наличии ${nf(p.qty)}${p.units?' · продано '+nf(p.units):''}</span><br>${p.no_photo?'<span class="chip zero">нет фото</span>':''}${p.no_card?'<span class="chip warn">карточка</span>':''}${p.no_site?'<span class="chip warn">нет на сайте</span>':''}</span><span class="price num">${cols==='retail'?fmt(p.retail):fmt(p.price)}</span></div>`).join('')}</div>`;
  $('#main').innerHTML = `<div class="row"><h2>Путь товара</h2><div class="seg">${[30,90].map(d=>`<button data-fldays="${d}" aria-pressed="${FL.days===d}">${d} дней</button>`).join('')}</div></div>
  ${storeFilterHtml()}
  ${!D?'<div class="empty">Считаем…</div>':`
  <div class="fl-chain">
    ${step('🧾','Заказано', nf(D.ordered.units)+' шт.', nf(D.ordered.pos)+' позиций у поставщиков', D.ordered.pos?'ok':'warn')}
    ${step('🚚','В пути из Китая', nf(D.transit.units)+' шт.', nf(D.transit.pos)+' позиций', D.transit.pos?'ok':'warn')}
    ${step('📥','Принято', nf(D.received.units)+' шт.', `${nf(D.received.pos)} позиций за ${D.days} дней`, D.received.pos?'ok':'warn')}
    ${(()=>{ const T = D.to_astana || { units:0, pos:0, docs:0 }, age = T.oldest ? Math.floor((Date.now()-new Date(T.oldest))/864e5) : 0;
      return step('🚛','В пути в Астану', nf(T.units)+' шт.', T.docs ? `${nf(T.pos)} позиций · ${nf(T.docs)} отправок${age?' · самая старая '+age+' дн.':''}` : 'сейчас ничего не едет', T.docs ? (age>4?'bad':'ok') : ''); })()}
    ${step('📷','Фото', nf(D.photo.ok), bar(D.photo.ok, D.photo.no), st(D.photo.ok, D.photo.no))}
    ${step('🏷','Карточка', nf(D.card.ok), bar(D.card.ok, D.card.no), st(D.card.ok, D.card.no))}
    ${step('🌐','На сайте', nf(D.site.ok), bar(D.site.ok, D.site.no), st(D.site.ok, D.site.no))}
    ${step('📣','Посты и контент-план','—','публикации в Instagram по плану на 2 недели','',true)}
    ${step('💰','Продано', nf(D.sold.units)+' шт.', `${nf(D.sold.checks)} чеков за ${D.days} дней`, 'ok')}
    ${step('🕸','Залежи 90+ дней', nf(D.stale.pos)+' поз.', fmt(D.stale.retail)+' в рознице', D.stale.pos?'bad':'ok')}
  </div>
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
  if(S.view!=='flow') return; const t = e.target.closest('button'); if(!t) return;
  if(t.dataset.fldays){ FL.days = +t.dataset.fldays; render(); await loadFlow(); render(); }
  else if(t.dataset.flgo){ const b = document.querySelector(`nav button[data-view="${t.dataset.flgo}"]`); S.view = t.dataset.flgo; const g = groupOf(S.view); (S.lastView ||= {})[g[0]] = S.view; render(); scrollTo(0,0);
    if(S.view==='po'){ await loadPo(); render(); } else if(S.view==='wh'){ if(!S.wmode) S.wmode=whModes()[0][0]; await loadWhSide(); render(); } else if(S.view==='site'){ await loadSite(); render(); } else if(S.view==='nom'){ await loadNom(); render(); } else if(S.view==='analytics'){ S.an=null; await loadAnalytics(); render(); } }
});


/* ---------- закуп: позиции, привязка к базе, приёмка с пересчётом себестоимости ---------- */
function poItemRow(o, i){
  const cur = CUR[o.currency||'KZT'] || '₸', open = ['ordered','transit'].includes(o.status), canLink = open && (poEdit() || (isBoss() && !isViewer()));
  const lnk = PO.lnk && PO.lnk.item===i.item_id;
  const cands = !i.product_id && canLink ? (i.candidates||[]) : [];
  return `<tr><td>${thumb(i)}</td><td>${i.product_id?`<b>${esc(i.name)}</b><br><span class="meta num">${esc(i.barcode||'')}</span>${i.title_ru?`<br><span class="meta">у поставщика: ${esc(i.title_ru)}</span>`:''}`:`<span class="chip zero">не связан с базой</span> <b>${esc(i.title_ru||i.supplier_title||'')}</b>${i.title_ru?`<br><span class="meta" lang="zh">${esc(i.supplier_title)}</span>`:''}`}
      ${cands.length?`<div class="meta" style="margin-top:4px">По этой же ссылке в базе ${cands.length===1?'есть товар':'есть товары'} — выберите нужный вариант:</div><div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:4px">${cands.map(p=>`<button class="btn small" data-polink="${i.item_id}:${p.id}" style="display:flex;gap:6px;align-items:center">${thumb(p)}<span style="text-align:left">${esc(p.name)}<br><span class="meta num">${esc(p.barcode)}</span></span></button>`).join('')}</div>`:''}
      ${i.spec?`<br><span class="meta">вариант: ${esc(i.spec)}</span>`:''}${i.purchase_url?` · <a href="${esc(i.purchase_url)}" target="_blank" rel="noopener" class="meta">у поставщика</a>`:''}
      ${canLink&&!i.product_id&&i.suggest?`<br><button class="btn small primary" data-polink="${i.item_id}:${i.suggest.id}">Связать с «${esc(i.suggest.name)}»</button>`:''}
      ${canLink&&!lnk&&!(PO.mk&&PO.mk.item===i.item_id)?`<br><span class="row" style="gap:6px;justify-content:flex-start">${i.product_id?`<button class="btn small" data-polink="${i.item_id}:" title="Связь ошибочная — снять">✕ Отменить связь</button>`:`<button class="btn small" data-polinkopen="${i.item_id}">Найти в базе</button>${isBoss()&&!isViewer()?`<button class="btn small" data-pocreate="${i.item_id}">+ Создать товар</button>`:''}`}</span>`:''}
      ${PO.mk&&PO.mk.item===i.item_id?poCreateHtml(o,i):''}
      ${lnk?`<div class="stack" style="gap:4px;margin-top:6px"><input id="po-lnk-q" placeholder="Штрихкод, артикул или название в нашей базе" value="${esc(PO.lnk.q)}" autocomplete="off">
        ${PO.lnk.found.slice(0,8).map(p=>`<button class="prod" data-polink="${i.item_id}:${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}</div>`:''}</td>
    <td class="num">${i.qty} шт.${i.received_qty!=null&&i.received_qty!==i.qty?'<br><span class="meta">получено '+i.received_qty+'</span>':''}</td>
    <td class="num">${i.price_cur!=null?(+i.price_cur).toLocaleString('ru-RU')+' '+cur:'—'}${i.unit_cost!=null&&o.currency!=='KZT'?'<br><span class="meta">≈ '+fmt(i.unit_cost)+'</span>':''}</td>
    <td class="num">${i.landed_cost!=null?'<b>'+fmt(i.landed_cost)+'</b><br><span class="meta">себестоимость</span>':''}</td></tr>`;
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
    PO.imp = `Готово: новых заказов ${tot.new}, обновлено ${tot.updated}. Позиций ${tot.items}, из них сразу связано с базой ${tot.linked}. Остальные свяжите при приёмке — Silver запомнит связь для следующих заказов.`;
    PO.mode = 'orders'; PO.filter = 'open'; PO.list = null; await loadPo(); render();
    if('Translator' in self) translate1688();   // сразу переводим новые названия на русский
  }catch(e){ PO.imp = 'Не загрузилось: '+errText(e); render(); }
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
    const rows = data.map(([o,f,i])=>({ o, f, i: i.map(u => u.startsWith('http') ? u : 'https://'+u) }));
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
    ${i.spec?`<span class="meta">Вариант у поставщика: ${esc(i.spec)}${m.specRu?' → '+esc(m.specRu):''}</span>`:''}
    <span class="meta">Розничную цену можно оставить пустой — её поставит Анна. Фото и ссылка на поставщика сохранятся в карточке, штрихкод создастся автоматически.</span>
    <div class="row" style="justify-content:flex-start"><button class="btn small" id="po-mk-cancel">Отмена</button><button class="btn small primary" id="po-mk-save">Создать и связать</button></div></div>`;
}

document.addEventListener('input', e => { if(S.view==='po' && e.target.id==='po-oq'){ PO.oq = e.target.value; PO.lim = 40; clearTimeout(PO.oqT); PO.oqT = setTimeout(render, 250); } });

const poBulkOk = () => isBoss() && !isViewer();
