/* Piano alimentare - app a pagina singola, dati salvati sul telefono (localStorage). */
(function () {
'use strict';
const D = window.NUTRI_DATA;
const APP_VERSION = '1.3.0';
const KEY = 'piano-alimentare-v1';

/* ===================== Utilità ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const f0 = n => nf0.format(Math.round(n));
const f1 = n => nf1.format(Math.round(n * 10) / 10);
const nf2 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const fw = n => nf2.format(Math.round(n * 100) / 100);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const dkey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const todayKey = () => dkey(new Date());
const pk = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (k, n) => { const d = pk(k); d.setDate(d.getDate() + n); return dkey(d); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const dateSub = (k, short) => pk(k).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: short ? 'short' : 'long' });
const dateLong = k => cap(pk(k).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }));
const dateMid = k => cap(pk(k).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/\.$/, ''));
function dateMain(k) {
  const t = todayKey();
  if (k === t) return 'Oggi';
  if (k === addDays(t, -1)) return 'Ieri';
  if (k === addDays(t, 1)) return 'Domani';
  return cap(pk(k).toLocaleDateString('it-IT', { weekday: 'long' }));
}

/* ===================== Archivio dati ===================== */
const defaults = () => ({
  v: 1,
  settings: { targets: { kcal: 2200, p: 155, c: 265, f: 55 }, phase: 'minicut', weekly: [1, 0, 1, 0, 1, 1, 0], activityPct: 50, startWeight: 68.5, waterGoal: 2.5, lastBackup: 0, mealsSeeded: true, estMargin: 0 },
  days: {}, custom: [], saved: [], recents: {}, weights: [{ date: '2026-10-19', kg: 67 }], created: Date.now(),
});
/* Ogni giorno parte con i pasti principali già pronti (vuoti): se ne salti uno basta non toccarlo, se ne aggiungi uno lo crei tu. */
const DEFAULT_MEALS = ['Colazione', 'Pranzo', 'Merenda', 'Cena'];
const defMeals = () => DEFAULT_MEALS.map(n => ({ id: uid(), name: n, time: '', items: [] }));
let storageOK = true;
function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const out = { ...d, ...o, settings: { ...d.settings, ...(o.settings || {}), targets: { ...d.settings.targets, ...((o.settings || {}).targets || {}) } } };
      if (!(o.settings && o.settings.mealsSeeded)) { /* una tantum: i giorni già salvati ma senza pasti ricevono Colazione, Pranzo, Merenda, Cena */
        Object.values(out.days || {}).forEach(day => { if (day && Array.isArray(day.meals) && !day.meals.length) day.meals = defMeals(); });
        out.settings.mealsSeeded = true;
      }
      return out;
    }
  } catch (e) { console.warn('Lettura archivio fallita', e); storageOK = false; }
  return d;
}
let S = load();
let saveTimer = null;
let noPersist = false;
function persist() {
  if (noPersist) return;
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; }
  catch (e) { if (storageOK) toast('Salvataggio non riuscito: controlla lo spazio del telefono'); storageOK = false; }
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 120); }

/* ===================== Calcoli ===================== */
const Z = () => ({ kcal: 0, p: 0, c: 0, f: 0 });
const addM = (a, b) => { a.kcal += b.kcal; a.p += b.p; a.c += b.c; a.f += b.f; return a; };
const itemMacro = it => { const k = it.kind === 'g' ? it.qty / 100 : it.qty; return { kcal: it.per.kcal * k, p: it.per.p * k, c: it.per.c * k, f: it.per.f * k }; };
const sumItems = items => items.reduce((a, it) => addM(a, itemMacro(it)), Z());
const dayTotals = d => d ? d.meals.reduce((a, m) => addM(a, sumItems(m.items)), Z()) : Z();
function dayTarget(d) {
  const base = (d && d.targetOverride) || S.settings.targets;
  const act = d ? d.activities.reduce((s, a) => s + num(a.kcal), 0) : 0;
  const extra = act * S.settings.activityPct / 100;
  return { kcal: base.kcal + extra, p: base.p, c: base.c + extra / 4, f: base.f, extra, base };
}
const defType = k => S.settings.weekly[(pk(k).getDay() + 6) % 7] ? 'training' : 'rest';
const newDay = k => ({ date: k, type: defType(k), meals: defMeals(), activities: [], water: 0, supp: { whey: false, creatine: false }, targetOverride: null });
const V = { date: todayKey(), tab: 'oggi', open: {}, weightDate: null, openMeals: {}, lastMeal: null, weekOff: 0 };
/* Giorno non ancora salvato: resta in "bozza" (stessi id dei pasti a ogni lettura) finché non ci scrivi qualcosa. */
let draftDay = null;
const cur = () => S.days[V.date] || (draftDay && draftDay.date === V.date ? draftDay : (draftDay = newDay(V.date)));
const ensure = (k = V.date) => {
  if (S.days[k]) return S.days[k];
  let d; if (draftDay && draftDay.date === k) { d = draftDay; draftDay = null; } else d = newDay(k);
  return (S.days[k] = d);
};
function mut(fn) { const d = ensure(); fn(d); save(); render(); }
const dayHasData = d => d && (d.meals.some(m => m.items.length) || d.activities.length || d.supp.whey || d.supp.creatine);
const findMeal = (d, id) => d.meals.find(m => m.id === id);

/* ===================== Catalogo ===================== */
let FMAP = null;
const allFoods = () => [...D.FOODS, ...D.VENUE_FOODS, ...S.custom];
/* Margine di sicurezza (opzionale) sulle voci «stima» del catalogo: kcal, carboidrati e grassi salgono, le proteine restano. */
function withMargin(f) {
  const m = +S.settings.estMargin || 0;
  if (!m || f.src !== 'stima' || f.custom) return f;
  const k = 1 + m / 100;
  return { ...f, mg: m, per: { kcal: f.per.kcal * k, p: f.per.p, c: f.per.c * k, f: f.per.f * k } };
}
function foodMap() { if (!FMAP) { FMAP = new Map(); allFoods().forEach(f => FMAP.set(f.id, withMargin(f))); } return FMAP; }
const invalidateFoods = () => { FMAP = null; };
const foodById = id => foodMap().get(id);
const dishById = id => D.DISHES.find(d => d.id === id);
function unitStr(it, qty) {
  if (it.kind === 'g') return it.unit || 'g';
  if (Array.isArray(it.unit)) return Math.abs(qty - 1) < 1e-9 ? it.unit[0] : it.unit[1];
  return it.unit || 'porzione';
}
function mkItem(food, qty, extra = {}) {
  return { id: uid(), fid: food.id, name: food.name, kind: food.kind, per: { ...food.per }, unit: food.unit, qty, note: food.note || '', src: food.src || '', ...(food.mg ? { mg: food.mg } : {}), ...extra };
}
function cfgOf(it) {
  const f = foodById(it.fid) || {};
  const isG = it.kind === 'g';
  return { id: it.fid, name: it.name, kind: it.kind, per: it.per, unit: it.unit, note: it.note, src: it.src, mg: it.mg,
    def: f.def != null ? f.def : (isG ? 100 : 1), step: f.step || (isG ? 10 : 1), min: f.min, max: f.max, chips: f.chips, pz: f.pz };
}
function qtyText(it) {
  const q = it.kind === 'g' ? f0(it.qty) : f1(it.qty);
  let s = q + ' ' + unitStr(it, it.qty);
  const f = foodById(it.fid);
  if (f && f.pz && it.kind === 'g') { const n = it.qty / f.pz.g; s += ' (≈ ' + f1(n) + ' ' + (Math.abs(n - 1) < 1e-9 ? f.pz.l : f.pz.pl) + ')'; }
  return s;
}
function lastQty(food) { const r = S.recents[food.id]; return r && r.qty > 0 ? r.qty : food.def; }
function touchRecent(fid, qty) {
  S.recents[fid] = { qty, ts: Date.now() };
  const keys = Object.keys(S.recents);
  if (keys.length > 80) keys.sort((a, b) => S.recents[a].ts - S.recents[b].ts).slice(0, keys.length - 80).forEach(k => delete S.recents[k]);
}
function expandDish(dish, mult = 1) {
  const key = uid();
  return dish.items.map((c, i) => {
    const f = foodById(c.f);
    const step = f.step || 1;
    const q = f.kind === 'g' ? Math.max(step, Math.round(c.q * mult / step) * step) : Math.max(step, Math.round(c.q * mult / step) * step);
    return mkItem(f, q, { dishKey: key, dishId: dish.id, dishName: dish.name, compIdx: i });
  });
}
function dishTotals(dish) { return sumItems(dish.items.map(c => mkItem(foodById(c.f), c.q))); }
function expandTemplate(t) {
  return t.meals.map(tm => ({
    id: uid(), name: tm.name, time: tm.time || '',
    items: tm.items.flatMap(x => x.dish ? expandDish(dishById(x.dish)) : [mkItem(foodById(x.f), x.q)]),
  }));
}
const cloneMeals = (meals) => {
  const keyMap = {};
  return JSON.parse(JSON.stringify(meals)).map(m => ({ ...m, id: uid(), items: m.items.map(it => {
    const n = { ...it, id: uid() };
    if (n.dishKey) { keyMap[n.dishKey] = keyMap[n.dishKey] || uid(); n.dishKey = keyMap[n.dishKey]; }
    return n;
  }) }));
};

/* ===================== Riepilogo ===================== */
let preview = null;
const fmtRem = (v, t) => t - v;
function mbar(cls, label, v, t, pvv, opts = {}) {
  const pct = t > 0 ? clamp(v / t * 100, 0, 100) : 0;
  const pvp = t > 0 ? clamp(Math.max(0, pvv) / t * 100, 0, 100 - pct) : 0;
  const over = opts.noOver ? false : (v + pvv > t + 0.5);
  return `<div class="mbar ${cls}${over ? ' over' : ''}"><div class="top"><b>${label}</b><span class="v${over ? ' over' : ''}">${f0(v)}<span style="opacity:.6"> / ${f0(t)}${opts.unit || ''}</span></span></div><div class="bar"><i style="width:${pct}%"></i><i class="pv" style="left:${pct}%;width:${pvp}%"></i></div></div>`;
}
function cbar(cls, label, v, t, pvv, noOver) {
  const pct = t > 0 ? clamp(v / t * 100, 0, 100) : 0;
  const pvp = t > 0 ? clamp(Math.max(0, pvv) / t * 100, 0, 100 - pct) : 0;
  const over = noOver ? false : (v + pvv > t + 0.5);
  return `<div class="mbar ${cls}${over ? ' over' : ''}"><div class="top"><b>${label}</b><span class="v${over ? ' over' : ''}">${f0(v)}<small>/${f0(t)}</small></span></div><div class="bar"><i style="width:${pct}%"></i><i class="pv" style="left:${pct}%;width:${pvp}%"></i></div></div>`;
}
function renderRecap() {
  const d = cur(), t = dayTotals(d), tg = dayTarget(d), pv = preview || Z();
  const R = 44, C = 2 * Math.PI * R;
  const consFrac = tg.kcal > 0 ? clamp(t.kcal / tg.kcal, 0, 1) : 0;
  const pvFrac = tg.kcal > 0 ? clamp(Math.max(0, pv.kcal) / tg.kcal, 0, 1 - consFrac) : 0;
  const rem = tg.kcal - t.kcal - pv.kcal;
  const over = t.kcal + pv.kcal > tg.kcal + 0.5;
  const sign = pv.kcal > 0 ? '+' : '';
  const sub = pv.kcal ? `<em>${sign}${f0(pv.kcal)} kcal</em>` : `<span>${over ? 'kcal oltre' : 'kcal restano'}</span>`;
  const training = d.type === 'training';
  const extra = tg.extra > 0 ? ` +${f0(tg.extra)}` : '';
  $('#recap').innerHTML = `
    <div class="r-date-mini">${esc(dateMain(V.date))} · ${esc(dateSub(V.date))} · ${training ? 'Allenamento' : 'Riposo'}</div>
    <div class="r-nav">
      <button class="icon-btn" data-act="prevDay" aria-label="Giorno precedente"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <label class="r-date"><span class="r-date-main">${esc(dateMain(V.date))}</span><span class="r-date-sub">${esc(dateSub(V.date, window.innerWidth < 420))}</span><input class="r-date-input" type="date" value="${V.date}" data-act-change="pickDate" aria-label="Scegli la data"></label>
      <button class="icon-btn" data-act="nextDay" aria-label="Giorno successivo"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      <button class="type-chip ${training ? 'training' : ''}" data-act="toggleType" aria-label="Cambia tipo di giorno">${training ? 'Allenamento' : 'Riposo'}</button>
    </div>
    <div class="r-full">
      <div class="ring${over ? ' over' : ''}"><svg viewBox="0 0 104 104"><circle class="trk" cx="52" cy="52" r="${R}" fill="none" stroke-width="10"/>
        <circle class="arc" cx="52" cy="52" r="${R}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(consFrac * C).toFixed(1)} ${C.toFixed(1)}"/>
        ${pvFrac > 0 ? `<circle class="arc pv" cx="52" cy="52" r="${R}" fill="none" stroke-width="10" stroke-dasharray="${(pvFrac * C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-consFrac * C).toFixed(1)}"/>` : ''}
        </svg><div class="ring-c"><b>${over ? '+' : ''}${f0(Math.abs(rem))}</b>${sub}</div></div>
      <div class="r-bars">
        ${mbar('m-p', 'Proteine', t.p, tg.p, pv.p, { unit: ' g', noOver: true })}
        ${mbar('m-c', 'Carboidrati', t.c, tg.c, pv.c, { unit: ' g' })}
        ${mbar('m-f', 'Grassi', t.f, tg.f, pv.f, { unit: ' g' })}
      </div>
    </div>
    <div class="r-compact">
      ${cbar('m-k', 'Kcal', t.kcal, tg.kcal, pv.kcal)}
      ${cbar('m-p', 'Prot.', t.p, tg.p, pv.p, true)}
      ${cbar('m-c', 'Carb.', t.c, tg.c, pv.c)}
      ${cbar('m-f', 'Grassi', t.f, tg.f, pv.f)}
    </div>`;
  measureRecap();
}
/* Altezza del riepilogo: misuro solo il contenuto (senza padding). Il padding dipende dalla safe-area ed è
   calcolato dal CSS, così resta giusto anche se l'area sicura cambia dopo la ripresa dell'app. */
const recapSeen = {};
function measureRecap(force) {
  const r = $('#recap'); if (!r) return;
  const cs = getComputedStyle(r), st = document.documentElement.style;
  const core = () => r.offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
  const put = (name, v) => { if (v > 0 && Math.abs((recapSeen[name] || -1) - v) > 0.5) { recapSeen[name] = v; st.setProperty(name, v + 'px'); } };
  const compact = r.classList.contains('compact');
  put(compact ? '--recap-core-c' : '--recap-core', core());
  if (force) { /* misura anche l'altro stato, senza che si veda (nessun disegno tra i due passaggi) */
    r.classList.toggle('compact', !compact);
    put(compact ? '--recap-core' : '--recap-core-c', core());
    r.classList.toggle('compact', compact);
  }
}
function updateFab() {
  const fab = $('#fab'); if (!fab) return;
  let show = V.tab === 'oggi' && SHEETS.length === 0;
  if (show) {
    const nb = $('#view [data-act="newMeal"]');
    if (nb) {
      const r = nb.getBoundingClientRect();
      const top = $('#recap').getBoundingClientRect().bottom, bottom = $('#tabbar').getBoundingClientRect().top;
      show = !(r.bottom > top + 6 && r.top < bottom - 6);
    } else show = false;
  }
  if (fab.classList.contains('on') !== show) { fab.classList.toggle('on', show); document.body.classList.toggle('fab-on', show); }
}
function setCompact() {
  const open = SHEETS.length > 0;
  const r = $('#recap');
  const want = open || (r.classList.contains('compact') ? window.scrollY > 20 : window.scrollY > 70);
  if (want !== r.classList.contains('compact')) { r.classList.toggle('compact', want); measureRecap(); }
  updateFab();
}
function topPreview() { const s = SHEETS[SHEETS.length - 1]; return s ? (s.preview || null) : null; }
function refreshPreview() { preview = topPreview(); renderRecap(); }

/* ===================== Schermata Oggi ===================== */
const needsBackup = () => {
  const hasData = Object.values(S.days).some(dayHasData);
  return hasData && (Date.now() - (S.settings.lastBackup || S.created || Date.now()) > 7 * 86400000);
};
function groupItems(items) {
  const groups = [];
  items.forEach(it => {
    const last = groups[groups.length - 1];
    if (it.dishKey && last && last.key === it.dishKey) last.items.push(it);
    else groups.push({ key: it.dishKey || null, name: it.dishName, items: [it] });
  });
  return groups;
}
function itemRow(m, it) {
  const mc = itemMacro(it);
  const tag = it.src === 'stima' ? `<span class="tag stima">stima${it.mg ? ' +' + it.mg + '%' : ''}</span>` : (it.src === 'etichetta' ? '<span class="tag etichetta">etichetta</span>' : '');
  return `<button class="item" data-act="editItem" data-meal="${m.id}" data-id="${it.id}">
    <div><div class="item-name">${esc(it.name)}</div><div class="item-qty">${esc(qtyText(it))}${it.note ? ' · ' + esc(it.note) : ''}${tag}</div></div>
    <div class="item-m">${f0(mc.kcal)} kcal<small>P ${f1(mc.p)} · C ${f1(mc.c)} · G ${f1(mc.f)}</small></div></button>`;
}
const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px;fill:currentColor"><circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/></svg>';
function mealSub(m, open) {
  const tm = m.time ? m.time + ' · ' : '';
  if (!m.items.length) return tm + 'Vuoto';
  if (open) return tm + m.items.length + (m.items.length === 1 ? ' alimento' : ' alimenti');
  const seen = new Set(), names = [];
  m.items.forEach(it => { const n = it.dishName || it.name; if (!seen.has(n)) { seen.add(n); names.push(n); } });
  return tm + names.join(', ');
}
function mealCard(m) {
  const t = sumItems(m.items), open = !!V.openMeals[m.id];
  const body = groupItems(m.items).map(g => {
    if (!g.key) return g.items.map(it => itemRow(m, it)).join('');
    const gt = sumItems(g.items);
    return `<div class="dish"><button class="dish-head" data-act="editDish" data-meal="${m.id}" data-key="${g.key}"><span class="dish-name">${esc(g.name)}</span><span class="dish-sum">${f0(gt.kcal)} kcal</span><span class="muted">›</span></button>${g.items.map(it => itemRow(m, it)).join('')}</div>`;
  }).join('');
  return `<section class="meal${open ? ' open' : ''}">
    <button class="meal-head" data-act="toggleMeal" data-id="${m.id}" aria-expanded="${open}" aria-label="${esc(m.name)}: apri o chiudi">
      <div class="mh-l"><h3>${esc(m.name)}</h3><span class="meal-time">${esc(mealSub(m, open))}</span></div>
      <div class="meal-sum">${f0(t.kcal)} kcal<small>P ${f0(t.p)} g</small></div>${CHEV}</button>
    <div class="meal-body"><div class="mb-in"><div class="items">${body}</div>
      <div class="meal-actions"><button class="btn add" data-act="addTo" data-meal="${m.id}">+ Aggiungi alimento</button><button class="btn opt" data-act="editMeal" data-id="${m.id}" aria-label="Opzioni del pasto">${DOTS}</button></div></div></div></section>`;
}
function dayCard(d) {
  const tg = dayTarget(d);
  const acts = d.activities.map(a => `<div class="act-row"><div><b>${esc(a.name)}</b><div class="muted" style="font-size:14px">${f0(a.kcal)} kcal${a.min ? ' · ' + a.min + ' min' : ''}</div></div><button class="btn sm danger" data-act="delActivity" data-id="${a.id}">Rimuovi</button></div>`).join('');
  const tgTxt = `${f0(tg.base.kcal)} kcal · P ${f0(tg.base.p)} · C ${f0(tg.base.c)} · G ${f0(tg.base.f)}`;
  return `<section class="card">
    <h3>Integratori</h3>
    <div class="row" style="margin-top:8px;gap:10px"><button class="toggle ${d.supp.whey ? 'on' : ''}" style="flex:1" data-act="supp" data-k="whey">${d.supp.whey ? '✓ ' : ''}Whey</button><button class="toggle ${d.supp.creatine ? 'on' : ''}" style="flex:1" data-act="supp" data-k="creatine">${d.supp.creatine ? '✓ ' : ''}Creatina</button></div>
    <div class="sep"></div>
    <h3>Attività extra</h3>
    <p class="sub">Padel, corsa e simili. Alzano il target del giorno di ${S.settings.activityPct}% delle kcal stimate.</p>
    ${acts}
    <button class="btn" data-act="addActivity" style="margin-top:6px">+ Aggiungi attività</button>
    <div class="sep"></div>
    <h3>Target di questo giorno</h3>
    <p class="sub">${d.targetOverride ? 'Personalizzato: ' : ''}${tgTxt}${tg.extra > 0 ? `<br>Con l'attività extra: ${f0(tg.kcal)} kcal` : ''}</p>
    <button class="btn" data-act="editTarget">Modifica il target di oggi</button>
  </section>`;
}
function viewOggi() {
  const d = cur();
  let h = '';
  if (needsBackup()) h += `<div class="banner"><span>L'ultimo backup è vecchio. Salva una copia dei tuoi dati.</span><button data-act="exportBackup">Backup</button></div>`;
  if (!d.meals.length) {
    h += `<section class="card empty"><h3>Giornata vuota</h3><p>Crea i pasti come vuoi tu, oppure parti da una giornata tipo.</p>
      <div class="stack"><button class="btn primary" data-act="newMeal">+ Nuovo pasto</button><button class="btn" data-act="templates">Applica una giornata tipo</button><button class="btn ghost" data-act="copyDay">Copia da un altro giorno</button></div></section>`;
  } else {
    const allOpen = d.meals.every(m => V.openMeals[m.id]);
    if (d.meals.length > 1) h += `<div class="meals-tools"><span>${d.meals.length} pasti</span><button data-act="toggleAll">${allOpen ? 'Chiudi tutti' : 'Apri tutti'}</button></div>`;
    h += d.meals.map(mealCard).join('');
    h += `<div class="stack" style="margin-bottom:14px"><button class="btn primary" data-act="newMeal">+ Nuovo pasto</button><button class="btn" data-act="closeMacros">Chiudi i macro</button><div class="btn-row"><button class="btn" data-act="templates">Giornata tipo</button><button class="btn" data-act="copyDay">Copia da…</button></div></div>`;
  }
  return h + dayCard(d);
}

/* ===================== Storico ===================== */
function loggedDays() { return Object.keys(S.days).filter(k => dayHasData(S.days[k]) && S.days[k].meals.some(m => m.items.length)).sort().reverse(); }
function avgOf(keys) {
  const a = Z(); if (!keys.length) return null;
  keys.forEach(k => addM(a, dayTotals(S.days[k])));
  return { kcal: a.kcal / keys.length, p: a.p / keys.length, c: a.c / keys.length, f: a.f / keys.length, n: keys.length };
}
function barsChart(keys) {
  if (!keys.length) return '';
  const W = 340, H = 150, pl = 6, pr = 6, pt = 14, pb = 22;
  const vals = keys.map(k => ({ k, v: dayTotals(S.days[k]).kcal, t: dayTarget(S.days[k]).kcal, type: S.days[k].type }));
  const max = Math.max(...vals.map(x => Math.max(x.v, x.t))) * 1.08;
  const bw = (W - pl - pr) / vals.length;
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kcal degli ultimi giorni">`;
  vals.forEach((x, i) => {
    const bx = pl + i * bw + bw * 0.16, w = bw * 0.68;
    s += `<rect x="${bx.toFixed(1)}" y="${y(x.v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - pb - y(x.v)).toFixed(1)}" rx="3" fill="${x.type === 'training' ? '#7c6cff' : '#4b566b'}"/>`;
    s += `<line x1="${(pl + i * bw + 2).toFixed(1)}" x2="${(pl + (i + 1) * bw - 2).toFixed(1)}" y1="${y(x.t).toFixed(1)}" y2="${y(x.t).toFixed(1)}" stroke="#eef1f6" stroke-width="1.5" stroke-dasharray="3 2" opacity=".75"/>`;
    if (i % 2 === 0 || vals.length < 8) s += `<text x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${pk(x.k).getDate()}</text>`;
  });
  return s + '</svg>';
}
function dayDetail(d) {
  const meals = d.meals.filter(m => m.items.length).map(m => {
    const t = sumItems(m.items);
    return `<h4>${esc(m.name)}${m.time ? ' · ' + esc(m.time) : ''} <span class="muted" style="font-weight:500">${f0(t.kcal)} kcal · P ${f0(t.p)}</span></h4>` +
      m.items.map(it => `<div class="li"><b>${esc(it.name)}</b><span>${esc(qtyText(it))} · ${f0(itemMacro(it).kcal)} kcal</span></div>`).join('');
  }).join('');
  const extra = [];
  if (d.activities.length) extra.push('Attività: ' + d.activities.map(a => `${a.name} ${f0(a.kcal)} kcal`).join(', '));
  const sup = [d.supp.whey && 'whey', d.supp.creatine && 'creatina'].filter(Boolean);
  if (sup.length) extra.push('Integratori: ' + sup.join(', '));
  return `<div class="day-detail">${meals}${extra.length ? `<p class="hint">${extra.map(esc).join('<br>')}</p>` : ''}
    <div class="btn-row" style="margin-top:12px"><button class="btn sm" style="width:100%" data-act="openDay" data-date="${d.date}">Apri e modifica</button><button class="btn sm" style="width:100%" data-act="copyFromDay" data-date="${d.date}">Copia su oggi</button></div></div>`;
}
/* Report settimanale (lunedì-domenica). Oggi resta fuori finché la settimana è in corso: la giornata non è finita. */
const weekMon = off => { const t = todayKey(); return addDays(t, -((pk(t).getDay() + 6) % 7) + 7 * off); };
function weekStats(off) {
  const mon = weekMon(off), sun = addDays(mon, 6), today = todayKey();
  const all = loggedDays().filter(k => k >= mon && k <= sun);
  const keys = all.filter(k => k !== today).sort();
  const n = keys.length, tot = Z(), tgt = Z();
  let inT = 0, kHi = 0, kLo = 0, pLow = 0, incompl = 0;
  keys.forEach(k => {
    const d = S.days[k], t = dayTotals(d), tg = dayTarget(d);
    addM(tot, t); addM(tgt, { kcal: tg.kcal, p: tg.p, c: tg.c, f: tg.f });
    const e = (t.kcal - tg.kcal) / tg.kcal, pOk = t.p >= tg.p * 0.9;
    if (Math.abs(e) <= 0.05 && pOk) inT++;
    if (e > 0.05) kHi++; else if (e < -0.05) kLo++;
    if (!pOk) pLow++;
    if (t.kcal < tg.kcal * 0.6) incompl++;
  });
  const avg = n ? { kcal: tot.kcal / n, p: tot.p / n, c: tot.c / n, f: tot.f / n } : null;
  const tav = n ? { kcal: tgt.kcal / n, p: tgt.p / n, c: tgt.c / n, f: tgt.f / n } : null;
  const ws = S.weights.filter(w => w.date >= mon && w.date <= sun);
  const kg = ws.length ? ws.reduce((a, w) => a + w.kg, 0) / ws.length : null;
  return { mon, sun, n, keys, avg, tav, inT, kHi, kLo, pLow, incompl, kg, nw: ws.length, todayHas: off === 0 && all.includes(today) };
}
function weekCard() {
  const off = V.weekOff, w = weekStats(off), pv = weekStats(off - 1);
  const lab = k => pk(k).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace(/\.$/, '');
  const hasOlder = loggedDays().some(k => k < w.mon) || S.weights.some(x => x.date < w.mon);
  const dlt = (a, b, u, d1) => { const x = a - b; return (x > 0 ? '+' : x < 0 ? '−' : '±') + (d1 ? f1(Math.abs(x)) : f0(Math.abs(x))) + u; };
  const pct = (a, b) => b ? Math.round((a / b - 1) * 100) : 0;
  let h = `<section class="card"><div class="wk-head"><button class="btn sm" data-act="weekPrev" aria-label="Settimana precedente"${hasOlder ? '' : ' disabled'}>‹</button>
    <div class="wk-t"><h3>${off === 0 ? 'Questa settimana' : off === -1 ? 'Settimana scorsa' : 'Settimana'}</h3><div class="sub" style="margin:0">${lab(w.mon)} – ${lab(w.sun)}</div></div>
    <button class="btn sm" data-act="weekNext" aria-label="Settimana successiva"${off < 0 ? '' : ' disabled'}>›</button></div>`;
  if (!w.n) {
    h += `<p class="hint" style="margin-top:12px">${w.todayHas ? 'Per ora c\'è solo oggi, e la giornata non è finita: il report si riempie da domani.' : 'Nessun giorno con pasti registrati in questa settimana.'}</p>`;
  } else {
    const row = (l, v, sub, cls) => `<div class="wk-row ${cls || ''}"><span>${l}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const pvOk = pv.n >= 2;
    h += `<div class="wk-grid">`;
    h += row('Giorni registrati', `${w.n} / ${off === 0 ? Math.max(w.n, Math.min(7, (pk(todayKey()).getDay() + 6) % 7)) : 7}`, off === 0 ? 'oggi escluso' : '');
    h += row('Giorni in target', `${w.inT} / ${w.n}`, 'kcal ±5% e proteine ≥ 90%', w.inT === w.n ? 'ok' : '');
    h += row('Kcal medie', f0(w.avg.kcal), `target ${f0(w.tav.kcal)} (${pct(w.avg.kcal, w.tav.kcal) > 0 ? '+' : pct(w.avg.kcal, w.tav.kcal) < 0 ? '−' : '±'}${Math.abs(pct(w.avg.kcal, w.tav.kcal))}%)${pvOk ? ' · ' + dlt(w.avg.kcal, pv.avg.kcal, '', 0) + ' sulla precedente' : ''}`);
    h += row('Proteine medie', f0(w.avg.p) + ' g', `target ${f0(w.tav.p)} (${pct(w.avg.p, w.tav.p) > 0 ? '+' : pct(w.avg.p, w.tav.p) < 0 ? '−' : '±'}${Math.abs(pct(w.avg.p, w.tav.p))}%)${pvOk ? ' · ' + dlt(w.avg.p, pv.avg.p, ' g', 0) + ' sulla precedente' : ''}`);
    h += row('Carboidrati / grassi', `${f0(w.avg.c)} / ${f0(w.avg.f)} g`, `target ${f0(w.tav.c)} / ${f0(w.tav.f)} g`);
    h += `</div>`;
    const bits = [];
    if (w.kHi) bits.push(`kcal sopra il target in ${w.kHi} ${w.kHi === 1 ? 'giorno' : 'giorni'}`);
    if (w.kLo) bits.push(`kcal sotto il target in ${w.kLo} ${w.kLo === 1 ? 'giorno' : 'giorni'}`);
    if (w.pLow) bits.push(`proteine sotto il 90% in ${w.pLow} ${w.pLow === 1 ? 'giorno' : 'giorni'}`);
    if (bits.length) h += `<p class="hint" style="margin-top:10px">${bits.join(' · ')}.</p>`;
    if (w.n < 3) h += `<p class="hint">Pochi giorni registrati: con meno di 3 giorni le medie dicono poco.</p>`;
    if (w.incompl) h += `<p class="hint">${w.incompl} ${w.incompl === 1 ? 'giorno è' : 'giorni sono'} sotto il 60% del target di kcal: se avevi dimenticato di registrare, le medie risultano più basse del reale.</p>`;
  }
  if (w.kg != null || pv.kg != null) {
    h += `<div class="sep"></div><div class="wk-grid">`;
    const sub = w.kg != null && pv.kg != null ? `${dlt(w.kg, pv.kg, ' kg', 1)} sulla settimana precedente (${w.nw} ${w.nw === 1 ? 'pesata' : 'pesate'})` : w.kg != null ? `${w.nw} ${w.nw === 1 ? 'pesata' : 'pesate'}; nessuna pesata nella settimana precedente per il confronto` : 'nessuna pesata in questa settimana';
    h += `<div class="wk-row"><span>Peso medio</span><b>${w.kg != null ? f1(w.kg) + ' kg' : '–'}</b><small>${sub}</small></div></div>`;
    if (w.kg != null && pv.kg != null && Math.abs(w.kg - pv.kg) < 0.5) h += `<p class="hint">Variazioni sotto 0,5 kg in una settimana possono essere solo oscillazioni (acqua, sale, glicogeno): per giudicare serve il trend su 2-3 settimane.</p>`;
  }
  return h + '</section>';
}
function viewStorico() {
  const keys = loggedDays();
  let h = '<h1 class="view-title">Storico</h1>';
  if (!keys.length) return h + '<section class="card empty"><h3>Ancora nessun giorno</h3><p>Quando registri i pasti, i giorni con i valori salvati compaiono qui.</p></section>';
  if (V.weekOff === 0 && !V.weekTouched && weekStats(0).n === 0 && weekStats(-1).n > 0) V.weekOff = -1;
  h += weekCard();
  const last7 = keys.slice(0, 7), a7 = avgOf(last7);
  const k30 = keys.filter(k => k >= addDays(todayKey(), -30));
  const tr = avgOf(k30.filter(k => S.days[k].type === 'training')), rs = avgOf(k30.filter(k => S.days[k].type !== 'training'));
  const stat = (lab, a, sub) => a ? `<div class="stat"><span>${lab}</span><b>${f0(a.kcal)} kcal</b><small><span class="nw">P ${f0(a.p)} · C ${f0(a.c)} · G ${f0(a.f)}</span><br>${sub}</small></div>` : `<div class="stat"><span>${lab}</span><b>–</b><small>nessun dato</small></div>`;
  h += `<section class="card"><h3>Medie giornaliere</h3><p class="sub">Solo i giorni con pasti registrati.</p><div class="stat-grid">
      ${stat('Ultimi ' + a7.n + (a7.n === 1 ? ' giorno' : ' giorni'), a7, 'target ' + f0(S.settings.targets.kcal) + ' kcal')}
      ${stat('Media 30 giorni, allenamento', tr, (tr ? tr.n : 0) + ((tr ? tr.n : 0) === 1 ? ' giorno' : ' giorni'))}
      ${stat('Media 30 giorni, riposo', rs, (rs ? rs.n : 0) + ((rs ? rs.n : 0) === 1 ? ' giorno' : ' giorni'))}
      </div></section>`;
  h += `<section class="card"><h3>Kcal degli ultimi giorni</h3><p class="sub">Viola: allenamento. Grigio: riposo. Linea tratteggiata: target del giorno.</p>${barsChart(keys.slice(0, 14).reverse())}</section>`;
  h += keys.map(k => {
    const d = S.days[k], t = dayTotals(d), tg = dayTarget(d), open = !!V.open[k];
    return `<section class="day-card"><button class="hd" data-act="toggleDay" data-date="${k}">
      <div class="t"><b>${esc(dateMid(k))}</b><span class="pill ${d.type === 'training' ? 'training' : ''}">${d.type === 'training' ? 'Allenamento' : 'Riposo'}</span></div>
      <div class="mini-bars">${cbar('m-k', 'Kcal', t.kcal, tg.kcal, 0)}${cbar('m-p', 'P', t.p, tg.p, 0, true)}${cbar('m-c', 'C', t.c, tg.c, 0)}${cbar('m-f', 'G', t.f, tg.f, 0)}</div></button>
      ${open ? dayDetail(d) : ''}</section>`;
  }).join('');
  return h + `<div class="stack"><button class="btn" data-act="exportCsv">Esporta i giorni in CSV</button></div>`;
}

/* ===================== Peso ===================== */
function sortedWeights() { return [...S.weights].sort((a, b) => a.date.localeCompare(b.date)); }
function movingAvg(ws, i) {
  const t = pk(ws[i].date).getTime(), from = t - 6 * 86400000;
  const sel = ws.filter(w => { const x = pk(w.date).getTime(); return x >= from && x <= t; });
  return sel.reduce((s, w) => s + w.kg, 0) / sel.length;
}
function weightChart(ws) {
  if (ws.length < 2) return '<p class="hint">Servono almeno due pesate per vedere il grafico.</p>';
  const W = 340, H = 190, pl = 34, pr = 10, pt = 12, pb = 24;
  const xs = ws.map(w => pk(w.date).getTime()), x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 86400000);
  const all = ws.map(w => w.kg).concat(S.settings.startWeight ? [S.settings.startWeight] : []);
  const lo = Math.floor(Math.min(...all) - 0.5), hi = Math.ceil(Math.max(...all) + 0.5);
  const X = t => pl + (t - x0) / (x1 - x0) * (W - pl - pr), Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del peso">`;
  const step = (hi - lo) > 6 ? 2 : 1;
  for (let v = lo; v <= hi; v += step) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#2b3444" stroke-width="1"/><text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
  if (S.settings.startWeight) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(S.settings.startWeight).toFixed(1)}" y2="${Y(S.settings.startWeight).toFixed(1)}" stroke="#ffb547" stroke-width="1.2" stroke-dasharray="4 3"/>`;
  const pts = ws.map((w, i) => `${X(pk(w.date).getTime()).toFixed(1)},${Y(movingAvg(ws, i)).toFixed(1)}`).join(' ');
  s += `<polyline points="${pts}" fill="none" stroke="#9a8dff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  ws.forEach(w => { s += `<circle cx="${X(pk(w.date).getTime()).toFixed(1)}" cy="${Y(w.kg).toFixed(1)}" r="3.2" fill="#eef1f6" opacity=".85"/>`; });
  const lab = t => new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  s += `<text x="${pl}" y="${H - 6}" text-anchor="start">${lab(x0)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${lab(x1)}</text>`;
  return s + '</svg>';
}
function weightSlope(ws) {
  const t1 = pk(ws[ws.length - 1].date).getTime(), from = t1 - 21 * 86400000;
  const sel = ws.filter(w => pk(w.date).getTime() >= from);
  if (sel.length < 3) return null;
  const xs = sel.map(w => pk(w.date).getTime() / 86400000), ys = sel.map(w => w.kg);
  if (Math.max(...xs) - Math.min(...xs) < 7) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return sxx ? sxy / sxx * 7 : null;
}
function viewPeso() {
  const ws = sortedWeights(), last = ws[ws.length - 1];
  const wd = V.weightDate || todayKey();
  const val = V.weightVal != null ? V.weightVal : (last ? last.kg : S.settings.startWeight);
  let h = '<h1 class="view-title">Peso</h1>';
  h += `<section class="card"><h3>Nuova pesata</h3><p class="sub">Meglio al mattino, a digiuno, sempre nelle stesse condizioni.</p>
    <div class="row" style="justify-content:center;margin:6px 0 12px"><div class="stepper"><button data-act="wStep" data-d="-0.1" aria-label="Meno 100 g">−</button><div class="val"><input id="wInput" class="num" inputmode="decimal" value="${f1(val).replace('.', ',')}" style="width:96px;text-align:center;font:800 28px var(--font-num);background:var(--card);border:2px solid var(--accent);border-radius:14px;height:56px;color:var(--text)"></div><button data-act="wStep" data-d="0.1" aria-label="Più 100 g">+</button></div><span class="muted" style="font-size:18px;margin-left:6px">kg</span></div>
    <label class="fld"><span>Data</span><input class="inp" type="date" id="wDate" value="${wd}" max="${todayKey()}"></label>
    <button class="btn primary" data-act="saveWeight">Salva peso</button></section>`;
  if (last) {
    const avg7 = ws.filter(w => pk(w.date).getTime() >= pk(last.date).getTime() - 6 * 86400000);
    const a7 = avg7.reduce((s, w) => s + w.kg, 0) / avg7.length;
    const diff = last.kg - S.settings.startWeight, slope = weightSlope(ws);
    h += `<section class="card"><h3>Andamento</h3><div class="stat-grid" style="margin-top:8px">
      <div class="stat"><span>Ultima pesata</span><b>${f1(last.kg)} kg</b><small>${esc(dateSub(last.date))}</small></div>
      <div class="stat"><span>Media 7 giorni</span><b>${f1(a7)} kg</b><small>${avg7.length} pesate</small></div>
      <div class="stat"><span>Da inizio piano (${f1(S.settings.startWeight)} kg)</span><b>${diff > 0 ? '+' : ''}${f1(diff)} kg</b></div>
      <div class="stat"><span>Ritmo (ultime 3 settimane)</span><b>${slope == null ? '–' : (slope > 0 ? '+' : '') + f1(slope) + ' kg/sett.'}</b><small>${slope == null ? 'servono più pesate' : 'ideale in cut: −0,25 / −0,5'}</small></div>
      </div>${weightChart(ws)}<p class="hint">Punti: singole pesate. Linea viola: media mobile di 7 giorni. Tratteggio arancione: peso di partenza. Il peso oscilla di circa ±1 kg per acqua e digestione: guarda la tendenza, non il singolo giorno.</p></section>`;
    h += `<section class="card"><h3>Tutte le pesate</h3><div class="mlist">${[...ws].reverse().slice(0, 40).map(w => `<div class="act-row"><div><b>${f1(w.kg)} kg</b><div class="muted" style="font-size:14px">${esc(dateLong(w.date))}</div></div><button class="btn sm danger" data-act="delWeight" data-date="${w.date}">Elimina</button></div>`).join('')}</div></section>`;
  }
  return h;
}

/* ===================== Altro / Impostazioni ===================== */
function viewAltro() {
  const st = S.settings, t = st.targets;
  const kc = t.p * 4 + t.c * 4 + t.f * 9;
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'], full = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const fld = (lab, path, val, mode) => `<label class="fld"><span>${lab}</span><input class="inp num" type="text" inputmode="${mode || 'numeric'}" data-set="${path}" value="${esc(String(val).replace('.', ','))}"></label>`;
  let h = '<h1 class="view-title">Altro</h1>';
  h += `<section class="card"><h3>Obiettivi giornalieri</h3><p class="sub">Valgono ogni giorno. Nel singolo giorno puoi cambiarli da «Oggi».</p>
    <div class="btn-row" style="margin-bottom:12px"><button class="btn ${st.phase === 'minicut' ? 'primary' : ''}" data-act="preset" data-k="minicut">Mini-cut</button><button class="btn ${st.phase === 'bulk' ? 'primary' : ''}" data-act="preset" data-k="bulk">Bulk</button></div>
    <div class="grid2">${fld('Kcal', 'targets.kcal', t.kcal)}${fld('Proteine (g)', 'targets.p', t.p)}${fld('Carboidrati (g)', 'targets.c', t.c)}${fld('Grassi (g)', 'targets.f', t.f)}</div>
    <p class="hint">I macro valgono ${f0(kc)} kcal${Math.abs(kc - t.kcal) > 60 ? `, ${f0(Math.abs(kc - t.kcal))} kcal ${kc > t.kcal ? 'più' : 'meno'} del target` : ' e tornano con il target'}.</p></section>`;
  h += `<section class="card"><h3>Settimana tipo</h3><p class="sub">Tocca un giorno per scegliere se, di solito, ti alleni. Ogni giorno si può comunque cambiare dalla barra in alto.</p>
    <div class="chips">${days.map((l, i) => `<button class="chip ${st.weekly[i] ? 'on' : ''}" style="min-width:48px;justify-content:center" data-act="weekday" data-i="${i}" aria-label="${full[i]}">${l}</button>`).join('')}</div>
    <p class="hint">Viola: giorno di allenamento. Grigio: riposo.</p></section>`;
  h += `<section class="card"><h3>Attività extra</h3><p class="sub">Quanta parte delle kcal stimate di padel e simili aggiungi al target del giorno.</p>
    <div class="row"><input type="range" min="0" max="100" step="10" value="${st.activityPct}" data-set-range="activityPct" style="flex:1"><b class="num" style="min-width:52px;text-align:right" id="actPctVal">${st.activityPct}%</b></div>
    <p class="hint">Le stime di calorie dell'attività sono imprecise (spesso per eccesso): con 50% sei prudente. Le kcal in più vengono aggiunte come carboidrati.</p></section>`;
  h += `<section class="card"><h3>Margine sulle stime</h3><p class="sub">Per i piatti «stima» (pizzeria, hamburgheria e locali senza dati ufficiali) puoi aggiungere un margine di sicurezza: kcal, carboidrati e grassi salgono della percentuale scelta, le proteine restano come sono.</p>
    <div class="chips">${[[0, 'Nessuno'], [10, '+10%'], [20, '+20%']].map(([v, l]) => `<button class="chip ${(+st.estMargin || 0) === v ? 'on' : ''}" data-act="margin" data-v="${v}">${l}</button>`).join('')}</div>
    <p class="hint">È una regola pratica, non un valore misurato: i piatti dei locali si discostano dalle tabelle anche del 10-20% o più, ma non esiste un fattore valido per ogni piatto. Vale per gli alimenti che aggiungi da ora; quelli già inseriti non cambiano.</p></section>`;
  h += `<section class="card"><h3>Peso di partenza</h3><p class="sub">Serve per il grafico del peso.</p>${fld('Peso di partenza (kg)', 'startWeight', st.startWeight, 'decimal')}</section>`;
  h += `<section class="card"><h3>I miei alimenti</h3><p class="sub">Alimenti extra e prodotti salvati dalla ricerca online.</p>
    ${S.custom.length ? `<div class="mlist">${S.custom.map(f => `<div class="act-row"><div><b>${esc(f.name)}</b><div class="muted" style="font-size:14px">${f.kind === 'g' ? 'per 100 g: ' : 'a porzione: '}${f0(f.per.kcal)} kcal · P ${f1(f.per.p)} · C ${f1(f.per.c)} · G ${f1(f.per.f)}</div></div><div style="display:flex;gap:6px"><button class="btn sm" data-act="editCustom" data-id="${f.id}">Modifica</button><button class="btn sm danger" data-act="delCustom" data-id="${f.id}">✕</button></div></div>`).join('')}</div>` : '<p class="muted">Nessun alimento salvato.</p>'}
    <button class="btn" style="margin-top:10px" data-act="newCustom">+ Nuovo alimento</button></section>`;
  h += `<section class="card"><h3>Pasti salvati</h3><p class="sub">Combinazioni che riusi spesso. Si salvano da un pasto, con «Salva come pasto».</p>
    ${S.saved.length ? `<div class="mlist">${S.saved.map(s => `<div class="act-row"><div><b>${esc(s.name)}</b><div class="muted" style="font-size:14px">${f0(sumItems(s.items).kcal)} kcal · ${s.items.length} alimenti</div></div><button class="btn sm danger" data-act="delSaved" data-id="${s.id}">Elimina</button></div>`).join('')}</div>` : '<p class="muted">Nessun pasto salvato.</p>'}</section>`;
  const lb = st.lastBackup ? new Date(st.lastBackup).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : 'mai';
  h += `<section class="card"><h3>Backup dei dati</h3><p class="sub">I dati sono nel telefono, dentro questa app. Se la elimini o cambi telefono si perdono: salva ogni tanto un backup (es. in File o iCloud). Ultimo backup: ${lb}.</p>
    <div class="stack"><button class="btn primary" data-act="exportBackup">Salva un backup</button><button class="btn" data-act="importBackup">Ripristina da un backup</button><button class="btn ghost" data-act="exportCsv">Esporta i giorni in CSV</button></div>
    <input type="file" id="importFile" accept="application/json,.json" class="hidden"></section>`;
  h += `<section class="card"><h3>App</h3><p class="sub">Versione ${APP_VERSION}. Valori nutrizionali: tabelle e etichette dei prodotti; le voci «stima» sono indicative. Ricerca prodotti: Open Food Facts (dati inseriti dagli utenti, da verificare con l'etichetta).</p>
    <div class="stack"><button class="btn" data-act="updateApp">Aggiorna l'app</button><button class="btn danger" data-act="resetAll">Cancella tutti i dati</button></div></section>`;
  return h;
}

/* ===================== Render ===================== */
function renderView() {
  const fn = { oggi: viewOggi, storico: viewStorico, peso: viewPeso, altro: viewAltro }[V.tab];
  $('#view').innerHTML = fn();
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === V.tab));
  updateFab();
}
function render() { renderRecap(); renderView(); }
function setTab(t) { V.tab = t; renderView(); window.scrollTo(0, 0); setCompact(); }

/* ===================== Notifiche e finestre ===================== */
let toastT = null;
function toast(msg) {
  const el = $('#toast'); el.innerHTML = '<div></div>'; const d = el.firstChild; d.textContent = msg;
  requestAnimationFrame(() => d.classList.add('on'));
  clearTimeout(toastT); toastT = setTimeout(() => { d.classList.remove('on'); }, 1900);
}
function choice(title, text, buttons) {
  return new Promise(res => {
    const back = document.createElement('div'); back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    back.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) { back.remove(); res(buttons[+b.dataset.i].value); }
      else if (e.target === back) { back.remove(); res(null); }
    });
    document.body.appendChild(back);
  });
}

const SHEETS = [];
let lockY = 0;
function lockScroll() { if (document.body.classList.contains('locked')) return; lockY = window.scrollY; document.body.style.top = -lockY + 'px'; document.body.classList.add('locked', 'sheet-open'); }
function unlockScroll() { document.body.classList.remove('locked', 'sheet-open'); document.body.style.top = ''; window.scrollTo(0, lockY); }
function openSheet(title, opts = {}) {
  const el = document.createElement('section'); el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.style.zIndex = 100 + SHEETS.length * 2;
  el.innerHTML = `<div class="sheet-head"><button class="sheet-x" data-sa="close" aria-label="Chiudi">✕</button><h2></h2></div><div class="sheet-body"></div><div class="sheet-foot"></div>`;
  const api = { el, body: $('.sheet-body', el), foot: $('.sheet-foot', el), h: $('h2', el), handlers: {}, preview: null, closed: false,
    setTitle(t) { api.h.textContent = t; },
    on(map) { Object.assign(api.handlers, map); },
    setPreview(m) { api.preview = m; if (SHEETS[SHEETS.length - 1] === api) refreshPreview(); },
    close() {
      if (api.closed) return; api.closed = true;
      const i = SHEETS.indexOf(api); if (i >= 0) SHEETS.splice(i, 1);
      el.classList.remove('open'); setTimeout(() => el.remove(), 260);
      if (!SHEETS.length) { unlockScroll(); }
      setCompact(); refreshPreview();
      if (opts.onClose) opts.onClose();
    } };
  api.setTitle(title);
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-sa]'); if (!t || !el.contains(t)) return;
    if (t.dataset.sa === 'close') return api.close();
    const fn = api.handlers[t.dataset.sa]; if (fn) fn(t, e);
  });
  $('#sheets').appendChild(el);
  SHEETS.push(api); lockScroll(); setCompact(); refreshPreview();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  return api;
}

/* ===================== Operazioni sui dati ===================== */
const snapTo = (v, step) => Math.round(Math.round(v / step) * step * 100) / 100;
const r2 = v => Math.round(v * 100) / 100;
function findItem(d, mealId, id) { const m = findMeal(d, mealId); return m ? m.items.find(i => i.id === id) : null; }
function cloneItems(items) {
  const km = {};
  return JSON.parse(JSON.stringify(items)).map(it => {
    const n = { ...it, id: uid() };
    if (n.dishKey) { km[n.dishKey] = km[n.dishKey] || uid(); n.dishKey = km[n.dishKey]; }
    return n;
  });
}
function addItemsTo(mealId, items) {
  mut(d => { const m = findMeal(d, mealId); if (m) m.items.push(...items); });
}
function addFoodTo(mealId, food, qty) {
  mut(d => { const m = findMeal(d, mealId); if (!m) return; m.items.push(mkItem(food, qty)); touchRecent(food.id, qty); });
}
const mealName = id => { const m = findMeal(cur(), id); return m ? m.name : 'pasto'; };
function moveItems(fromId, ids, toId, strip) {
  if (fromId === toId) return;
  mut(d => {
    const from = findMeal(d, fromId), to = findMeal(d, toId); if (!from || !to) return;
    const moving = from.items.filter(i => ids.includes(i.id));
    from.items = from.items.filter(i => !ids.includes(i.id));
    if (strip) moving.forEach(i => { delete i.dishKey; delete i.dishId; delete i.dishName; delete i.compIdx; });
    to.items.push(...moving);
  });
  toast('Spostato in ' + mealName(toId));
}
function normalize(o) {
  const d = defaults();
  return { ...d, ...o, settings: { ...d.settings, ...(o.settings || {}), targets: { ...d.settings.targets, ...((o.settings || {}).targets || {}) } },
    days: o.days || {}, custom: o.custom || [], saved: o.saved || [], recents: o.recents || {}, weights: o.weights || [] };
}
async function applyMealsTo(destKey, newMeals, label) {
  const d0 = S.days[destKey];
  let mode = 'replace';
  if (d0 && d0.meals.some(m => m.items.length)) {
    mode = await choice(label, 'Questa giornata ha già dei pasti.', [
      { label: 'Aggiungi ai pasti esistenti', value: 'add', cls: 'primary' },
      { label: 'Sostituisci tutto', value: 'replace', cls: 'danger' },
      { label: 'Annulla', value: null }]);
    if (!mode) return false;
  }
  const d = ensure(destKey);
  if (mode === 'replace') d.meals = newMeals;
  else newMeals.forEach(nm => {
    const ex = d.meals.find(m => norm(m.name) === norm(nm.name));
    if (ex) ex.items.push(...nm.items); else d.meals.push(nm);
  });
  save(); render();
  return true;
}
function ask(title, label, value, okLabel) {
  return new Promise(res => {
    const back = document.createElement('div'); back.className = 'dlg-back'; back.style.alignItems = 'center';
    back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><label class="fld" style="margin:0"><span>${esc(label)}</span><input class="inp" value="${esc(value || '')}" autocomplete="off"></label><button class="btn primary" data-i="ok">${esc(okLabel || 'OK')}</button><button class="btn ghost" data-i="no">Annulla</button></div>`;
    const inp = $('input', back);
    const done = v => { back.remove(); res(v); };
    back.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) done(b.dataset.i === 'ok' ? inp.value.trim() : null); else if (e.target === back) done(null);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value.trim()); });
    document.body.appendChild(back); setTimeout(() => inp.focus(), 60);
  });
}
const qs = c => c.kind === 'g' ? f0(c.qty) + ' g' : f1(c.qty) + ' ' + unitStr(c, c.qty);

/* ===================== Editor quantità ===================== */
function openQty(o) {
  const c = o.cfg, isG = c.kind === 'g';
  const step = c.step || (isG ? 10 : 1);
  let q = o.qty;
  const base = o.base || Z();
  const sh = openSheet(o.title || 'Quantità');
  const uLabel = () => isG ? 'g' : unitStr(c, q);
  const sMax = () => Math.max(c.max || (isG ? Math.max(Math.ceil(c.def * 3 / 50) * 50, 100) : Math.max(c.def * 3, 4)), q);
  const perTxt = isG
    ? `Per 100 g: ${f0(c.per.kcal)} kcal · P ${f1(c.per.p)} · C ${f1(c.per.c)} · G ${f1(c.per.f)}`
    : `Per 1 ${unitStr(c, 1)}: ${f0(c.per.kcal)} kcal · P ${f1(c.per.p)} · C ${f1(c.per.c)} · G ${f1(c.per.f)}`;
  const note = [c.note, c.unit && isG && c.unit !== 'g' ? 'unità: ' + c.unit : ''].filter(Boolean).join(' · ');
  let chips;
  if (c.chips && c.chips.length) chips = c.chips.slice();
  else if (isG) chips = [c.def / 2, c.def, c.def * 1.5, c.def * 2].map(v => snapTo(v, Math.min(step, 5)));
  else chips = step < 1 ? [0.5, 1, 1.5, 2, 3] : [1, 2, 3, 4, 5];
  const rc = S.recents[c.id]; if (rc && rc.qty > 0) chips.push(rc.qty);
  if (o.qty > 0) chips.push(o.qty);
  chips = [...new Set(chips.filter(v => v > 0).map(r2))].sort((a, b) => a - b);
  const chipLab = v => isG ? f0(v) + ' g' : f1(v);
  sh.body.innerHTML = `<div class="max"><div class="qty-name">${esc(c.name)}${c.src === 'stima' ? ' <span class="tag stima">stima</span>' : ''}</div>
    <div class="qty-note">${esc(note) || '&nbsp;'}</div>
    <div class="qty-ctl"><button class="step" data-hold="-1" aria-label="Meno">−</button>
      <div class="qty-field"><input class="q-in" inputmode="decimal" autocomplete="off" aria-label="Quantità"><span class="u"></span></div>
      <button class="step" data-hold="1" aria-label="Più">+</button></div>
    <input type="range" class="q-range" min="0" step="${step}" aria-label="Regola la quantità">
    <div class="chips q-chips">${chips.map(v => `<button class="chip" data-sa="chip" data-v="${v}">${chipLab(v)}</button>`).join('')}</div>
    ${c.pz && isG ? `<div class="chips" style="margin-top:8px">${[1, 2, 3, 4].map(n => `<button class="chip" data-sa="chip" data-v="${r2(n * c.pz.g)}">${n} ${n === 1 ? c.pz.l : c.pz.pl}</button>`).join('')}</div>` : ''}
    <div class="tiles"><div class="tile"><b class="t-k"></b><span>kcal</span></div><div class="tile p"><b class="t-p"></b><span>proteine</span></div><div class="tile c"><b class="t-c"></b><span>carboidrati</span></div><div class="tile f"><b class="t-f"></b><span>grassi</span></div></div>
    <p class="hint">${esc(perTxt)}${c.src === 'stima' ? '<br>Valore stimato: controlla l\'etichetta se puoi.' : ''}</p></div>`;
  const inp = $('.q-in', sh.body), rng = $('.q-range', sh.body);
  const cur0 = () => itemMacro({ kind: c.kind, per: c.per, qty: q });
  function paint(skipInput) {
    const m = cur0();
    $('.t-k', sh.body).textContent = f0(m.kcal); $('.t-p', sh.body).textContent = f1(m.p); $('.t-c', sh.body).textContent = f1(m.c); $('.t-f', sh.body).textContent = f1(m.f);
    if (!skipInput) inp.value = String(isG ? r2(q) : r2(q)).replace('.', ',');
    $('.u', sh.body).textContent = uLabel();
    rng.max = sMax(); rng.value = q;
    $$('.chip', sh.body).forEach(b => b.classList.toggle('on', Math.abs(num(b.dataset.v) - q) < 1e-6));
    sh.setPreview({ kcal: m.kcal - base.kcal, p: m.p - base.p, c: m.c - base.c, f: m.f - base.f });
    const ok = $('[data-sa="ok"]', sh.foot); if (ok) ok.disabled = !(q > 0);
  }
  function set(v, skipInput) { q = r2(clamp(v, 0, 99999)); paint(skipInput); }
  function stepBy(dir, mult = 1) {
    let v;
    const r = q / step;
    if (Math.abs(r - Math.round(r)) > 1e-6) v = (dir > 0 ? Math.ceil(r) : Math.floor(r)) * step; else v = q + dir * step * mult;
    set(v);
  }
  $$('[data-hold]', sh.body).forEach(btn => {
    const dir = +btn.dataset.hold; let t1, t2;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); stepBy(dir); let n = 0; t1 = setTimeout(() => { t2 = setInterval(() => { n++; stepBy(dir, n > 16 ? 5 : n > 7 ? 2 : 1); }, 90); }, 380); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('click', e => { if (e.detail === 0) stepBy(dir); });
  });
  inp.addEventListener('input', () => set(num(inp.value), true));
  inp.addEventListener('blur', () => paint(false));
  inp.addEventListener('focus', () => setTimeout(() => { try { inp.select(); } catch (e) { } }, 0));
  rng.addEventListener('input', () => set(num(rng.value)));
  sh.foot.innerHTML = `<button class="btn primary" data-sa="ok">${esc(o.confirmLabel || 'Aggiungi')}</button>` +
    (o.onMove || o.onDelete ? `<div class="btn-row">${o.onMove ? '<button class="btn" data-sa="move">Sposta in…</button>' : '<span></span>'}${o.onDelete ? '<button class="btn danger" data-sa="del">Elimina</button>' : '<span></span>'}</div>` : '');
  sh.on({
    chip: el => set(num(el.dataset.v)),
    ok: () => { if (!(q > 0)) return; sh.close(); o.onConfirm(q); },
    move: () => o.onMove(sh),
    del: () => { sh.close(); o.onDelete(); },
  });
  paint();
  return sh;
}

/* ===================== Piatti scomponibili ===================== */
function openDish(o) {
  const edit = o.mode === 'edit';
  let dish = o.dish, comps = [], mult = 1, dishName;
  let its = [];
  if (edit) {
    const meal = findMeal(cur(), o.mealId);
    its = meal ? meal.items.filter(i => i.dishKey === o.key) : [];
    if (!its.length) return;
    dish = its[0].dishId ? dishById(its[0].dishId) : null;
    dishName = its[0].dishName;
    comps = its.map(it => ({ idx: it.compIdx == null ? 99 : it.compIdx, item: it, food: null, name: it.name, kind: it.kind, per: it.per, unit: it.unit, step: cfgOf(it).step, qty: it.qty, on: true, base: it.qty, id: it.fid, cfg: cfgOf(it) }));
    if (dish) dish.items.forEach((cc, i) => {
      if (its.some(it => it.compIdx === i)) return;
      const f = foodById(cc.f);
      comps.push({ idx: i, item: null, food: f, name: f.name, kind: f.kind, per: f.per, unit: f.unit, step: f.step || 1, qty: cc.q, on: false, base: cc.q, id: f.id, cfg: f });
    });
    comps.sort((a, b) => a.idx - b.idx);
  } else {
    dishName = dish.name;
    comps = dish.items.map((cc, i) => { const f = foodById(cc.f); return { idx: i, item: null, food: f, name: f.name, kind: f.kind, per: f.per, unit: f.unit, step: f.step || 1, qty: cc.q, on: true, base: cc.q, id: f.id, cfg: f }; });
  }
  const orig = sumItems(its);
  const sh = openSheet(edit ? 'Modifica piatto' : 'Piatto');
  const tot = () => comps.filter(c => c.on).reduce((a, c) => addM(a, itemMacro(c)), Z());
  const mults = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const mLab = m => ({ 0.5: '½', 0.75: '¾', 1: '×1', 1.25: '1¼', 1.5: '1½', 2: '×2' }[m]);
  sh.body.innerHTML = `<div class="max"><div class="qty-name">${esc(dishName)}</div><p class="qty-note">${dish && dish.note ? esc(dish.note) + ' ' : ''}Togli o aggiungi gli ingredienti e cambia le quantità come vuoi.</p>
    <div class="chips d-mult" style="margin-bottom:6px"></div><div class="d-comps"></div>
    <div class="tiles"><div class="tile"><b class="t-k"></b><span>kcal</span></div><div class="tile p"><b class="t-p"></b><span>proteine</span></div><div class="tile c"><b class="t-c"></b><span>carboidrati</span></div><div class="tile f"><b class="t-f"></b><span>grassi</span></div></div></div>`;
  function draw() {
    $('.d-mult', sh.body).innerHTML = '<span class="muted" style="align-self:center;font-size:14px;margin-right:2px">Porzione</span>' + mults.map(m => `<button class="chip ${mult === m ? 'on' : ''}" data-sa="mult" data-m="${m}">${mLab(m)}</button>`).join('');
    $('.d-comps', sh.body).innerHTML = comps.map((c, i) => {
      const m = itemMacro(c);
      return `<div class="comp ${c.on ? 'on' : 'off'}"><button class="cb" data-sa="tog" data-i="${i}" aria-label="Includi o togli ${esc(c.name)}">✓</button>
        <div class="nm">${esc(c.name)}<small>${f0(m.kcal)} kcal · P ${f1(m.p)} · C ${f1(m.c)} · G ${f1(m.f)}</small></div>
        <div class="mini-step"><button data-sa="dec" data-i="${i}" aria-label="Meno">−</button><button class="v" data-sa="val" data-i="${i}">${esc(qs(c))}</button><button data-sa="inc" data-i="${i}" aria-label="Più">+</button></div></div>`;
    }).join('');
    const t = tot();
    $('.t-k', sh.body).textContent = f0(t.kcal); $('.t-p', sh.body).textContent = f1(t.p); $('.t-c', sh.body).textContent = f1(t.c); $('.t-f', sh.body).textContent = f1(t.f);
    const base = edit ? orig : Z();
    sh.setPreview({ kcal: t.kcal - base.kcal, p: t.p - base.p, c: t.c - base.c, f: t.f - base.f });
    const ok = $('[data-sa="ok"]', sh.foot); if (ok) ok.disabled = !comps.some(c => c.on);
  }
  const getMeal = () => o.getMeal ? o.getMeal() : o.mealId;
  sh.foot.innerHTML = edit
    ? `<button class="btn primary" data-sa="ok">Salva modifiche</button><div class="btn-row"><button class="btn" data-sa="move">Sposta tutto in…</button><button class="btn" data-sa="ungroup">Scomponi</button></div><button class="btn danger" data-sa="del">Elimina piatto</button>`
    : `<button class="btn primary" data-sa="ok"></button>`;
  const okLabel = () => { const b = $('[data-sa="ok"]', sh.foot); if (b && !edit) b.textContent = 'Aggiungi a ' + mealName(getMeal()); };
  sh.on({
    mult: el => { mult = +el.dataset.m; comps.forEach(c => { c.qty = Math.max(c.step, snapTo(c.base * mult, c.step)); }); draw(); },
    tog: el => { const c = comps[+el.dataset.i]; c.on = !c.on; draw(); },
    dec: el => { const c = comps[+el.dataset.i]; const r = c.qty / c.step; c.qty = Math.max(0, r2((Math.abs(r - Math.round(r)) > 1e-6 ? Math.floor(r) : r - 1) * c.step)); mult = null; if (c.qty <= 0) { c.qty = c.step; c.on = false; } draw(); },
    inc: el => { const c = comps[+el.dataset.i]; const r = c.qty / c.step; c.qty = r2((Math.abs(r - Math.round(r)) > 1e-6 ? Math.ceil(r) : r + 1) * c.step); c.on = true; mult = null; draw(); },
    val: el => {
      const c = comps[+el.dataset.i];
      openQty({ cfg: c.cfg, qty: c.qty, title: c.name, confirmLabel: 'Imposta', base: c.on ? itemMacro(c) : Z(),
        onConfirm: q => { c.qty = q; c.on = true; mult = null; draw(); refreshPreview(); } });
    },
    ok: () => {
      if (!comps.some(c => c.on)) return;
      if (!edit) {
        const key = uid();
        const items = comps.filter(c => c.on).map(c => mkItem(c.food, c.qty, { dishKey: key, dishId: dish.id, dishName: dish.name, compIdx: c.idx }));
        sh.close(); addItemsTo(getMeal(), items); toast('Aggiunto: ' + dish.name);
        if (o.onAdded) o.onAdded();
      } else {
        sh.close();
        mut(d => {
          const meal = findMeal(d, o.mealId); if (!meal) return;
          comps.forEach(c => {
            if (c.item) {
              const it = meal.items.find(i => i.id === c.item.id); if (!it) return;
              if (c.on) it.qty = c.qty; else meal.items.splice(meal.items.indexOf(it), 1);
            } else if (c.on) {
              const ni = mkItem(c.food, c.qty, { dishKey: o.key, dishId: dish ? dish.id : null, dishName, compIdx: c.idx });
              let last = -1; meal.items.forEach((x, i) => { if (x.dishKey === o.key) last = i; });
              if (last >= 0) meal.items.splice(last + 1, 0, ni); else meal.items.push(ni);
            }
          });
        });
      }
    },
    move: () => openMove('Sposta il piatto in…', o.mealId, to => { sh.close(); moveItems(o.mealId, its.map(i => i.id), to, false); }),
    ungroup: () => {
      sh.close();
      mut(d => { const meal = findMeal(d, o.mealId); if (meal) meal.items.forEach(i => { if (i.dishKey === o.key) { delete i.dishKey; delete i.dishId; delete i.dishName; delete i.compIdx; } }); });
      toast('Ora gli alimenti sono separati');
    },
    del: async () => {
      const r = await choice('Eliminare il piatto?', dishName + ' e tutti i suoi ingredienti.', [{ label: 'Elimina', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]);
      if (!r) return;
      sh.close(); mut(d => { const meal = findMeal(d, o.mealId); if (meal) meal.items = meal.items.filter(i => i.dishKey !== o.key); });
    },
  });
  okLabel(); draw();
  return sh;
}

/* ===================== Spostamenti, pasti, giornate tipo ===================== */
function openMove(title, fromId, onPick) {
  const d = cur();
  const sh = openSheet(title);
  sh.body.innerHTML = `<div class="max stack">${d.meals.map(m => `<button class="btn" data-sa="pick" data-id="${m.id}" ${m.id === fromId ? 'disabled' : ''}><span>${esc(m.name)}</span><span class="muted" style="font-weight:500">${f0(sumItems(m.items).kcal)} kcal</span></button>`).join('')}<button class="btn primary" data-sa="new">+ Nuovo pasto</button></div>`;
  sh.on({ pick: el => { sh.close(); onPick(el.dataset.id); }, new: () => { sh.close(); openNewMeal(id => onPick(id)); } });
  return sh;
}
const MEAL_NAMES = ['Colazione', 'Spuntino', 'Pranzo', 'Merenda', 'Cena', 'Pre-nanna', 'Pre-allenamento', 'Post-allenamento'];
function openNewMeal(onCreate) {
  const d = cur();
  const sh = openSheet('Nuovo pasto');
  const used = d.meals.map(m => norm(m.name));
  const sugg = MEAL_NAMES.filter(n => !used.includes(norm(n)));
  sh.body.innerHTML = `<div class="max"><label class="fld"><span>Nome del pasto</span><input class="inp nm-in" placeholder="Es. Pranzo" autocomplete="off" maxlength="40"></label>
    <div class="chips" style="margin-bottom:14px">${sugg.map(n => `<button class="chip" data-sa="sugg" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <label class="fld"><span>Orario (facoltativo)</span><input class="inp tm-in" type="time"></label></div>`;
  sh.foot.innerHTML = '<button class="btn primary" data-sa="ok">Crea pasto</button>';
  const nm = $('.nm-in', sh.body);
  sh.on({
    sugg: el => { nm.value = el.dataset.n; $$('.chip', sh.body).forEach(c => c.classList.toggle('on', c === el)); },
    ok: () => {
      const name = nm.value.trim() || ('Pasto ' + (d.meals.length + 1));
      const id = uid(), time = $('.tm-in', sh.body).value;
      sh.close();
      V.openMeals[id] = true; V.lastMeal = id;
      mut(dd => dd.meals.push({ id, name, time, items: [] }));
      (onCreate || openPicker)(id);
    },
  });
}
function openMealSheet(id) {
  const d0 = cur(), m0 = findMeal(d0, id); if (!m0) return;
  const sh = openSheet('Pasto');
  sh.body.innerHTML = `<div class="max"><label class="fld"><span>Nome</span><input class="inp nm-in" value="${esc(m0.name)}" maxlength="40" autocomplete="off"></label>
    <label class="fld"><span>Orario (facoltativo)</span><input class="inp tm-in" type="time" value="${esc(m0.time || '')}"></label>
    <div class="btn-row" style="margin-bottom:10px"><button class="btn" data-sa="up">Sposta su</button><button class="btn" data-sa="down">Sposta giù</button></div>
    <div class="stack"><button class="btn" data-sa="saveMeal">Salva come pasto riutilizzabile</button><button class="btn" data-sa="dup">Duplica il pasto</button><button class="btn" data-sa="clear">Svuota il pasto</button><button class="btn danger" data-sa="del">Elimina il pasto</button></div></div>`;
  sh.foot.innerHTML = '<button class="btn primary" data-sa="ok">Salva</button>';
  const commit = () => {
    const name = $('.nm-in', sh.body).value.trim() || m0.name, time = $('.tm-in', sh.body).value;
    const m = findMeal(ensure(), id); if (m) { m.name = name; m.time = time; }
  };
  const shift = dir => { commit(); const d = ensure(), i = d.meals.findIndex(x => x.id === id), j = i + dir; if (j < 0 || j >= d.meals.length) return; [d.meals[i], d.meals[j]] = [d.meals[j], d.meals[i]]; save(); render(); toast(dir < 0 ? 'Spostato su' : 'Spostato giù'); };
  sh.on({
    ok: () => { commit(); save(); sh.close(); render(); },
    up: () => shift(-1), down: () => shift(1),
    saveMeal: async () => {
      commit();
      const m = findMeal(ensure(), id);
      if (!m.items.length) return toast('Il pasto è vuoto');
      const name = await ask('Salva come pasto', 'Nome', m.name, 'Salva');
      if (!name) return;
      S.saved.push({ id: uid(), name, items: cloneItems(m.items) }); save(); toast('Pasto salvato');
    },
    dup: () => { commit(); const d = ensure(), i = d.meals.findIndex(x => x.id === id); const c = cloneMeals([d.meals[i]])[0]; c.name = d.meals[i].name + ' (copia)'; d.meals.splice(i + 1, 0, c); save(); sh.close(); render(); toast('Pasto duplicato'); },
    clear: async () => {
      const m = findMeal(cur(), id); if (!m.items.length) return toast('Il pasto è già vuoto');
      const r = await choice('Svuotare il pasto?', 'Gli alimenti verranno rimossi.', [{ label: 'Svuota', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]);
      if (r) { sh.close(); mut(d => { findMeal(d, id).items = []; }); }
    },
    del: async () => {
      const m = findMeal(cur(), id);
      const r = m.items.length ? await choice('Eliminare il pasto?', `«${m.name}» e i suoi ${m.items.length} alimenti.`, [{ label: 'Elimina', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]) : true;
      if (r) { sh.close(); mut(d => { d.meals = d.meals.filter(x => x.id !== id); }); }
    },
  });
}
function openTemplates() {
  const d = cur();
  const sh = openSheet('Giornate tipo');
  const list = D.TEMPLATES.slice().sort((a, b) => (b.type === d.type) - (a.type === d.type));
  const row = t => {
    const meals = expandTemplate(t), tt = sumItems(meals.flatMap(m => m.items));
    return `<button class="btn" data-sa="tpl" data-id="${t.id}" style="flex-direction:column;align-items:flex-start;gap:3px;padding:12px 16px;text-align:left;height:auto"><span style="display:flex;justify-content:space-between;width:100%;gap:8px"><b>${esc(t.name)}</b><span class="pill ${t.type === 'training' ? 'training' : ''}">${t.type === 'training' ? 'Allenamento' : 'Riposo'}</span></span><span class="muted" style="font-weight:500;font-size:14px">${esc(t.desc || '')}</span><span class="num muted" style="font-size:14px;font-weight:600">${f0(tt.kcal)} kcal · P ${f0(tt.p)} · C ${f0(tt.c)} · G ${f0(tt.f)}</span></button>`;
  };
  const mine = list.filter(t => t.type === d.type), other = list.filter(t => t.type !== d.type);
  sh.body.innerHTML = `<div class="max"><p class="hint" style="margin:0 0 6px">Propongono pasti già pronti: poi puoi cambiare tutto, spostare e scomporre gli alimenti.</p>
    <div class="group-title" style="margin-top:8px">Consigliate per ${d.type === 'training' ? 'un giorno di allenamento' : 'un giorno di riposo'}</div><div class="stack" style="margin-top:8px">${mine.map(row).join('')}</div>
    <div class="group-title">Altre</div><div class="stack" style="margin-top:8px">${other.map(row).join('')}</div></div>`;
  sh.on({
    tpl: async el => {
      const t = D.TEMPLATES.find(x => x.id === el.dataset.id);
      const ok = await applyMealsTo(V.date, expandTemplate(t), t.name);
      if (ok) { sh.close(); toast('Giornata applicata'); }
    },
  });
}
function openCopyDay(onlyKey) {
  const sh = openSheet('Copia da un altro giorno');
  const keys = loggedDays().filter(k => k !== V.date).slice(0, 40);
  sh.body.innerHTML = `<div class="max">${keys.length ? `<div class="stack">${keys.map(k => { const t = dayTotals(S.days[k]); return `<button class="btn" data-sa="cp" data-k="${k}" style="flex-direction:column;align-items:flex-start;gap:2px;height:auto;padding:12px 16px"><b>${esc(dateLong(k))}</b><span class="muted num" style="font-size:14px;font-weight:600">${f0(t.kcal)} kcal · P ${f0(t.p)} · ${S.days[k].type === 'training' ? 'Allenamento' : 'Riposo'}</span></button>`; }).join('')}</div>` : '<p class="muted">Non ci sono ancora giorni registrati da copiare.</p>'}</div>`;
  sh.on({
    cp: async el => {
      const src = S.days[el.dataset.k];
      const ok = await applyMealsTo(V.date, cloneMeals(src.meals.filter(m => m.items.length)), 'Copia dei pasti');
      if (ok) { sh.close(); toast('Pasti copiati'); }
    },
  });
}

/* ===================== Target del giorno e attività ===================== */
function openTarget() {
  const d = cur(), b = d.targetOverride || S.settings.targets;
  const sh = openSheet('Target di questo giorno');
  const fld = (l, id, v) => `<label class="fld"><span>${l}</span><input class="inp num" data-f="${id}" inputmode="numeric" value="${v}"></label>`;
  sh.body.innerHTML = `<div class="max"><p class="hint" style="margin:0 0 12px">Cambia solo ${esc(dateMain(V.date).toLowerCase())}, senza toccare il piano di base.</p>
    <div class="grid2">${fld('Kcal', 'kcal', Math.round(b.kcal))}${fld('Proteine (g)', 'p', Math.round(b.p))}${fld('Carboidrati (g)', 'c', Math.round(b.c))}${fld('Grassi (g)', 'f', Math.round(b.f))}</div>
    <p class="hint tgt-hint"></p></div>`;
  sh.foot.innerHTML = `<button class="btn primary" data-sa="ok">Salva per questo giorno</button>${d.targetOverride ? '<button class="btn" data-sa="reset">Torna al target standard</button>' : ''}`;
  const vals = () => { const o = {}; $$('[data-f]', sh.body).forEach(i => { o[i.dataset.f] = num(i.value); }); return o; };
  const upd = () => { const v = vals(), k = v.p * 4 + v.c * 4 + v.f * 9; $('.tgt-hint', sh.body).textContent = `I macro valgono ${f0(k)} kcal.`; };
  $$('[data-f]', sh.body).forEach(i => i.addEventListener('input', upd)); upd();
  sh.on({
    ok: () => { const v = vals(); if (!(v.kcal > 0)) return toast('Inserisci le kcal'); sh.close(); mut(dd => { dd.targetOverride = { kcal: v.kcal, p: v.p, c: v.c, f: v.f }; }); toast('Target aggiornato'); },
    reset: () => { sh.close(); mut(dd => { dd.targetOverride = null; }); toast('Target standard'); },
  });
}
const ACT_PRESETS = [['Padel', 400], ['Allenamento a casa', 300], ['Palestra', 300], ['Corsa', 600], ['Camminata', 250], ['Altro', 300]];
function openActivity() {
  const sh = openSheet('Attività extra');
  sh.body.innerHTML = `<div class="max"><div class="chips" style="margin-bottom:14px">${ACT_PRESETS.map(([n]) => `<button class="chip" data-sa="pr" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <label class="fld"><span>Attività</span><input class="inp a-n" placeholder="Es. Padel" maxlength="40" autocomplete="off"></label>
    <div class="grid2"><label class="fld"><span>Durata (minuti)</span><input class="inp num a-m" inputmode="numeric"></label><label class="fld"><span>Kcal consumate</span><input class="inp num a-k" inputmode="numeric"></label></div>
    <p class="hint a-hint">Scegli un'attività e inserisci i minuti: le kcal sono una stima indicativa, correggile se usi un orologio.</p></div>`;
  sh.foot.innerHTML = '<button class="btn primary" data-sa="ok">Aggiungi attività</button>';
  let rate = 300, manual = false;
  const k = $('.a-k', sh.body), m = $('.a-m', sh.body), n = $('.a-n', sh.body);
  const recalc = () => { if (!manual && num(m.value) > 0) k.value = Math.round(rate * num(m.value) / 60); updHint(); };
  const updHint = () => { const x = num(k.value); $('.a-hint', sh.body).textContent = x > 0 ? `Al target vengono aggiunte ${f0(x * S.settings.activityPct / 100)} kcal (${S.settings.activityPct}% della stima).` : $('.a-hint', sh.body).textContent; };
  m.addEventListener('input', () => { manual = false; recalc(); });
  k.addEventListener('input', () => { manual = true; updHint(); });
  sh.on({
    pr: el => { const p = ACT_PRESETS.find(x => x[0] === el.dataset.n); n.value = p[0]; rate = p[1]; $$('.chip', sh.body).forEach(c => c.classList.toggle('on', c === el)); recalc(); },
    ok: () => {
      const kc = num(k.value); if (!(kc > 0)) return toast('Inserisci le kcal');
      const name = n.value.trim() || 'Attività';
      sh.close(); mut(d => d.activities.push({ id: uid(), name, min: num(m.value) || 0, kcal: kc })); toast('Attività aggiunta');
    },
  });
}

/* ===================== Alimenti personalizzati ===================== */
function openCustomForm(o) {
  const ex = o.food, isNew = !ex;
  let mode = ex ? (ex.kind === 'g' ? 'g' : 'u') : 'g';
  const sh = openSheet(ex ? 'Modifica alimento' : (o.add ? 'Alimento extra' : 'Nuovo alimento'));
  const v = (x) => ex ? String(ex.per[x]).replace('.', ',') : '';
  sh.body.innerHTML = `<div class="max"><label class="fld"><span>Nome</span><input class="inp c-n" maxlength="60" autocomplete="off" value="${esc(ex ? ex.name : '')}" placeholder="Es. Pizza margherita"></label>
    <div class="seg" style="margin-bottom:14px"><button data-sa="mode" data-m="g">Valori per 100 g</button><button data-sa="mode" data-m="u">Valori per porzione</button></div>
    <div class="grid2"><label class="fld"><span>Kcal</span><input class="inp num c-k" inputmode="decimal" value="${v('kcal')}"></label><label class="fld"><span>Proteine (g)</span><input class="inp num c-p" inputmode="decimal" value="${v('p')}"></label>
    <label class="fld"><span>Carboidrati (g)</span><input class="inp num c-c" inputmode="decimal" value="${v('c')}"></label><label class="fld"><span>Grassi (g)</span><input class="inp num c-f" inputmode="decimal" value="${v('f')}"></label></div>
    <div class="c-unit" style="display:none"><label class="fld"><span>Nome della porzione</span><input class="inp c-u" maxlength="24" placeholder="Es. fetta, pezzo, porzione" value="${esc(ex && typeof ex.unit === 'string' && ex.kind !== 'g' ? ex.unit : '')}"></label></div>
    ${o.add ? '<label class="fld"><span class="c-qlab">Quantità da aggiungere (g)</span><input class="inp num c-q" inputmode="decimal" value="100"></label>' : ''}
    <p class="hint c-hint">Se lasci vuote le kcal, le calcolo da proteine, carboidrati e grassi.</p></div>`;
  sh.foot.innerHTML = o.add
    ? '<button class="btn primary" data-sa="save">Salva e aggiungi</button><button class="btn" data-sa="once">Aggiungi senza salvare</button>'
    : '<button class="btn primary" data-sa="save">Salva</button>';
  const drawMode = () => {
    $$('.seg button', sh.body).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    $('.c-unit', sh.body).style.display = mode === 'u' ? 'block' : 'none';
    const ql = $('.c-qlab', sh.body), qi = $('.c-q', sh.body);
    if (ql) { ql.textContent = mode === 'g' ? 'Quantità da aggiungere (g)' : 'Quantità da aggiungere (porzioni)'; if (qi && !qi.dataset.touched) qi.value = mode === 'g' ? '100' : '1'; }
  };
  const qi0 = $('.c-q', sh.body); if (qi0) qi0.addEventListener('input', () => { qi0.dataset.touched = '1'; });
  function build() {
    const name = $('.c-n', sh.body).value.trim();
    const p = num($('.c-p', sh.body).value), c = num($('.c-c', sh.body).value), f = num($('.c-f', sh.body).value);
    let k = $('.c-k', sh.body).value.trim() === '' ? p * 4 + c * 4 + f * 9 : num($('.c-k', sh.body).value);
    if (!name) { toast('Scrivi il nome'); return null; }
    if (!(k > 0) && !(p + c + f > 0)) { toast('Inserisci almeno le kcal'); return null; }
    const un = $('.c-u', sh.body).value.trim() || 'porzione';
    return { id: ex ? ex.id : 'c_' + uid(), name, cat: 'Miei', kind: mode === 'g' ? 'g' : 'unit', per: { kcal: r2(k), p: r2(p), c: r2(c), f: r2(f) },
      unit: mode === 'g' ? 'g' : un, def: mode === 'g' ? 100 : 1, step: mode === 'g' ? 10 : 0.5, src: ex ? ex.src || '' : '', custom: true };
  }
  sh.on({
    mode: el => { mode = el.dataset.m; drawMode(); },
    save: () => {
      const food = build(); if (!food) return;
      if (ex) { const i = S.custom.findIndex(x => x.id === ex.id); if (i >= 0) S.custom[i] = food; } else S.custom.push(food);
      invalidateFoods(); save();
      const q = o.add ? num($('.c-q', sh.body).value) : 0;
      sh.close();
      if (o.add && q > 0) addFoodTo(o.add, food, q); else render();
      toast(ex ? 'Alimento aggiornato' : 'Alimento salvato');
      if (o.after) o.after(food);
    },
    once: () => {
      const food = build(); if (!food) return;
      food.id = 'q_' + uid(); const q = num($('.c-q', sh.body).value) || (mode === 'g' ? 100 : 1);
      sh.close(); addFoodTo(o.add, food, q); toast('Aggiunto: ' + food.name);
    },
  });
  drawMode();
  if (ex) mode = ex.kind === 'g' ? 'g' : 'u', drawMode();
}

/* ===================== Open Food Facts ===================== */
const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity,serving_size';
function offToFood(p) {
  const n = p.nutriments || {};
  const g = k => { const x = parseFloat(n[k]); return isFinite(x) ? x : null; };
  let kcal = g('energy-kcal_100g'); if (kcal == null) { const kj = g('energy_100g'); if (kj != null) kcal = kj / 4.184; }
  const pr = g('proteins_100g'), ch = g('carbohydrates_100g'), fa = g('fat_100g');
  if (kcal == null || pr == null || ch == null || fa == null || !p.product_name) return null;
  const brand = (p.brands || '').split(',')[0].trim();
  const sv = parseFloat(p.serving_quantity);
  return { id: 'off_' + (p.code || uid()), name: p.product_name.trim() + (brand ? ' · ' + brand : ''), cat: 'Miei', kind: 'g',
    per: { kcal: Math.round(kcal), p: r2(pr), c: r2(ch), f: r2(fa) }, unit: 'g', def: sv > 0 && sv < 1000 ? Math.round(sv) : 100, step: 5, note: 'Open Food Facts', src: 'off', custom: true };
}
async function offSearch(q) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 14000);
  try {
    const url = /^\d{8,14}$/.test(q)
      ? `https://world.openfoodfacts.org/api/v2/product/${q}.json?fields=${OFF_FIELDS}`
      : `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&sort_by=unique_scans_n&lc=it&fields=${OFF_FIELDS}`;
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const arr = j.products ? j.products : (j.product ? [j.product] : []);
    return arr.map(offToFood).filter(Boolean);
  } finally { clearTimeout(to); }
}

/* ===================== Chiudi i macro ===================== */
/* Cerca, tra i tuoi spuntini e alimenti pratici, 1-2 voci che avvicinano la giornata al target
   (kcal entro ±5%, proteine ≥ 90%). È un aiuto di calcolo: non considera fibre, sazietà, gusto o orario. */
const CLOSE_FOODS = ['whey', 'yogurt', 'fesa_tacchino', 'tonno', 'uova', 'banana', 'mela', 'gallette', 'pane', 'avena', 'riso', 'mandorle', 'burro_arachidi'];
const CLOSE_DISH_CATS = ['Shaker e spuntini', 'Merenda', 'Pre-nanna', 'Colazione'];
function closeCandidates() {
  const out = [], MULTS = [1, 0.5, 1.5, 2];
  CLOSE_FOODS.forEach(id => {
    const f = foodById(id); if (!f) return;
    const step = f.step || 1, seen = new Set();
    MULTS.forEach(m => {
      const q = Math.max(step, snapTo(f.def * m, step)); if (seen.has(q)) return; seen.add(q);
      const items = [mkItem(f, q)];
      out.push({ kind: 'food', id, ids: [id], items, m: sumItems(items), label: f.name + ' · ' + qtyText(items[0]) });
    });
  });
  D.DISHES.filter(x => !x.venue && CLOSE_DISH_CATS.includes(x.cat)).forEach(x => {
    const hasCrea = x.items.some(c => c.f === 'creatina'), seen = new Set();
    MULTS.forEach(m => {
      if (hasCrea && m !== 1) return;
      const items = expandDish(x, m), sig = items.map(i => i.qty).join(',');
      if (seen.has(sig)) return; seen.add(sig);
      out.push({ kind: 'dish', id: x.id, ids: x.items.map(c => c.f).concat(x.id), items, m: sumItems(items), label: x.name + (m === 1 ? '' : ' (' + ({ 0.5: 'circa ½ porzione', 1.5: 'circa 1½ porzioni', 2: 'circa 2 porzioni' }[m]) + ')') });
    });
  });
  return out;
}
function closeCost(cur, t, tg) {
  const a = { kcal: cur.kcal + t.kcal, p: cur.p + t.p, c: cur.c + t.c, f: cur.f + t.f };
  const ek = (a.kcal - tg.kcal) / tg.kcal;
  let cost = 4 * Math.abs(ek);
  if (ek > 0.05) cost += 6 * (ek - 0.05);
  if (ek < -0.05) cost += 2 * (-ek - 0.05);
  const ep = (a.p - tg.p) / tg.p;
  if (ep < -0.1) cost += 8 * (-ep - 0.1); else if (ep < 0) cost += 2 * -ep;
  if (ep > 0.1) cost += 3 * (ep - 0.1);
  if (Math.abs(ek) > 0.04) cost += 1;
  if (a.p < tg.p * 0.92) cost += 1;
  cost += 1.2 * Math.abs(a.c - tg.c) / tg.c;
  const ef = (a.f - tg.f) / tg.f; cost += ef > 0 ? 1.5 * ef : 0.5 * -ef;
  return cost;
}
const dayStatus = (tot, tg) => ({ kcalOk: Math.abs(tot.kcal - tg.kcal) <= tg.kcal * 0.05, pOk: tot.p >= tg.p * 0.9 });
function closeSuggestions(tot, tg) {
  const cands = closeCandidates(), res = [];
  const consider = (parts) => {
    const t = parts.reduce((a, c) => addM(a, c.m), Z());
    res.push({ parts, t, cost: closeCost(tot, t, tg) + 0.03 * (parts.length - 1) });
  };
  cands.forEach(a => consider([a]));
  const foods = cands.filter(c => c.kind === 'food');
  cands.forEach(a => foods.forEach(b => {
    if (a === b || a.id === b.id || (a.kind === 'food' && a.id > b.id)) return;
    if (a.kind === 'dish' && a.ids.includes(b.id)) return;
    consider([a, b]);
  }));
  res.sort((x, y) => x.cost - y.cost);
  const pick = [], used = new Set(), sigs = new Set();
  for (const r of res) {
    const ids = r.parts.map(p => p.id), sig = [r.t.kcal / 5, r.t.p, r.t.c, r.t.f].map(v => Math.round(v)).join('/');
    if (ids.some(i => used.has(i)) || sigs.has(sig)) continue;
    pick.push(r); sigs.add(sig); ids.forEach(i => used.add(i));
    if (pick.length === 3) break;
  }
  return pick;
}
function openClose() {
  const d = cur(), tg = dayTarget(d), tot = dayTotals(d);
  const rem = { kcal: tg.kcal - tot.kcal, p: tg.p - tot.p, c: tg.c - tot.c, f: tg.f - tot.f };
  const st = dayStatus(tot, tg);
  const sh = openSheet('Chiudi i macro');
  let meal = (findMeal(d, V.lastMeal) || d.meals[d.meals.length - 1] || {}).id;
  const sg = (v, k) => (v < 0 ? '−' : '') + f0(Math.abs(v)) + k;
  let sugg = [];
  const head = `<p class="qty-note">Ti manca per il target di oggi (un valore negativo vuol dire che l'hai già superato):</p>
    <div class="tiles" style="margin-top:8px"><div class="tile"><b>${sg(rem.kcal, '')}</b><span>kcal</span></div><div class="tile p"><b>${sg(rem.p, '')}</b><span>proteine</span></div><div class="tile c"><b>${sg(rem.c, '')}</b><span>carboidrati</span></div><div class="tile f"><b>${sg(rem.f, '')}</b><span>grassi</span></div></div>`;
  let msg = '';
  if (!d.meals.length) msg = 'Crea prima un pasto dalla schermata Oggi.';
  else if (st.kcalOk && st.pOk) msg = 'Sei già in target: kcal entro il 5% e proteine almeno al 90%. Non serve aggiungere altro.';
  else if (rem.kcal > 900) msg = 'Ti mancano ancora molte kcal: troppe per uno spuntino. Registra prima i pasti principali, poi torna qui per sistemare il resto della giornata.';
  else if (rem.kcal < -tg.kcal * 0.05 && rem.p <= tg.p * 0.1) msg = 'Hai già superato il target di kcal e le proteine sono quasi a posto: non aggiungerei altro.';
  else { sugg = closeSuggestions(tot, tg); if (!sugg.length) msg = 'Non trovo combinazioni utili con gli alimenti a disposizione.'; }
  function draw() {
    const over = rem.kcal < -tg.kcal * 0.05;
    let h = head;
    if (msg) h += `<p class="hint" style="margin-top:14px">${esc(msg)}</p>`;
    if (sugg.length) {
      if (over) h += `<p class="hint" style="margin-top:14px">Sei sopra il target di kcal, ma ti mancano proteine: ecco le opzioni che pesano meno sulle kcal.</p>`;
      h += `<div class="chips scroll p-target" style="margin:14px 0 0"><span class="muted" style="flex:none;align-self:center;font-size:14px">Aggiungi a</span>${d.meals.map(m => `<button class="chip ${m.id === meal ? 'on' : ''}" data-sa="mealpick" data-id="${m.id}">${esc(m.name)}</button>`).join('')}</div>`;
      h += sugg.map((r, i) => {
        const a = { kcal: tot.kcal + r.t.kcal, p: tot.p + r.t.p, c: tot.c + r.t.c, f: tot.f + r.t.f };
        return `<div class="sugg"><ul>${r.parts.map(p => `<li>${esc(p.label)}</li>`).join('')}</ul>
          <div class="muted" style="font-size:14px">Aggiunge ${f0(r.t.kcal)} kcal · P ${f0(r.t.p)} · C ${f0(r.t.c)} · G ${f0(r.t.f)}</div>
          <div class="after">Giornata: <b>${f0(a.kcal)}</b> / ${f0(tg.kcal)} kcal · P <b>${f0(a.p)}</b> / ${f0(tg.p)} · C <b>${f0(a.c)}</b> / ${f0(tg.c)} · G <b>${f0(a.f)}</b> / ${f0(tg.f)}</div>
          <button class="btn primary" data-sa="addsug" data-i="${i}">Aggiungi a ${esc(mealName(meal))}</button></div>`;
      }).join('');
      h += `<p class="hint">Combinazioni calcolate sui tuoi spuntini e alimenti abituali per avvicinarsi a kcal (±5%) e proteine (≥ 90%). È solo un calcolo: non tiene conto di fame, fibre, gusto o orario. Dopo l'aggiunta puoi cambiare le quantità.</p>`;
    }
    sh.body.innerHTML = `<div class="max">${h}</div>`;
  }
  sh.foot.innerHTML = '<button class="btn" data-sa="close">Chiudi</button>';
  sh.on({
    mealpick: el => { meal = el.dataset.id; draw(); },
    addsug: el => {
      const r = sugg[+el.dataset.i]; if (!r || !meal) return;
      addItemsTo(meal, cloneItems(r.parts.flatMap(p => p.items)));
      V.openMeals[meal] = true; V.lastMeal = meal;
      toast('Aggiunto a ' + mealName(meal)); sh.close();
    },
  });
  draw();
  return sh;
}

/* ===================== Lettore di codici a barre ===================== */
/* Decodifica con ZXing (vendor/zxing-ean.js, caricato solo alla prima scansione). Fotocamera dal vivo,
   oppure foto scattata con la fotocamera di sistema come ripiego. Il codice letto va alla ricerca Open Food Facts. */
let zxLoading = null;
function loadZX() {
  if (window.ZXBarcode) return Promise.resolve();
  if (!zxLoading) zxLoading = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'vendor/zxing-ean.js';
    sc.onload = res; sc.onerror = () => { zxLoading = null; rej(new Error('zx-load')); };
    document.head.appendChild(sc);
  });
  return zxLoading;
}
const SCAN_ANGLES = [0, 8, -8, 90, 16, -16, -90];
/* Disegna `src` (video o immagine) su `cv` ruotato di `deg` gradi, ridotto a max `maxSide` px, e prova a leggere un codice.
   Con `band` usa solo la fascia centrale (60%) dell'inquadratura, a risoluzione piena: più nitido e più veloce. */
function scanDecode(src, sw, sh, cv, ctx, deg, maxSide, band) {
  const swap = Math.abs(deg) === 90;
  let sx = 0, sy = 0, bw = sw, bh = sh;
  if (band) { if (swap) { bw = sw * 0.6; sx = (sw - bw) / 2; } else { bh = sh * 0.6; sy = (sh - bh) / 2; } }
  const k = Math.min(1, maxSide / Math.max(bw, bh)), w = Math.max(8, Math.round(bw * k)), h = Math.max(8, Math.round(bh * k));
  const cw = swap ? h : w, ch = swap ? w : h;
  cv.width = cw; cv.height = ch;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
  ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(src, sx, sy, bw, bh, -w / 2, -h / 2, w, h); ctx.restore();
  const d = ctx.getImageData(0, 0, cw, ch).data, g = new Uint8ClampedArray(cw * ch);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  const code = window.ZXBarcode.decode(g, cw, ch);
  return code && /^\d{8,14}$/.test(code) ? code : null;
}
function scanErrText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'Accesso alla fotocamera non consentito. Consentilo quando il telefono lo chiede (se avevi rifiutato, riattivalo dalle Impostazioni) oppure usa «Scatta una foto del codice».';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Non trovo una fotocamera utilizzabile. Prova «Scatta una foto del codice» o scrivi il numero nella casella di ricerca.';
  if (n === 'NotReadableError') return 'La fotocamera è in uso da un\'altra app. Chiudila e riprova.';
  if (e && e.message === 'zx-load') return 'Non riesco a caricare il lettore. Controlla la connessione e riprova.';
  if (n === 'Unsupported') return 'Questo browser non permette di usare la fotocamera dall\'app. Usa «Scatta una foto del codice» o scrivi il numero.';
  return 'Non riesco ad avviare la fotocamera. Prova «Scatta una foto del codice» o scrivi il numero nella casella di ricerca.';
}
function openScanner(onCode) {
  let stream = null, stopped = false, timer = 0, k = 0, pend = null, pendAt = 0, busy = false;
  const sh = openSheet('Scansiona il codice a barre', { onClose: stop });
  sh.body.innerHTML = `<div class="max"><div class="scan-box"><video class="scan-video" playsinline muted autoplay></video><div class="scan-guide"><i></i></div></div>
    <p class="scan-msg" aria-live="polite">Avvio della fotocamera…</p>
    <p class="hint">Avvicina il codice a barre fino a riempire il riquadro, con buona luce e le barre più o meno orizzontali. Si legge da solo.</p>
    <button class="btn" data-sa="photo" style="margin-top:12px">Scatta una foto del codice</button>
    <input type="file" class="hidden scan-file" accept="image/*" capture="environment"></div>`;
  sh.foot.innerHTML = '<button class="btn" data-sa="close">Annulla</button>';
  const video = $('video', sh.body), msg = $('.scan-msg', sh.body), file = $('.scan-file', sh.body);
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
  function stop() {
    stopped = true; clearTimeout(timer);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    try { video.srcObject = null; } catch (e) { }
  }
  function found(code) { if (stopped) return; stop(); sh.close(); onCode(code); }
  function tick() {
    if (stopped) return;
    const next = () => { timer = setTimeout(tick, 70); };
    if (video.readyState < 2 || !video.videoWidth) return next();
    let code = null;
    try { code = scanDecode(video, video.videoWidth, video.videoHeight, cv, ctx, SCAN_ANGLES[k++ % SCAN_ANGLES.length], 1280, true); } catch (e) { }
    if (code) {
      const now = Date.now();
      if (code === pend && now - pendAt < 3000) return found(code);
      pend = code; pendAt = now; msg.textContent = 'Codice letto, conferma…';
    } else if (pend && Date.now() - pendAt > 3000) { pend = null; msg.textContent = 'Cerco il codice…'; }
    next();
  }
  (async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw { name: 'Unsupported' };
      const zx = loadZX();
      const st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (stopped) { st.getTracks().forEach(t => t.stop()); return; }
      stream = st; video.srcObject = st;
      await zx;
      try { await video.play(); } catch (e) { }
      if (stopped) return;
      msg.textContent = 'Cerco il codice…';
      tick();
    } catch (e) { if (!stopped) { stop(); stopped = false; msg.textContent = scanErrText(e); msg.classList.add('err'); $('.scan-box', sh.body).classList.add('off'); $('.hint', sh.body).style.display = 'none'; } }
  })();
  sh.on({
    photo: () => { file.value = ''; file.click(); },
  });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; if (!f || busy) return;
    busy = true; msg.classList.remove('err'); msg.textContent = 'Leggo la foto…';
    try {
      await loadZX();
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = url; });
      let code = null;
      for (const side of [1600, 1000]) for (const a of [0, 90, 8, -8, -90, 16, -16]) {
        code = scanDecode(img, img.naturalWidth, img.naturalHeight, cv, ctx, a, side, false); if (code) break;
        await new Promise(r => setTimeout(r, 0));
      }
      URL.revokeObjectURL(url);
      if (code) return found(code);
      msg.classList.add('err'); msg.textContent = 'Non riesco a leggere il codice nella foto. Avvicinati, metti a fuoco e tieni le barre orizzontali, poi riprova.';
    } catch (e) { msg.classList.add('err'); msg.textContent = scanErrText(e); }
    busy = false;
  });
  return sh;
}

/* ===================== Selettore alimenti ===================== */
function openPicker(mealId) {
  const P = { meal: mealId, tab: 'alimenti', cat: 'Tutti', venue: null, dcat: 'Tutti', q: '', dq: '', added: 0, off: { q: '', res: null, busy: false, err: '' } };
  const sh = openSheet('Aggiungi alimenti', { onClose: () => { if (P.added) { V.openMeals[P.meal] = true; V.lastMeal = P.meal; renderView(); } } });
  sh.body.innerHTML = '<div class="max"><div class="chips scroll p-target" style="margin-bottom:8px"></div><div class="seg p-tabs"></div><div class="p-ctl" style="margin-top:12px"></div><div class="p-list"></div></div>';
  const T = $('.p-target', sh.body), TB = $('.p-tabs', sh.body), CT = $('.p-ctl', sh.body), LS = $('.p-list', sh.body);
  const TABS = [['alimenti', 'Alimenti'], ['piatti', 'Piatti'], ['salvati', 'Salvati'], ['online', 'Online'], ['extra', 'Extra']];
  const catList = ['Recenti', 'Tutti', ...D.CATS.filter(c => c !== 'Fuori casa'), 'Miei', 'Fuori casa'];
  const dcats = ['Tutti', ...new Set(D.DISHES.map(x => x.cat))];
  const venues = [...new Set(D.VENUE_FOODS.map(x => x.venue))];
  const mealNm = () => mealName(P.meal);
  const label = (it) => { const m = itemMacro(it); return `${qtyText(it)} · ${f0(m.kcal)} kcal · P ${f1(m.p)}`; };

  function foot() { sh.foot.innerHTML = `<button class="btn primary" data-sa="done">Fatto${P.added ? ' · ' + P.added + (P.added === 1 ? ' aggiunto' : ' aggiunti') : ''}</button>`; }
  function drawTarget() {
    const d = cur();
    T.innerHTML = '<span class="muted" style="flex:none;align-self:center;font-size:14px">Aggiungi a</span>' + d.meals.map(m => `<button class="chip ${m.id === P.meal ? 'on' : ''}" data-sa="tgt" data-id="${m.id}">${esc(m.name)}</button>`).join('') + '<button class="chip" data-sa="newm">+ Nuovo pasto</button>';
    const on = $('.chip.on', T); if (on && on.scrollIntoView) { try { T.scrollLeft = Math.max(0, on.offsetLeft - 90); } catch (e) { } }
  }
  function drawTabs() { TB.innerHTML = TABS.map(([k, l]) => `<button class="${P.tab === k ? 'on' : ''}" data-sa="tab" data-t="${k}">${l}</button>`).join(''); }
  function drawCtl() {
    if (P.tab === 'alimenti') {
      CT.innerHTML = `<input class="search p-q" type="search" placeholder="Cerca un alimento…" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" value="${esc(P.q)}">
        <div class="chips scroll" style="margin-top:10px">${catList.map(c => `<button class="chip ${P.cat === c ? 'on' : ''}" data-sa="cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        ${P.cat === 'Fuori casa' && !P.q ? `<div class="chips scroll" style="margin-top:4px"><button class="chip ${!P.venue ? 'on' : ''}" data-sa="venue" data-v="">Tutti i locali</button>${venues.map(v => `<button class="chip ${P.venue === v ? 'on' : ''}" data-sa="venue" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}`;
      $('.p-q', CT).addEventListener('input', e => { P.q = e.target.value; drawList(); });
    } else if (P.tab === 'piatti') {
      CT.innerHTML = `<input class="search p-q" type="search" placeholder="Cerca un piatto…" enterkeyhint="search" autocomplete="off" autocorrect="off" value="${esc(P.dq)}">
        <div class="chips scroll" style="margin-top:10px">${dcats.map(c => `<button class="chip ${P.dcat === c ? 'on' : ''}" data-sa="dcat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
      $('.p-q', CT).addEventListener('input', e => { P.dq = e.target.value; drawList(); });
    } else if (P.tab === 'online') {
      CT.innerHTML = `<div style="display:grid;grid-template-columns:1fr auto;gap:8px"><input class="search p-q" type="search" placeholder="Nome del prodotto o codice a barre" enterkeyhint="search" autocomplete="off" autocorrect="off" value="${esc(P.off.q)}"><button class="btn primary" style="width:auto;min-height:52px" data-sa="osearch">Cerca</button></div>
        <button class="btn" style="margin-top:8px" data-sa="scan"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;margin-right:8px;vertical-align:-5px"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M12 9v6M16 9v6"/></svg>Scansiona il codice a barre</button>`;
      const inp = $('.p-q', CT);
      inp.addEventListener('input', e => { P.off.q = e.target.value; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); doOnline(); } });
    } else CT.innerHTML = '';
  }
  function foodsFor() {
    const q = norm(P.q.trim());
    if (q) {
      const toks = q.split(/\s+/);
      return allFoods().filter(f => { const hay = norm(f.name + ' ' + (f.venue || '') + ' ' + (f.group || '') + ' ' + f.cat); return toks.every(t => hay.includes(t)); }).slice(0, 120);
    }
    let list;
    if (P.cat === 'Recenti') list = Object.entries(S.recents).sort((a, b) => b[1].ts - a[1].ts).map(([id]) => foodById(id)).filter(Boolean).slice(0, 30);
    else if (P.cat === 'Miei') list = S.custom.slice();
    else if (P.cat === 'Fuori casa') list = D.VENUE_FOODS.filter(f => !P.venue || f.venue === P.venue);
    else if (P.cat === 'Tutti') list = [...D.FOODS, ...S.custom].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    else list = D.FOODS.filter(f => f.cat === P.cat).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    return list;
  }
  function foodRow(f, extraSub) {
    f = foodById(f.id) || f;
    const q = lastQty(f), tmp = mkItem(f, q);
    return `<div class="frow"><button class="main" data-sa="food" data-id="${esc(f.id)}"><b>${esc(f.name)}</b><span>${esc(label(tmp))}${f.src === 'stima' ? ' · stima' + (f.mg ? ' +' + f.mg + '%' : '') : ''}${extraSub || ''}</span></button><button class="quick" data-sa="quick" data-id="${esc(f.id)}" aria-label="Aggiungi ${esc(f.name)}">+</button></div>`;
  }
  function dishRow(x, sub) {
    const t = dishTotals(x), est = x.items.some(c => { const f = foodById(c.f); return f && f.src === 'stima'; });
    return `<div class="frow"><button class="main" data-sa="dish" data-id="${x.id}"><b>${esc(x.name)}</b><span>${esc(sub || x.cat)} · ${f0(t.kcal)} kcal · P ${f0(t.p)} · C ${f0(t.c)} · G ${f0(t.f)}${est ? ' · stima' : ''}</span></button><button class="quick" data-sa="dquick" data-id="${x.id}" aria-label="Aggiungi ${esc(x.name)}">+</button></div>`;
  }
  const venueDishes = (v, toks) => D.DISHES.filter(x => x.venue === v && (!toks || toks.every(t => norm(x.name + ' ' + x.venue).includes(t))));
  function drawList() {
    if (P.tab === 'alimenti') {
      const list = foodsFor();
      const toks = P.q.trim() ? norm(P.q.trim()).split(/\s+/) : null;
      const showDishes = !!toks || P.cat === 'Fuori casa';
      if (!list.length && !(showDishes && D.DISHES.some(x => x.venue && (!toks || toks.every(t => norm(x.name + ' ' + x.venue).includes(t)))))) { LS.innerHTML = `<p class="muted" style="padding:18px 2px">${P.cat === 'Miei' ? 'Non hai ancora alimenti tuoi. Creali dalla scheda Extra o cerca online.' : P.cat === 'Recenti' ? 'Qui compariranno gli alimenti che aggiungi.' : 'Nessun risultato. Prova la scheda Online o Extra.'}</p>`; return; }
      let html = '', lastG = null, lastV = null;
      if (toks) {
        const ds = D.DISHES.filter(x => x.venue && toks.every(t => norm(x.name + ' ' + x.venue).includes(t)));
        if (ds.length) html += ds.map(x => dishRow(x, 'Piatto pronto')).join('');
        list.forEach(f => { html += foodRow(f, f.venue ? ' · ' + f.venue : ''); });
      } else {
        list.forEach(f => {
          if (P.cat === 'Fuori casa') {
            if (f.venue !== lastV) {
              lastV = f.venue;
              const ds = venueDishes(f.venue);
              if (ds.length) { html += `<div class="group-title">${esc((P.venue ? '' : f.venue + ' · ') + 'Piatti pronti')}</div>` + ds.map(x => dishRow(x, 'Piatto pronto')).join(''); lastG = null; }
            }
            const g = (P.venue ? '' : f.venue + ' · ') + (f.group || ''); if (g !== lastG) { html += `<div class="group-title">${esc(g)}</div>`; lastG = g; }
          }
          html += foodRow(f);
        });
      }
      LS.innerHTML = `<div class="list">${html}</div>`;
    } else if (P.tab === 'piatti') {
      const q = norm(P.dq.trim());
      const list = D.DISHES.filter(x => (P.dcat === 'Tutti' || x.cat === P.dcat) && (!q || q.split(/\s+/).every(t => norm(x.name + ' ' + x.items.map(c => foodById(c.f).name).join(' ')).includes(t))));
      LS.innerHTML = list.length ? `<div class="list">${list.map(x => dishRow(x)).join('')}</div>` : '<p class="muted" style="padding:18px 2px">Nessun piatto trovato.</p>';
    } else if (P.tab === 'salvati') {
      LS.innerHTML = S.saved.length ? `<div class="list">${S.saved.map(s => { const t = sumItems(s.items); return `<div class="frow"><button class="main" data-sa="saved" data-id="${s.id}"><b>${esc(s.name)}</b><span>${s.items.length} alimenti · ${f0(t.kcal)} kcal · P ${f0(t.p)}</span></button><button class="quick" data-sa="saved" data-id="${s.id}" aria-label="Aggiungi ${esc(s.name)}">+</button></div>`; }).join('')}</div>` : '<p class="muted" style="padding:18px 2px">Nessun pasto salvato. Aprendo un pasto dalla schermata Oggi puoi usare «Salva come pasto riutilizzabile».</p>';
    } else if (P.tab === 'online') {
      const o = P.off;
      if (o.busy) LS.innerHTML = '<p class="muted" style="padding:18px 2px">Cerco su Open Food Facts…</p>';
      else if (o.err) LS.innerHTML = `<p class="muted" style="padding:18px 2px">${esc(o.err)}</p>`;
      else if (o.res == null) LS.innerHTML = '<p class="muted" style="padding:18px 2px">Cerca un prodotto confezionato per nome, oppure scansiona o scrivi il codice a barre. Servono connessione e un po\' di pazienza: i dati sono inseriti dagli utenti, controlla sempre l\'etichetta.</p>';
      else if (!o.res.length) LS.innerHTML = '<p class="muted" style="padding:18px 2px">Nessun prodotto con valori completi. Prova un altro nome oppure crea l\'alimento a mano dalla scheda Extra.</p>';
      else LS.innerHTML = `<div class="list">${o.res.map((f, i) => `<div class="frow"><button class="main" data-sa="ofood" data-i="${i}"><b>${esc(f.name)}</b><span>Per 100 g: ${f0(f.per.kcal)} kcal · P ${f1(f.per.p)} · C ${f1(f.per.c)} · G ${f1(f.per.f)}</span></button><button class="quick" data-sa="ofood" data-i="${i}" aria-label="Scegli">›</button></div>`).join('')}</div><p class="hint">Fonte: Open Food Facts (dati inseriti dagli utenti, possono contenere errori).</p>`;
    } else {
      LS.innerHTML = `<div class="stack" style="margin-top:6px"><button class="btn primary" data-sa="custom">+ Alimento extra o aggiunta rapida</button>
        <p class="hint" style="margin:0">Inserisci a mano i valori di un prodotto o di un piatto che non c'è. Puoi salvarlo nei tuoi alimenti per riutilizzarlo.</p>
        ${S.custom.length ? `<div class="group-title" style="margin-top:6px">I miei alimenti</div><div class="list">${S.custom.map(f => foodRow(f)).join('')}</div>` : ''}</div>`;
    }
  }
  async function doOnline(fromScan) {
    const q = P.off.q.trim(); if (q.length < 2) return;
    P.off.busy = true; P.off.err = ''; drawList();
    try {
      P.off.res = await offSearch(q);
      if (/^\d{8,14}$/.test(q) && !P.off.res.length) P.off.err = 'Codice ' + q + ': prodotto non trovato su Open Food Facts, oppure senza valori nutrizionali completi. Puoi inserire i valori dall\'etichetta dalla scheda Extra.';
      else if (fromScan && P.off.res.length === 1) { P.off.busy = false; drawList(); openFood(P.off.res[0]); return; }
    }
    catch (e) { P.off.res = null; P.off.err = (e && e.name === 'AbortError') ? 'La ricerca ha impiegato troppo tempo. Riprova tra poco.' : 'Non riesco a collegarmi a Open Food Facts. Controlla la connessione e riprova.'; }
    P.off.busy = false; drawList();
  }
  const openFood = f => openQty({ cfg: f, qty: lastQty(f), title: 'Aggiungi', confirmLabel: 'Aggiungi a ' + mealNm(),
    onConfirm: q => { if (f.src === 'off' && !S.custom.some(x => x.id === f.id)) { S.custom.push(f); invalidateFoods(); } addFoodTo(P.meal, f, q); P.added++; foot(); toast('Aggiunto: ' + f.name); } });
  sh.on({
    done: () => sh.close(),
    tgt: el => { P.meal = el.dataset.id; drawTarget(); },
    newm: () => openNewMeal(id => { P.meal = id; drawTarget(); }),
    tab: el => { P.tab = el.dataset.t; drawTabs(); drawCtl(); drawList(); },
    cat: el => { P.cat = el.dataset.c; P.q = ''; drawCtl(); drawList(); },
    venue: el => { P.venue = el.dataset.v || null; drawCtl(); drawList(); },
    dcat: el => { P.dcat = el.dataset.c; drawCtl(); drawList(); },
    food: el => { const f = foodById(el.dataset.id); if (f) openFood(f); },
    quick: el => { const f = foodById(el.dataset.id); if (!f) return; const q = lastQty(f); addFoodTo(P.meal, f, q); P.added++; foot(); toast('Aggiunto: ' + f.name + ' · ' + qtyText(mkItem(f, q))); },
    dish: el => openDish({ mode: 'add', dish: dishById(el.dataset.id), getMeal: () => P.meal, onAdded: () => { P.added++; foot(); } }),
    dquick: el => { const x = dishById(el.dataset.id); addItemsTo(P.meal, expandDish(x)); P.added++; foot(); toast('Aggiunto: ' + x.name); },
    saved: el => { const s = S.saved.find(x => x.id === el.dataset.id); if (!s) return; addItemsTo(P.meal, cloneItems(s.items)); P.added++; foot(); toast('Aggiunto: ' + s.name); },
    osearch: () => { $('.p-q', CT).blur(); doOnline(); },
    scan: () => openScanner(code => { P.off.q = code; drawCtl(); doOnline(true); }),
    ofood: el => { const f = P.off.res[+el.dataset.i]; if (f) openFood(f); },
    custom: () => openCustomForm({ add: P.meal, after: () => { drawList(); } }),
  });
  drawTarget(); drawTabs(); drawCtl(); drawList(); foot();
  return sh;
}

/* ===================== Backup, CSV, importazione ===================== */
async function shareOrDownload(name, mime, text) {
  try {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e && e.name === 'AbortError') return false; }
    }
  } catch (e) { }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
const backupText = () => JSON.stringify({ app: 'piano-alimentare', version: APP_VERSION, exportedAt: new Date().toISOString(), data: S });
async function exportBackup() {
  const ok = await shareOrDownload('piano-alimentare-backup-' + todayKey() + '.json', 'application/json', backupText());
  if (ok) { S.settings.lastBackup = Date.now(); save(); render(); toast('Backup pronto: salvalo in File o iCloud'); }
}
async function exportCsv() {
  const rows = [['Data', 'Tipo giorno', 'Pasto', 'Alimento', 'Quantità', 'Unità', 'Kcal', 'Proteine', 'Carboidrati', 'Grassi']];
  const cell = v => { const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const n1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
  Object.keys(S.days).sort().forEach(k => {
    const d = S.days[k];
    d.meals.forEach(m => m.items.forEach(it => { const mc = itemMacro(it); rows.push([k, d.type === 'training' ? 'Allenamento' : 'Riposo', m.name, it.name, n1(it.qty), it.kind === 'g' ? 'g' : unitStr(it, it.qty), Math.round(mc.kcal), n1(mc.p), n1(mc.c), n1(mc.f)]); }));
  });
  if (rows.length < 2) return toast('Non ci sono ancora dati da esportare');
  await shareOrDownload('piano-alimentare-' + todayKey() + '.csv', 'text/csv', '﻿' + rows.map(r => r.map(cell).join(';')).join('\n'));
}
async function doImport(text, sh) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return toast('Il file non è un backup valido'); }
  const data = o && o.data ? o.data : o;
  if (!data || typeof data !== 'object' || !data.days || !data.settings) return toast('Non sembra un backup di questa app');
  const nd = Object.values(data.days).filter(dayHasData).length;
  const r = await choice('Ripristinare il backup?', `Contiene ${nd} giorni registrati. I dati attuali verranno sostituiti (ne tengo una copia di sicurezza nel telefono).`, [{ label: 'Ripristina', value: true, cls: 'primary' }, { label: 'Annulla', value: null }]);
  if (!r) return;
  try { localStorage.setItem(KEY + '-prev', JSON.stringify(S)); } catch (e) { }
  S = normalize(data); invalidateFoods(); persist();
  if (sh) sh.close();
  V.date = todayKey(); V.open = {}; render(); toast('Backup ripristinato');
}
function openImport() {
  const sh = openSheet('Ripristina da un backup');
  sh.body.innerHTML = `<div class="max"><p class="hint" style="margin:0 0 12px">Scegli il file .json salvato con «Salva un backup», oppure incolla qui il testo del backup.</p>
    <input type="file" class="i-file hidden" accept="application/json,.json,text/plain"><div class="stack"><button class="btn primary" data-sa="pick">Scegli il file…</button></div>
    <label class="fld" style="margin-top:16px"><span>Oppure incolla il testo</span><textarea class="inp i-txt" placeholder="{ ... }" spellcheck="false"></textarea></label></div>`;
  sh.foot.innerHTML = '<button class="btn" data-sa="paste">Ripristina dal testo incollato</button>';
  const fi = $('.i-file', sh.body);
  fi.addEventListener('change', async () => { const f = fi.files[0]; if (f) doImport(await f.text(), sh); fi.value = ''; });
  sh.on({ pick: () => fi.click(), paste: () => { const t = $('.i-txt', sh.body).value.trim(); if (t) doImport(t, sh); else toast('Incolla prima il testo del backup'); } });
}
async function updateApp() {
  try {
    if (navigator.serviceWorker) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
    if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); }
  } catch (e) { }
  location.reload();
}

/* ===================== Azioni (tocchi nella pagina) ===================== */
function setPath(path, v) { const parts = path.split('.'); let o = S.settings; while (parts.length > 1) o = o[parts.shift()]; o[parts[0]] = v; }
/* ---- Animazioni: solo transform/opacity (GPU). Niente layout né ridisegno a ogni fotogramma, così restano fluide anche a 120 Hz. ---- */
const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const EASE_OUT = 'cubic-bezier(.22,.8,.24,1)';
/* Cambia lo stato (layout istantaneo) e fa scivolare gli elementi sottostanti dalla vecchia alla nuova posizione.
   Una "tenda" del colore dello sfondo scorre insieme alle card e copre i vuoti tra l'una e l'altra: il contenuto
   del pasto si scopre (apertura) o si ricopre (chiusura, con una copia ferma del corpo) soltanto man mano,
   senza lasciare scie. Tutto con transform: nessun ridisegno a ogni fotogramma. */
function flipFollowers(sec, mutate, closing) {
  const fol = []; for (let e = sec.nextElementSibling; e; e = e.nextElementSibling) if (!e.classList.contains('fx')) fol.push(e);
  const animate = !!sec.animate && !reduceMotion() && fol.length > 0;
  let ghost = null, gTop = 0;
  if (animate && closing) { /* copia del solo corpo, ferma al suo posto finché le card non la ricoprono */
    const bd = $('.meal-body', sec);
    gTop = bd.getBoundingClientRect().top + window.scrollY - 12;
    ghost = document.createElement('div'); ghost.className = 'meal open ghost fx'; ghost.appendChild(bd.cloneNode(true));
  }
  const y0 = animate ? fol[0].getBoundingClientRect().top : 0;
  mutate();
  if (!animate) { updateFab(); return; }
  const f0r = fol[0].getBoundingClientRect(), delta = f0r.top - y0;
  updateFab(); /* legge le posizioni finali: va fatto prima di avviare le animazioni */
  if (Math.abs(delta) < 2) return;
  const vh = window.innerHeight, ad = Math.abs(delta);
  const kf = [{ transform: `translate3d(0,${-delta}px,0)` }, { transform: 'translate3d(0,0,0)' }];
  const opt = { duration: 280, easing: EASE_OUT };
  const sr = sec.getBoundingClientRect(), gap = parseFloat(getComputedStyle(sec).marginBottom) || 0;
  const fx = []; /* elementi temporanei */
  let anchor = sec;
  if (ghost) {
    Object.assign(ghost.style, { position: 'absolute', left: sr.left + 'px', top: gTop + 'px', width: sr.width + 'px', pointerEvents: 'none' });
    ghost.setAttribute('aria-hidden', 'true'); anchor.insertAdjacentElement('afterend', ghost); anchor = ghost; fx.push(ghost);
  }
  const curtain = document.createElement('div'); curtain.className = 'fx'; curtain.setAttribute('aria-hidden', 'true');
  Object.assign(curtain.style, { position: 'absolute', left: sr.left + 'px', width: sr.width + 'px', top: (f0r.top + window.scrollY - gap) + 'px', height: (ad + gap) + 'px', background: 'var(--bg)', pointerEvents: 'none' });
  anchor.insertAdjacentElement('afterend', curtain); fx.push(curtain);
  const cleanup = () => fx.forEach(n => n.remove());
  const c = curtain.animate(kf, opt); c.onfinish = c.oncancel = cleanup;
  setTimeout(cleanup, 700); /* rete di sicurezza */
  fol.forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.top > vh + ad || r.bottom < -ad) return; /* fuori schermo: inutile animarlo */
    e.animate(kf, opt);
  });
}
const FXSEL = '#view > .fx';
let dayPhase = null, dayAnim = null, dayDirty = false, dayTimer = 0;
function showDay() { dayDirty = false; V.open = {}; render(); window.scrollTo(0, 0); updateFab(); }
function endDayAnim() {
  clearTimeout(dayTimer); dayPhase = null; dayAnim = null; dayDirty = false;
  document.body.classList.remove('busy'); const v = $('#view'); v.style.willChange = ''; v.style.transform = ''; v.style.opacity = '';
  $$(FXSEL).forEach(n => n.remove());
}
/* Se l'app è stata in background (o un'animazione non è terminata) riporto tutto in uno stato pulito. */
function resetMotion() {
  if (document.getAnimations) document.getAnimations().forEach(a => { a.onfinish = a.oncancel = null; try { a.cancel(); } catch (e) { } });
  const dirty = dayDirty; endDayAnim();
  if (dirty) showDay();
}
/* dx0 = spostamento attuale della vista (se arrivo da un trascinamento) */
function changeDay(dir, dx0) {
  V.date = addDays(V.date, dir); dayDirty = true;
  const v = $('#view');
  if (!v.animate || reduceMotion()) { v.style.willChange = ''; showDay(); return; }
  if (dayPhase === 'out') return; /* la data è già aggiornata: la vista nuova viene disegnata a fine uscita */
  if (dayAnim) { dayAnim.onfinish = dayAnim.oncancel = null; dayAnim.cancel(); dayAnim = null; }
  v.style.transform = ''; v.style.opacity = '';
  dayPhase = 'out'; document.body.classList.add('busy'); v.style.willChange = 'transform, opacity';
  const W = Math.min(window.innerWidth, 640) * 0.3;
  const out = v.animate([{ transform: `translate3d(${dx0 || 0}px,0,0)`, opacity: 1 }, { transform: `translate3d(${-dir * W}px,0,0)`, opacity: 0 }],
    { duration: 110, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  let handled = false;
  const afterOut = () => {
    if (handled || dayPhase !== 'out') return; handled = true;
    showDay(); /* il contenuto è invisibile: il lavoro di disegno non si nota */
    out.onfinish = null; out.cancel();
    dayPhase = 'in';
    dayAnim = v.animate([{ transform: `translate3d(${dir * W}px,0,0)`, opacity: 0 }, { transform: 'translate3d(0,0,0)', opacity: 1 }], { duration: 240, easing: EASE_OUT });
    dayAnim.onfinish = dayAnim.oncancel = endDayAnim;
    clearTimeout(dayTimer); dayTimer = setTimeout(endDayAnim, 700); /* rete di sicurezza */
  };
  out.onfinish = afterOut;
  clearTimeout(dayTimer); dayTimer = setTimeout(afterOut, 400);
}
function fabAdd() {
  const d = cur();
  if (!d.meals.length) return openNewMeal();
  const firstEmpty = d.meals.find(m => !m.items.length);
  const id = V.lastMeal && findMeal(d, V.lastMeal) ? V.lastMeal : (firstEmpty || d.meals[d.meals.length - 1]).id;
  openPicker(id);
}
function initSwipe() {
  const view = $('#view');
  let sw = null, raf = 0;
  const blocked = e => V.tab !== 'oggi' || SHEETS.length > 0 || dayPhase || document.querySelector('.dlg-back') || e.touches.length !== 1;
  const offset = dx => dx * 0.55;
  const paint = () => { raf = 0; if (sw && sw.active) view.style.transform = `translate3d(${offset(sw.dx)}px,0,0)`; };
  document.addEventListener('touchstart', e => {
    if (blocked(e)) { sw = null; return; }
    const t = e.touches[0];
    if (t.clientX < 24 || t.clientX > window.innerWidth - 24) { sw = null; return; }
    if (e.target.closest('input, textarea, select, #tabbar, #fab, .chips.scroll')) { sw = null; return; }
    sw = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, active: false, dead: false };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sw || sw.dead) return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw.dead = true; return; }
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) { sw.active = true; view.style.willChange = 'transform'; } else return;
    }
    sw.dx = dx;
    if (!raf) raf = requestAnimationFrame(paint); /* un solo aggiornamento per fotogramma */
  }, { passive: true });
  const end = (cancel) => {
    if (!sw || !sw.active) { sw = null; return; }
    const dx = sw.dx, dt = Date.now() - sw.t; sw = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const go = !cancel && (Math.abs(dx) > 70 || (Math.abs(dx) > 40 && dt < 260));
    const cur0 = offset(dx);
    view.style.transform = '';
    if (go) { changeDay(dx < 0 ? 1 : -1, cur0); return; }
    if (view.animate) {
      const a = view.animate([{ transform: `translate3d(${cur0}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 220, easing: EASE_OUT });
      a.onfinish = a.oncancel = () => { view.style.willChange = ''; };
    } else view.style.willChange = '';
  };
  document.addEventListener('touchend', () => end(false), { passive: true });
  document.addEventListener('touchcancel', () => end(true), { passive: true });
}
const A = {
  prevDay() { changeDay(-1); },
  nextDay() { changeDay(1); },
  toggleMeal(el) {
    const id = el.dataset.id, m = findMeal(cur(), id); if (!m) return;
    const open = !V.openMeals[id]; V.openMeals[id] = open; if (open) V.lastMeal = id;
    const sec = el.closest('.meal');
    flipFollowers(sec, () => {
      sec.classList.toggle('open', open); el.setAttribute('aria-expanded', open);
      $('.meal-time', sec).textContent = mealSub(m, open);
      const all = $('[data-act="toggleAll"]'); if (all) all.textContent = cur().meals.every(x => V.openMeals[x.id]) ? 'Chiudi tutti' : 'Apri tutti';
    }, !open);
  },
  toggleAll() { const d = cur(), open = !d.meals.every(m => V.openMeals[m.id]); d.meals.forEach(m => { V.openMeals[m.id] = open; }); renderView(); },
  fab() { fabAdd(); },
  toggleType() { mut(d => { d.type = d.type === 'training' ? 'rest' : 'training'; }); toast(cur().type === 'training' ? 'Giorno di allenamento' : 'Giorno di riposo'); },
  newMeal() { openNewMeal(); },
  addTo(el) { openPicker(el.dataset.meal); },
  editMeal(el) { openMealSheet(el.dataset.id); },
  editItem(el) {
    const mealId = el.dataset.meal, id = el.dataset.id, it = findItem(cur(), mealId, id); if (!it) return;
    openQty({ cfg: cfgOf(it), qty: it.qty, title: 'Modifica', confirmLabel: 'Salva', base: itemMacro(it),
      onConfirm: q => mut(d => { const x = findItem(d, mealId, id); if (x) x.qty = q; }),
      onDelete: () => mut(d => { const m = findMeal(d, mealId); if (m) m.items = m.items.filter(i => i.id !== id); }),
      onMove: sh => openMove('Sposta in…', mealId, to => { sh.close(); moveItems(mealId, [id], to, true); }) });
  },
  editDish(el) { openDish({ mode: 'edit', mealId: el.dataset.meal, key: el.dataset.key }); },
  templates() { openTemplates(); },
  copyDay() { openCopyDay(); },
  supp(el) { mut(d => { d.supp[el.dataset.k] = !d.supp[el.dataset.k]; }); },
  addActivity() { openActivity(); },
  delActivity(el) { mut(d => { d.activities = d.activities.filter(a => a.id !== el.dataset.id); }); },
  editTarget() { openTarget(); },
  weekPrev() { V.weekTouched = true; V.weekOff--; renderView(); },
  weekNext() { V.weekTouched = true; if (V.weekOff < 0) V.weekOff++; renderView(); },
  toggleDay(el) { const k = el.dataset.date; V.open[k] = !V.open[k]; const y = window.scrollY; renderView(); window.scrollTo(0, y); },
  openDay(el) { V.date = el.dataset.date; V.tab = 'oggi'; render(); window.scrollTo(0, 0); },
  async copyFromDay(el) {
    const src = S.days[el.dataset.date], dest = todayKey();
    const ok = await applyMealsTo(dest, cloneMeals(src.meals.filter(m => m.items.length)), 'Copia su oggi');
    if (ok) { V.date = dest; V.tab = 'oggi'; render(); window.scrollTo(0, 0); toast('Pasti copiati su oggi'); }
  },
  exportCsv() { exportCsv(); },
  exportBackup() { exportBackup(); },
  importBackup() { openImport(); },
  wStep(el) {
    const inp = $('#wInput'); V.weightVal = Math.round((num(inp.value, S.settings.startWeight) + num(el.dataset.d)) * 10) / 10;
    inp.value = String(V.weightVal).replace('.', ',');
  },
  saveWeight() {
    const kg = num($('#wInput').value), date = $('#wDate').value || todayKey();
    if (!(kg > 25 && kg < 300)) return toast('Controlla il peso inserito');
    S.weights = S.weights.filter(w => w.date !== date); S.weights.push({ date, kg: Math.round(kg * 10) / 10 });
    V.weightVal = null; V.weightDate = null; save(); render(); toast('Peso salvato');
  },
  async delWeight(el) {
    const r = await choice('Eliminare la pesata?', dateLong(el.dataset.date), [{ label: 'Elimina', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]);
    if (r) { S.weights = S.weights.filter(w => w.date !== el.dataset.date); save(); renderView(); }
  },
  preset(el) { const p = D.PRESETS[el.dataset.k]; S.settings.targets = { kcal: p.kcal, p: p.p, c: p.c, f: p.f }; S.settings.phase = el.dataset.k; save(); render(); toast('Obiettivi ' + p.label); },
  closeMacros() { openClose(); },
  margin(el) { S.settings.estMargin = +el.dataset.v || 0; invalidateFoods(); save(); render(); toast(S.settings.estMargin ? 'Margine sulle stime: +' + S.settings.estMargin + '%' : 'Nessun margine sulle stime'); },
  weekday(el) { const i = +el.dataset.i; S.settings.weekly[i] = S.settings.weekly[i] ? 0 : 1; draftDay = null; save(); render(); },
  newCustom() { openCustomForm({}); },
  editCustom(el) { const f = S.custom.find(x => x.id === el.dataset.id); if (f) openCustomForm({ food: f }); },
  async delCustom(el) {
    const f = S.custom.find(x => x.id === el.dataset.id); if (!f) return;
    const r = await choice('Eliminare l\'alimento?', f.name + '. I giorni già registrati non cambiano.', [{ label: 'Elimina', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]);
    if (r) { S.custom = S.custom.filter(x => x.id !== f.id); invalidateFoods(); save(); renderView(); }
  },
  async delSaved(el) {
    const s = S.saved.find(x => x.id === el.dataset.id); if (!s) return;
    const r = await choice('Eliminare il pasto salvato?', s.name, [{ label: 'Elimina', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]);
    if (r) { S.saved = S.saved.filter(x => x.id !== s.id); save(); renderView(); }
  },
  updateApp() { updateApp(); },
  async resetAll() {
    const r = await choice('Cancellare tutti i dati?', 'Pasti, pesi, alimenti e impostazioni verranno eliminati da questo telefono. Se non hai un backup non si può tornare indietro.', [{ label: 'Cancella tutto', value: true, cls: 'danger' }, { label: 'Annulla', value: null }]);
    if (!r) return;
    noPersist = true; clearTimeout(saveTimer);
    try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-prev'); } catch (e) { }
    location.reload();
  },
};
const AC = {
  pickDate(el) { if (el.value) { V.date = el.value; V.open = {}; render(); window.scrollTo(0, 0); } },
};

/* ===================== Avvio ===================== */
function init() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t || t.closest('.sheet') || t.closest('.dlg-back')) return;
    const fn = A[t.dataset.act]; if (fn) fn(t, e);
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.actChange && AC[t.dataset.actChange]) return AC[t.dataset.actChange](t);
    if (t.dataset && t.dataset.set) {
      const v = num(t.value, NaN);
      if (isFinite(v) && v > 0) { setPath(t.dataset.set, v); if (t.dataset.set.startsWith('targets.')) S.settings.phase = 'custom'; save(); render(); }
      else renderView();
    }
    if (t.id === 'wDate') V.weightDate = t.value;
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset && t.dataset.setRange) { S.settings[t.dataset.setRange] = +t.value; const l = $('#actPctVal'); if (l) l.textContent = t.value + '%'; save(); renderRecap(); }
    if (t.id === 'wInput') V.weightVal = num(t.value);
  });
  $('#fab').addEventListener('click', fabAdd);
  initSwipe();
  $('#tabbar').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  let tick = false;
  window.addEventListener('scroll', () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false; setCompact(); }); }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => measureRecap()).observe($('#recap'));
  /* Alla ripresa dall'app in background: stato animazioni pulito e misure del riepilogo rifatte (anche ritardate). */
  const resumed = () => { resetMotion(); measureRecap(true); setCompact(); setTimeout(() => { measureRecap(true); updateFab(); }, 350); };
  window.addEventListener('pageshow', resumed);
  window.addEventListener('orientationchange', () => setTimeout(resumed, 250));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => measureRecap(true));
  V.lastToday = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
    else { const t = todayKey(); if (t !== V.lastToday) { if (V.date === V.lastToday) V.date = t; V.lastToday = t; render(); } resumed(); }
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('resize', () => { measureRecap(true); updateFab(); });
  render(); measureRecap(true);
  try { if (!localStorage.getItem(KEY)) persist(); } catch (e) { }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }
  try { if (!localStorage.getItem('piano-hint-swipe')) { localStorage.setItem('piano-hint-swipe', '1'); setTimeout(() => toast('Scorri a destra o a sinistra per cambiare giorno'), 1400); } } catch (e) { }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
  if (/[?&]debug\b/.test(location.search)) window.__app = { get S() { return S; }, V, A, SHEETS };
}
init();
})();
