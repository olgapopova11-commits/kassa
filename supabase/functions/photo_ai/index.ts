// AI-фото товаров через Grok (xAI).
// Стили и критерии — из документа «Стили генерации фото украшений — критерии» (таблица photo_styles).
// Действия:
//   status / set_key            — ключ xAI (хранится в app_secrets('xai'), в браузер не возвращается)
//   styles                      — список активных стилей
//   analyze                     — распознать изделие (тип, металл, камни, детали) + предложить стили и поля карточки
//   gen                         — сгенерировать N вариантов в стиле, с автопроверкой совпадения и перегенерацией брака (до 3 попыток)
//   check                       — перепроверить фото против фото настоящего изделия (приёмка: черновик «по фото поставщика» → черновик)
//   review                      — одобрить / в брак / сделать главным фото товара
//   gen с order_item_id без фото — черновики по фото поставщика из заказа (Китай); после связи с товаром переходят к нему
// Совместимость: gen с mode "white"/"model" (старый экран) = стили catalog/tryon.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const XAI = "https://api.x.ai/v1";
const IMAGE_MODEL = "grok-imagine-image-2.0";
const VISION_MODEL = "grok-4.20-0309-non-reasoning";   // распознавание: быстро и дёшево
const CHECK_MODEL = "grok-4.20-0309-reasoning";        // проверка совпадения: внимательнее
const MAX_ATTEMPTS = 3;
const TIME_BUDGET_MS = 110_000;                         // не упираемся в лимит функции
const TICK = 1e-10;                                     // usage.cost_in_usd_ticks → USD

type Emp = { id: string; role: string; active: boolean };
type Style = { code: string; title: string; method: string; aspect: string; item_share: string | null; prompt: string; brand: string | null; card_slot: number | null };

// ---------- общие правила (раздел «Общие правила для всех стилей») ----------
const RULES = [
  "THE ITEM MUST NOT CHANGE: identical shape and silhouette, the same number, color and shape of stones/pearls/beads/charms, the same metal color, the same chain/link type and clasp, the same engraving. Do not add, remove, redesign or 'improve' anything.",
  "Keep the item at its true real-world scale.",
  "The whole item is in sharp focus; blur only the background.",
  "Stones show natural light play, pearls a soft nacre luster, without artificial star sparkles.",
  "No text, letters, hieroglyphs, logos, watermarks, price tags, rulers, color cards, hands of the photographer or foreign jewelry in the frame. Do not imitate any famous brand.",
  "Photorealistic, high-end commercial quality.",
].join(" ");
const metalLight = (metal: string) => /зол|gold|розов|rose/i.test(metal) ? "Metal is gold-toned: use warm soft light." : /сереб|silver|родий|сталь|steel|white/i.test(metal) ? "Metal is silver-toned: use neutral or slightly cool light." : "";
const PEOPLE = "If a person appears: natural skin texture, natural manicure, anatomically correct hands (five fingers), ears and neck; appearance close to young women from Almaty and Astana, Kazakhstan.";

// ---------- подбор стилей (раздел «Как Silver предлагает стиль») ----------
const TYPE_RU: Record<string, string> = { ring: "Кольцо", earrings: "Серьги", necklace: "Колье / цепь / подвеска", bracelet: "Браслет", hair: "Аксессуар для волос", brooch: "Брошь", other: "Другое" };
function suggestStyles(a: any, brand: string | null, season: string | null, gift: boolean) {
  const t = a?.type || "other", metal = String(a?.metal_color || ""), stones = a?.stones || [];
  const out: { code: string; why: string; scene?: string }[] = [];
  const add = (code: string, why: string, scene?: string) => { if (!out.some((x) => x.code === code)) out.push({ code, why, scene }); };
  const prodScene: Record<string, string> = { ring: "on a stone or matte ceramic", earrings: "on a small stand", necklace: "on silk", bracelet: "on travertine", hair: "on linen", brooch: "on linen" };
  add("catalog", t === "earrings" ? "Первое фото карточки: серьги парой на чистом фоне" : t === "necklace" ? "Первое фото карточки: раскладкой на чистом фоне" : "Первое фото карточки на чистом фоне");
  add("tryon", ({ ring: "Как сидит на руке", earrings: "Как смотрятся на ухе, в профиль", necklace: "Как лежит на декольте", bracelet: "Как сидит на запястье", hair: "Как смотрится в волосах" } as Record<string, string>)[t] || "Как смотрится на человеке");
  if (t === "bracelet") add("creative", "Для бренда и соцсетей: браслет на неожиданном предмете");
  else add("product", "Второе фото карточки: студийная сцена", prodScene[t]);
  const pearls = stones.some((s: any) => /жемч|pearl/i.test(`${s.color} ${s.shape} ${s.kind || ""}`)) || /жемч|pearl/i.test(a?.notes || "");
  const cz = stones.some((s: any) => /фиан|циркон|кристал|zircon|crystal|прозрач/i.test(`${s.color} ${s.kind || ""}`)) || stones.some((s: any) => (s.size || "") === "large");
  let palette = "";
  if (pearls) palette = "warm pastel backgrounds, silk, soft light";
  else if (cz) palette = "dark or contrast background, spot light to show the stone play";
  else if (/зол|gold/i.test(metal)) palette = "warm palette: sand, terracotta, olive";
  else if (/сереб|silver|сталь|родий/i.test(metal)) palette = "cool/neutral palette: grey stone, light blue, white marble";
  if (season) add("creative", `Сезонный товар (${season}): креатив с сезонными реквизитами`, `seasonal props for ${season}`);
  if (gift) add("creative", "Подарочный товар: сцена с фирменной упаковкой", `with the ${brand === "moon" ? "MOON" : brand === "sunshine" ? "Sunshine" : "brand"} gift box`);
  return { styles: out.slice(0, 4), palette };
}

// ---------- xAI ----------
async function xai(key: string, path: string, body: unknown) {
  const r = await fetch(XAI + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) });
  const txt = await r.text(); let j: any = null; try { j = JSON.parse(txt); } catch (_) { /* */ }
  if (!r.ok) throw new Error("Grok: " + (j?.error?.message || j?.error || j?.message || txt.slice(0, 300)));
  return j;
}
const usd = (j: any) => (+(j?.usage?.cost_in_usd_ticks || 0)) * TICK;
async function vision(key: string, model: string, text: string, images: string[]) {
  const j = await xai(key, "/chat/completions", {
    model, temperature: 0, response_format: { type: "json_object" },
    messages: [{ role: "user", content: [{ type: "text", text }, ...images.map((u) => ({ type: "image_url", image_url: { url: u, detail: "high" } }))] }],
  });
  let out: any = {}; try { out = JSON.parse(j?.choices?.[0]?.message?.content || "{}"); } catch (_) { out = {}; }
  return { out, cost: usd(j) };
}

const ANALYZE_PROMPT = `Ты эксперт по ювелирной предметной съёмке. На фото — одно изделие (украшение или аксессуар для волос), возможно на фото поставщика с надписями.
Верни JSON строго такого вида (по-русски, кроме поля type):
{"type":"ring|earrings|necklace|bracelet|hair|brooch|other",
 "type_ru":"...", "metal_color":"золотистый|серебристый|розовое золото|чёрный|разноцветный|нет металла",
 "stones":[{"kind":"фианит|жемчуг|натуральный камень|смола|эмаль|бусина|...","color":"...","shape":"...","count":число,"size":"small|medium|large"}],
 "elements_count":число отдельных предметов на фото (пара серёг = 2),
 "chain":"тип плетения или null","clasp":"тип застёжки или null","engraving":"текст/узор гравировки или null",
 "key_details":["5–10 коротких признаков, по которым изделие точно узнаётся"],
 "size_estimate":"примерный размер в мм или null",
 "has_watermark_or_text":true|false,"has_other_items":true|false,"is_collage":true|false,
 "card":{"category":"Кольца|Серьги|Колье|Цепочки|Подвески|Браслеты|Для волос|Броши|...","material":"Нержавейка|Мед сплав|Серебро 925|Пластик|другой|...","color":"цвет по-русски"},
 "notes":"одно предложение"}`;

function checkPrompt(a: any, strict: boolean) {
  return `Сравни два фото. ПЕРВОЕ — оригинал изделия. ВТОРОЕ — сгенерированная картинка для интернет-магазина.
Известные признаки оригинала: ${JSON.stringify({ type: a?.type, metal_color: a?.metal_color, stones: a?.stones, chain: a?.chain, clasp: a?.clasp, engraving: a?.engraving, key_details: a?.key_details })}
Проверь по чек-листу и верни JSON:
{"items":{
 "shape":{"ok":bool,"note":""},          // 1 форма и силуэт совпадают
 "count":{"ok":bool,"note":""},          // 2 количество камней, жемчужин, шариков, подвесок
 "stone_color":{"ok":bool,"note":""},    // 3 цвет камней
 "metal_color":{"ok":bool,"note":""},    // 4 цвет металла
 "chain":{"ok":bool,"note":""},          // 5 тип плетения и звеньев (ok=true если цепи нет)
 "clasp":{"ok":bool,"note":""},          // 6 застёжка того же типа (ok=true если не видна)
 "engraving":{"ok":bool,"note":""},      // 7 гравировка/надписи не искажены и не добавлены
 "scale":{"ok":bool,"note":""},          // 8 размер правдоподобен относительно руки/уха/шеи
 "clean":{"ok":bool,"note":""},          // 9 нет текста, водяных знаков, лишних украшений
 "anatomy":{"ok":bool,"note":""}         // 10 нет лишних пальцев, странных ушей (ok=true если людей нет)
},"pass":bool,"reasons":["коротко по-русски, что не так"]}
pass=true только если ВСЕ пункты ok. ${strict ? "Будь особенно строгим: это каталожное фото, любое изменение изделия — брак." : "Будь строгим к самому изделию; к сцене придирайся только по пунктам 8–10."}
Отвечай только JSON.`;
}

function buildPrompt(st: Style, a: any, o: { size: string; wish: string; palette: string; scene?: string; supplier: boolean; refs: number; brand: string | null }) {
  const facts: string[] = [];
  if (a?.type_ru) facts.push(`The item: ${a.type_ru}${a.notes ? " — " + a.notes : ""}.`);
  if (a?.metal_color) facts.push(`Metal color: ${a.metal_color}.`);
  if (Array.isArray(a?.stones) && a.stones.length) facts.push("Stones/inserts exactly: " + a.stones.map((s: any) => `${s.count ?? "?"} × ${s.color || ""} ${s.kind || ""} ${s.shape || ""}`.trim()).join("; ") + ".");
  if (Array.isArray(a?.key_details) && a.key_details.length) facts.push("Must keep these details: " + a.key_details.join("; ") + ".");
  const parts = [
    o.refs ? `<IMAGE_0> is the product to photograph. ${Array.from({ length: o.refs }, (_, i) => `<IMAGE_${i + 1}>`).join(", ")} ${o.refs > 1 ? "are" : "is"} brand style reference${o.refs > 1 ? "s" : ""}: take ONLY lighting, color palette, background mood and composition from ${o.refs > 1 ? "them" : "it"}; never copy any jewelry or objects from references.` : "Use the provided image as the product to photograph.",
    st.prompt,
    st.item_share ? `The item occupies about ${st.item_share} of the frame.` : "",
    o.scene ? `Scene detail: ${o.scene}.` : "",
    o.palette ? `Preferred palette: ${o.palette}.` : "",
    facts.join(" "),
    o.size ? `Real size of the item: ${o.size}; keep true scale.` : "",
    metalLight(String(a?.metal_color || "")),
    o.supplier ? "The source is a supplier photo: remove all text, watermarks, hieroglyphs, collage frames, extra color variants and any other items; show only this one item (a pair for earrings)." : "Remove the ruler, color card, fingers holding the item, price tags and background clutter of the source photo.",
    RULES,
    /tryon|lifestyle|ugc/.test(st.code) ? PEOPLE : "",
    st.method === "strict" ? "This is a strict product shot: only change background, lighting and shadow; the item pixels-level appearance must stay identical." : "",
    o.wish ? `Additional wishes from the manager: ${o.wish}.` : "",
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
async function putPublic(path: string, bytes: Uint8Array, ct: string) {
  const up = await db.storage.from("product-photos").upload(path, bytes, { contentType: ct, upsert: true });
  if (up.error) throw new Error(up.error.message);
  return db.storage.from("product-photos").getPublicUrl(path).data.publicUrl;
}
async function sourceUrl(image: unknown, folder: string) {
  const m = String(image || "").match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return null;
  return await putPublic(`ai-src/${folder}/${Date.now()}.${m[1].includes("png") ? "png" : "jpg"}`, b64ToBytes(m[2]), m[1]);
}
// фото поставщика (alicdn) перекладываем к себе: у xAI и у проверки должна быть стабильная ссылка
async function mirror(url: string, folder: string) {
  const g = await fetch(url); if (!g.ok) throw new Error("Не удалось скачать фото поставщика");
  const ct = g.headers.get("content-type") || "image/jpeg";
  return await putPublic(`ai-src/${folder}/sup-${Date.now()}.${ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg"}`, new Uint8Array(await g.arrayBuffer()), ct);
}

async function analyze(key: string, src: string, ids: { product_id?: string | null; order_item_id?: string | null }) {
  const { out, cost } = await vision(key, VISION_MODEL, ANALYZE_PROMPT, [src]);
  let brand: string | null = null, season: string | null = null, gift = false;
  if (ids.product_id) {
    const { data: p } = await db.from("products").select("brand,name").eq("id", ids.product_id).maybeSingle();
    brand = p?.brand === "moon" || p?.brand === "sunshine" ? p.brand : null;
    gift = /подар|gift|набор/i.test(p?.name || "");
    const { data: ss } = await db.from("product_seasons").select("seasons(name)").eq("product_id", ids.product_id).limit(1);
    season = (ss?.[0] as any)?.seasons?.name || null;
  }
  const sug = suggestStyles(out, brand, season, gift);
  await db.from("product_ai_analysis").insert({ product_id: ids.product_id || null, order_item_id: ids.order_item_id || null, source_url: src, analysis: out, suggested: sug });
  return { analysis: out, suggested: sug, brand, cost };
}

async function latestAnalysis(ids: { product_id?: string | null; order_item_id?: string | null }, src: string) {
  let q = db.from("product_ai_analysis").select("analysis,suggested,source_url").order("created_at", { ascending: false }).limit(5);
  q = ids.product_id ? q.eq("product_id", ids.product_id) : q.eq("order_item_id", ids.order_item_id || "00000000-0000-0000-0000-000000000000");
  const { data } = await q;
  return (data || []).find((r) => r.source_url === src) || null;
}

async function genOne(key: string, st: Style, prompt: string, images: string[], n: number) {
  const body: any = { model: IMAGE_MODEL, prompt, n, aspect_ratio: st.aspect, resolution: "2k", response_format: "b64_json" };
  if (images.length > 1) body.images = images.map((u) => ({ url: u, type: "image_url" }));
  else body.image = { url: images[0], type: "image_url" };
  const j = await xai(key, "/images/edits", body);
  return { list: (j?.data || []) as any[], cost: usd(j) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Нужно войти в Silver" }, 401);
    const { data: emp } = await db.from("employees").select("id,role,active").eq("auth_user_id", u.user.id).maybeSingle() as { data: Emp | null };
    if (!emp?.active || !["owner", "manager", "purchaser"].includes(emp.role)) return json({ error: "Нет доступа" }, 403);
    const b = await req.json();
    const { data: sec } = await db.from("app_secrets").select("value").eq("key", "xai").maybeSingle();
    const key = sec?.value || "";

    if (b.action === "status") return json({ has_key: !!key, owner: emp.role === "owner" });
    if (b.action === "set_key") {
      if (emp.role !== "owner") return json({ error: "Ключ может вписать только владелец" }, 403);
      const k = String(b.key || "").trim();
      if (k.length < 20) return json({ error: "Похоже, ключ вставлен не полностью" }, 400);
      const { error } = await db.from("app_secrets").upsert({ key: "xai", value: k });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (b.action === "styles") {
      const { data } = await db.from("photo_styles").select("code,title,purpose,method,aspect,item_share,card_slot,brand").eq("active", true).order("sort");
      return json({ styles: data || [] });
    }
    if (!key) return json({ error: "Не вписан ключ Grok (xAI). Владелец вписывает его в карточке товара → AI-фото." }, 400);

    // ---------- review: одобрить / брак / главное фото ----------
    if (b.action === "review") {
      const id = +b.photo_id; const { data: ph } = await db.from("product_ai_photos").select("id,product_id,url,status").eq("id", id).maybeSingle();
      if (!ph) return json({ error: "Фото не найдено" }, 404);
      if (b.decision === "reject") { await db.from("product_ai_photos").update({ status: "rejected", reviewed_by: emp.id, reviewed_at: new Date().toISOString() }).eq("id", id); return json({ ok: true, status: "rejected" }); }
      if (ph.status === "supplier_draft") return json({ error: "Это черновик по фото поставщика. Сначала сфотографируйте настоящее изделие и запустите проверку — только потом можно одобрить." }, 400);
      if (ph.status === "rejected" && !b.force) return json({ error: "Фото не прошло автопроверку. Одобрить его можно только вручную, отметив, что вы сверили изделие сами." }, 400);
      if (b.decision === "approve" || b.make_main) await db.from("product_ai_photos").update({ status: "approved", reviewed_by: emp.id, reviewed_at: new Date().toISOString() }).eq("id", id);
      if (b.make_main) {
        if (!ph.product_id) return json({ error: "Позиция заказа ещё не связана с товаром" }, 400);
        const { error } = await db.from("products").update({ photo_url: ph.url }).eq("id", ph.product_id); if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, status: "approved" });
    }

    // ---------- источник: фото из магазина или фото поставщика ----------
    const pid: string | null = b.product_id ? String(b.product_id) : null;
    const oid: string | null = b.order_item_id ? String(b.order_item_id) : null;
    const folder = pid || ("item-" + oid);
    let src = await sourceUrl(b.image, folder) || (b.image_url ? String(b.image_url) : null);
    let supplier = false;
    if (!src && oid) {
      const { data: it } = await db.from("purchase_order_items").select("supplier_photo").eq("id", oid).maybeSingle();
      if (it?.supplier_photo) { src = await mirror(it.supplier_photo, folder); supplier = true; }
    } else if (src && /alicdn\.com/i.test(src)) { src = await mirror(src, folder); supplier = true; }
    if (b.source === "supplier") supplier = true;

    // ---------- check: перепроверка против настоящего изделия ----------
    if (b.action === "check") {
      const id = +b.photo_id; const { data: ph } = await db.from("product_ai_photos").select("id,url,status,style,product_id,order_item_id").eq("id", id).maybeSingle();
      if (!ph) return json({ error: "Фото не найдено" }, 404);
      if (!src) return json({ error: "Загрузите фото настоящего изделия" }, 400);
      const an = await analyze(key, src, { product_id: ph.product_id, order_item_id: ph.order_item_id });
      const { data: st } = await db.from("photo_styles").select("method").eq("code", ph.style || "catalog").maybeSingle();
      const { out, cost } = await vision(key, CHECK_MODEL, checkPrompt(an.analysis, st?.method === "strict"), [src, ph.url]);
      const pass = !!out?.pass && Object.values(out?.items || {}).every((x: any) => x?.ok !== false);
      await db.from("product_ai_photos").update({ status: pass ? "draft" : "rejected", check_result: { ...out, pass, against: src, real_item: true } }).eq("id", id);
      return json({ ok: true, pass, check: out, cost_usd: +(an.cost + cost).toFixed(4) });
    }

    // ---------- analyze ----------
    if (b.action === "analyze") {
      if (!src) return json({ error: "Нет фото" }, 400);
      const r = await analyze(key, src, { product_id: pid, order_item_id: oid });
      const { data: styles } = await db.from("photo_styles").select("code,title,purpose,aspect,card_slot").eq("active", true).order("sort");
      return json({ source_url: src, supplier, analysis: r.analysis, suggested: r.suggested, type_ru: TYPE_RU[r.analysis?.type] || r.analysis?.type_ru, styles, cost_usd: +r.cost.toFixed(4) });
    }

    if (b.action !== "gen") return json({ error: "unknown action" }, 400);
    if (!pid && !oid) return json({ error: "Нет товара или позиции заказа" }, 400);
    if (!src) return json({ error: "Нет фото" }, 400);

    const code = b.style || (b.mode === "model" ? "tryon" : b.mode === "white" ? "catalog" : "catalog");
    const { data: st } = await db.from("photo_styles").select("*").eq("code", code).eq("active", true).maybeSingle() as { data: Style | null };
    if (!st) return json({ error: "Стиль не найден: " + code }, 400);
    const n = Math.max(1, Math.min(4, +b.n || (b.mode ? 1 : 2)));   // старый экран (mode) — по 1 варианту, как было
    const wish = String(b.wish || "").slice(0, 600), size = String(b.size || "").slice(0, 60);
    const refs: string[] = (Array.isArray(b.refs) ? b.refs : []).filter((x: unknown) => /^https:\/\//.test(String(x))).slice(0, 3);

    let costTotal = 0;
    let an = await latestAnalysis({ product_id: pid, order_item_id: oid }, src);
    let analysis = an?.analysis, suggested: any = an?.suggested;
    if (!analysis) { const r = await analyze(key, src, { product_id: pid, order_item_id: oid }); analysis = r.analysis; suggested = r.suggested; costTotal += r.cost; }
    let brand: string | null = null;
    if (pid) { const { data: p } = await db.from("products").select("brand").eq("id", pid).maybeSingle(); brand = p?.brand === "moon" || p?.brand === "sunshine" ? p.brand : null; }
    const scene = (suggested?.styles || []).find((s: any) => s.code === code)?.scene;
    const prompt = buildPrompt(st, analysis, { size: size || analysis?.size_estimate || "", wish, palette: st.code === "catalog" ? "" : (suggested?.palette || ""), scene, supplier, refs: refs.length, brand });
    const images = [src, ...refs];
    const strict = st.method === "strict";

    const saved: any[] = [];
    let need = n, attempt = 0;
    while (need > 0 && attempt < MAX_ATTEMPTS && Date.now() - t0 < TIME_BUDGET_MS) {
      attempt++;
      const g = await genOne(key, st, prompt, images, need); costTotal += g.cost;
      const results = await Promise.all(g.list.map(async (d, i) => {
        let bytes: Uint8Array | null = null, ct = d.mime_type || "image/jpeg";
        if (d.b64_json) bytes = b64ToBytes(d.b64_json);
        else if (d.url) { const r = await fetch(d.url); ct = r.headers.get("content-type") || ct; bytes = new Uint8Array(await r.arrayBuffer()); }
        if (!bytes) return null;
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
        const url = await putPublic(`ai/${folder}/${Date.now()}-${st.code}-${attempt}-${i}.${ext}`, bytes, ct);
        const c = await vision(key, CHECK_MODEL, checkPrompt(analysis, strict), [src!, url]);
        const pass = !!c.out?.pass && Object.values(c.out?.items || {}).every((x: any) => x?.ok !== false);
        return { url, pass, check: c.out, cost: c.cost };
      }));
      for (const r of results) {
        if (!r) continue; costTotal += r.cost;
        const last = attempt >= MAX_ATTEMPTS || Date.now() - t0 >= TIME_BUDGET_MS;
        if (!r.pass && !last) { // брак — сохраняем для истории, перегенерируем
          await db.from("product_ai_photos").insert({ product_id: pid, order_item_id: oid, url: r.url, mode: st.code === "tryon" ? "model" : "white", style: st.code, status: "rejected", source: supplier ? "supplier" : "shop", source_url: src, check_result: { ...r.check, pass: false }, attempts: attempt, wish: wish || null, size_mm: size || null, created_by: emp.id });
          continue;
        }
        const status = r.pass ? (supplier ? "supplier_draft" : "draft") : "rejected";
        const { data: row } = await db.from("product_ai_photos").insert({ product_id: pid, order_item_id: oid, url: r.url, mode: st.code === "tryon" ? "model" : "white", style: st.code, status, source: supplier ? "supplier" : "shop", source_url: src, check_result: { ...r.check, pass: r.pass }, attempts: attempt, wish: wish || null, size_mm: size || null, created_by: emp.id }).select("id,url,status,style,check_result").single();
        if (row) saved.push(row);
        if (r.pass) need--;
      }
    }
    const share = saved.length ? +(costTotal / saved.length).toFixed(4) : 0;
    if (saved.length) await db.from("product_ai_photos").update({ cost_usd: share }).in("id", saved.map((s) => s.id));
    const ok = saved.filter((s) => s.status !== "rejected");
    return json({
      photos: saved, passed: ok.length, attempts: attempt, style: st.code, prompt, cost_usd: +costTotal.toFixed(4),
      url: ok[0]?.url || saved[0]?.url || null, mode: st.code === "tryon" ? "model" : "white",   // для старого экрана
      note: !ok.length ? "Ни один вариант не прошёл проверку совпадения с оригиналом — см. причины в check_result.reasons" : supplier ? "Черновики по фото поставщика: одобрить можно после проверки по фото настоящего изделия (action=check)" : undefined,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
