/* Касса MOON и Sunshine — пробная версия. Данные: Supabase. */
'use strict';
const SB_URL = 'https://ottuadjdksxipfjytlyv.supabase.co';
const SB_KEY = 'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo';
const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const PAY = { cash:'Наличные', card:'Карта', kaspi_qr:'Kaspi QR', transfer:'Перевод', invoice:'По счёту', bonus:'Бонусы', certificate:'Сертификат' };
const ROLE = { owner:'Владелец', manager:'Менеджер', consultant:'Консультант', purchaser:'Закуп' };
const BRAND = { moon:'MOON', sunshine:'Sunshine' };

const S = {
  me:null, stores:[], store:null, view:'pos', catalog:[], catalogAt:null,
  q:'', found:[], stock:{},
  cart:[], discType:'pct', disc:0, pays:{}, certCode:'',
  phone:'', cust:null, custMsg:'', bonusSpend:0,
  sales:[], salesQ:'', stockQ:'', stockRows:[], certs:[], emps:[], busy:false,
  sel:null, period:'30', from:'', to:'', an:null, stockSort:'total', wmode:null, doc:null, dq:'', dfound:[], audit:null, auditRows:[], whList:[], trList:[],
};

/* ---------- утилиты ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => Math.round(Number(n)||0).toLocaleString('ru-RU').replace(/ |,/g,' ') + ' ₸';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c=='x'?r:(r&3|8)).toString(16)}));
const isBoss = () => S.me && ['owner','manager'].includes(S.me.role);
const store = () => S.stores.find(s => s.id === S.store) || {};
const storeName = id => { const s = S.stores.find(x=>x.id===id); return s ? `${BRAND[s.brand]} · ${s.address}` : '—'; };
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
  const cached = ls.get('kassa_catalog2', null);
  if(cached && !force){ S.catalog = cached.items; S.catalogAt = cached.at; }
  if(!navigator.onLine) return;
  if(cached && !force && Date.now() - cached.at < 6*3600e3) return;
  const items = []; let from = 0;
  while(true){
    const { data, error } = await sb.from('products').select('id,barcode,sku,name,price,archived,photo_url').eq('archived', false).order('name').range(from, from+999);
    if(error) { toast('Каталог не загрузился: '+errText(error)); return; }
    data.forEach(p => items.push([p.id, p.barcode, p.sku||'', p.name, Number(p.price)]));
    if(data.length < 1000) break; from += 1000;
  }
  S.catalog = items; S.catalogAt = Date.now(); ls.set('kassa_catalog2', {at:S.catalogAt, items});
}
const prodObj = a => ({ id:a[0], barcode:a[1], sku:a[2], name:a[3], price:a[4] });
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
function renderLogin(mode='in', msg=''){
  $('#app').innerHTML = `<div class="login card">
    <h2>${mode==='in'?'Вход в кассу':'Регистрация сотрудника'}</h2>
    ${mode==='up'?'<input id="lg-name" placeholder="Имя и фамилия" autocomplete="name">':''}
    <input id="lg-email" type="email" placeholder="Почта" autocomplete="username">
    <input id="lg-pass" type="password" placeholder="Пароль (не меньше 6 символов)" autocomplete="${mode==='in'?'current-password':'new-password'}">
    ${msg?`<div class="${/ошиб|не /i.test(msg)?'warn':'okmsg'}">${esc(msg)}</div>`:''}
    <button class="btn primary" id="lg-go">${mode==='in'?'Войти':'Зарегистрироваться'}</button>
    <button class="btn" id="lg-switch">${mode==='in'?'Я новый сотрудник':'У меня уже есть вход'}</button>
    <p class="meta">Новый сотрудник регистрируется сам, а менеджер включает ему доступ и назначает магазин.</p>
  </div>`;
  $('#lg-switch').onclick = () => renderLogin(mode==='in'?'up':'in');
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
  S.stores = st.data || [];
  S.store = ls.get('kassa_store', null) || me.home_store_id || (S.stores[0]||{}).id;
  if(!S.stores.some(s=>s.id===S.store)) S.store = (S.stores[0]||{}).id;
  renderShell(); await loadCatalog(); render(); flushQueue();
}

/* ---------- каркас ---------- */
function renderShell(){
  const tabs = [['pos','Продажа'],['sales','Чеки и возвраты'],['stock','Остатки'],['wh','Склад'],['certs','Сертификаты']];
  if(isBoss()) { tabs.splice(1,0,['analytics','Аналитика']); tabs.push(['emps','Сотрудники']); }
  $('#app').innerHTML = `<header id="hdr"></header><main id="main"></main>
    <nav class="tabs" role="tablist">${tabs.map(([v,t])=>`<button role="tab" data-view="${v}">${t}</button>`).join('')}</nav>`;
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); scrollTo(0,0); });
  renderHeader();
}
function renderHeader(){
  const h = $('#hdr'); if(!h) return;
  const q = queue();
  h.innerHTML = `<span class="brand">Касса</span>
    <select id="store-sel" aria-label="Магазин">${S.stores.map(s=>`<option value="${s.id}" ${s.id===S.store?'selected':''}>${esc(BRAND[s.brand]+' · '+s.city+', '+s.address)}</option>`).join('')}</select>
    <span class="who"><span class="net ${navigator.onLine?'':'off'}">${navigator.onLine?'онлайн':'нет интернета'}</span>
    ${q.length?`<span class="chip warn">в очереди: ${q.length}</span>`:''}
    <span>${esc(S.me.full_name)} · ${ROLE[S.me.role]}</span><button id="logout">Выйти</button></span>`;
  $('#store-sel').onchange = e => { S.store = +e.target.value; ls.set('kassa_store', S.store); S.cust = null; S.bonusSpend = 0; if(S.phone) lookupCustomer(); render(); };
  $('#logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
}
function render(){
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === S.view));
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  ({ pos:renderPos, sales:renderSales, stock:renderStock, certs:renderCerts, emps:renderEmps, analytics:renderAnalytics, wh:renderWh })[S.view]();
  if(id){ const el = document.getElementById(id); if(el){ el.focus(); try{ if(pos!=null) el.setSelectionRange(pos,pos) }catch(e){} } }
}

/* ---------- продажа ---------- */
function totals(){
  const sub = S.cart.reduce((a,l)=>a+l.price*l.qty,0);
  const lineDisc = S.cart.reduce((a,l)=>a+Math.min(l.disc||0, l.price*l.qty),0);
  const after = sub - lineDisc;
  const chk = Math.round(S.discType==='pct' ? after*Math.min(S.disc||0,100)/100 : Math.min(S.disc||0, after));
  return { sub, lineDisc, chk, total: after - chk };
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
          ${Object.entries(s).filter(([k,v])=>+k!==S.store&&v>0).slice(0,4).map(([k,v])=>`<span class="chip">${esc((S.stores.find(x=>x.id==k)||{}).address||k)}: ${v}</span>`).join('')}</span>
          <span class="price num">${fmt(p.price)}</span></button>`}).join('') : `<div class="empty">${S.q?'Ничего не найдено':'Отсканируйте штрихкод или введите название'}</div>`}</div>
   </div>
   <div class="card stack">
     <div class="row"><h2 style="margin:0">Чек</h2><span class="meta">${esc(storeName(S.store))}</span></div>
     ${S.cart.length ? S.cart.map((l,i)=>`<div class="line">
        <span>${esc(l.name)}</span><span class="price num">${fmt(l.price*l.qty-(l.disc||0))}</span>
        <div class="ctrl"><span class="qty"><button data-dec="${i}" aria-label="Меньше">−</button><span class="num">${l.qty}</span><button data-inc="${i}" aria-label="Больше">+</button></span>
        <span class="meta num">× ${fmt(l.price)}</span>
        <label class="meta">скидка ₸ <input class="small" type="number" min="0" id="ld-${i}" data-ldisc="${i}" value="${l.disc||''}" inputmode="numeric"></label>
        <button class="btn small" data-del="${i}">Убрать</button></div></div>`).join('') : '<div class="empty">Чек пуст</div>'}
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
         <div class="meta">Покупок в ${BRAND[brand]}: ${c.purchases} на ${fmt(c.total)}</div></div>`:''}
     </div>

     <div class="num">
       <div class="row"><span>Без скидок</span><span>${fmt(t.sub)}</span></div>
       ${t.lineDisc+t.chk?`<div class="row"><span>Скидки</span><span>−${fmt(t.lineDisc+t.chk)}</span></div>`:''}
       <div class="row total"><span>Итого</span><span>${fmt(t.total)}</span></div>
     </div>
     <div><div class="label" style="margin-bottom:6px">Способ оплаты — обязательно</div>
       <div class="pays">${Object.entries(PAY).filter(([k])=>k!=='bonus'||c).map(([k,v])=>`<div class="pay ${k in S.pays?'on':''}">
         <label><input type="checkbox" data-pay="${k}" ${k in S.pays?'checked':''}>${v}${k==='bonus'?` <span class="meta">до ${fmt(maxBonus()).replace(' ₸','')}</span>`:''}</label>
         ${k in S.pays?`<input type="number" min="0" id="pa-${k}" data-pamt="${k}" value="${S.pays[k]}" inputmode="numeric" aria-label="Сумма ${v}">`:''}
         ${k==='certificate'&&k in S.pays?`<input type="text" id="cert-code" placeholder="Номер сертификата" value="${esc(S.certCode)}"><button class="btn small" id="cert-check">Проверить</button>`:''}
       </div>`).join('')}</div></div>
     ${S.cart.length&&!keys.length?'<div class="warn">Выберите способ оплаты</div>':''}
     ${keys.length&&Math.abs(diff)>=1?`<div class="warn num">${diff>0?'Не хватает '+fmt(diff):'Лишние '+fmt(-diff)}</div>`:''}
     ${needCode?'<div class="warn">Введите номер сертификата</div>':''}
     <div class="row"><button class="btn" id="clear" ${S.cart.length?'':'disabled'}>Очистить</button>
       <button class="btn primary" id="checkout" ${canPay?'':'disabled'}>${S.busy?'Проводим…':'Провести чек'}</button></div>
   </div></div>`;
}
function addToCart(p){
  const l = S.cart.find(x=>x.pid===p.id);
  if(l) l.qty++; else S.cart.push({ pid:p.id, name:p.name, barcode:p.barcode, price:p.price, qty:1, disc:0 });
  syncPays(); render();
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
  S.cart=[]; S.disc=0; S.pays={}; S.certCode=''; S.phone=''; S.cust=null; S.custMsg=''; S.q=''; S.found=[];
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
  const methods = [...new Set(s.sale_payments.map(p=>p.method).filter(m=>m!=='bonus'))].concat(Object.keys(PAY).filter(k=>k!=='bonus'&&!s.sale_payments.some(p=>p.method===k)));
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
  const sortCol = S.stockSort === 'total' ? null : +S.stockSort;
  if(S.stockQ.trim()){
    const found = searchCatalog(S.stockQ).slice(0,100);
    await loadStock(found.map(p=>p.id));
    const q = p => { const st = S.stock[p.id]||{}; return sortCol ? (st[sortCol]||0) : S.stores.reduce((a,x)=>a+(st[x.id]||0),0); };
    S.stockRows = found.sort((a,b)=>q(b)-q(a));
  } else {
    const { data, error } = await sb.rpc('stock_top', { p_sort_store: sortCol, p_stores: null, p_limit: 200, p_offset: 0 });
    if(error) return toast(errText(error));
    const byId = new Map(S.catalog.map(a=>[a[0],a]));
    S.stockRows = (data||[]).map(r => { S.stock[r.product_id] = Object.fromEntries(Object.entries(r.per_store).map(([k,v])=>[+k,v]));
      const a = byId.get(r.product_id); return a ? prodObj(a) : { id:r.product_id, name:'(архив)', barcode:'', price:0 }; });
  }
}
function renderStock(){
  const sortCol = S.stockSort === 'total' ? null : +S.stockSort;
  const th = (key, label) => `<th><button class="btn small" data-ssort="${key}" style="${String(S.stockSort)===String(key)?'background:var(--ink);color:var(--surface)':''}">${label} ↓</button></th>`;
  $('#main').innerHTML = `<h2>Остатки по магазинам</h2>
    <div class="filters"><input id="stq" style="flex:1" placeholder="Название, штрихкод или артикул (пусто — все товары)" value="${esc(S.stockQ)}"><button class="btn" id="stq-go">Найти</button>
      <select id="stsort"><option value="total" ${S.stockSort==='total'?'selected':''}>Сортировать: всего по сети</option>${S.stores.map(st=>`<option value="${st.id}" ${String(S.stockSort)===String(st.id)?'selected':''}>Сортировать: ${esc(BRAND[st.brand]+' · '+st.address)}</option>`).join('')}</select></div>
    <p class="meta">${S.stockQ.trim()?'Найденные товары':'Топ-200 товаров по остатку'}, по убыванию ${sortCol?'в магазине '+esc(storeName(sortCol)):'по всей сети'}. Нажмите на заголовок магазина, чтобы отсортировать по нему.</p>
    ${S.stockRows.length?`<div class="scroll"><table><thead><tr><th>Товар</th>${S.stores.map(st=>th(st.id, esc(BRAND[st.brand])+'<br>'+esc(st.address))).join('')}${th('total','Всего')}<th></th></tr></thead><tbody>
    ${S.stockRows.map(p=>{ const st=S.stock[p.id]||{}; const qs=S.stores.map(x=>st[x.id]||0);
      return `<tr><td><b>${esc(p.name)}</b><br><span class="meta num">${esc(p.barcode)} · ${fmt(p.price)}</span></td>${qs.map((n,i)=>`<td class="num" style="${n?'':'color:var(--muted)'};${S.stores[i].id===sortCol?'background:var(--soft)':''}">${n}</td>`).join('')}
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
      <td>${esc((S.stores.find(s=>s.id===m.store_id)||{}).address||'')}</td><td class="num" style="color:${m.qty>0?'var(--ok)':'var(--bad)'}">${m.qty>0?'+':''}${m.qty}</td><td>${esc(m.employees?m.employees.full_name:'')}</td></tr>`).join('')}</tbody></table></div>
    <button class="btn" data-close>Закрыть</button>`);
}

/* ---------- склад: приёмка, оприходование, списание, перемещение, ревизия ---------- */
const WH = {
  receipt:   { t:'Приёмка', boss:true, hint:'Товар от поставщика. Закупочная цена обновится, после проведения можно напечатать этикетки.' },
  capitalize:{ t:'Оприходование', boss:true, hint:'Излишки и найденный товар без поставщика.' },
  writeoff:  { t:'Списание', boss:true, hint:'Брак, потеря, подарок. Причина обязательна.' },
  transfer:  { t:'Перемещение', boss:false, hint:'Создаёт перемещение менеджер. Товар списывается в магазине-отправителе сразу, а в магазине-получателе — когда там нажмут «Принять».' },
  audit:     { t:'Ревизия', boss:false, hint:'Сканируйте товар на полке — каждое сканирование +1. Продажи во время ревизии учитываются. Закрывает менеджер.' },
};
function whModes(){ return Object.entries(WH).filter(([k,v]) => !v.boss || isBoss()); }
function newDoc(mode){ return { mode, store:S.store, to:(S.stores.find(x=>x.id!==S.store)||{}).id, supplier:'', note:'', reason:'', items:[] }; }
async function loadWhSide(){
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
      <span class="chip ${t.status==='received'?'ok':'warn'}">${t.status==='received'?'принято':'в пути'}</span></div>
    <div class="meta">Отправила ${esc(t.sent_by||'')} ${new Date(t.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}${t.received_by?' · приняла '+esc(t.received_by):''}</div>
    <div>${(t.items||[]).map(i=>esc(i.name)+' × '+i.qty).join('<br>')}</div>
    ${t.status==='sent'&&(isBoss()||t.to===S.store)?`<button class="btn small primary" data-trrecv="${t.id}">Принять в ${esc(storeName(t.to))}</button>`:''}
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
  toast(WH[m].t+' проведено'); S.doc = newDoc(m); await loadWhSide(); render();
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
  const { data, error } = await sb.from('certificate_report').select('*').order('sold_at',{ascending:false}).limit(200);
  if(!error) S.certs = data || [];
}
function renderCerts(){
  const ST = { active:'активен', used:'использован', expired:'истёк', cancelled:'отменён' };
  $('#main').innerHTML = `<div class="grid2"><div>
    <h2>Сертификаты</h2>
    <div class="filters"><input id="cc" style="flex:1" placeholder="Проверить номер сертификата"><button class="btn" id="cc-go">Проверить</button></div>
    ${S.certs.length?`<div class="scroll"><table><thead><tr><th>Номер</th><th>Номинал / остаток</th><th>Статус</th><th>Продан</th><th>Кто купил → кому</th><th>Где использован</th></tr></thead><tbody>
    ${S.certs.map(c=>`<tr><td><b>${esc(c.code)}</b><br><span class="meta">${c.kind==='electronic'?'электронный':'физический'}</span></td>
      <td class="num">${fmt(c.nominal)}<br><span class="meta">осталось ${fmt(c.balance)}</span></td>
      <td><span class="chip ${c.status==='active'?'ok':c.status==='used'?'':'zero'}">${ST[c.status]||c.status}</span><br><span class="meta">до ${new Date(c.expires_at).toLocaleDateString('ru-RU')}</span></td>
      <td>${esc(c.sold_city)}, ${esc(c.sold_store)}<br><span class="meta">${new Date(c.sold_at).toLocaleDateString('ru-RU')}</span></td>
      <td>${esc(c.buyer_name||'')} ${esc(c.buyer_phone||'')}<br>→ ${esc(c.recipient_name||'')} ${esc(c.recipient_phone||'')}</td>
      <td>${esc(c.used_in||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Сертификатов пока нет</div>'}
  </div>
  <div class="card stack"><h2 style="margin:0">Продать сертификат</h2>
    <div class="seg" id="ck-kind"><button data-ck="physical" aria-pressed="true">Физический</button><button data-ck="electronic" aria-pressed="false">Электронный</button></div>
    <input id="c-code" placeholder="Номер с карточки (пусто — создать автоматически)">
    <input id="c-amount" type="number" min="1" placeholder="Номинал, ₸" inputmode="numeric">
    <div class="label">Кто покупает</div>
    <input id="c-bname" placeholder="Имя покупателя"><input id="c-bphone" placeholder="Телефон покупателя *" inputmode="tel">
    <div class="label">Кому сертификат</div>
    <input id="c-rname" placeholder="Имя получателя"><input id="c-rphone" placeholder="Телефон получателя" inputmode="tel">
    <select id="c-pay">${['cash','card','kaspi_qr','transfer','invoice'].map(k=>`<option value="${k}">${PAY[k]}</option>`).join('')}</select>
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
async function loadAnalytics(){
  const [from, to] = periodRange(), ids = selStores();
  const rows = []; let off = 0;
  while(true){
    const { data, error } = await sb.from('sales').select('id,kind,store_id,total,discount_total,created_at,is_certificate_sale,customer_id,sale_items(product_id,qty,total,products(name)),sale_payments(method,amount)')
      .in('store_id', ids).gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).order('created_at').range(off, off+999);
    if(error){ toast(errText(error)); break; }
    rows.push(...data); if(data.length < 1000 || rows.length >= 20000) break; off += 1000;
  }
  const A = { revenue:0, checks:0, returns:0, returnsSum:0, discounts:0, certSold:0, items:0, clients:new Set(), byStore:{}, byPay:{}, byProd:{}, byDay:{} };
  for(const r of rows){
    const sign = r.kind==='return' ? -1 : 1, st = (A.byStore[r.store_id] ||= { revenue:0, checks:0, returns:0 });
    if(r.is_certificate_sale){ A.certSold += +r.total; continue; }
    A.revenue += sign*r.total; st.revenue += sign*r.total;
    if(r.kind==='return'){ A.returns++; A.returnsSum += +r.total; st.returns++; } else { A.checks++; st.checks++; A.discounts += +r.discount_total; }
    if(r.customer_id) A.clients.add(r.customer_id);
    const day = r.created_at.slice(0,10); A.byDay[day] = (A.byDay[day]||0) + sign*r.total;
    r.sale_payments.forEach(p => { A.byPay[p.method] = (A.byPay[p.method]||0) + sign*p.amount; });
    r.sale_items.forEach(i => { A.items += sign*i.qty; const p = (A.byProd[i.product_id] ||= { name:i.products?i.products.name:'', qty:0, sum:0 }); p.qty += sign*i.qty; p.sum += sign*i.total; });
  }
  S.an = A;
}
function renderAnalytics(){
  const A = S.an;
  const periods = [['today','Сегодня'],['7','7 дней'],['30','30 дней'],['90','3 месяца'],['365','Год'],['custom','Свой период']];
  const days = A ? Object.entries(A.byDay).sort() : [], maxDay = Math.max(1, ...days.map(d=>d[1]));
  $('#main').innerHTML = `<h2>Аналитика</h2>${storeFilterHtml()}
    <div class="filters">${periods.map(([k,t])=>`<button class="btn small ${S.period===k?'primary':''}" data-period="${k}">${t}</button>`).join('')}
      ${S.period==='custom'?`<input type="date" id="an-from" value="${S.from}"><input type="date" id="an-to" value="${S.to}"><button class="btn small" id="an-go">Показать</button>`:''}</div>
    ${!A?'<div class="empty">Загружаем…</div>':`
    <div class="pays" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      ${[['Выручка',fmt(A.revenue)],['Чеков',A.checks],['Средний чек',fmt(A.checks?A.revenue/A.checks:0)],['Продано штук',A.items],['Возвраты',A.returns+' · '+fmt(A.returnsSum)],['Скидки',fmt(A.discounts)],['Клиентов с картой',A.clients.size],['Продано сертификатов',fmt(A.certSold)]]
        .map(([k,v])=>`<div class="card"><div class="label">${k}</div><div class="total num" style="font-size:20px">${v}</div></div>`).join('')}
    </div>
    ${days.length?`<h2 style="margin-top:16px">Выручка по дням</h2><div class="card" style="display:flex;align-items:flex-end;gap:3px;height:140px;overflow-x:auto">
      ${days.map(([d,v])=>`<div title="${d}: ${fmt(v)}" style="flex:1 0 8px;max-width:28px;background:var(--accent);opacity:.85;height:${Math.max(2,Math.round(v/maxDay*120))}px;border-radius:3px 3px 0 0"></div>`).join('')}</div>`:''}
    <div class="grid2" style="margin-top:16px"><div>
      <h2>По магазинам</h2><div class="scroll"><table><thead><tr><th>Магазин</th><th>Выручка</th><th>Чеков</th><th>Средний чек</th><th>Возвратов</th></tr></thead><tbody>
      ${Object.entries(A.byStore).sort((a,b)=>b[1].revenue-a[1].revenue).map(([id,v])=>`<tr><td>${esc(storeName(+id))}</td><td class="num">${fmt(v.revenue)}</td><td class="num">${v.checks}</td><td class="num">${fmt(v.checks?v.revenue/v.checks:0)}</td><td class="num">${v.returns}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Продаж за период нет</td></tr>'}</tbody></table></div>
      <h2 style="margin-top:16px">Способы оплаты</h2><div class="scroll"><table><tbody>
      ${Object.entries(A.byPay).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${PAY[k]||k}</td><td class="num">${fmt(v)}</td><td class="num meta">${A.revenue?Math.round(v/A.revenue*100):0}%</td></tr>`).join('') || '<tr><td class="meta">—</td></tr>'}</tbody></table></div>
    </div><div>
      <h2>Топ товаров</h2><div class="scroll"><table><thead><tr><th>Товар</th><th>Шт.</th><th>Сумма</th></tr></thead><tbody>
      ${Object.values(A.byProd).sort((a,b)=>b.sum-a.sum).slice(0,20).map(p=>`<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td class="num">${fmt(p.sum)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">—</td></tr>'}</tbody></table></div>
    </div></div>
    <p class="meta">Пока считается по чекам, пробитым в новой кассе. После переноса истории из Wipon здесь будут и прошлые продажи.</p>`}`;
}

/* ---------- сотрудники ---------- */
async function loadEmps(){ const { data } = await sb.from('employees').select('*').order('created_at'); S.emps = data || []; }
function renderEmps(){
  $('#main').innerHTML = `<h2>Сотрудники</h2><p class="meta">Сотрудник регистрируется сам на странице входа. Здесь включите доступ, роль и магазин.</p>
    <div class="scroll"><table><thead><tr><th>Имя</th><th>Роль</th><th>Магазин</th><th>Доступ</th></tr></thead><tbody>
    ${S.emps.map(e=>`<tr><td>${esc(e.full_name)}</td>
      <td><select data-erole="${e.id}">${Object.entries(ROLE).map(([k,v])=>`<option value="${k}" ${e.role===k?'selected':''}>${v}</option>`).join('')}</select></td>
      <td><select data-estore="${e.id}"><option value="">—</option>${S.stores.map(s=>`<option value="${s.id}" ${e.home_store_id===s.id?'selected':''}>${esc(BRAND[s.brand]+' · '+s.address)}</option>`).join('')}</select></td>
      <td><label><input type="checkbox" data-eact="${e.id}" ${e.active?'checked':''}> включён</label></td></tr>`).join('')}</tbody></table></div>`;
}
async function updEmp(id, patch){ const { error } = await sb.from('employees').update(patch).eq('id', id); if(error) toast(errText(error)); else toast('Сохранено'); }

/* ---------- модальное окно ---------- */
function modal(html){ $('#modal').innerHTML = `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true">${html}</div></div>`; }
function closeModal(){ $('#modal').innerHTML = ''; }

/* ---------- события ---------- */
let searchTimer;
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
  else if(d.pay){ const k=d.pay; if(k in S.pays) delete S.pays[k]; else S.pays[k] = k==='bonus' ? Math.min(maxBonus(), Math.max(0, totals().total-paid())) : Math.max(0, totals().total-paid()); syncPays(); render(); }
  else if(t.id==='cust-find') lookupCustomer();
  else if(t.id==='cust-clear'){ S.cust=null; S.phone=''; S.custMsg=''; delete S.pays.bonus; syncPays(); render(); }
  else if(t.id==='cust-create'){
    const p = normPhone(S.phone); const { error } = await sb.rpc('customer_upsert', { p_phone:p, p_name:$('#new-name').value, p_birthday:$('#new-bd').value||null });
    if(error) return toast(errText(error)); toast('Клиент создан'); lookupCustomer();
  }
  else if(t.id==='cert-check'){ if(S.certCode.trim()) checkCert(S.certCode.trim()); }
  else if(t.id==='clear'){ S.cart=[]; S.disc=0; S.pays={}; S.certCode=''; render(); }
  else if(t.id==='checkout') checkout();
  else if(t.id==='sq-go'){ await loadSales(); render(); }
  else if(d.ret) openReturn(d.ret);
  else if(t.id==='stq-go'){ await loadStockView(); render(); }
  else if(d.hist) openHistory(d.hist);
  else if(t.id==='cc-go'){ const v=$('#cc').value.trim(); if(v) checkCert(v); }
  else if(d.ck){ document.querySelectorAll('#ck-kind button').forEach(b=>b.setAttribute('aria-pressed', b===t)); }
  else if(t.id==='c-sell') sellCert();
  else if(d.eact){ updEmp(d.eact, { active:t.checked }); }
  else if(d.sgroup){ const g=d.sgroup; S.sel = S.stores.filter(st => g==='all' || st.brand===g || st.city===g).map(st=>st.id); onSelChange(); }
  else if(d.sone){ const id=+d.sone; selStores(); S.sel = t.checked ? [...new Set([...S.sel, id])] : S.sel.filter(x=>x!==id); if(!S.sel.length) S.sel=[id]; onSelChange(); }
  else if(d.wmode){ S.wmode=d.wmode; S.dq=''; S.dfound=[]; await loadWhSide(); render(); }
  else if(d.dadd){ const p=S.dfound.find(x=>x.id===d.dadd); if(p) docAdd(p); }
  else if(t.id==='dq-add'){ const r=searchCatalog(S.dq); if(r.length===1 || (r[0]&&r[0].barcode===S.dq.trim())) docAdd(r[0]); else { S.dfound=r; render(); } }
  else if(d.ddel){ S.doc.items.splice(+d.ddel,1); render(); }
  else if(t.id==='d-post'){ t.disabled=true; await postDoc(); }
  else if(d.trrecv){ const { error } = await sb.rpc('receive_transfer', { p_transfer:d.trrecv }); if(error) toast(errText(error)); else { toast('Перемещение принято'); await loadWhSide(); render(); } }
  else if(d.labels){ printLabels(JSON.parse(d.labels)); }
  else if(t.id==='au-start'){ const { error } = await sb.rpc('audit_start', { p_store:S.store }); if(error) toast(errText(error)); await loadAudit(); render(); }
  else if(t.id==='au-uncounted'){ const { data } = await sb.rpc('audit_diff', { p_audit:S.audit.id, p_include_uncounted:true }); S.auditRows=(data&&data.rows)||[]; render(); }
  else if(t.id==='au-close'||t.id==='au-close-full'){ const full=t.id==='au-close-full';
    modal(`<h2>Закрыть ревизию?</h2><p>${full?'Все товары, которые не посчитали, будут обнулены в этом магазине.':'Остатки поправятся только по посчитанным товарам.'}</p>
      <div class="row"><button class="btn" data-close>Отмена</button><button class="btn primary" data-auclose="${full?1:0}">Закрыть ревизию</button></div>`); }
  else if(d.auclose!=null){ const { error } = await sb.rpc('close_audit', { p_audit:S.audit.id, p_full:d.auclose==='1' }); closeModal(); if(error) toast(errText(error)); else { toast('Ревизия закрыта, остатки поправлены'); await loadAudit(); render(); } }
  else if(d.ssort){ S.stockSort = d.ssort; await loadStockView(); render(); }
  else if(d.period){ S.period=d.period; if(d.period!=='custom'){ S.an=null; render(); await loadAnalytics(); } render(); }
  else if(t.id==='an-go'){ S.from=$('#an-from').value; S.to=$('#an-to').value; S.an=null; render(); await loadAnalytics(); render(); }
});
document.addEventListener('change', e => {
  const t = e.target, d = t.dataset;
  if(d.erole) updEmp(d.erole, { role:t.value });
  if(d.estore) updEmp(d.estore, { home_store_id: t.value ? +t.value : null });
  if(t.id==='d-store'){ S.doc.store=+t.value; }
  if(t.id==='d-to'){ S.doc.to=+t.value; }
  if(d.acset){ sb.rpc('audit_count', { p_audit:S.audit.id, p_product:d.acset, p_delta:0, p_set:Math.max(0,+t.value||0) }).then(async r=>{ if(r.error) toast(errText(r.error)); await loadAudit(); render(); }); }
  if(t.id==='stsort'){ S.stockSort = t.value; loadStockView().then(render); }
});
document.addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if(t.id==='q'){ S.q = t.value; clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 200); }
  else if(d.ldisc!=null){ S.cart[+d.ldisc].disc = Math.max(0,+t.value||0); syncPays(); render(); }
  else if(t.id==='disc'){ S.disc = Math.max(0,+t.value||0); syncPays(); render(); }
  else if(t.id==='phone'){ S.phone = t.value; if(normPhone(t.value) && t.value.replace(/\D/g,'').length>=10){ clearTimeout(searchTimer); searchTimer=setTimeout(lookupCustomer, 300); } }
  else if(d.pamt){ S.pays[d.pamt] = Math.max(0,+t.value||0); if(d.pamt==='bonus') S.pays.bonus = Math.min(S.pays.bonus, maxBonus()); render(); }
  else if(t.id==='cert-code'){ S.certCode = t.value; }
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
  if(S.view==='analytics'){ S.an=null; render(); await loadAnalytics(); render(); }
});

sb.auth.onAuthStateChange((ev) => { if(ev==='SIGNED_OUT') renderLogin(); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
boot();
