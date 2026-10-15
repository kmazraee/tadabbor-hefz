"""Build the two runnable copies of the app from the template + data.

  prototype/index.html                  -> web (GitHub Pages); data read from ../data/
  android/app/src/main/assets/          -> Android app: index.html, fonts, data/pages/ and data/trans/ (offline)

Run from the repo root after scripts/build_quran.py:  python3 scripts/build_web.py
The app downloads translations and content updates from SITE_BASE (set it to your own server's address
to move the app off GitHub Pages):  SITE_BASE=https://example.com/ python3 scripts/build_web.py
A web copy always reads from the server it is served from. For your own server see scripts/build_server.py.
"""
import hashlib, json, os, pathlib, re, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE_BASE = os.environ.get("SITE_BASE", "https://kmazraee.github.io/tadabbor-hefz/").rstrip("/") + "/"
tpl = (ROOT / "scripts/prototype_src.html").read_text(encoding="utf-8")
meta = (ROOT / "data/meta.json").read_text(encoding="utf-8")


_DIG = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
def deck_units(d, total):
    """Top-level units of an institute slide (سیاق / بخش / طلیعه ...) as (start, end, title).
    Only returned when they tile the whole surah without gaps; otherwise the mushaf-ruku split stays."""
    tops = [x for x in d.get("flow", []) if "_" not in x["id"] and x["id"].startswith("r") and "s" not in x]
    units = []
    for x in tops:
        t = x["t"].translate(_DIG)
        ms = list(re.finditer(r"(سیاق[^()—:]*|بخش[^()—:]*|طلیعه|خاتمه|مقدمه)\s*\((?:آیات|آیه)\s*(\d+)(?:\s*تا\s*(\d+))?\)?", t))
        if not ms:
            return None
        m = ms[-1]; a = int(m.group(2)); b = int(m.group(3) or a)
        rest = t[m.end():].lstrip(")").lstrip(" :/—-").strip()
        generic = m.group(1).strip().startswith("بخش")
        units.append((a, b, rest if rest and not generic else "", m.group(1).strip().startswith("سیاق") or m.group(1).strip() in ("طلیعه", "خاتمه", "مقدمه")))
    if not units or units[0][0] != 1 or units[-1][1] != total or any(u[1] + 1 != v[0] for u, v in zip(units, units[1:])):
        return None
    if len(units) < 2 and not units[0][3]:
        return None      # one generic «بخش» over the whole surah says nothing about siyaq boundaries
    return units

# Institute slide decks per surah (data/decks/NNN.json): surah card, guidance flow and direction.
# Where the flow boxes exactly tile a siyaq, they become that siyaq's reference steps.
_m = json.loads(meta)
for f in sorted((ROOT / "data/decks").glob("*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    s = next(x for x in _m["surahs"] if x["n"] == int(f.stem))
    s["deck"] = d
    if s["src"] == "book":
        continue
    if s["n"] != 2:
        u = deck_units(d, s["total"])
        if u:      # siyaq boundaries from the slide's top level (no fasl outside Baqarah)
            s["siyaqs"] = [{"n": i + 1, "s": a, "e": b, "title": t or None, "steps": []} for i, (a, b, t, _) in enumerate(u)]
            s["sy"] = "deck"
    s["dir"] = d.get("dir") or s.get("dir")
    s["source"] = d.get("source")
    nodes = sorted([x for x in d.get("flow", []) if "s" in x], key=lambda x: x["s"])
    for q in s["siyaqs"]:
        inside = [x for x in nodes if x["s"] >= q["s"] and x["e"] <= q["e"]]
        tiles = inside and inside[0]["s"] == q["s"] and inside[-1]["e"] == q["e"] and all(
            a["e"] + 1 == b["s"] for a, b in zip(inside, inside[1:]))
        if d.get("steps"):
            q["steps"] = [x for x in d["steps"] if q["s"] <= x["s"] and x["e"] <= q["e"]]
            if q["s"] == 1 and q["e"] == s["total"] and d.get("dir"):
                q["title"] = d["dir"]
                q["sum"] = [d["dirText"]] if d.get("dirText") else []
        elif tiles:
            q["steps"] = [{"s": x["s"], "e": x["e"], "t": x["t"]} for x in inside]
            if q["s"] == 1 and q["e"] == s["total"] and d.get("dir"):
                q["title"] = d["dir"]
                q["sum"] = [d["dirText"]] if d.get("dirText") else []
    print(f"  deck: surah {s['n']} {s['name']}")
meta = json.dumps(_m, ensure_ascii=False, separators=(",", ":"))
for ph in ("/*DATA*/", "/*DATABASE*/", "/*SITEBASE*/"):
    assert ph in tpl, ph

HEAD = ('<!doctype html>\n<html lang="fa" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#2F6B4F">\n'
        '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,'
        + __import__("base64").b64encode((pathlib.Path(__file__).resolve().parent.parent / "store/logo.svg").read_bytes()).decode() + '">\n')


def page(pagebase, local_fonts):
    body = tpl.replace("/*DATA*/", meta).replace("/*DATABASE*/", pagebase).replace("/*SITEBASE*/", SITE_BASE)
    head_part, rest = body.split("</style>", 1)
    head_part += "</style>\n"
    if local_fonts:
        head_part = re.sub(r'<link rel="(preconnect|stylesheet)" href="https://fonts\.(googleapis|gstatic)\.com[^>]*>\n?', "", head_part)
        assert "fonts.googleapis" not in head_part
        head_part = head_part.replace("<style>", "<style>\n" + FACES + "\n", 1)
    return HEAD + head_part + "</head>\n<body>\n" + rest + "\n</body>\n</html>\n"


AR_RANGE = "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC"
FACES = "\n".join(
    [f"@font-face{{font-family:'Vazirmatn';font-weight:{w};font-display:swap;src:url('fonts/vazirmatn-arabic-{w}-normal.woff2') format('woff2');unicode-range:{AR_RANGE}}}\n"
     f"@font-face{{font-family:'Vazirmatn';font-weight:{w};font-display:swap;src:url('fonts/vazirmatn-latin-{w}-normal.woff2') format('woff2')}}"
     for w in (400, 500, 700, 800)]
    + ["@font-face{font-family:'Amiri Quran';font-weight:400;font-display:swap;src:url('fonts/amiri-quran-arabic-400-normal.woff2') format('woff2')}",
       "@font-face{font-family:'Scheherazade New';font-weight:400;font-display:swap;src:url('fonts/scheherazade-new-arabic-400-normal.woff2') format('woff2')}",
       "@font-face{font-family:'Scheherazade New';font-weight:700;font-display:swap;src:url('fonts/scheherazade-new-arabic-700-normal.woff2') format('woff2')}"])

# Full text for search: one string per verse, joined from the mushaf page words (simple script with diacritics)
verses = {}
for f in sorted((ROOT / "data/pages").glob("*.json")):
    for ln in json.loads(f.read_text(encoding="utf-8"))["lines"]:
        for w in ln:
            if w[0] == "w":
                verses.setdefault(w[3], []).append(w[4])
surah_meta = json.loads(meta)["surahs"]
quran = [[" ".join(verses[f"{s['n']}:{a}"]) for a in range(1, s["total"] + 1)] for s in surah_meta]
assert sum(map(len, quran)) == 6236 and len(verses) == 6236, "verse text incomplete"
(ROOT / "data/quran.json").write_text(json.dumps(quran, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

(ROOT / "prototype/index.html").write_text(page("../data/", False), encoding="utf-8")


def service_worker():
    """sw.js for a web copy. Its cache name is a hash of the data, so a data change replaces the cache."""
    h = hashlib.sha1(meta.encode())
    for sub in ("pages", "trans"):
        for f in sorted((ROOT / "data" / sub).glob("*.json")):
            h.update(f.read_bytes())
    for f in ("quran.json", "roots.json", "similar.json"):
        h.update((ROOT / "data" / f).read_bytes())
    return SW.replace("__V__", h.hexdigest()[:12])


SW = """// Generated by scripts/build_web.py. Keeps what the app reads from the server on the device:
// mushaf pages, translations, search data and fonts are read once and then served from the cache.
const CACHE = "hefz-__V__";
const DATA = /\\/data\\/(pages|trans)\\/[^/]+\\.json$|\\/data\\/(quran|roots|similar)\\.json$|\\/fonts\\/[^/]+\\.woff2$/;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k.startsWith("hefz-") && k !== CACHE).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
const keep = (req, res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; };
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  // The page itself: always the newest from the server, the saved copy when offline
  if (r.mode === "navigate") { e.respondWith(fetch(r).then(res => keep(r, res)).catch(() => caches.match(r))); return; }
  const mine = u.origin === location.origin && DATA.test(u.pathname);
  const qcf = u.hostname === "cdn.jsdelivr.net" && u.pathname.includes("/quran-qcf4@");
  if (!mine && !qcf) return;
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => keep(r, res))));
});
"""
(ROOT / "prototype/sw.js").write_text(service_worker(), encoding="utf-8")

assets = ROOT / "android/app/src/main/assets"
(assets / "index.html").write_text(page("data/", True), encoding="utf-8")
BUNDLED_TRANS = ("safavi", "ansarian", "makarem", "fooladvand")   # the rest are downloaded inside the app
for sub in ("pages", "trans"):
    dst = assets / "data" / sub
    if dst.exists():
        shutil.rmtree(dst)
    if sub == "pages":
        shutil.copytree(ROOT / "data" / sub, dst)
    else:
        dst.mkdir(parents=True)
        for tid in BUNDLED_TRANS:
            shutil.copy(ROOT / "data/trans" / f"{tid}.json", dst / f"{tid}.json")
for f in ("quran.json", "roots.json", "similar.json"):      # full text, word roots, similar verses
    shutil.copy(ROOT / "data" / f, assets / "data" / f)
print("built prototype/index.html and android assets (index.html, 604 pages, full text for search, 4 bundled translations)")
