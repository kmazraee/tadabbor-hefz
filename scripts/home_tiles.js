// ---------- colourful shortcut tiles at the top of «امروز» ----------
// Kept in its own file and inlined by scripts/build_web.py at the /*HOMETILES*/ placeholder (after ACT is defined).
// Two tabs: a fixed set of shortcuts, and the user's own (cfg.myTiles, a list of menu keys from menuGroups()).
// A tile opens the same thing as the menu item with that key (ACT["data-feat"]); a few extra keys start playback.
const TILE_DEF = ["mushaf", "map", "search", "listen", "listentr", "ai", "review", "hq", "vnotes"];
const TILE_COL = {
  mushaf: ["#5B6FB5", "#3E4F94"], map: ["#4FB6F0", "#2B8FDB"], search: ["#FF8A5B", "#EE5A3A"], ai: ["#1E4C6B", "#0E2F45"],
  listen: ["#7BC25A", "#4FA343"], listentr: ["#8C8A70", "#666552"], review: ["#2BB59A", "#14907C"], hq: ["#A05BE8", "#7A3FD0"],
  vnotes: ["#F5C342", "#E8A61E"], notebook: ["#8B6A3E", "#634A28"], lessons: ["#E85A6B", "#C93D52"], path: ["#3A9E62", "#24804A"],
  reciters: ["#45B3B0", "#2A8E8C"], progress: ["#5C7FD6", "#3A5CB8"], quiz: ["#F08A3C", "#D96A1E"], weak: ["#C2554A", "#9E3A31"],
  vocab: ["#6C8E3A", "#4F6D24"], books: ["#9C6B4E", "#7A4E35"], goal: ["#E0704A", "#BF5232"], weekly: ["#4A9BD6", "#2E7AB8"],
  class: ["#7E68C9", "#5F4BAA"], downloads: ["#5A8C9E", "#3E6F80"], settings: ["#6E7B85", "#4F5A63"], guide: ["#3F8F86", "#26706A"]
};
const TILE_PLAY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>`;
// Extra shortcuts that are not menu items
const tileExtra = () => [
  {k: "listen", l: "پخش قرائت", ic: TILE_PLAY, go: () => tileListen("ar")},
  {k: "listentr", l: "پخش قرائت و ترجمه گویا", ic: TILE_PLAY, go: () => tileListen("artr")}
];
function tileListen(mode) {
  cfg.mpMode = mode; if (mode !== "ar" && !cfg.mpTrans) cfg.mpTrans = "translations/Makarem_Kabiri_16Kbps"; saveCfg();
  goTab("mushaf");
  setTimeout(() => { if (typeof muPop === "function") muPop("end"); else { const [sn, ay] = firstOnPage(mushafPage); mpStart(sn, ay); } }, 120);
}
const tileAll = () => [...tileExtra(), ...menuGroups().flatMap(g => g.items)];
const tileByKey = k => tileAll().find(x => x.k === k);
const myTiles = () => (cfg.myTiles || []).filter(k => tileByKey(k));
const tileHtml = x => { const c = TILE_COL[x.k] || ["#6E7B85", "#4F5A63"];
  return `<button class="tile2" data-tile="${x.k}" style="--t1:${c[0]};--t2:${c[1]}"><span class="t2-ic">${x.ic}</span><span class="t2-l">${x.l}</span>${x.b ? `<b class="t2-b num">${FA(x.b)}</b>` : ""}</button>`; };
function homeTiles() {
  const mine = cfg.tileTab === "my", keys = mine ? myTiles() : TILE_DEF;
  return `<section class="tiles2" aria-label="میانبرها">
    <div class="t2-seg" role="tablist"><button role="tab" data-tiletab="def" aria-selected="${!mine}">میانبرهای پیش‌فرض</button><button role="tab" data-tiletab="my" aria-selected="${mine}">میانبرهای من</button></div>
    <button class="searchbar" data-search aria-label="جستجو در همه‌جا"><span aria-hidden="true">${ICON_SEARCH}</span><span>جستجو</span></button>
    <div class="t2-grid">${keys.map(k => tileHtml(tileByKey(k))).join("")}${mine ? `<button class="tile2 t2-add" data-tileedit><span class="t2-ic">${MI(`<path d="M12 5v14M5 12h14"/>`)}</span><span class="t2-l">${keys.length ? "ویرایش میانبرها" : "افزودن میانبر"}</span></button>` : ""}</div>
  </section>`;
}
function openTileEdit() {
  const cur = new Set(myTiles());
  const box = sheet(`<div class="sheet" role="dialog" aria-modal="true" aria-label="میانبرهای من">
    <header><button class="icon-btn btn-ghost" data-close aria-label="بستن">✕</button><h2>میانبرهای من</h2></header>
    <div class="body"><p class="small muted">هر امکانی را که زیاد استفاده می‌کنید انتخاب کنید تا در «میانبرهای من» بالای صفحه امروز بیاید.</p>
    <div class="t2-pick">${tileAll().filter(x => x.k !== "home").map(x => `<label class="mitem"><input type="checkbox" value="${x.k}" ${cur.has(x.k) ? "checked" : ""}><span class="mi">${x.ic}</span><span class="ml">${x.l}</span></label>`).join("")}</div></div></div>`);
  box.querySelectorAll(".t2-pick input").forEach(i => i.addEventListener("change", () => {
    const list = myTiles().filter(k => k !== i.value); if (i.checked) list.push(i.value);
    cfg.myTiles = list; saveCfg();
  }));
}
ACT["data-tile"] = k => { const x = tileByKey(k); if (x) x.go(); };
ACT["data-tiletab"] = v => { cfg.tileTab = v; saveCfg(); render(); };
ACT["data-tileedit"] = () => openTileEdit();

(function tilesStyle() {
  const css = `.tiles2{display:flex;flex-direction:column;gap:12px}
.t2-seg{display:grid;grid-template-columns:1fr 1fr;align-self:center;width:min(100%,340px);border:1.5px solid var(--ink);border-radius:12px;overflow:hidden}
.t2-seg button{border:none;border-radius:0;background:none;color:var(--ink);font-size:14px;min-height:40px;padding:6px 8px}
.t2-seg button[aria-selected="true"]{background:var(--ink);color:var(--paper);font-weight:700}
.t2-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.tile2{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;gap:8px;min-height:104px;padding:12px;border:none;border-radius:22px;color:#fff;text-align:start;
  background:linear-gradient(150deg,var(--t1),var(--t2));box-shadow:0 4px 12px color-mix(in srgb,var(--t2) 35%,transparent)}
.tile2::after{content:"";position:absolute;inset-inline-start:-18%;bottom:-38%;width:90%;aspect-ratio:1;border-radius:50%;border:10px solid rgba(255,255,255,.1);box-shadow:0 0 0 18px rgba(255,255,255,.06),0 0 0 36px rgba(255,255,255,.04);pointer-events:none}
.t2-ic{align-self:flex-end}
.t2-ic svg{width:34px;height:34px;display:block;color:#fff}
.t2-l{font-weight:800;font-size:15px;line-height:1.5;position:relative;z-index:1}
.t2-b{position:absolute;top:10px;inset-inline-start:10px;min-width:22px;height:22px;border-radius:11px;background:rgba(255,255,255,.92);color:var(--t2);font-size:12px;display:grid;place-items:center;padding:0 6px}
.t2-add{background:none;color:var(--muted);border:2px dashed var(--line);box-shadow:none}
.t2-add::after{display:none}
.t2-add .t2-ic svg{color:var(--muted)}
.t2-pick{display:flex;flex-direction:column;gap:2px}
.t2-pick input{width:20px;height:20px;flex:none;accent-color:var(--lapis)}
@media (min-width:560px){.t2-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}`;
  const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el);
})();
