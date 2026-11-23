/* код обновления для расширения Silver: расширение подгружает этот файл с сайта, поэтому правки не требуют переустановки */
function silverChinaSync(K){
  const SB = 'https://ottuadjdksxipfjytlyv.supabase.co/rest/v1/rpc/', AK = 'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo';
  const rpc = async (fn, body) => { const r = await fetch(SB + fn, { method:'POST', headers:{ 'content-type':'application/json', apikey:AK, authorization:'Bearer ' + AK }, body:JSON.stringify(body) }); const j = await r.json().catch(() => null); if(!r.ok) throw Error((j && (j.message || j.hint)) || ('Silver ' + r.status)); return j; };
  let b = document.getElementById('silver-cn');
  if(!b){ b = document.createElement('div'); b.id = 'silver-cn'; b.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);max-width:92vw;padding:12px 18px;border-radius:14px;background:#111;color:#fff;font:600 14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)'; document.body.appendChild(b); }
  const say = t => { b.textContent = t; };
  const h = location.hostname, day = 864e5, LIMIT = Date.now() - 31 * day;   // только последний месяц
  const send = async (src, orders) => { const tot = { new:0, updated:0, items:0, linked:0 }; for(let i = 0; i < orders.length; i += 40){ const d = await rpc('po_ingest', { p_key:K, p_source:src, p:orders.slice(i, i + 40) }); for(const k in tot) tot[k] += +(d || {})[k] || 0; } return tot; };
  const done = (name, t) => say('Silver ✓ ' + name + ': новых заказов ' + t.new + ', обновлено ' + t.updated + (t.items ? ', позиций ' + t.items + ' (сразу связано с базой ' + t.linked + ')' : '') + '. Вкладку можно закрыть.');
  async function c1688(){
    if(!(window.lib && lib.mtop && lib.mtop.request)){ say('Silver: открываю страницу заказов 1688… Когда она загрузится, нажмите закладку ещё раз.'); location.href = 'https://trade.1688.com/order/buyer_order_list.htm'; return; }
    const ST = { waitsellersend:'等待卖家发货', waitbuyerreceive:'等待买家确认收货', waitbuyersign:'等待买家确认收货', send_goods_but_not_fund:'等待买家确认收货', confirm_goods:'已收货', confirm_goods_but_not_fund:'已收货', success:'交易成功', cancel:'交易关闭', terminated:'交易关闭' };
    const num = v => +(v && typeof v === 'object' ? (v.realAmount ?? v.calAmount) : v) || 0, yuan = v => Math.round(num(v)) / 100;
    const out = []; let old = false;
    for(let page = 1; page <= 8 && !old; page++){
      say('Silver: читаю заказы 1688, страница ' + page + '…');
      const r = await lib.mtop.request({ api:'mtop.1688.trading.dataline.service', v:'1.0', type:'POST', dataType:'json', valueType:'original', data:{ serviceId:'OrderListDataLineService.buyerOrderList', param:JSON.stringify({ page, pageSize:50 }) } });
      let x = r && r.data && r.data.data && r.data.data.result; if(typeof x === 'string') x = JSON.parse(x);
      const L = (x && x.data && x.data.data) || []; if(!L.length) break;
      for(const o of L){
        const t = Date.parse(String(o.gmtCreate).replace(' ', 'T') + '+08:00'); if(t < LIMIT){ old = true; continue; }
        if(o.status === 'waitbuyerpay') continue;   // ещё не оплачен — заберём, когда оплатите
        const qty = e => { let q = e.quantity; if(typeof q === 'string'){ try{ q = JSON.parse(q); }catch(_){ } } return num(q) || 1; };
        out.push({ no:String(o.idStr || o.id), seller:o.sellerInfo && o.sellerInfo.companyName, seller_login:o.sellerInfo && o.sellerInfo.loginId, ship:yuan(o.carriage), adj:yuan(o.adjustFee), status:ST[o.status] || o.statusLabel || o.status, created:o.gmtCreate, track:null,
          items:(o.orderEntries || []).map(e => { let sp = e.specInfo; if(typeof sp === 'string'){ try{ sp = JSON.parse(sp); }catch(_){ sp = null; } } const spec = ((sp && sp.specItems) || []).map(s => s.specValue).filter(Boolean).join(' / ');
            return { title:(e.productName || '') + (spec ? ': ' + spec : ''), price:yuan(e.actualUnitPrice || e.price), qty:qty(e), unit:e.unit || null, art:e.productNumber || null, offer:e.sourceId ? String(e.sourceId) : null, sku:e.skuId ? String(e.skuId) : null, sku_art:null }; }) });
      }
      if(x.data.pages && page >= x.data.pages) break;
    }
    say('Silver: отправляю ' + out.length + ' заказов…');
    done('Китай', await send('1688', out));
  }
  async function cAli(){
    if(h !== 'biz.alibaba.com'){ say('Silver: открываю страницу заказов Alibaba… Когда она загрузится, нажмите закладку ещё раз.'); location.href = 'https://biz.alibaba.com/order/list.htm'; return; }
    const ck = n => (document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')) || [])[1] || '';
    const list = []; let old = false;
    for(let page = 1; page <= 10 && !old; page++){
      say('Silver: читаю заказы Alibaba, страница ' + page + '…');
      const q = { requests:{ simpleFilter:null, pagination:{ currentPage:page, pageSize:20 } }, pagination:{ currentPage:page, pageSize:20 }, responseModel:'V2', requestEnvironment:{ operator:{ role:'buyer' } } };
      const j = await fetch('/list/ajax/ta/mainv2.json?json=' + encodeURIComponent(JSON.stringify(q)) + '&ctoken=' + ck('ctoken') + '&_tb_token_=' + ck('_tb_token_'), { credentials:'include' }).then(r => r.json());
      const p = j && j.data && j.data.pageData; if(!p || !p.data || !p.data.length) break;
      for(const o of p.data){ if(Date.parse(o.baseInfo.createTime) < LIMIT) old = true; else list.push(o); }
      if(!p.pagination || page >= p.pagination.totalPage) break;
    }
    const L = list.filter(o => o.statusAction && o.statusAction.status && o.statusAction.status.name !== 'unpay');
    const known = new Set(await rpc('po_known', { p_key:K, p_source:'alibaba', p_nos:L.map(o => String(o.baseInfo.id)) }) || []);
    const out = []; let i = 0;
    for(const o of L){
      const no = String(o.baseInfo.id), st = o.statusAction.status.displayName || o.statusAction.status.name, pay = o.paymentInfo || {}, n = v => (v && +v.number) || 0;
      const base = { no, seller:o.seller && o.seller.companyName, created:o.baseInfo.createTime, status:st, track:null, ship:n(pay.shippingFeeAmount), fee:0, discount:0, items:[] };
      if(!known.has(no)){
        say('Silver: читаю состав нового заказа Alibaba ' + (++i) + '…');
        const t = await fetch('/ta/detail.htm?orderId=' + no, { credentials:'include' }).then(r => r.text());
        const a = t.indexOf('window["simpleTradeDetailVO"]'), z = t.indexOf('</script>', a);
        let vo = null; try{ vo = JSON.parse(t.slice(t.indexOf('=', a) + 1, z).trim().replace(/;$/, '')); }catch(_){ }
        const find = (x, d) => { if(!x || typeof x !== 'object' || d > 6) return null; if(Array.isArray(x.products) && x.products[0] && x.products[0].skuId !== undefined) return x.products; for(const v of Object.values(x)){ const r = find(v, d + 1); if(r) return r; } return null; };
        const P = find(vo, 0);
        if(P) base.items = P.map(e => ({ title:e.name, spec:e.sku || null, price:+((e.unitPriceAmountVO && e.unitPriceAmountVO.amount) || 0), qty:+e.quantity || 1, unit:e.unit && (e.unit.name || e.unit.code), offer:e.productId ? String(e.productId) : null, sku:e.skuId ? String(e.skuId) : null, photo:e.snapshotImage || null }));
        else (o.productInfo && o.productInfo.products || []).forEach(pr => (pr.skuList || []).forEach(s => base.items.push({ title:pr.name, spec:s.skuDescription || null, price:n(s.unitPrice), qty:n(s.quantity) || 1, unit:s.unit, offer:String(pr.id), sku:s.skuId ? String(s.skuId) : null, photo:s.imageUrl || pr.imageUrl })));
      }
      out.push(base);
    }
    say('Silver: отправляю ' + out.length + ' заказов…');
    done('Alibaba', await send('alibaba', out));
  }
  (/(^|\.)1688\.com$/.test(h) ? c1688() : /(^|\.)alibaba\.com$/.test(h) ? cAli() : Promise.resolve(say('Silver: откройте страницу заказов 1688 или Alibaba и нажмите закладку там.'))).catch(e => say('Silver: ошибка — ' + e.message));
}
/* Wipon: по очереди выбираем каждое ИП (как переключатель внизу слева), передаём его сеанс Silver и забираем данные; в конце возвращаем ИП, которое было открыто */
function silverWiponAll(K){
  let b = document.getElementById('silver-wu');
  if(!b){ b = document.createElement('div'); b.id = 'silver-wu'; b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;background:#1d2b4f;color:#fff;padding:8px 12px;border-radius:10px;font:13px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:420px'; document.body.appendChild(b); }
  const say = t => { b.textContent = t; };
  const SRV = 'https://ottuadjdksxipfjytlyv.supabase.co/functions/v1/wipon_srv';
  const call = async body => { const r = await fetch(SRV, { method:'POST', headers:{ 'content-type':'application/json', 'x-ingest':K }, body:JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if(!r.ok || j.error) throw Error(j.error || ('Silver ' + r.status)); return j; };
  const V = () => JSON.parse(localStorage.getItem('vuex'));
  const W = async (tk, path, opt) => { const r = await fetch('https://api.wipon.kz' + path, Object.assign({ headers:{ Accept:'application/json', 'Content-Type':'application/json', Authorization:'Bearer ' + tk } }, opt || {})); if(!r.ok) throw Error('Wipon ' + r.status); return r.json(); };
  (async () => {
    let tk = V().user.token; const me = V().employee.item.id;
    const L = ((await W(tk, '/v1/employee/' + me + '/companies')).data) || [];
    const cur = L.find(c => c.employee_id === me) || L[0]; if(!cur) throw Error('нет списка ИП');
    const order = [...L.filter(c => c !== cur), cur];   // текущее ИП — последним, чтобы в Wipon осталось как было
    let active = cur, n = 0, sales = 0;
    // история приёмок (только для аналитики Silver): дозагружаем новые строки по каждому ИП
    const SBR = 'https://ottuadjdksxipfjytlyv.supabase.co/rest/v1/rpc/';
    const sbr = async (fn, body) => { const r = await fetch(SBR + fn, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:'sb_publishable_OyN1810CuHrR9Ys0VTSExA_XY-nO7zo' }, body:JSON.stringify(body) }); if(!r.ok) throw Error('Silver ' + r.status); return r.json(); };
    const LAST = await sbr('wipon_arrivals_last', { p_key:K }).catch(() => ({}));
    const amap = x => ({ id:x.id, c:x.item && x.item.company_id, s:x.stock && x.stock.id, sn:x.stock_name, i:x.item && x.item.id, b:x.item && x.item.barcode, n:(x.item_name||'').slice(0,120), q:x.quantity, p:x.purchase_price, d:x.date, k:x.invoice && x.invoice.kind_id, r:x.invoice && x.invoice.reason_id, st:x.invoice && x.invoice.status });
    const arrPull = async c => { const since = LAST[c.id] ? new Date(LAST[c.id]).getTime() - 2*864e5 : Date.now() - 30*864e5;
      for(let pg = 1; pg <= 60; pg++){ const a = await W(tk, '/v1/employee/' + c.employee_id + '/arrival?page=' + pg + '&per_page=100'); const D = a.data || []; if(!D.length) break;
        await sbr('wipon_arrivals_ingest', { p_key:K, p:D.map(amap) }); arr += D.length;
        if(new Date(D[D.length-1].date).getTime() < since || pg >= ((a.meta||{}).last_page || 1)) break; } };
    let arr = 0;
    try{
      for(const c of order){
        say('Silver: ИП «' + c.name + '» (' + (++n) + ' из ' + order.length + ')…');
        if(c !== active){ const j = await W(tk, '/v1/switch', { method:'POST', body:JSON.stringify({ company_id:c.id }) }); const nt = j.access_token || (j.data && j.data.access_token); if(!nt) throw Error('Wipon не переключил ИП'); tk = nt; active = c; }
        await call({ action:'set_token', token:tk, emps:[c.employee_id], cos:{ [c.employee_id]:c.name } });
        const p = await call({ action:'pull_one', emp:c.employee_id }).catch(() => null); if(p && p.sales) sales += +p.sales;
        await arrPull(c).catch(() => null);
      }
    } finally {
      try{ const v = V(); v.user.token = tk; localStorage.setItem('vuex', JSON.stringify(v)); }catch(_){ }   // свежий сеанс — в эту вкладку Wipon
    }
    say('Silver ✓ Wipon: все ИП обновлены (' + order.length + '), новых чеков: ' + sales);
  })().catch(e => say('Silver: ошибка — ' + e.message));
}

window.__silverSync = { china:silverChinaSync, alibaba:silverChinaSync, wipon:silverWiponAll };
