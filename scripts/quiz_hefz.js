// ---------- memorization quiz «آزمون حفظ»: hidden words, complete the verse, which verse comes next ----------
// Kept in its own file and inlined by scripts/build_web.py at the /*HEFZQUIZ*/ placeholder (after ACT is defined).
// Uses the page's helpers: S, st, cfg, siyaqs, quizPool, surahOpen, vplain, loadText, QTEXT, nextV, key, range,
// FA, esc, toast, sheet, play, addErr, errOf, logInc, markActive, save, saveCfg, today, arNorm, ACT, lastDraw.
// Results are kept in st.hq (synced and backed up with the rest of the progress).
const HQ_N = 10;
const HQ_MODES = {
  hide: {l: "کلمه‌های پنهان", d: "چند کلمه از آیه پنهان می‌شود؛ از حفظ بگویید و بعد ببینید کدام را درست گفتید.", c: "var(--st-learn)"},
  complete: {l: "تکمیل آیه", d: "ابتدای آیه را می‌بینید؛ کلمه‌های بعدی را یکی‌یکی از میان گزینه‌ها انتخاب کنید.", c: "var(--gold)"},
  next: {l: "آیه بعد", d: "آیه را می‌بینید؛ از میان چهار گزینه، آیه بعد از آن را پیدا کنید.", c: "var(--st-solid)"}
};
const HQ_LEVELS = [[0.25, "آسان"], [0.45, "متوسط"], [0.7, "سخت"]];
let hq = null;
const hqCfg = () => Object.assign({mode: "hide", scope: "mem", lvl: 1}, cfg.hq || {});
const hqWords = (sn, ay) => String(vplain(sn, ay) || "").split(" ").filter(Boolean);
const hqPick = a => a[Math.floor(Math.random() * a.length)];
const hqShuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const hqPct = x => FA(Math.round(x)) + "٪";

(function hqStyle() {
  const css = `.hq-modes{display:grid;gap:8px}
.hq-modes button{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:start;padding:12px 14px;border-radius:14px}
.hq-modes button[aria-pressed="true"]{border-color:var(--lapis);background:var(--lapis-soft)}
.hq-modes .hq-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-inline-end:6px;vertical-align:middle}
.hq-ar{font-family:var(--f-q);font-size:22px;line-height:2.4;direction:rtl}
.hq-gap{display:inline-block;min-width:2.2em;border:0;border-bottom:2px dashed var(--muted);background:transparent;color:transparent;padding:0 2px;margin:0 2px;border-radius:0;font:inherit;cursor:pointer}
.hq-gap.shown{color:inherit;border-bottom-color:var(--st-solid);background:color-mix(in srgb,var(--st-solid) 14%,transparent);border-radius:6px}
.hq-gap.miss{border-bottom-color:var(--st-due);background:color-mix(in srgb,var(--st-due) 22%,transparent)}
.hq-rest{color:var(--muted)}
.hq-opts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.hq-opts.one{grid-template-columns:1fr}
.hq-opts button{font-family:var(--f-q);font-size:19px;line-height:2;padding:6px 10px}
.hq-opts button:disabled{opacity:1}
.hq-opts button.right{background:var(--st-solid);color:#fff;border-color:var(--st-solid)}
.hq-opts button.wrong{background:var(--st-due);color:#fff;border-color:var(--st-due)}
.hq-bar{height:8px;border-radius:99px;background:var(--line);overflow:hidden}
.hq-bar>i{display:block;height:100%;background:var(--lapis);border-radius:99px}
.hq-chart{width:100%;height:auto;display:block}
.hq-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
.hq-stats b{display:block;font-size:20px}`;
  const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el);
})();

// Verses to ask from: the memorized siyaqs (same pool as the other quizzes) or one whole surah
function hqPool(c) {
  if (c.scope !== "mem" && S[+c.scope] && surahOpen(+c.scope)) return range(1, S[+c.scope].total).map(a => [+c.scope, a]);
  return quizPool();
}
function openHq(mode) {
  if (mode && HQ_MODES[mode]) { cfg.hq = Object.assign(hqCfg(), {mode}); saveCfg(); }
  if (!QTEXT) { loadText().then(() => openHq()).catch(() => toast("متن قرآن باز نشد؛ دوباره امتحان کنید")); return; }
  hq = null; drawHqHome();
}
function drawHqHome() {
  const c = hqCfg(), surahs = DATA.surahs.filter(s => surahOpen(s.n));
  lastDraw = drawHqHome;
  const box = sheet(`<div class="sheet" role="dialog" aria-modal="true" aria-label="آزمون حفظ">
    <header><button class="icon-btn btn-ghost" data-close aria-label="بستن">✕</button><h2>آزمون حفظ</h2></header>
    <div class="body">
      <div class="hq-modes" role="group" aria-label="نوع آزمون">${Object.entries(HQ_MODES).map(([k, m]) => `<button data-hqmode="${k}" aria-pressed="${c.mode === k}"><b><span class="hq-dot" style="background:${m.c}"></span>${m.l}</b><span class="small muted">${m.d}</span></button>`).join("")}</div>
      <label class="small">از کجا بپرسد؟
        <select id="hq-scope"><option value="mem" ${c.scope === "mem" ? "selected" : ""}>سیاق‌هایی که حفظ کرده‌ام</option>${surahs.map(s => `<option value="${s.n}" ${String(c.scope) === String(s.n) ? "selected" : ""}>سوره ${s.name}</option>`).join("")}</select></label>
      ${c.mode === "hide" ? `<div><span class="small">سختی</span><div class="seg" role="group" aria-label="سختی">${HQ_LEVELS.map(([, l], i) => `<button data-hqlvl="${i}" aria-pressed="${c.lvl === i}">${l}</button>`).join("")}</div></div>` : ""}
      <button class="btn-main" id="hq-go">شروع آزمون ${FA(HQ_N)} سؤالی</button>
      ${hqProgressCard()}
    </div></div>`);
  box.querySelectorAll("[data-hqmode]").forEach(b => b.addEventListener("click", () => { cfg.hq = Object.assign(hqCfg(), {mode: b.dataset.hqmode}); saveCfg(); drawHqHome(); }));
  box.querySelectorAll("[data-hqlvl]").forEach(b => b.addEventListener("click", () => { cfg.hq = Object.assign(hqCfg(), {lvl: +b.dataset.hqlvl}); saveCfg(); drawHqHome(); }));
  box.querySelector("#hq-scope").addEventListener("change", e => { cfg.hq = Object.assign(hqCfg(), {scope: e.target.value}); saveCfg(); });
  box.querySelector("#hq-go").addEventListener("click", hqStart);
}

function hqStart() {
  const c = hqCfg(), pool = hqPool(c).filter(([sn, ay]) => hqWords(sn, ay).length >= (c.mode === "hide" ? 2 : c.mode === "complete" ? 3 : 1) && (c.mode !== "next" || nextV(sn, ay)));
  if (!pool.length) { toast(c.scope === "mem" ? "اول چند سیاق را حفظ کنید یا یک سوره را انتخاب کنید" : "آیه‌ای برای این آزمون نیست"); return; }
  hq = {mode: c.mode, lvl: c.lvl, scope: c.scope, pool, used: new Set(), n: 0, score: 0, run: 0, best: 0};
  hqNext();
}
function hqNext() {
  const z = hq; if (z.n >= HQ_N) return hqEnd();
  let v; for (let i = 0; i < 40; i++) { v = hqPick(z.pool); if (!z.used.has(key(...v))) break; }
  z.used.add(key(...v)); z.n++; z.cur = v; z.done = false; z.got = 0;
  const w = hqWords(...v);
  if (z.mode === "hide") hqMakeHide(z, v, w);
  else if (z.mode === "complete") hqMakeComplete(z, v, w);
  else hqMakeNext(z, v);
  drawHq();
}

// --- hidden words: verses' weak words (from the mistakes book) are hidden first ---
function hqMakeHide(z, [sn, ay], w) {
  const want = Math.max(1, Math.min(w.length - (w.length > 2 ? 1 : 0), Math.round(w.length * HQ_LEVELS[z.lvl][0])));
  const e = errOf(key(sn, ay)), weak = e ? w.map((_, i) => i).filter(i => (e.w[i + 1] || 0) > 0) : [];
  const rest = hqShuffle(w.map((_, i) => i).filter(i => !weak.includes(i)));
  z.hide = new Set(hqShuffle(weak).concat(rest).slice(0, want)); z.peek = new Set(); z.miss = new Set(); z.words = w;
}
// --- complete the verse: a short start, then up to six words chosen one by one ---
function hqMakeComplete(z, [sn, ay], w) {
  const pre = Math.min(4, Math.max(1, Math.floor(w.length / 3))), k = Math.min(6, w.length - pre);
  const near = range(Math.max(1, ay - 12), Math.min(S[sn].total, ay + 12)).flatMap(a => hqWords(sn, a));
  const src = near.length > 30 ? near : range(1, S[sn].total).flatMap(a => hqWords(sn, a));
  z.words = w; z.pre = pre; z.k = k; z.step = 0; z.hits = 0; z.pickW = null; z.src = src; hqOptsComplete(z);
}
function hqOptsComplete(z) {
  const right = z.words[z.pre + z.step], seen = new Set([arNorm(right)]), opts = [right];
  for (const x of hqShuffle(z.src)) { if (opts.length >= 4) break; const n = arNorm(x); if (!n || seen.has(n)) continue; seen.add(n); opts.push(x); }
  z.opts = hqShuffle(opts); z.pickW = null;
}
// --- which verse is next: three other verses of the same surah as decoys, cut where they start to differ ---
function hqMakeNext(z, [sn, ay]) {
  const nv = nextV(sn, ay), s2 = nv[0], tot = S[s2].total;
  const cand = hqShuffle(range(1, tot).filter(a => a !== nv[1] && !(s2 === sn && a === ay) && Math.abs(a - nv[1]) <= 15));
  const pool = cand.length >= 3 ? cand : hqShuffle(range(1, tot).filter(a => a !== nv[1] && !(s2 === sn && a === ay)));
  const opts = [nv[1]].concat(pool.slice(0, 3));
  while (opts.length < 4) { const r = hqPick(DATA.surahs); const a = 1 + Math.floor(Math.random() * r.total); if (r.n !== s2) opts.push([r.n, a]); }
  const vs = opts.map(o => Array.isArray(o) ? o : [s2, o]), ws = vs.map(v => hqWords(...v));
  let len = 6; while (len < 40 && new Set(ws.map(w => arNorm(w.slice(0, len).join(" ")))).size < ws.length) len++;
  z.right = key(...nv); z.opts = hqShuffle(vs.map((v, i) => ({vk: key(...v), t: ws[i].slice(0, len).join(" ") + (ws[i].length > len ? " …" : "")}))); z.pickV = null;
}

function drawHq() {
  const z = hq, [sn, ay] = z.cur, m = HQ_MODES[z.mode];
  lastDraw = drawHq;
  const head = `<div class="row between small"><span>${m.l} · سؤال ${FA(z.n)} از ${FA(HQ_N)}</span><span class="num">امتیاز ${FA(Math.round(z.score * 10))}${z.run >= 3 ? ` · ${FA(z.run)} پیاپی ✓` : ""}</span></div>
    <div class="hq-bar" aria-hidden="true"><i style="width:${(z.n - (z.done ? 0 : 1)) / HQ_N * 100}%"></i></div>`;
  const where = `<span class="small muted">سوره ${S[sn].name} · آیه ${FA(ay)}</span>`;
  let body = "", foot = "";
  if (z.mode === "hide") {
    const txt = z.words.map((w, i) => !z.hide.has(i) ? esc(w) : `<button class="hq-gap${z.done || z.peek.has(i) ? " shown" : ""}${z.miss.has(i) ? " miss" : ""}" data-hqw="${i}" aria-label="${z.done || z.peek.has(i) ? esc(w) : "کلمه پنهان"}">${esc(w)}</button>`).join(" ");
    body = `<p class="small">${z.done ? "کلمه‌هایی را که اشتباه گفتید یا یادتان نیامد بزنید تا نارنجی شوند." : "آیه را با کلمه‌های پنهانش از حفظ بخوانید. برای کمک روی جای خالی بزنید (اشتباه حساب می‌شود)."}</p>
      <div class="card">${where}<div class="hq-ar">${txt}</div></div>`;
    foot = z.done ? `<button id="hq-hear">▶ شنیدن</button><button class="btn-main" id="hq-ok">ثبت و ادامه</button>` : `<button class="btn-main" id="hq-show">نشانم بده</button>`;
  } else if (z.mode === "complete") {
    const shown = z.words.slice(0, z.pre + z.step).map(esc).join(" "), left = z.words.slice(z.pre + z.k);
    body = `<p class="small">آیه را ادامه دهید: کلمه بعدی کدام است؟ (${FA(Math.min(z.step + 1, z.k))} از ${FA(z.k)})</p>
      <div class="card">${where}<div class="hq-ar">${shown}${z.done && left.length ? ` <span class="hq-rest">${left.map(esc).join(" ")}</span>` : z.done ? "" : " …"}</div></div>
      ${z.done ? `<p class="small ${z.hits === z.k ? "ok" : ""}">${FA(z.hits)} کلمه از ${FA(z.k)} درست</p>` : `<div class="hq-opts">${z.opts.map((o, i) => `<button data-hqc="${i}" class="${z.pickW === null ? "" : o === z.words[z.pre + z.step] ? "right" : i === z.pickW ? "wrong" : ""}" ${z.pickW !== null ? "disabled" : ""}>${esc(o)}</button>`).join("")}</div>`}`;
    foot = z.done ? `<button id="hq-hear">▶ شنیدن</button><button class="btn-main" id="hq-ok">سؤال بعد</button>` : "";
  } else {
    body = `<p class="small">آیه بعد از این آیه کدام است؟</p><div class="card">${where}<div class="hq-ar">${esc(vplain(sn, ay))}</div></div>
      <div class="hq-opts one">${z.opts.map(o => `<button data-hqn="${o.vk}" class="${z.pickV === null ? "" : o.vk === z.right ? "right" : o.vk === z.pickV ? "wrong" : ""}" ${z.pickV !== null ? "disabled" : ""}>${esc(o.t)}</button>`).join("")}</div>
      ${z.done ? `<p class="small">${z.pickV === z.right ? "✓ درست" : "پاسخ درست سبز شده است"} · <span class="muted">${(() => { const [a, b] = z.right.split(":").map(Number); return `سوره ${S[a].name} · آیه ${FA(b)}`; })()}</span></p>` : ""}`;
    foot = z.done ? `<button id="hq-hear">▶ شنیدن آیه بعد</button><button class="btn-main" id="hq-ok">سؤال بعد</button>` : "";
  }
  const box = sheet(`<div class="sheet" role="dialog" aria-modal="true" aria-label="آزمون حفظ در جریان">
    <header><button class="icon-btn btn-ghost" data-close aria-label="بستن">✕</button><h2>آزمون حفظ</h2></header>
    <div class="body">${head}${body}</div>${foot ? `<footer>${foot}</footer>` : ""}</div>`, () => { hq = null; render(); });
  const on = (s, f) => { const el = box.querySelector(s); if (el) el.addEventListener("click", f); };
  on("#hq-hear", () => z.mode === "next" ? play(...z.right.split(":").map(Number)) : play(sn, ay));
  on("#hq-show", () => { z.done = true; drawHq(); });
  on("#hq-ok", () => hqSettle());
  box.querySelectorAll("[data-hqw]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.hqw;
    if (!z.done) { z.peek.add(i); z.miss.add(i); } else if (z.miss.has(i)) z.miss.delete(i); else z.miss.add(i);
    drawHq();
  }));
  box.querySelectorAll("[data-hqc]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.hqc, ok = z.opts[i] === z.words[z.pre + z.step];
    z.pickW = i; if (ok) z.hits++; else z.missC = (z.missC || []).concat(z.pre + z.step);
    drawHq();
    setTimeout(() => { if (hq !== z) return; z.step++; if (z.step >= z.k) z.done = true; else hqOptsComplete(z); drawHq(); }, ok ? 450 : 1100);
  }));
  box.querySelectorAll("[data-hqn]").forEach(b => b.addEventListener("click", () => { z.pickV = b.dataset.hqn; z.done = true; drawHq(); }));
}
// Score the current question (0..1), send mistakes to the mistakes book, go on
function hqSettle() {
  const z = hq, [sn, ay] = z.cur, vk = key(sn, ay);
  let q = 0;
  if (z.mode === "hide") {
    q = (z.hide.size - z.miss.size) / z.hide.size;
    if (z.miss.size) { addErr(vk, "word"); const e = errOf(vk); z.miss.forEach(i => { e.w[i + 1] = (e.w[i + 1] || 0) + 1; }); save(); }
  } else if (z.mode === "complete") {
    q = z.hits / z.k;
    if (z.missC && z.missC.length) { addErr(vk, "forget"); const e = errOf(vk); z.missC.forEach(i => { e.w[i + 1] = (e.w[i + 1] || 0) + 1; }); save(); }
    z.missC = [];
  } else {
    q = z.pickV === z.right ? 1 : 0;
    if (!q) addErr(z.right, "order");
  }
  z.score += q; z.run = q === 1 ? z.run + 1 : 0; z.best = Math.max(z.best, z.run);
  hqNext();
}
function hqEnd() {
  const z = hq, p = Math.round(z.score / HQ_N * 100);
  st.hq = (st.hq || []).concat({t: Date.now(), d: today(), m: z.mode, p, l: z.mode === "hide" ? z.lvl : undefined, s: z.scope === "mem" ? 0 : +z.scope}).slice(-300);
  logInc("hq"); markActive(); save();
  const prev = (st.hq || []).filter(x => x.m === z.mode).slice(-6, -1), avg = prev.length ? prev.reduce((a, x) => a + x.p, 0) / prev.length : null;
  lastDraw = () => {};
  const box = sheet(`<div class="sheet" role="dialog" aria-modal="true" aria-label="نتیجه آزمون حفظ">
    <header><button class="icon-btn btn-ghost" data-close aria-label="بستن">✕</button><h2>نتیجه آزمون حفظ</h2></header>
    <div class="body"><div class="card lockcard"><span class="small muted">${HQ_MODES[z.mode].l}${z.mode === "hide" ? " · " + HQ_LEVELS[z.lvl][1] : ""}</span>
      <b style="font-size:32px" class="num">${hqPct(p)}</b>
      <span class="small num">امتیاز ${FA(Math.round(z.score * 10))} از ${FA(HQ_N * 10)} · بیشترین پیاپی درست ${FA(z.best)}</span>
      ${avg !== null ? `<span class="small ${p >= avg ? "ok" : "muted"}">${p >= avg ? "▲" : "▼"} میانگین پنج آزمون قبل: ${hqPct(avg)}</span>` : ""}
      <p class="small">${p >= 90 ? "عالی! این آیات خوب در حافظه نشسته‌اند." : p >= 60 ? "خوب است؛ اشتباه‌ها در «دفتر اشتباهات» ثبت شد تا تمرینشان کنید." : "این آیات مرور بیشتری لازم دارند؛ اشتباه‌ها در «دفتر اشتباهات» ثبت شد."}</p>
      <div class="row"><button id="hq-again" class="btn-main">آزمون دوباره</button><button id="hq-home">نمودار پیشرفت</button></div></div></div></div>`, () => { hq = null; render(); });
  box.querySelector("#hq-again").addEventListener("click", hqStart);
  box.querySelector("#hq-home").addEventListener("click", () => { hq = null; drawHqHome(); });
}

// ---------- progress: last 20 results as bars (newest on the left, as RTL reads), stats per mode ----------
function hqProgressCard() {
  const all = st.hq || [];
  if (!all.length) return `<section class="card"><h3>نمودار پیشرفت</h3><p class="small muted">بعد از اولین آزمون، نمره‌هایتان اینجا روی نمودار می‌آید.</p></section>`;
  const last = all.slice(-20), W = 320, H = 150, L = 26, B = 22, T = 8, cw = (W - L - 4) / 20, bw = Math.max(6, cw - 4);
  const y = p => T + (H - T - B) * (1 - p / 100);
  const grid = [0, 50, 80, 100].map(g => `<line x1="${L}" x2="${W - 2}" y1="${y(g)}" y2="${y(g)}" style="stroke:var(--line);stroke-width:1${g === 80 ? ";stroke-dasharray:3 3" : ""}"/><text x="${L - 4}" y="${y(g) + 4}" text-anchor="end" style="fill:var(--muted);font-size:10px">${FA(g)}</text>`).join("");
  // newest bar at the left edge of the plot, oldest at the right
  const bars = last.map((r, i) => { const pos = last.length - 1 - i, x = L + 2 + pos * cw + (cw - bw) / 2, yy = y(Math.max(2, r.p));
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - yy).toFixed(1)}" rx="3" style="fill:${HQ_MODES[r.m] ? HQ_MODES[r.m].c : "var(--muted)"}"><title>${HQ_MODES[r.m] ? HQ_MODES[r.m].l : ""} · ${hqPct(r.p)}</title></rect>`; }).join("");
  const chart = `<svg class="hq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="نمره بیست آزمون اخیر">${grid}${bars}
    <text x="${L + 2}" y="${H - 6}" style="fill:var(--muted);font-size:10px">تازه‌ترین</text><text x="${W - 2}" y="${H - 6}" text-anchor="end" style="fill:var(--muted);font-size:10px">قدیمی‌تر</text></svg>`;
  const t = today(), wk = all.filter(r => r.d > t - 7), pw = all.filter(r => r.d <= t - 7 && r.d > t - 14);
  const mean = a => a.length ? a.reduce((s, r) => s + r.p, 0) / a.length : null, mw = mean(wk), mp = mean(pw);
  const rows = Object.entries(HQ_MODES).map(([k, m]) => { const a = all.filter(r => r.m === k); if (!a.length) return "";
    return `<div class="row between small"><span><span class="hq-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-inline-end:6px;background:${m.c}"></span>${m.l}</span><span class="num">${FA(a.length)} آزمون · میانگین ${hqPct(mean(a))} · بهترین ${hqPct(Math.max(...a.map(r => r.p)))}</span></div>`; }).join("");
  return `<section class="card"><h3>نمودار پیشرفت</h3>
    <div class="hq-stats"><div><b class="num">${FA(all.length)}</b><span class="small muted">آزمون</span></div><div><b class="num">${mw === null ? "—" : hqPct(mw)}</b><span class="small muted">میانگین این هفته</span></div><div><b class="num ${mw !== null && mp !== null ? (mw >= mp ? "ok" : "") : ""}">${mw !== null && mp !== null ? (mw >= mp ? "▲ " : "▼ ") + FA(Math.abs(Math.round(mw - mp))) : "—"}</b><span class="small muted">نسبت به هفته قبل</span></div></div>
    ${chart}${rows}<p class="small muted">خط‌چین: نمره ۸۰، نشانه حفظ خوب.</p></section>`;
}

ACT["data-hq"] = v => openHq(v || undefined);
