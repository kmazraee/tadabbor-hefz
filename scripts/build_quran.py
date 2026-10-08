"""Build the whole-Quran data used by the app.

Inputs (npm packages, see README):
  quran-json 3.1.2   -> surah list, Meccan/Medinan, verse counts
  quran-qcf4 1.1.0   -> Madinah mushaf page layout (604 pages, MIT data)
  rukus.json         -> start of each ruku (from quran-meta, MIT), used as
                        placeholder sections where no siyaq data exists yet

Outputs:
  data/meta.json          surahs, siyaq ranges, verse->page index
  data/pages/NNN.json     one compact file per mushaf page (loaded on demand)

Siyaq ranges, titles and steps below are TEST DATA ONLY (Juz 30), not taken
from Ali Sabouhi's books. All other surahs use ruku divisions as placeholders.

Usage: python3 scripts/build_quran.py <quran-json chapters dir> <quran-qcf4 dir> <rukus.json>
"""
import json, sys, pathlib

CH, QCF, RUKUS = (pathlib.Path(a) for a in sys.argv[1:4])
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
    if sn in RANGES:
        ranges, src = RANGES[sn], "test"
    else:
        starts = sorted(set(ruku_starts.get(sn, [1])) | {1})
        ranges = [(a, (starts[i + 1] - 1) if i + 1 < len(starts) else total) for i, a in enumerate(starts)]
        src = "test" if 78 <= sn <= 114 else "ruku"
    exp = 1
    for a, b in ranges:
        if a != exp or b < a: problems.append(f"surah {sn}: range {a}-{b} breaks continuity")
        exp = b + 1
    if exp - 1 != total: problems.append(f"surah {sn}: ranges end at {exp - 1}, surah has {total}")
    siyaqs = []
    for i, (a, b) in enumerate(ranges, 1):
        t, steps = TITLES.get((sn, i), (None, []))
        if steps:
            e2 = a
            for x, y, _ in steps:
                if x != e2: problems.append(f"surah {sn} siyaq {i}: step {x}-{y} breaks continuity")
                e2 = y + 1
            if e2 - 1 != b: problems.append(f"surah {sn} siyaq {i}: steps end at {e2 - 1}")
        siyaqs.append({"n": i, "s": a, "e": b, "title": t, "steps": [{"s": x, "e": y, "t": tt} for x, y, tt in steps]})
    # verse -> page: first page of each verse; list extra pages only for verses split across pages
    vp, split = [], {}
    for ay in range(1, total + 1):
        pl = vpages.get(f"{sn}:{ay}")
        if not pl: problems.append(f"{sn}:{ay} not on any page"); vp.append(0); continue
        vp.append(pl[0])
        if len(pl) > 1: split[ay] = pl[1:]
    surahs.append({"n": sn, "name": NAMES[sn - 1], "type": ch["type"], "total": total, "src": src,
                   "dir": DIRECTION.get(sn), "siyaqs": siyaqs, "vp": vp, "split": split})

if total_verses != 6236: problems.append(f"total verses {total_verses}")
if len(vpages) != 6236: problems.append(f"verses on pages {len(vpages)}")
if problems:
    print("QA FAILED:\n" + "\n".join(problems[:30])); sys.exit(1)
OUT_META.write_text(json.dumps({"surahs": surahs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
size = sum(f.stat().st_size for f in OUT_PAGES.glob("*.json"))
print(f"OK: 114 surahs, {total_verses} verses, {sum(len(s['siyaqs']) for s in surahs)} sections, "
      f"604 pages ({size // 1024} KB), meta {OUT_META.stat().st_size // 1024} KB")
