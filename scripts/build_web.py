"""Build the two runnable copies of the app from the template + data.

  prototype/index.html                  -> web (GitHub Pages); data read from ../data/
  android/app/src/main/assets/          -> Android app: index.html, fonts, data/pages/ and data/trans/ (offline)

Run from the repo root after scripts/build_quran.py:  python3 scripts/build_web.py
"""
import json, pathlib, re, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
tpl = (ROOT / "scripts/prototype_src.html").read_text(encoding="utf-8")
meta = (ROOT / "data/meta.json").read_text(encoding="utf-8")
for ph in ("/*DATA*/", "/*DATABASE*/"):
    assert ph in tpl, ph

HEAD = ('<!doctype html>\n<html lang="fa" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#2F6B4F">\n'
        '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,'
        + __import__("base64").b64encode((pathlib.Path(__file__).resolve().parent.parent / "store/logo.svg").read_bytes()).decode() + '">\n')


def page(pagebase, local_fonts):
    body = tpl.replace("/*DATA*/", meta).replace("/*DATABASE*/", pagebase)
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
