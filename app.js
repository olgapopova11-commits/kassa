/* Silver — касса и учёт MOON и Sunshine. Данные: Supabase. */
'use strict';
const SB_URL = 'https://ottuadjdksxipfjytlyv.supabase.co';
const SB_KEY = 'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const POS_PAY = ['cash','card','certificate'];
const PAY = { cash:'Наличные', card:'Карта', kaspi_qr:'Kaspi QR', transfer:'Перевод', invoice:'По счёту', bonus:'Бонусы', certificate:'Сертификат' };
const ROLE = { owner:'Владелец', manager:'Менеджер', consultant:'Консультант', purchaser:'Закуп', viewer:'Управленец Астаны' };
const BRAND = { moon:'MOON', sunshine:'Sunshine' };

const S = {
  me:null, stores:[], store:null, view:'pos', catalog:[], catalogAt:null,
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
const isBoss = () => S.me && ['owner','manager','viewer'].includes(S.me.role);  // видит всё; viewer — без изменений
const isViewer = () => S.me && S.me.role === 'viewer';
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
  render();
}
function normPhone(v){ let d=String(v||'').replace(/\D/g,''); if(d.length===11&&(d[0]==='7'||d[0]==='8')) d=d.slice(1); if(d.length===10) return '+7'+d; return null; }
function toast(t){ const el=document.createElement('div'); el.className='toast'; el.textContent=t; document.body.append(el); setTimeout(()=>el.remove(),3200); }
const ls = { get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d }catch(e){ return d } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)) }catch(e){} } };
const thumbUrl = u => u.replace('static.tildacdn.pro/','thumb.tildacdn.pro/').replace(/\/([^/]+)$/,'/-/resize/120x/$1');
const thumb = p => p.photo_url ? `<img class="thumb" src="${esc(thumbUrl(p.photo_url))}" data-full="${esc(p.photo_url)}" alt="" loading="lazy" onerror="if(this.dataset.full&&this.src!==this.dataset.full)this.src=this.dataset.full">` : '<span class="thumb"></span>';
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
  const cached = ls.get('kassa_catalog3', null);
  if(cached && !force){ S.catalog = cached.items; S.catalogAt = cached.at; }
  if(!navigator.onLine) return;
  if(cached && !force && Date.now() - cached.at < 6*3600e3) return;
  const items = []; let from = 0;
  while(true){
    const { data, error } = await sb.from('products').select('id,barcode,sku,name,price,archived,photo_url').eq('archived', false).order('name').range(from, from+999);
    if(error) { toast('Каталог не загрузился: '+errText(error)); return; }
    data.forEach(p => items.push([p.id, p.barcode, p.sku||'', p.name, Number(p.price), p.photo_url||'']));
    if(data.length < 1000) break; from += 1000;
  }
  S.catalog = items; S.catalogAt = Date.now(); ls.set('kassa_catalog3', {at:S.catalogAt, items});
}
const prodObj = a => ({ id:a[0], barcode:a[1], sku:a[2], name:a[3], price:a[4], photo_url:a[5]||null });
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
  renderShell(); await loadPosShift(); await loadCatalog(); render(); flushQueue(); subscribeReqs();
}

/* ---------- каркас ---------- */
function renderShell(){
  const tabs = [['pos','Продажа'],['shifts','Смены'],['cash','Расходы'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты']];
  if(isBoss()) { tabs.splice(1,0,['analytics','Аналитика']); tabs.push(['bonus','Бонусные карты']); tabs.push(['nom','Номенклатура']); tabs.push(['site','Сайт']); tabs.push(['emps','Сотрудники']); }
  // настройка владельца: какие вкладки видит каждая роль
  const acc = (S.tabAccess||{})[S.me.role];
  if(S.me.role !== 'owner' && Array.isArray(acc)){ const keep = tabs.filter(([v]) => acc.includes(v)); tabs.splice(0, tabs.length, ...keep); }
  tabs.push(['pay', isBoss() ? 'Зарплата' : 'Моя зарплата']);
  if(tabs.length && !tabs.some(([v]) => v===S.view)) S.view = tabs[0][0];
  if(isViewer()){ tabs.splice(0, tabs.length, ...tabs.filter(([v]) => v!=='pos' && v!=='emps')); if(!S.view || S.view==='pos' || S.view==='emps') S.view = 'analytics'; }

  S.tabs = tabs;
  $('#app').innerHTML = `<header id="hdr"></header><nav class="subtabs" id="subnav" role="tablist"></nav><main id="main"></main>
    <nav class="tabs" id="mainnav" role="tablist"></nav>`;
  renderHeader();
}
// вкладки сгруппированы в разделы: внизу — разделы, сверху — вкладки выбранного раздела
const GROUPS = [['kassa','🧾','Касса',['pos','shifts','cash','sales']],['goods','📦','Товары',['stock','wh','nom','site']],
  ['clients','💳','Клиенты',['bonus','certs']],['analytics','📈','Аналитика',['analytics']],['team','👥','Сотрудники',['emps','pay']]];
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
  document.body.classList.toggle('readonly', !canEdit(S.store) || !canEditTab(S.view));
  renderNav();
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  ({ pos:renderPos, sales:renderSales, stock:renderStock, certs:renderCerts, emps:renderEmps, shifts:renderShifts, analytics:renderAnalytics, wh:renderWh, site:renderSite, nom:renderNom, bonus:renderBonus, cash:renderCash, pay:renderPay })[S.view]();
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
  const l = S.cart.find(x=>x.pid===p.id);
  if(l) l.qty++; else S.cart.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, qty:1, disc:0, dt:'pct', dv:0 });
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
  $('#main').innerHTML = `<h2>Чеки и возвраты</h2>${storeFilterHtml()}
    <div class="filters"><input id="sq" style="flex:1" placeholder="Номер чека, телефон клиента или товар" value="${esc(S.salesQ)}"><button class="btn" id="sq-go">Найти</button></div>
    ${S.sales.length?`<div class="scroll"><table><thead><tr><th>№</th><th>Когда</th>${isBoss()?'<th>Магазин</th>':''}<th>Товары</th><th>Сумма</th><th>Оплата</th><th>Клиент</th><th></th></tr></thead><tbody>
    ${S.sales.map(s=>`<tr><td class="num">${s.number}${s.kind==='return'?' <span class="chip zero">возврат</span>':''}</td>
      <td class="num">${new Date(s.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}<br><span class="meta">${esc(s.employees&&s.employees.full_name||'')}</span></td>${isBoss()?`<td>${esc(storeName(s.store_id))}</td>`:''}
      <td>${s.is_certificate_sale?esc(s.note):s.sale_items.map(i=>esc(i.products?i.products.name:'')+' × '+i.qty).join('<br>')}</td>
      <td class="num">${fmt(s.total)}</td><td>${s.sale_payments.map(p=>PAY[p.method]+(p.certificate_code?' '+esc(p.certificate_code):'')).join(', ')}</td>
      <td>${s.customers?esc(s.customers.phone):'—'}</td>
      <td>${s.kind==='sale'&&!s.is_certificate_sale?`<button class="btn small" data-ret="${s.id}">Возврат</button>`:''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Чеков пока нет</div>'}`;
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
  $('#main').innerHTML = `<h2>Остатки по магазинам</h2>
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
async function loadAudit(){
  const { data: open } = await sb.from('audits').select('id,store_id,status,started_at').eq('store_id', S.store).eq('status','counting').limit(1);
  S.audit = open && open[0] || null; S.auditRows = [];
  if(S.audit){ const { data } = await sb.rpc('audit_diff', { p_audit:S.audit.id, p_include_uncounted:false }); S.auditRows = (data&&data.rows)||[]; }
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
    ${m==='receipt'?`<input id="d-supplier" placeholder="Поставщик (например, 1688, Иу, рынок)" value="${esc(d.supplier)}">`:''}
    ${m==='writeoff'?`<input id="d-reason" placeholder="Причина списания *" value="${esc(d.reason)}">`:''}
    ${m==='capitalize'||m==='receipt'?`<input id="d-note" placeholder="Комментарий" value="${esc(d.note)}">`:''}
    ${docSearchHtml()}
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
  const a = S.audit;
  $('#main').innerHTML = `<h2>Склад</h2>${head}
    <div class="card stack"><div class="row"><b>Ревизия · ${esc(storeName(S.store))}</b>${a?`<span class="meta">начата ${new Date(a.started_at).toLocaleString('ru-RU')}</span>`:''}</div>
    ${!a?`<button class="btn primary" id="au-start">Начать ревизию в этом магазине</button>`:`
      ${docSearchHtml('Сканируйте товар — каждое сканирование +1')}
      <div class="scroll"><table><thead><tr><th>Товар</th><th>Посчитано</th><th>По базе</th><th>Разница</th></tr></thead><tbody>
      ${S.auditRows.map(r=>`<tr><td>${esc(r.name)}<br><span class="meta num">${esc(r.barcode)}</span></td>
        <td><input class="small" type="number" min="0" id="ac-${r.product_id}" data-acset="${r.product_id}" value="${r.counted??0}"></td>
        <td class="num">${r.expected}</td><td class="num" style="color:${r.diff<0?'var(--bad)':r.diff>0?'var(--ok)':'inherit'}">${r.diff>0?'+':''}${r.diff}</td></tr>`).join('') || '<tr><td colspan="4" class="meta">Пока ничего не посчитано</td></tr>'}</tbody></table></div>
      ${isBoss()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start">
        <button class="btn" id="au-uncounted">Показать и непосчитанные</button>
        <button class="btn primary" id="au-close">Закрыть: поправить только посчитанные</button>
        <button class="btn" id="au-close-full">Закрыть полностью (непосчитанные = 0)</button></div>`:'<p class="meta">Закрыть ревизию может менеджер.</p>'}`}
    </div>`;
}
function docAdd(p){
  if(S.wmode==='audit') return auditAdd(p);
  const d = S.doc, it = d.items.find(i=>i.pid===p.id);
  if(it) it.qty++; else d.items.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, qty:1, cost:null });
  S.dq=''; S.dfound=[]; render(); $('#dq') && $('#dq').focus();
}
async function auditAdd(p){
  const { error } = await sb.rpc('audit_count', { p_audit:S.audit.id, p_product:p.id, p_delta:1, p_set:null });
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
      <h2>Топ товаров</h2><div class="scroll"><table><thead><tr><th>Товар</th><th>Шт.</th><th>Сумма</th></tr></thead><tbody>
      ${Object.values(A.byProd).sort((a,b)=>b.sum-a.sum).slice(0,20).map(p=>`<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td class="num">${fmt(p.sum)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">—</td></tr>'}</tbody></table></div>
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
        <input id="sh-note" placeholder="Комментарий (необязательно)" style="flex:1;min-width:180px">
        <button class="btn primary" id="sh-close">Закрыть смену</button></div>`}</div>`;
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
  else if(t.id==='sh-close'){
    const v = $('#sh-close-cash').value; if(v===''){ toast('Пересчитайте наличные в кассе и введите сумму'); $('#sh-close-cash').focus(); return; }
    const vc = $('#sh-close-card').value; if(vc===''){ toast('Введите сумму по терминалу из отчёта терминала'); $('#sh-close-card').focus(); return; }
    t.disabled = true; const { error } = await sb.rpc('shift_close', { p_shift:S.shift.id, p_cash:+v, p_note:$('#sh-note').value, p_card:+vc });
    if(error){ toast(errText(error)); t.disabled = false; return; }
    const id = S.shift.id; await loadShifts(); render(); const x = S.shifts.find(z=>z.id===id); if(x) showShiftReport(x); }
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
const NM_EMPTY = () => ({ id:null, barcode:'', sku:'', name:'', price:'', cost:'', category_id:'', material:'', color:'', supplier:'', purchase_url:'', photo_url:'', is_basic:false, archived:false, sites:[] });
async function loadNom(){
  const f = S.nm; f.data = null;
  if(!f.cats){ const { data } = await sb.from('categories').select('id,name').order('name'); f.cats = data || []; }
  const { data, error } = await sb.rpc('product_list', { p_q:f.q.trim(), p_category:f.cat?+f.cat:null, p_archived:f.arch, p_offset:f.off, p_limit:50 });
  if(error){ toast(errText(error)); f.data = { rows:[], total:0 }; } else f.data = data;
}
function renderNom(){
  const f = S.nm, D = f.data, e = f.ed, cats = f.cats || [];
  const inp = (k, label, extra='') => `<label class="stack" style="gap:4px"><span class="label">${label}</span><input data-nf="${k}" value="${esc(e[k]??'')}" ${extra}></label>`;
  $('#main').innerHTML = `<div class="row"><h2>Номенклатура</h2><button class="btn primary" id="nm-new">+ Новый товар</button></div>
  <div class="grid2">
   <div>
    <div class="filters"><input id="nm-q" placeholder="Штрихкод, артикул или название" value="${esc(f.q)}" style="flex:1;min-width:180px">
      <select id="nm-cat"><option value="">Все категории</option>${cats.map(c=>`<option value="${c.id}" ${String(f.cat)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <label class="meta" style="align-self:center"><input type="checkbox" id="nm-arch" ${f.arch?'checked':''}> архив</label></div>
    ${!D?'<div class="empty">Загружаем…</div>':`<p class="meta">Найдено: ${D.total.toLocaleString('ru-RU')}</p>
    <div class="list">${D.rows.map(p=>`<div style="${e&&e.id===p.id?'background:var(--soft);':''}border-radius:10px"><button class="prod" data-nmopen="${p.id}" style="background:transparent">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta">${esc(nmInfo(p))}</span><br><span class="meta num">${esc(p.barcode)}${p.sku?' · арт. '+esc(p.sku):''} · остаток ${p.stock}</span>
      ${p.is_basic?'<span class="chip">базовый</span>':''}</span><span class="price num">${fmt(p.price)}</span></button>${nmSiteLinks(p)}</div>`).join('') || '<div class="empty">Ничего не найдено</div>'}</div>
    ${f.off||D.rows.length===50?`<div class="row" style="margin-top:8px"><button class="btn" data-nmpage="-1" ${f.off?'':'disabled'}>Назад</button><span class="meta">${f.off+1}–${f.off+D.rows.length}</span><button class="btn" data-nmpage="1" ${D.rows.length===50?'':'disabled'}>Дальше</button></div>`:''}`}
   </div>
   <div>${!e?'<div class="card empty">Выберите товар слева или создайте новый</div>':`<div class="card stack">
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
       <label class="stack" style="gap:4px"><span class="label">Категория</span><select data-nf="category_id"><option value="">—</option>${cats.map(c=>`<option value="${c.id}" ${String(e.category_id)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
       ${inp('material','Материал','list="nm-mats"')}${inp('color','Цвет','list="nm-colors"')}${inp('supplier','Поставщик')}
     </div>
     <datalist id="nm-mats">${['Серебро 925','Нержавейка','Мед сплав','Пластик','мельхиор','Жемчуг','Кожа','другой'].map(m=>`<option value="${m}">`).join('')}</datalist>
     <datalist id="nm-colors">${['золото','серебро','цветной','черный'].map(m=>`<option value="${m}">`).join('')}</datalist>
     ${inp('purchase_url','Ссылка на закуп (1688 и т.п.)')}
     <div class="row" style="justify-content:flex-start;gap:16px"><label><input type="checkbox" data-nf="is_basic" ${e.is_basic?'checked':''}> Базовый товар (для рекомендаций дозаказа)</label>
       <label><input type="checkbox" data-nf="archived" ${e.archived?'checked':''}> В архиве</label></div>
     <div class="row"><span>${e.id&&e.barcode?`<button class="btn small" data-labels='${esc(JSON.stringify([{n:e.name,b:e.barcode,p:+e.price,q:1}]))}'>Этикетка</button>`:''}</span>
       <button class="btn primary" id="nm-save">${e.id?'Сохранить':'Создать товар'}</button></div>
     <div class="cust stack"><span class="label">Связь с сайтом</span>
       ${!e.id?'<span class="meta">Сначала сохраните товар</span>':`
       ${(e.sites||[]).map(x=>`<div class="row"><span>${x.site==='moon'?'MOON':'Sunshine'}: ${esc(x.title)} ${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener">открыть</a>`:''}</span><button class="btn small" data-nmunlink="${x.site}:${x.uid}">Отвязать</button></div>`).join('') || '<span class="meta">Не связан с сайтом</span>'}
       <input id="nm-sq" placeholder="Найти карточку на сайте по названию" value="${esc(f.sq)}" autocomplete="off">
       ${f.sfound.map(x=>`<button class="prod" data-nmlink="${x.site}:${x.uid}">${thumb({photo_url:x.photo})}<span><b>${esc(x.title)}</b><br><span class="meta">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}${x.linked_to?' · сейчас связан с: '+esc(x.linked_to):''}</span></span><span class="price num">${fmt(x.price)}</span></button>`).join('')}`}
     </div>
   </div>`}</div>
  </div>`;
}
function nmInfo(p){ return [p.category, p.color, p.material, p.stone, p.brand, p.supplier?'поставщик '+p.supplier:''].filter(Boolean).join(' · '); }
function nmSiteLinks(p){ const L=(p.sites||[]).filter(x=>x.url); return L.length?`<div class="meta" style="padding:0 10px 8px">${L.map(x=>`🔗 <a href="${esc(x.url)}" target="_blank" rel="noopener">${x.site==='moon'?'mooncollection.kz':'sunshinejewelry.kz'}${x.status==='review'?' (связь не проверена)':''}</a>`).join(' &nbsp; ')}</div>`:''; }
function nmOpen(p){ S.nm.ed = { ...NM_EMPTY(), ...p, category_id: p.category_id??'', cost: p.cost??'', supplier: p.supplier||'', sites: p.sites||[] }; S.nm.sq=''; S.nm.sfound=[]; render(); }
async function nmSave(){
  const e = S.nm.ed; if(!e) return;
  const { data, error } = await sb.rpc('product_save', { p: { ...e, sites: undefined } });
  if(error) return toast(errText(error));
  toast(e.id ? 'Сохранено' : 'Товар создан, штрихкод '+data.barcode);
  e.id = data.id; e.barcode = data.barcode;
  const row = [e.id, e.barcode, e.sku||'', e.name, Number(e.price), e.photo_url||''];
  const i = S.catalog.findIndex(a=>a[0]===e.id); if(i>=0) S.catalog[i]=row; else S.catalog.push(row);
  try{ ls.set('kassa_catalog3', { at:S.catalogAt, items:S.catalog }); }catch(_){}
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
const SITE_ST = [['review','Проверить'],['auto','Связано автоматически'],['confirmed','Подтверждено'],['none','Без пары'],['rejected','Нет в базе']];
const SITE_NAME = { moon:'mooncollection.kz', sunshine:'sunshinejewelry.kz' };
async function loadSite(){
  const f = S.st; f.data = null;
  const { data, error } = await sb.rpc('site_list', { p_site:f.site, p_status:f.status, p_q:f.q.trim(), p_offset:f.off, p_limit:50 });
  if(error){ toast(errText(error)); f.data = { rows:[], counts:{} }; } else f.data = data;
}
function siteImg(u){ return u ? `<img class="thumb" style="width:64px;height:64px" src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="" loading="lazy" onerror="if(this.dataset.full&&this.src!==this.dataset.full)this.src=this.dataset.full">` : '<span class="thumb" style="width:64px;height:64px"></span>'; }
function renderSite(){
  const f = S.st, D = f.data, cnt = k => (D && D.counts && D.counts[f.site+':'+k]) || 0;
  $('#main').innerHTML = `<h2>Сайт ↔ база товаров</h2>
    <p class="meta">Слева карточка с сайта, справа товар из базы, с которым она связана. Через эту связь на сайт пойдут остатки, а в кассу — фото.</p>
    <div class="filters">${Object.entries(SITE_NAME).map(([k,v])=>`<button class="btn small ${f.site===k?'primary':''}" data-stsite="${k}">${v}</button>`).join('')}</div>
    <div class="filters">${SITE_ST.map(([k,v])=>`<button class="btn small ${f.status===k?'primary':''}" data-ststatus="${k}">${v} · ${cnt(k)}</button>`).join('')}
      <input id="st-q" placeholder="Поиск: название или штрихкод" value="${esc(f.q)}" style="flex:1;min-width:200px"></div>
    ${!D?'<div class="empty">Загружаем…</div>':!D.rows.length?'<div class="empty">Здесь пусто</div>':D.rows.map(r=>{ const key=r.site+':'+r.uid, open=f.open===key;
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
        ${r.status!=='rejected'?`<button class="btn small" data-stno="${key}">Нет в базе</button>`:''}
      </div>
      ${open?`<div class="cust stack" style="margin-top:8px">
        <span class="label">Похожие товары в базе</span>
        ${!f.cands?'<div class="meta">Ищем…</div>':f.cands.map(c=>`<button class="prod" data-stpick="${key}" data-pid="${c.product_id}">${thumb({photo_url:c.photo})}<span><b>${esc(c.name)}</b><br><span class="meta num">${esc(c.barcode)} · сходство ${Math.round(c.sim*100)}%</span></span><span class="price num">${fmt(c.price)}</span></button>`).join('')}
        <span class="label">Или найдите вручную</span>
        <input id="st-cq" placeholder="Штрихкод или название из базы" value="${esc(f.cq)}" autocomplete="off">
        ${f.cfound.slice(0,10).map(p=>`<button class="prod" data-stpick="${key}" data-pid="${p.id}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)}</span></span><span class="price num">${fmt(p.price)}</span></button>`).join('')}
      </div>`:''}
    </div>`; }).join('')}
    ${D&&(f.off||D.rows.length===50)?`<div class="row"><button class="btn" data-stpage="-1" ${f.off?'':'disabled'}>Назад</button><span class="meta">${f.off+1}–${f.off+D.rows.length}</span><button class="btn" data-stpage="1" ${D.rows.length===50?'':'disabled'}>Дальше</button></div>`:''}`;
}
async function siteSet(key, pid, status){
  const [site, uid] = key.split(':');
  const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product:pid||null, p_status:status });
  if(error) return toast(errText(error));
  toast(status==='confirmed'?'Связь подтверждена':'Отмечено: нет в базе');
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
function renderBonus(){
  const T = BK.stats || {}, L = BK.list, C = BK.card, ro = isViewer();
  const n = v => Math.round(+v||0).toLocaleString('ru-RU');
  $('#main').innerHTML = `<h2>Бонусные карты</h2>
  <div class="filters"><div class="seg">${[['sunshine','Sunshine'],['moon','MOON']].map(([k,v])=>`<button data-bkbrand="${k}" aria-pressed="${BK.brand===k}">${v}</button>`).join('')}</div>
    <span class="meta" style="align-self:center">Бонусы у брендов раздельные, база клиентов общая.</span></div>
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

/* ---------- зарплата ---------- */
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
function renderPay(){
  const D = PY.data, tabel = S.me && ['owner','manager'].includes(S.me.role) && !isViewer();
  const total = (D||[]).reduce((a,e)=>a+e.total,0);
  const stEmps = (S.emps||[]).filter(e => e.active && (!e.store_ids || !e.store_ids.length || e.store_ids.includes(+PY.store)));
  $('#main').innerHTML = `<div class="row"><h2>${isBoss()?'Зарплата':'Моя зарплата'}</h2><label class="meta">Месяц <input type="month" id="py-month" value="${PY.month}"></label></div>
  ${isBoss()?storeFilterHtml():''}
  <p class="meta">Предварительный расчёт по продажам в кассе и табелю часов. Правила: ${['Курмангазы, Толе би, Гагарина — 12/10% по часам','MOON Курмангазы — 5%','Астана — 6% Sunshine, 3% MOON'].join(' · ')}.</p>
  <div class="grid2"><div>
   ${!D?'<div class="empty">Считаем…</div>':!D.length?'<div class="empty">За этот месяц нет часов в табеле</div>':`<div class="scroll"><table><thead><tr><th>Сотрудник</th><th>Часы</th><th>Начислено</th><th>Бонусы / удержания</th><th>К выплате</th><th>Выплачено</th><th>Остаток</th></tr></thead><tbody>
     ${D.map(e=>{ const P = paySum(e), open = PY.open===e.employee || D.length===1; return `<tr><td><button class="btn small" data-pyopen="${e.employee}" style="border:0;background:none;padding:0;font-weight:600">${open?'▾':'▸'} ${esc(e.name)}</button></td><td class="num">${e.hours}</td><td class="num">${fmt(e.total)}</td>
       <td class="num">${P.plus?'+'+fmt(P.plus):''}${P.plus&&P.minus?'<br>':''}${P.minus?'<span style="color:var(--bad)">−'+fmt(P.minus)+'</span>':''}</td><td class="num"><b>${fmt(P.due)}</b></td><td class="num">${P.paid?fmt(P.paid):''}</td>
       <td class="num" style="color:${P.rest<0?'var(--bad)':P.rest>0?'inherit':'var(--ok)'}"><b>${P.rest<0?'переплата '+fmt(-P.rest):fmt(P.rest)}</b></td></tr>
       ${open?`<tr><td colspan="7" style="padding:0 0 10px">
         ${e.days.length?`<table style="margin:0 0 6px"><tbody>${e.days.map(payLine).join('')}</tbody></table>`:''}
         <div class="cust stack" style="gap:6px"><b>Расчёт</b>
           <div class="row"><span>Начислено по продажам</span><span class="num">${fmt(e.total)}</span></div>
           ${P.A.map(a=>`<div class="row"><span>${PADJ[a.kind][0]}${a.note?' <span class="meta">— '+esc(a.note)+'</span>':''} <span class="meta">${dshort(a.at)}</span></span><span class="num">${PADJ[a.kind][1]>0?'+':'−'}${fmt(a.amount)}${tabelOk()?` <button class="btn small" data-padel="${a.id}" title="Удалить">✕</button>`:''}</span></div>`).join('')}
           <div class="row" style="border-top:1px solid var(--line);padding-top:6px"><b>${P.rest<0?'Переплата (учесть в следующем месяце)':'Остаток к выплате'}</b><b class="num">${fmt(Math.abs(P.rest))}</b></div>
           ${P.by('card')?`<div class="meta">из них переведено на карту: ${fmt(P.by('card'))}</div>`:''}
           ${tabelOk()?`<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">
             <select id="pa-kind-${e.employee}">${Object.entries(PADJ).map(([k,[t]])=>`<option value="${k}">${t}</option>`).join('')}</select>
             <input id="pa-amt-${e.employee}" class="small" type="number" min="1" inputmode="numeric" placeholder="сумма" style="width:110px">
             <input id="pa-note-${e.employee}" placeholder="комментарий" style="flex:1;min-width:120px">
             <button class="btn small primary" data-paadd="${e.employee}">Добавить</button>
             ${P.rest>0?`<button class="btn small" data-papayall="${e.employee}" data-rest="${Math.round(P.rest)}">Выплатить остаток ${fmt(P.rest)}</button>`:''}</div>`:''}
         </div></td></tr>`:''}`; }).join('')}
     ${D.length>1?(()=>{ const T = D.map(paySum).reduce((a,p)=>({due:a.due+p.due, paid:a.paid+p.paid, rest:a.rest+p.rest}),{due:0,paid:0,rest:0}); return `<tr><td><b>Итого</b></td><td></td><td class="num"><b>${fmt(total)}</b></td><td></td><td class="num"><b>${fmt(T.due)}</b></td><td class="num">${fmt(T.paid)}</td><td class="num"><b>${fmt(T.rest)}</b></td></tr>`; })():''}</tbody></table></div>`}
  </div><div>
   ${tabel?`<div class="card stack"><b>Табель часов</b>
     <div class="row" style="flex-wrap:wrap;justify-content:flex-start"><select id="py-store">${S.stores.map(s=>`<option value="${s.id}" ${+PY.store===s.id?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select><input type="date" id="py-day" value="${PY.day}"></div>
     <span class="meta">Правило: ${esc(payRuleText((PY.rules||{})[String(PY.store)]))}</span>
     ${(PY.sheet||[]).length?`<table><tbody>${PY.sheet.map(w=>`<tr><td>${esc(w.name)}${w.kind==='dress'?' <span class="chip">переодевание</span>':''}</td>
       <td><input class="small" type="number" min="0" max="24" step="0.5" value="${w.hours}" data-pyh="${w.employee}:${w.kind}" inputmode="decimal"> ч</td>
       <td><button class="btn small" data-pydel="${w.employee}:${w.kind}">✕</button></td></tr>`).join('')}</tbody></table>`:'<span class="meta">На этот день в табеле никого нет. Тот, кто открывает смену, попадает в табель автоматически.</span>'}
     <div class="row" style="flex-wrap:wrap;justify-content:flex-start">
       <select id="py-emp"><option value="">Сотрудник…</option>${stEmps.map(e=>`<option value="${e.id}" ${PY.add.emp===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}</select>
       <input id="py-hours" class="small" type="number" min="0.5" max="24" step="0.5" placeholder="часы" value="${esc(PY.add.hours)}" inputmode="decimal">
       <select id="py-kind"><option value="sale" ${PY.add.kind==='sale'?'selected':''}>продажи</option><option value="dress" ${PY.add.kind==='dress'?'selected':''}>переодевание (1 200/ч)</option></select>
       <button class="btn primary" id="py-add">Добавить</button></div>
   </div>`:`<div class="card meta">Часы в табель ставит менеджер. Если вы видите ошибку в часах — напишите менеджеру.</div>`}
  </div></div>`;
}

/* ---------- доступ к вкладкам по ролям ---------- */
const ALL_TABS = [['pos','Продажа'],['analytics','Аналитика'],['shifts','Смены'],['cash','Расходы'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты'],['bonus','Бонусные карты'],['nom','Номенклатура'],['site','Сайт'],['emps','Сотрудники']];
const BOSS_ONLY = ['analytics','bonus','nom','site','emps'];
function defaultTabs(role){ const boss = ['manager','viewer'].includes(role);
  return ALL_TABS.map(([v])=>v).filter(v => (boss || !BOSS_ONLY.includes(v)) && !(role==='viewer' && (v==='pos'||v==='emps'))); }
function canEditTab(v){ if(!S.me || S.me.role==='owner') return true; const E=(S.tabEdit||{})[S.me.role]; return Array.isArray(E) ? E.includes(v) : true; }
function accessHtml(){
  if(S.me.role!=='owner') return '';
  const roles = ['manager','consultant','purchaser','viewer'], A = S.tabAccess || {};
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
  $('#main').innerHTML = `<h2>Сотрудники</h2>
    <div class="card stack" style="margin-bottom:12px"><b>Добавить сотрудника по телефону</b>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start">
        <input id="ne-phone" placeholder="+7 7__ ___ __ __" inputmode="tel"><input id="ne-name" placeholder="Имя и фамилия" style="flex:1;min-width:160px">
        <select id="ne-role">${Object.entries(ROLE).filter(([k])=>k!=='owner'||S.me.role==='owner').map(([k,v])=>`<option value="${k}" ${k==='consultant'?'selected':''}>${v}</option>`).join('')}</select></div>
      <div>${S.allStores.map(s=>`<label class="meta" style="margin-right:12px;white-space:nowrap"><input type="checkbox" class="ne-store" value="${s.id}"> ${esc(BRAND[s.brand]+' · '+s.address)}</label>`).join('')}</div>
      <div class="row"><span class="meta">Сотрудник входит кнопкой «Войти через Telegram» и делится этим же номером в боте — пароль не нужен.</span><button class="btn primary" id="ne-add">Добавить</button></div></div>
    <div class="scroll"><table><thead><tr><th>Имя</th><th>Роль</th><th>Доступ к магазинам</th><th>Вход</th></tr></thead><tbody>
    ${S.emps.map(e=>`<tr><td>${esc(e.full_name)}<br><input class="small" data-ephone="${e.id}" value="${esc(e.phone||'')}" placeholder="телефон не указан" inputmode="tel" style="width:150px;margin-top:4px"><br><span class="meta">${e.telegram_id?'Telegram ✓':''}${!e.auth_user_id?(e.telegram_id?' · ':'')+'ещё не входил':''}</span></td>
      <td><select data-erole="${e.id}">${Object.entries(ROLE).map(([k,v])=>`<option value="${k}" ${e.role===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td>${['owner','viewer'].includes(e.role)?'<span class="meta">все магазины</span>':(e.role==='manager'?'<div class="meta" style="max-width:240px">Видит все магазины. Отмеченные — подтверждает перемещения в них из другого города:</div>':'')+S.allStores.map(s=>{ const ids=e.store_ids||(e.home_store_id?[e.home_store_id]:[]);
        return `<label class="meta" style="display:block;white-space:nowrap"><input type="checkbox" data-estores="${e.id}:${s.id}" ${ids.includes(s.id)?'checked':''}> ${esc(BRAND[s.brand]+' · '+s.address)}</label>`; }).join('')}</td>
      <td><label><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''}> включён</label></td></tr>`).join('')}</tbody></table></div>${accessHtml()}`;
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
  else if(t.id==='sq-go'){ await loadSales(); render(); }
  else if(d.ret) openReturn(d.ret);
  else if(t.id==='stq-go'){ await loadStockView(); render(); }
  else if(t.id==='stf-clear'){ S.stockF={}; await loadStockView(); render(); }
  else if(d.hist) openHistory(d.hist);
  else if(t.id==='cc-go'){ const v=$('#cc').value.trim(); if(v) checkCert(v); }
  else if(d.ck){ document.querySelectorAll('#ck-kind button').forEach(b=>b.setAttribute('aria-pressed', b===t)); }
  else if(t.id==='c-sell') sellCert();
  else if(d.eact){ updEmp(d.eact, { active:t.checked }); }
  else if(d.estores){ const [eid, sid] = d.estores.split(':'); const e = S.emps.find(x=>x.id===eid); if(e){ const cur = new Set(e.store_ids||(e.home_store_id?[e.home_store_id]:[])); t.checked ? cur.add(+sid) : cur.delete(+sid); e.store_ids=[...cur].sort((a,b)=>a-b); updEmp(eid, { store_ids: e.store_ids }); } }
  else if(d.sgroup){ const g=d.sgroup; S.sel = S.stores.filter(st => g==='all' || st.brand===g || st.city===g).map(st=>st.id); onSelChange(); }
  else if(d.sone){ const id=+d.sone; selStores(); S.sel = t.checked ? [...new Set([...S.sel, id])] : S.sel.filter(x=>x!==id); if(!S.sel.length) S.sel=[id]; onSelChange(); }
  else if(t.id==='nm-new'){ nmOpen({}); }
  else if(t.id==='nm-close'){ S.nm.ed=null; render(); }
  else if(t.id==='nm-save'){ t.disabled=true; await nmSave(); }
  else if(d.nmopen){ const p=(S.nm.data&&S.nm.data.rows||[]).find(r=>r.id===d.nmopen); if(p) nmOpen(p); }
  else if(d.nmpage){ S.nm.off=Math.max(0,S.nm.off+50*(+d.nmpage)); render(); await loadNom(); render(); }
  else if(d.nmlink||d.nmunlink){ const key=d.nmlink||d.nmunlink, [site,uid]=key.split(':');
    const { error } = await sb.rpc('site_link_set', { p_site:site, p_uid:+uid, p_product: d.nmlink?S.nm.ed.id:null, p_status: d.nmlink?'confirmed':'rejected' });
    if(error) toast(errText(error)); else { toast(d.nmlink?'Связано с сайтом':'Отвязано'); S.nm.sq=''; S.nm.sfound=[]; await loadNom(); const fr=S.nm.data.rows.find(r=>r.id===S.nm.ed.id); if(fr) nmOpen(fr); else render(); } }
  else if(d.wook||d.wono){ t.disabled=true; const { data, error } = await sb.rpc('decide_writeoff', { p_id:d.wook||d.wono, p_approve:!!d.wook, p_note:null }); if(error){ toast(errText(error)); t.disabled=false; return; } toast(data); await loadWhSide(); render(); }
  else if(d.trg){ S.trG=d.trg; S.trend=null; render(); loadTrends(); }
  else if(d.paadd){ const id=d.paadd, amt=+($('#pa-amt-'+id)||{}).value; if(!(amt>0)) return toast('Укажите сумму');
    const { error } = await sb.rpc('pay_adj_add', { p_employee:id, p_month:PY.month+'-01', p_kind:$('#pa-kind-'+id).value, p_amount:amt, p_note:$('#pa-note-'+id).value });
    if(error) return toast(errText(error)); toast('Добавлено'); PY.open=id; await loadPay(); render(); }
  else if(d.papayall){ const { error } = await sb.rpc('pay_adj_add', { p_employee:d.papayall, p_month:PY.month+'-01', p_kind:'paid', p_amount:+d.rest, p_note:'остаток' });
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
  else if(t.id==='au-start'){ const { error } = await sb.rpc('audit_start', { p_store:S.store }); if(error) toast(errText(error)); await loadAudit(); render(); }
  else if(t.id==='au-uncounted'){ const { data } = await sb.rpc('audit_diff', { p_audit:S.audit.id, p_include_uncounted:true }); S.auditRows=(data&&data.rows)||[]; render(); }
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
  if(d.erole) updEmp(d.erole, { role:t.value });
  if(d.ephone){ const p = normPhone(t.value); if(t.value.trim() && !p) return toast('Телефон: 10 цифр после +7'); if(p && S.emps.some(x=>x.id!==d.ephone && x.phone===p)) return toast('Этот телефон уже у другого сотрудника'); t.value = p||''; const e2 = S.emps.find(x=>x.id===d.ephone); if(e2) e2.phone = p; updEmp(d.ephone, { phone: p }); }
  if(d.stf){ (S.stockF ||= {})[d.stf]=t.value; await loadStockView(); render(); }
  if(d.accedit){ const [r,v]=d.accedit.split(':'); const E={...(S.tabEdit||{})}; const vis=Array.isArray((S.tabAccess||{})[r])?S.tabAccess[r]:defaultTabs(r);
    const cur=new Set(Array.isArray(E[r])?E[r]:vis); t.checked?cur.add(v):cur.delete(v); E[r]=ALL_TABS.map(([x])=>x).filter(x=>cur.has(x));
    const { error } = await sb.rpc('set_tab_edit', { p:E }); if(error){ toast(errText(error)); t.checked=!t.checked; } else { S.tabEdit=E; toast(t.checked?'Может менять':'Только смотреть'); } }
  if(d.acc){ const [r,v]=d.acc.split(':'); const A={...(S.tabAccess||{})}; const cur=new Set(Array.isArray(A[r])?A[r]:defaultTabs(r)); t.checked?cur.add(v):cur.delete(v);
    A[r]=ALL_TABS.map(([x])=>x).filter(x=>cur.has(x)); const { error } = await sb.rpc('set_tab_access', { p:A }); if(error){ toast(errText(error)); t.checked=!t.checked; } else { S.tabAccess=A; toast('Сохранено'); } }
  if(t.id==='cs-photo'){ cashPhoto(t.files[0]); }
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
  if(d.acset){ sb.rpc('audit_count', { p_audit:S.audit.id, p_product:d.acset, p_delta:0, p_set:Math.max(0,+t.value||0) }).then(async r=>{ if(r.error) toast(errText(r.error)); await loadAudit(); render(); }); }
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
  render(); scrollTo(0,0);
  if(S.view==='shifts'){ await loadShifts(); render(); }
  if(S.view==='sales'){ await loadSales(); render(); }
  if(S.view==='certs'){ await loadCerts(); render(); }
  if(S.view==='emps'){ await loadEmps(); render(); }
  if(S.view==='pay'){ render(); await loadPay(); render(); }
  if(S.view==='wh'){ if(!S.wmode) S.wmode=whModes()[0][0]; await loadWhSide(); render(); }
  if(S.view==='stock' && !S.stockRows.length){ await loadStockView(); render(); }
  if(S.view==='site'){ render(); await loadSite(); render(); }
  if(S.view==='nom'){ render(); await loadNom(); render(); }
  if(S.view==='bonus'){ render(); await loadBonus(); render(); }
  if(S.view==='cash'){ render(); await loadCash(); render(); }
  if(S.view==='analytics'){ S.an=null; render(); await loadAnalytics(); render(); }
});

sb.auth.onAuthStateChange((ev) => { if(ev==='SIGNED_OUT') renderLogin(); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
boot();
