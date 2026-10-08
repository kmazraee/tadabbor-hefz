"""Build prototype data for Juz 30 and validate siyaq ranges.

Quran text: quran-json 3.1.2 (Uthmani text from quranenc.com), CC-BY-4.0.
Siyaq ranges: TEST DATA ONLY — not taken from Ali Sabouhi's books.
"""
import json, sys, pathlib

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

NAMES = {
    78: "نبأ", 79: "نازعات", 80: "عبس", 81: "تکویر", 82: "انفطار", 83: "مطففین",
    84: "انشقاق", 85: "بروج", 86: "طارق", 87: "اعلی", 88: "غاشیه", 89: "فجر",
    90: "بلد", 91: "شمس", 92: "لیل", 93: "ضحی", 94: "شرح", 95: "تین", 96: "علق",
    97: "قدر", 98: "بینه", 99: "زلزله", 100: "عادیات", 101: "قارعه", 102: "تکاثر",
    103: "عصر", 104: "همزه", 105: "فیل", 106: "قریش", 107: "ماعون", 108: "کوثر",
    109: "کافرون", 110: "نصر", 111: "مسد", 112: "اخلاص", 113: "فلق", 114: "ناس",
}

# Test siyaq boundaries: list of (start, end) per surah. Placeholder only.
RANGES = {
    78: [(1, 5), (6, 16), (17, 30), (31, 40)],
    79: [(1, 14), (15, 26), (27, 33), (34, 46)],
    80: [(1, 16), (17, 32), (33, 42)],
    81: [(1, 14), (15, 29)],
    82: [(1, 5), (6, 12), (13, 19)],
    83: [(1, 6), (7, 17), (18, 28), (29, 36)],
    84: [(1, 15), (16, 25)],
    85: [(1, 11), (12, 22)],
    86: [(1, 10), (11, 17)],
    87: [(1, 5), (6, 13), (14, 19)],
    88: [(1, 16), (17, 26)],
    89: [(1, 14), (15, 20), (21, 30)],
    90: [(1, 10), (11, 20)],
    91: [(1, 10), (11, 15)],
    92: [(1, 11), (12, 21)],
    93: [(1, 5), (6, 11)],
    96: [(1, 5), (6, 19)],
    98: [(1, 5), (6, 8)],
}

# Test titles and guidance steps for a few siyaqs, to show the UI. Not from the book.
TITLES = {
    (78, 1): ("پرسش از خبر بزرگ", ["طرح پرسش مشرکان", "هشدار به آگاهی نزدیک"]),
    (78, 2): ("نشانه‌های قدرت در آفرینش", ["زمین و کوه‌ها", "خواب و شب و روز", "آسمان و باران و رویش"]),
    (78, 3): ("روز داوری و فرجام طغیانگران", ["وصف روز فصل", "جایگاه طغیانگران", "علت کیفر"]),
    (78, 4): ("پاداش پرهیزگاران و هشدار پایانی", ["نعمت‌های پرهیزگاران", "روز ایستادن روح و فرشتگان", "هشدار و حسرت کافر"]),
    (87, 1): ("تسبیح پروردگار برتر", []),
    (87, 2): ("وعده خواندن و تذکر", []),
    (87, 3): ("رستگاری با تزکیه", []),
    (103, 1): ("زیان انسان و راه نجات", ["سوگند به عصر", "زیان همگانی", "چهار ویژگی رستگاران"]),
    (112, 1): ("توحید خالص", []),
}

surahs, problems = [], []
for n in range(78, 115):
    ch = json.loads((SRC / f"{n}.json").read_text(encoding="utf-8"))
    verses = [v["text"] for v in ch["verses"]]
    total = ch["total_verses"]
    if len(verses) != total:
        problems.append(f"surah {n}: {len(verses)} verses vs total {total}")
    ranges = RANGES.get(n, [(1, total)])
    # QA: contiguous, no gaps, no overlap, covers all
    expect = 1
    for s, e in ranges:
        if s != expect or e < s:
            problems.append(f"surah {n}: range {s}-{e} breaks continuity (expected start {expect})")
        expect = e + 1
    if expect - 1 != total:
        problems.append(f"surah {n}: ranges end at {expect-1}, surah has {total}")
    siyaqs = []
    for i, (s, e) in enumerate(ranges, 1):
        t, steps = TITLES.get((n, i), (None, []))
        siyaqs.append({"n": i, "s": s, "e": e, "title": t, "steps": steps})
    surahs.append({"n": n, "name": NAMES[n], "type": ch["type"], "total": total,
                   "verses": verses, "siyaqs": siyaqs})

if problems:
    print("QA FAILED:\n" + "\n".join(problems))
    sys.exit(1)

OUT.write_text(json.dumps({"surahs": surahs}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"OK: {len(surahs)} surahs, {sum(s['total'] for s in surahs)} verses, "
      f"{sum(len(s['siyaqs']) for s in surahs)} siyaqs -> {OUT}")
