"""Build study data from the Quran text (data/quran.json):

  data/roots.json    roots of every word (Quranic Arabic Corpus word map) and a root -> verses index
  data/similar.json  similar verses (mutashabihat) for each verse, from shared word sequences

Run from the repo root:  python3 scripts/build_study.py <wordmap.json>
wordmap.json = {simple word: {lemma, root}} from the Quranic Arabic Corpus v4.0 (corpus.quran.com),
as bundled in the npm package quran-search-engine.
"""
import json, re, sys, collections, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
Q = json.loads((ROOT / "data/quran.json").read_text(encoding="utf-8"))
wm = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))

DIAC = re.compile(r"[ً-ٰٟۖ-ۭـ‌‍]")
def k1(w): return DIAC.sub("", w).replace("ٱ", "ا")
def k3(w):
    w = k1(w)
    w = re.sub(r"[أإآ]", "ا", w).replace("ى", "ي").replace("ی", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي").replace("ء", "")
    w = re.sub(r"واه$", "اه", w)
    return w[:1] + w[1:].replace("ا", "")
# Particles and pronouns carry pseudo-roots in the word map ("م-ن", "ه-و-ي-ه-و-أ"); keep real 3- and 4-letter roots only
FUNC = set("من في ما هو هم هي هما هن أنت أنتم أنا نحن الذي الذين التي اللاتي اللائي على إلى عن أن إن لا لم لن ثم قد إذ إذا بل أو أم ذلك ذا هذا هذه تلك أولئك هؤلاء كي لو لولا حتى إلا ليت لعل كأن لكن يا".split())
def real(v):
    r = v.get("root") or ""
    return v.get("lemma") not in FUNC and len(r.split("-")) in (3, 4) and all(len(x) == 1 for x in r.split("-"))
by1, by3 = {}, {}
for k, v in wm.items():
    if real(v):
        by1.setdefault(k1(k), v["root"]); by3.setdefault(k3(k), v["root"])

# Function words, with prefixed و ف ب ل ك or attached pronouns (بما، وهم، إليك، عليهم…), have no root
FUNC_S = {k1(x).replace("أ", "ا").replace("إ", "ا") for x in FUNC} | {"الي", "علي", "لدي", "لدن", "اذن"}
PRON = r"(ه|ها|هم|هما|هن|ك|كم|كما|كن|ي|نا|ني)?"
FUNC_RE = re.compile(r"^(و|ف|ب|ل|ك|وب|ول|فب|فل)?(" + "|".join(sorted(FUNC_S, key=len, reverse=True)) + ")" + PRON + "$")
def is_func(w):
    b = re.sub(r"[أإآ]", "ا", k1(w)).replace("ى", "ي")
    if re.match(r"^(و|ف)?(كان|كانت|كانوا|كنت|كنتم)$", b): return False      # the verb كان, not ك + أن
    return bool(FUNC_RE.match(b))
roots, rid = [], {}
verses_roots = []            # per surah, per verse: list of root ids (or -1) for each word
index = collections.defaultdict(list)
tot = hit = 0
for si, sv in enumerate(Q, 1):
    out_s = []
    for ai, v in enumerate(sv, 1):
        ids = []
        for w in v.split(" "):
            tot += 1
            r = None if is_func(w) else by1.get(k1(w)) or by3.get(k3(w))
            if r:
                hit += 1
                if r not in rid: rid[r] = len(roots); roots.append(r)
                ids.append(rid[r])
                vk = f"{si}:{ai}"
                if not index[rid[r]] or index[rid[r]][-1] != vk: index[rid[r]].append(vk)
            else:
                ids.append(-1)
        out_s.append(ids)
    verses_roots.append(out_s)
print(f"roots: {len(roots)} · words with a root: {hit}/{tot} ({hit / tot:.1%})")
assert hit / tot > 0.6   # about a third of the words are particles and pronouns
(ROOT / "data/roots.json").write_text(json.dumps({"roots": roots, "words": verses_roots, "index": [index[i] for i in range(len(roots))]},
                                                 ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# Similar verses: verses sharing a run of 4+ words (after removing diacritics), ranked by shared length
def norm_words(v): return [k3(w) for w in v.split(" ")]
NW = [[norm_words(v) for v in sv] for sv in Q]
N = 4
grams = collections.defaultdict(set)
for si, sv in enumerate(NW, 1):
    for ai, ws in enumerate(sv, 1):
        for i in range(len(ws) - N + 1):
            grams[tuple(ws[i:i + N])].add((si, ai))
common = [g for g, vs in grams.items() if 2 <= len(vs) <= 40]
pairs = collections.Counter()
for g in common:
    vs = sorted(grams[g])
    for a in vs:
        for b in vs:
            if a != b: pairs[(a, b)] += 1
sim = {}
for (a, b), c in pairs.items():
    la = len(NW[a[0] - 1][a[1] - 1])
    sim.setdefault(f"{a[0]}:{a[1]}", []).append((c, f"{b[0]}:{b[1]}", round(min(1, (c + N - 1) / max(la, 1)), 2)))
out = {k: [[v, s] for c, v, s in sorted(lst, key=lambda x: (-x[0], x[1]))[:6]] for k, lst in sim.items()}
print(f"verses with similar verses: {len(out)} of 6236")
(ROOT / "data/similar.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
