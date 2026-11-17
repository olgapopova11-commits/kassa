/* Касса MOON и Sunshine — пробная версия. Данные: Supabase. */
'use strict';
const SB_URL = 'https://ottuadjdksxipfjytlyv.supabase.co';
const SB_KEY = 'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const POS_PAY = ['cash','card','certificate'];
const PAY = { cash:'Наличные', card:'Карта', kaspi_qr:'Kaspi QR', transfer:'Перевод', invoice:'По счёту', bonus:'Бонусы', certificate:'Сертификат' };
const ROLE = { owner:'Владелец', manager:'Менеджер', consultant:'Консультант', purchaser:'Закуп', viewer:'Просмотр' };
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
    <h2>${mode==='in'?'Вход в кассу':'Регистрация сотрудника'}</h2>
    ${mode==='in'?`<button class="btn primary" id="lg-tg">✈️ Войти через Telegram</button><p class="meta">Для сотрудников, которых менеджер добавил по номеру телефона.</p><div class="label">или по почте</div>`:''}
    ${mode==='up'?'<input id="lg-name" placeholder="Имя и фамилия" autocomplete="name">':''}
    <input id="lg-email" type="email" placeholder="Почта" autocomplete="username">
    <input id="lg-pass" type="password" placeholder="Пароль (не меньше 6 символов)" autocomplete="${mode==='in'?'current-password':'new-password'}">
    ${msg?`<div class="${/ошиб|не /i.test(msg)?'warn':'okmsg'}">${esc(msg)}</div>`:''}
    <button class="btn primary" id="lg-go">${mode==='in'?'Войти':'Зарегистрироваться'}</button>
    <button class="btn" id="lg-switch">${mode==='in'?'Я новый сотрудник':'У меня уже есть вход'}</button>
    <p class="meta">Новый сотрудник регистрируется сам, а менеджер включает ему доступ и назначает магазин.</p>
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
      const { error } = await sb.auth.signUp({ email, password, options:{ data:{ full_name }, emailRedirectTo: location.href.split('#')[0] } });
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
  S.store = ls.get('kassa_store', null) || me.home_store_id || (S.stores[0]||{}).id;
  if(!S.stores.some(s=>s.id===S.store)) S.store = (S.stores[0]||{}).id;
  renderShell(); await loadCatalog(); render(); flushQueue(); subscribeReqs();
}

/* ---------- каркас ---------- */
function renderShell(){
  const tabs = [['pos','Продажа'],['shifts','Смены'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты']];
  if(isBoss()) { tabs.splice(1,0,['analytics','Аналитика']); tabs.push(['nom','Номенклатура']); tabs.push(['site','Сайт']); tabs.push(['emps','Сотрудники']); }
  if(isViewer()){ tabs.splice(0, tabs.length, ...tabs.filter(([v]) => v!=='pos' && v!=='emps')); if(!S.view || S.view==='pos' || S.view==='emps') S.view = 'analytics'; }

  $('#app').innerHTML = `<header id="hdr"></header><main id="main"></main>
    <nav class="tabs" role="tablist">${tabs.map(([v,t])=>`<button role="tab" data-view="${v}">${t}</button>`).join('')}</nav>`;
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = async () => { S.view = b.dataset.view; render(); scrollTo(0,0); if(S.view==='shifts'){ await loadShifts(); render(); } });
  renderHeader();
}
function renderHeader(){
  const h = $('#hdr'); if(!h) return;
  const q = queue();
  h.innerHTML = `<span class="brand">Касса</span>
    <select id="store-sel" aria-label="Магазин">${S.stores.map(s=>`<option value="${s.id}" ${s.id===S.store?'selected':''}>${esc(BRAND[s.brand]+' · '+s.city+', '+s.address)}</option>`).join('')}</select>
    <span class="who"><span class="net ${navigator.onLine?'':'off'}">${navigator.onLine?'онлайн':'нет интернета'}</span>
    ${q.length?`<span class="chip warn">в очереди: ${q.length}</span>`:''}
    <span>${esc(S.me.full_name)} · ${ROLE[S.me.role]}</span>${!canEdit(S.store)?`<span class="chip warn" title="${isViewer()?'Можно смотреть всё, изменения недоступны':'Этот магазин в другом городе: можно смотреть, менять нельзя'}">только просмотр</span>`:''}${S.me.telegram?'':'<button id="tg-link" title="Получать уведомления и входить через Telegram">Привязать Telegram</button>'}<button id="logout">Выйти</button></span>`;
  $('#store-sel').onchange = e => { S.store = +e.target.value; ls.set('kassa_store', S.store); S.cust = null; S.bonusSpend = 0; if(S.phone) lookupCustomer(); renderHeader(); render(); if(S.view==='shifts') loadShifts().then(render); };
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  if($('#tg-link')) $('#tg-link').onclick = () => tgLogin('link');
}
function render(){
  document.body.classList.toggle('readonly', !canEdit(S.store));
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === S.view));
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  ({ pos:renderPos, sales:renderSales, stock:renderStock, certs:renderCerts, emps:renderEmps, shifts:renderShifts, analytics:renderAnalytics, wh:renderWh, site:renderSite, nom:renderNom })[S.view]();
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
  const canPay = S.cart.length && keys.length && Math.abs(diff) < 1 && !needCode && !S.busy;
  const c = S.cust;
  $('#main').innerHTML = `<div class="grid2">
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
       <button class="btn primary" id="checkout" ${canPay?'':'disabled'}>${S.busy?'Проводим…':'Провести чек'}</button></div>
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
  writeoff:  { t:'Списание', boss:true, hint:'Брак, потеря, подарок. Причина обязательна.' },
  transfer:  { t:'Перемещение', boss:false, hint:'Создаёт перемещение менеджер. Товар списывается в магазине-отправителе сразу, а в магазине-получателе — когда там нажмут «Принять».' },
  audit:     { t:'Ревизия', boss:false, hint:'Сканируйте товар на полке — каждое сканирование +1. Продажи во время ревизии учитываются. Закрывает менеджер.' },
};
function whModes(){ return Object.entries(WH).filter(([k,v]) => !v.boss || isBoss()); }
function newDoc(mode){ return { mode, store:S.store, to:(S.stores.find(x=>x.id!==S.store)||{}).id, supplier:'', note:'', reason:'', items:[] }; }
async function loadReqs(){ const { data, error } = await sb.rpc('requests_list', { p_status: S.reqSt||'pending' }); if(error) toast(errText(error)); S.reqs = data||[]; if((S.reqSt||'pending')==='pending') setReqBadge(S.reqs.length); }
function setReqBadge(n){ S.reqCount=n; const b=document.querySelector('nav.tabs [data-view="wh"]'); if(b) b.textContent = n ? `Склад (${n})` : 'Склад'; }
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
  else { const { data } = await sb.rpc('writeoffs_list', { p_store: isBoss()?null:S.store }); S.whList = (data||[]).filter(x => x.kind === S.wmode); }
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
      <button class="btn primary" id="d-post" ${d.items.length?'':'disabled'}>${{receipt:'Провести приёмку',capitalize:'Оприходовать',writeoff:'Списать',transfer:'Отправить'}[m]}</button></div>
  </div><div>${m==='transfer'?renderTransfers():renderWhList()}</div></div>`;
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
    res = await sb.rpc('post_writeoff', { p_store:d.store, p_reason:d.reason, p_items:d.items.map(i=>({ product_id:i.pid, qty:i.qty })) });
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
  S.an = normAn(cur.data);
  S.anPrev = prev.error ? null : normAn(prev.data);
  S.anPrevRange = [pFrom, pTo];
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
    const o = b.get(k) || { lab, tip, v:0, n:0 }; o.v += v; o.n++; b.set(k,o);
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
          ${bars.map((x,i)=>`<div class="rcol ${i<bars.length/3?'l':i>=bars.length*2/3?'r':''}"><div class="rbar" style="height:${Math.max(2,Math.round(x.v/max*150))}px"><span class="rtip">${esc(x.tip)}<b>${fmt(x.v)}</b></span></div></div>`).join('')}
        </div>
        <div style="display:flex;gap:${bars.length>40?2:4}px;margin-top:4px">
          ${bars.map((x,i)=>`<div class="meta" style="flex:1 1 0;min-width:0;font-size:10px;text-align:center;white-space:nowrap;overflow:visible">${i%every===0?esc(x.lab):''}</div>`).join('')}
        </div>
      </div>
    </div>
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
    <p class="meta">Считается по всем чекам: новой кассы и истории из Wipon с 1 января 2026.</p>`}`;
}

/* ---------- смены ---------- */
async function loadShifts(){
  if(!navigator.onLine) return;
  const days = S.shDays || 7, to = new Date(), from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate()-(days-1));
  const [cur, list] = await Promise.all([
    sb.rpc('shift_current', { p_store: S.store }),
    sb.rpc('shifts_list', { p_stores: isBoss() ? selStores() : [S.store], p_from: from.toISOString(), p_to: to.toISOString() })
  ]);
  if(cur.error) toast(errText(cur.error));
  S.shift = cur.data || null; S.shifts = list.data || []; S.shLoaded = true;
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
    ${closing!=null ? row('Фактически', fmt(closing)) + row('Расхождение', diffHtml(closing - r.cashExpected)) : ''}
  </tbody></table>
  ${(r.byEmployee||[]).length>1 || ((r.byEmployee||[])[0]||{}).name!=='—' ? `<table style="margin-top:8px"><tbody><tr><td colspan="2" class="meta">По продавцам</td></tr>${r.byEmployee.map(e=>row(esc(e.name)+' <span class="meta">· '+e.checks+' чек.</span>', fmt(e.revenue))).join('')}</tbody></table>` : ''}
  </div></div>`;
}
function shiftText(sh, r){
  const w = 32, pad = (a,b) => a + ' '.repeat(Math.max(1, w - a.length - b.length)) + b, L = [];
  L.push('ОТЧЁТ О ЗАКРЫТИИ СМЕНЫ', storeName(sh.store_id), 'Смена №'+sh.number, 'Открыта: '+tm(sh.opened_at)+(sh.opened_by_name?' · '+sh.opened_by_name:''), 'Закрыта: '+tm(sh.closed_at)+(sh.closed_by_name?' · '+sh.closed_by_name:''), '-'.repeat(w));
  L.push(pad('Выручка', fmt(r.revenue)), pad('Чеков', String(r.checks)), pad('Средний чек', fmt(r.checks?r.revenue/r.checks:0)), pad('Продано штук', String(r.items)), pad('Возвраты', r.returns+' / '+fmt(r.returnsSum)), pad('Скидки', fmt(r.discounts)), pad('Бонусов начислено', fmt(r.bonusEarned)), pad('Бонусов использовано', fmt(r.bonusSpent)), pad('Сертификатов продано', fmt(r.certSold)), '-'.repeat(w));
  Object.entries(r.byPay||{}).forEach(([k,v]) => L.push(pad(PAY[k]||k, fmt(v))));
  L.push('-'.repeat(w), pad('Наличные на начало', fmt(sh.opening_cash)), pad('Наличными за смену', fmt(r.cashNet)), pad('Должно быть', fmt(r.cashExpected)));
  if(sh.closing_cash!=null) L.push(pad('Фактически', fmt(sh.closing_cash)), pad('Расхождение', fmt(sh.closing_cash - r.cashExpected)));
  if(sh.note) L.push('', 'Комментарий: '+sh.note);
  return L.join('\n');
}
function renderShifts(){
  const sh = S.shift, ro = isViewer(), st = esc(storeName(S.store));
  let cur;
  if(!S.shLoaded) cur = '<div class="empty">Загружаем…</div>';
  else if(!sh) cur = `<div class="card stack"><div><b>${st}</b> · <span class="chip zero">смена закрыта</span></div>
      ${ro ? '<p class="meta">Открыть смену может сотрудник магазина.</p>' : `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
        <label class="meta">Наличные в кассе на начало, ₸ <input id="sh-open-cash" type="number" min="0" inputmode="numeric" placeholder="0" style="width:140px"></label>
        <button class="btn primary" id="sh-open">Открыть смену</button></div>`}</div>`;
  else cur = `<div class="card stack"><div class="row" style="flex-wrap:wrap;gap:8px"><div><b>${st}</b> · <span class="chip ok">смена №${sh.number} открыта</span>
        <div class="meta">с ${tm(sh.opened_at)}${sh.opened_by_name?' · открыл(а) '+esc(sh.opened_by_name):''}</div></div><button class="btn small" id="sh-refresh">Обновить цифры</button></div>
      ${shiftReportHtml(sh.summary, sh.opening_cash, null)}
      ${ro ? '' : `<div class="row" style="flex-wrap:wrap;justify-content:flex-start;gap:8px;border-top:1px solid var(--line);padding-top:10px">
        <label class="meta">Наличные в кассе фактически, ₸ <input id="sh-close-cash" type="number" min="0" inputmode="numeric" placeholder="${Math.round(sh.summary.cashExpected)}" style="width:150px"></label>
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
  if(t.id==='sh-open'){ t.disabled = true; const { error } = await sb.rpc('shift_open', { p_store:S.store, p_cash: +($('#sh-open-cash').value||0) });
    if(error) toast(errText(error)); else toast('Смена открыта'); await loadShifts(); render(); }
  else if(t.id==='sh-refresh'){ await loadShifts(); render(); }
  else if(t.id==='sh-close'){
    const v = $('#sh-close-cash').value; if(v===''){ toast('Пересчитайте наличные в кассе и введите сумму'); $('#sh-close-cash').focus(); return; }
    t.disabled = true; const { error } = await sb.rpc('shift_close', { p_shift:S.shift.id, p_cash:+v, p_note:$('#sh-note').value });
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
  S.sa = data;
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
    <div class="list">${D.rows.map(p=>`<button class="prod" data-nmopen="${p.id}" style="${e&&e.id===p.id?'background:var(--soft)':''}">${thumb(p)}<span><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)} · остаток ${p.stock}</span>
      ${(p.sites||[]).length?'<span class="chip ok">на сайте</span>':''}${p.is_basic?'<span class="chip">базовый</span>':''}</span><span class="price num">${fmt(p.price)}</span></button>`).join('') || '<div class="empty">Ничего не найдено</div>'}</div>
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
async function loadEmps(){ const { data } = await sb.from('employees').select('*').order('created_at'); S.emps = data || []; }
function renderEmps(){
  $('#main').innerHTML = `<h2>Сотрудники</h2>
    <div class="card stack" style="margin-bottom:12px"><b>Добавить сотрудника по телефону</b>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-start">
        <input id="ne-phone" placeholder="+7 7__ ___ __ __" inputmode="tel"><input id="ne-name" placeholder="Имя и фамилия" style="flex:1;min-width:160px">
        <select id="ne-role">${Object.entries(ROLE).filter(([k])=>k!=='owner'||S.me.role==='owner').map(([k,v])=>`<option value="${k}" ${k==='consultant'?'selected':''}>${v}</option>`).join('')}</select></div>
      <div>${S.allStores.map(s=>`<label class="meta" style="margin-right:12px;white-space:nowrap"><input type="checkbox" class="ne-store" value="${s.id}"> ${esc(BRAND[s.brand]+' · '+s.address)}</label>`).join('')}</div>
      <div class="row"><span class="meta">Сотрудник входит кнопкой «Войти через Telegram» и делится этим же номером в боте — пароль не нужен.</span><button class="btn primary" id="ne-add">Добавить</button></div></div>
    <div class="scroll"><table><thead><tr><th>Имя</th><th>Роль</th><th>Основной магазин</th><th>Доступ к магазинам</th><th>Вход</th></tr></thead><tbody>
    ${S.emps.map(e=>`<tr><td>${esc(e.full_name)}<br><input class="small" data-ephone="${e.id}" value="${esc(e.phone||'')}" placeholder="телефон не указан" inputmode="tel" style="width:150px;margin-top:4px"><br><span class="meta">${e.telegram_id?'Telegram ✓':''}${!e.auth_user_id?(e.telegram_id?' · ':'')+'ещё не входил':''}</span></td>
      <td><select data-erole="${e.id}">${Object.entries(ROLE).map(([k,v])=>`<option value="${k}" ${e.role===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td><select data-estore="${e.id}"><option value="">—</option>${S.allStores.map(s=>`<option value="${s.id}" ${e.home_store_id===s.id?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select></td>
      <td>${['owner','viewer'].includes(e.role)?'<span class="meta">все магазины</span>':(e.role==='manager'?'<div class="meta" style="max-width:240px">Видит все магазины. Отмеченные — подтверждает перемещения в них из другого города:</div>':'')+S.allStores.map(s=>{ const ids=e.store_ids||(e.home_store_id?[e.home_store_id]:[]);
        return `<label class="meta" style="display:block;white-space:nowrap"><input type="checkbox" data-estores="${e.id}:${s.id}" ${ids.includes(s.id)?'checked':''}> ${esc(BRAND[s.brand]+' · '+s.address)}</label>`; }).join('')}</td>
      <td><label><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''}> включён</label></td></tr>`).join('')}</tbody></table></div>`;
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
  if(d.estore) updEmp(d.estore, { home_store_id: t.value ? +t.value : null });
  if(d.ephone){ const p = normPhone(t.value); if(t.value.trim() && !p) return toast('Телефон: 10 цифр после +7'); if(p && S.emps.some(x=>x.id!==d.ephone && x.phone===p)) return toast('Этот телефон уже у другого сотрудника'); t.value = p||''; const e2 = S.emps.find(x=>x.id===d.ephone); if(e2) e2.phone = p; updEmp(d.ephone, { phone: p }); }
  if(d.stf){ (S.stockF ||= {})[d.stf]=t.value; await loadStockView(); render(); }
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
  const b = e.target.closest('nav.tabs button'); if(!b) return;
  if(S.view==='sales'){ await loadSales(); render(); }
  if(S.view==='certs'){ await loadCerts(); render(); }
  if(S.view==='emps'){ await loadEmps(); render(); }
  if(S.view==='wh'){ if(!S.wmode) S.wmode=whModes()[0][0]; await loadWhSide(); render(); }
  if(S.view==='stock' && !S.stockRows.length){ await loadStockView(); render(); }
  if(S.view==='site'){ render(); await loadSite(); render(); }
  if(S.view==='nom'){ render(); await loadNom(); render(); }
  if(S.view==='analytics'){ S.an=null; render(); await loadAnalytics(); render(); }
});

sb.auth.onAuthStateChange((ev) => { if(ev==='SIGNED_OUT') renderLogin(); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
boot();
