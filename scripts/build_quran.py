"""Build the whole-Quran data used by the app.

Inputs (npm packages, see README):
  quran-json 3.1.2   -> surah list, Meccan/Medinan, verse counts
  quran-qcf4 1.1.0   -> Madinah mushaf page layout (604 pages, MIT data)
  rukus.json         -> start of each ruku (from quran-meta, MIT), used as
                        placeholder sections where no siyaq data exists yet

Outputs:
  data/meta.json          surahs, siyaq ranges, verse->page index
  data/pages/NNN.json     one compact file per mushaf page (loaded on demand)

  @ghoran/translation 0.0.9 -> Persian translations from Tanzil.net (json/fa/)

Outputs also data/trans/<id>.json: one Persian translation, as a list of
114 lists of verse strings.

Siyaq boundaries: until the book's divisions are licensed, every surah is split
by ruku. The test Juz 30 siyaqs/titles/steps below (NOT from Ali Sabouhi's books)
are only included with --with-test-siyaq, for development.

Usage: python3 scripts/build_quran.py <quran-json chapters> <quran-qcf4 dir> <rukus.json> <ghoran json/fa dir> [--with-test-siyaq]
"""
import hashlib, json, re, sys, pathlib, datetime

args = [a for a in sys.argv[1:] if not a.startswith("--")]
WITH_TEST = "--with-test-siyaq" in sys.argv
CH, QCF, RUKUS, FA_DIR = (pathlib.Path(a) for a in args[:4])
# All 13 Persian translations from Tanzil; the first three are bundled in the app, the rest are downloadable.
TRANSLATIONS = {k: f"tanzil-{k}.json" for k in ["ansarian", "makarem", "fooladvand", "ayati", "bahrampour", "gharaati", "ghomshei",
                                                "khorramdel", "khorramshahi", "moezzi", "mojtabavi", "sadeqi", "safavi"]}
FA_NORM = str.maketrans({"ي": "ی", "ك": "ک", "ى": "ی"})
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_META = ROOT / "data/meta.json"
OUT_PAGES = ROOT / "data/pages"

NAMES = ["فاتحه", "بقره", "آل عمران", "نساء", "مائده", "انعام", "اعراف", "انفال", "توبه", "یونس",
         "هود", "یوسف", "رعد", "ابراهیم", "حجر", "نحل", "اسراء", "کهف", "مریم", "طه",
         "انبیاء", "حج", "مؤمنون", "نور", "فرقان", "شعراء", "نمل", "قصص", "عنکبوت", "روم",
         "لقمان", "سجده", "احزاب", "سبأ", "فاطر", "یس", "صافات", "ص", "زمر", "غافر",
         "فصلت", "شوری", "زخرف", "دخان", "جاثیه", "احقاف", "محمد", "فتح", "حجرات", "ق",
         "ذاریات", "طور", "نجم", "قمر", "الرحمن", "واقعه", "حدید", "مجادله", "حشر", "ممتحنه",
         "صف", "جمعه", "منافقون", "تغابن", "طلاق", "تحریم", "ملک", "قلم", "حاقه", "معارج",
         "نوح", "جن", "مزمل", "مدثر", "قیامت", "انسان", "مرسلات", "نبأ", "نازعات", "عبس",
         "تکویر", "انفطار", "مطففین", "انشقاق", "بروج", "طارق", "اعلی", "غاشیه", "فجر", "بلد",
         "شمس", "لیل", "ضحی", "شرح", "تین", "علق", "قدر", "بینه", "زلزله", "عادیات",
         "قارعه", "تکاثر", "عصر", "همزه", "فیل", "قریش", "ماعون", "کوثر", "کافرون", "نصر",
         "مسد", "اخلاص", "فلق", "ناس"]
assert len(NAMES) == 114

# Test siyaq boundaries for Juz 30 (placeholder only)
RANGES = {
    78: [(1, 5), (6, 16), (17, 30), (31, 40)], 79: [(1, 14), (15, 26), (27, 33), (34, 46)],
    80: [(1, 16), (17, 32), (33, 42)], 81: [(1, 14), (15, 29)], 82: [(1, 5), (6, 12), (13, 19)],
    83: [(1, 6), (7, 17), (18, 28), (29, 36)], 84: [(1, 15), (16, 25)], 85: [(1, 11), (12, 22)],
    86: [(1, 10), (11, 17)], 87: [(1, 5), (6, 13), (14, 19)], 88: [(1, 16), (17, 26)],
    89: [(1, 14), (15, 20), (21, 30)], 90: [(1, 10), (11, 20)], 91: [(1, 10), (11, 15)],
    92: [(1, 11), (12, 21)], 93: [(1, 5), (6, 11)], 96: [(1, 5), (6, 19)], 98: [(1, 5), (6, 8)],
}
TITLES = {
    (78, 1): ("پرسش از خبر بزرگ", [(1, 3, "طرح پرسش مشرکان"), (4, 5, "هشدار به آگاهی نزدیک")]),
    (78, 2): ("نشانه‌های قدرت در آفرینش", [(6, 7, "زمین و کوه‌ها"), (8, 11, "انسان، خواب، شب و روز"), (12, 16, "آسمان، باران و رویش")]),
    (78, 3): ("روز داوری و فرجام طغیانگران", [(17, 20, "وصف روز فصل"), (21, 26, "جایگاه طغیانگران"), (27, 30, "علت کیفر")]),
    (78, 4): ("پاداش پرهیزگاران و هشدار پایانی", [(31, 36, "نعمت‌های پرهیزگاران"), (37, 39, "روز ایستادن روح و فرشتگان"), (40, 40, "هشدار و حسرت کافر")]),
    (87, 1): ("تسبیح پروردگار برتر", []), (87, 2): ("وعده خواندن و تذکر", []), (87, 3): ("رستگاری با تزکیه", []),
    (103, 1): ("زیان انسان و راه نجات", [(1, 1, "سوگند به عصر"), (2, 2, "زیان همگانی"), (3, 3, "چهار ویژگی رستگاران")]),
    (112, 1): ("توحید خالص", []),
}
DIRECTION = {78: "از پرسش منکران قیامت آغاز می‌کند، با نشانه‌های آفرینش امکان آن را نشان می‌دهد و با وصف فرجام دو گروه، به انتخاب امروز فرا می‌خواند."}

# ---- siyaq/fasl notation: data/siyaq/NNN.txt ----
# Each siyaq is a verse range in parentheses, each fasl (chapter) in square brackets.
# A fasl may sit inside another one (an interposed chapter), e.g. for Baqarah:
#   [(208-215)(216-221)[(222-223)(224-227)(228-233)(234-235)(236-242)](243-253)]
# Persian/Arabic digits and the word «تا» are accepted. Fasls are numbered in the order they open.
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
def parse_notation(text, total, sn):
    text = text.translate(DIGITS).replace("تا", "-").replace("–", "-").replace("—", "-")
    text = "".join(l.split("#", 1)[0] for l in text.splitlines())   # allow comments
    siyaqs, fasls, stack, errs = [], [], [], []
    for tok in re.findall(r"\[|\]|\(\s*\d+\s*(?:-\s*\d+\s*)?\)|\S", text):
        if tok == "[":
            f = {"n": len(fasls) + 1, "s": None, "e": None, "parent": stack[-1]["n"] if stack else None}
            fasls.append(f); stack.append(f)
        elif tok == "]":
            if not stack: errs.append(f"surah {sn}: extra ]"); continue
            stack.pop()
        elif tok.startswith("("):
            nums = list(map(int, re.findall(r"\d+", tok))); a, b = nums[0], nums[-1]
            siyaqs.append({"s": a, "e": b, "fasl": stack[-1]["n"] if stack else None})
            for f in stack:   # every open fasl covers this siyaq
                f["s"] = a if f["s"] is None else min(f["s"], a); f["e"] = b if f["e"] is None else max(f["e"], b)
        else:
            errs.append(f"surah {sn}: unexpected character {tok!r}")
    if stack: errs.append(f"surah {sn}: {len(stack)} unclosed [")
    if not siyaqs: errs.append(f"surah {sn}: no siyaq found")
    return siyaqs, fasls, errs

problems = []
ruku_starts = {}
for sn, ay in json.loads(RUKUS.read_text()):
    ruku_starts.setdefault(sn, []).append(ay)

# ---- pages ----
TYPES = {"word": "w", "end": "e", "surah_header": "h", "bismillah": "b", "quarter": "q"}
OUT_PAGES.mkdir(parents=True, exist_ok=True)
vpages = {}          # "s:a" -> [pages]
for n in range(1, 605):
    p = json.loads((QCF / f"pages/{n:03d}.json").read_text(encoding="utf-8"))
    lines = []
    for ln in p["lines"]:
        ws = []
        for w in ln["words"]:
            t = TYPES.get(w["type"])
            if t is None:
                problems.append(f"page {n}: unknown type {w['type']}"); continue
            ref = w.get("verse_key") or (str(w["sura"]) if "sura" in w else "")
            ws.append([t, w["char"], w["font"], ref, w.get("text", "")])
            if t in "we" and w.get("verse_key"):
                lst = vpages.setdefault(w["verse_key"], [])
                if n not in lst: lst.append(n)
        lines.append(ws)
    if n > 2 and len(lines) != 15:
        problems.append(f"page {n}: {len(lines)} lines")
    (OUT_PAGES / f"{n:03d}.json").write_text(json.dumps({"p": n, "f": p["font"], "lines": lines}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# ---- surahs ----
surahs, total_verses = [], 0
for sn in range(1, 115):
    ch = json.loads((CH / f"{sn}.json").read_text(encoding="utf-8"))
    total = ch["total_verses"]; total_verses += total
    book = ROOT / "data/siyaq" / f"{sn:03d}.txt"
    fasls, sfasl = [], {}
    if book.exists():
        parsed, fasls, errs = parse_notation(book.read_text(encoding="utf-8"), total, sn)
        problems.extend(errs)
        ranges, src = [(q["s"], q["e"]) for q in parsed], "book"
        sfasl = {i: q["fasl"] for i, q in enumerate(parsed, 1)}
    elif WITH_TEST and sn in RANGES:
        ranges, src = RANGES[sn], "test"
    else:
        starts = sorted(set(ruku_starts.get(sn, [1])) | {1})
        ranges = [(a, (starts[i + 1] - 1) if i + 1 < len(starts) else total) for i, a in enumerate(starts)]
        src = "ruku"
    exp = 1
    for a, b in ranges:
        if a != exp or b < a: problems.append(f"surah {sn}: range {a}-{b} breaks continuity")
        exp = b + 1
    if exp - 1 != total: problems.append(f"surah {sn}: ranges end at {exp - 1}, surah has {total}")
    siyaqs = []
    for i, (a, b) in enumerate(ranges, 1):
        t, steps = TITLES.get((sn, i), (None, [])) if WITH_TEST else (None, [])
        if steps:
            e2 = a
            for x, y, _ in steps:
                if x != e2: problems.append(f"surah {sn} siyaq {i}: step {x}-{y} breaks continuity")
                e2 = y + 1
            if e2 - 1 != b: problems.append(f"surah {sn} siyaq {i}: steps end at {e2 - 1}")
        q = {"n": i, "s": a, "e": b, "title": t, "steps": [{"s": x, "e": y, "t": tt} for x, y, tt in steps]}
        if sfasl.get(i): q["f"] = sfasl[i]
        siyaqs.append(q)
    # optional texts for book siyaqs: data/siyaq/NNN.json (titles and summaries)
    texts = ROOT / "data/siyaq" / f"{sn:03d}.json"
    sdir, spoints, ssource = None, None, None
    if src == "book" and texts.exists():
        c = json.loads(texts.read_text(encoding="utf-8"))
        cs = c.get("siyaqs", [])
        if len(cs) != len(siyaqs):
            problems.append(f"surah {sn}: {len(cs)} siyaq texts for {len(siyaqs)} siyaqs")
        for q, x in zip(siyaqs, cs):
            if (x.get("s"), x.get("e")) != (q["s"], q["e"]):
                problems.append(f"surah {sn} siyaq {q['n']}: text range {x.get('s')}-{x.get('e')} != {q['s']}-{q['e']}")
            q["title"] = x.get("t") or None
            if x.get("d"): q["sum"] = x["d"]
        for f in fasls:
            x = next((y for y in c.get("fasls", []) if y["n"] == f["n"]), None)
            if x: f["t"] = x.get("t"); f["d"] = x.get("d", [])
        sdir, spoints, ssource = c.get("dir"), c.get("points"), c.get("source")
    # verse -> page: first page of each verse; list extra pages only for verses split across pages
    vp, split = [], {}
    for ay in range(1, total + 1):
        pl = vpages.get(f"{sn}:{ay}")
        if not pl: problems.append(f"{sn}:{ay} not on any page"); vp.append(0); continue
        vp.append(pl[0])
        if len(pl) > 1: split[ay] = pl[1:]
    surahs.append({"n": sn, "name": NAMES[sn - 1], "type": ch["type"], "total": total, "src": src,
                   "dir": sdir or (DIRECTION.get(sn) if WITH_TEST else None), "siyaqs": siyaqs, "vp": vp, "split": split,
                   **({"points": spoints} if spoints else {}), **({"source": ssource} if ssource else {}),
                   **({"fasls": fasls} if fasls else {})})

if total_verses != 6236: problems.append(f"total verses {total_verses}")

# ---- Persian translations ----
OUT_TRANS = ROOT / "data/trans"
OUT_TRANS.mkdir(parents=True, exist_ok=True)
for tid, fname in TRANSLATIONS.items():
    flat = json.loads((FA_DIR / fname).read_text(encoding="utf-8"))
    if len(flat) != 6236:
        problems.append(f"translation {tid}: {len(flat)} verses"); continue
    out, i = [], 0
    for s in surahs:
        out.append([x.strip().translate(FA_NORM) for x in flat[i:i + s["total"]]]); i += s["total"]
    for sur in out:   # a translator may render two verses together; say so instead of leaving a gap
        for j, v in enumerate(sur):
            if not v:
                if j == 0: problems.append(f"translation {tid}: empty first verse")
                sur[j] = "(ترجمه این آیه همراه آیه قبل آمده است)"
    (OUT_TRANS / f"{tid}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
if len(vpages) != 6236: problems.append(f"verses on pages {len(vpages)}")
if problems:
    print("QA FAILED:\n" + "\n".join(problems[:30])); sys.exit(1)
# Content version: changes only when siyaq/fasl data or texts change (used by the in-app update check)
content_key = json.dumps([[s["n"], s["src"], s["siyaqs"], s.get("fasls"), s.get("dir"), s.get("points")] for s in surahs], ensure_ascii=False, sort_keys=True)
version = hashlib.sha1(content_key.encode()).hexdigest()[:10]
OUT_META.write_text(json.dumps({"v": version, "built": datetime.date.today().isoformat(), "surahs": surahs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
size = sum(f.stat().st_size for f in OUT_PAGES.glob("*.json"))
print(f"Translations: {', '.join(TRANSLATIONS)} | test siyaq data: {'ON' if WITH_TEST else 'off'}")
for s in surahs:
    if s["src"] == "book":
        print(f"  book siyaqs: surah {s['n']} {s['name']}: {len(s['siyaqs'])} siyaqs, {len(s.get('fasls', []))} fasls")
print(f"OK: 114 surahs, {total_verses} verses, {sum(len(s['siyaqs']) for s in surahs)} sections, "
      f"604 pages ({size // 1024} KB), meta {OUT_META.stat().st_size // 1024} KB")
