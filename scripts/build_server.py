"""Build a ready-to-serve copy of the web app for your own server, in dist/ (or the folder given).

  python3 scripts/build_server.py [dist]

What the server then has to do is only send files: the page uses its own fonts (no Google Fonts),
every text file is stored next to a gzip (.gz) and a brotli (.br) copy so nginx sends those directly
(gzip_static / brotli_static) without compressing on each request, and sw.js keeps pages,
translations and search data on the reader's device so they are downloaded once.
See deploy/nginx.conf for the matching server configuration.
"""
import gzip, pathlib, shutil, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_web as web      # rebuilds prototype/ and the Android assets first

try:
    import brotli
except ImportError:
    brotli = None

ROOT = web.ROOT
OUT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "dist"
if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "data").mkdir(parents=True)

(OUT / "index.html").write_text(web.page("data/", True), encoding="utf-8")
(OUT / "sw.js").write_text(web.service_worker(), encoding="utf-8")
shutil.copy(ROOT / "privacy.html", OUT / "privacy.html")
shutil.copytree(ROOT / "android/app/src/main/assets/fonts", OUT / "fonts", ignore=shutil.ignore_patterns("LICENSE-*"))
for sub in ("pages", "trans"):
    shutil.copytree(ROOT / "data" / sub, OUT / "data" / sub)
for f in ("meta.json", "quran.json", "roots.json", "similar.json"):
    shutil.copy(ROOT / "data" / f, OUT / "data" / f)

raw = gz = br = 0
for f in sorted(OUT.rglob("*")):
    if f.suffix not in (".html", ".js", ".json", ".svg", ".css") or f.stat().st_size < 1024:
        continue
    b = f.read_bytes(); raw += len(b)
    z = gzip.compress(b, 9, mtime=0); gz += len(z)
    f.with_name(f.name + ".gz").write_bytes(z)
    if brotli:
        z = brotli.compress(b, quality=11); br += len(z)
        f.with_name(f.name + ".br").write_bytes(z)
mb = lambda n: f"{n / 1e6:.1f} MB"
print(f"built {OUT}: text files {mb(raw)}, gzip {mb(gz)}" + (f", brotli {mb(br)}" if brotli else " (pip install brotli for .br copies)"))
