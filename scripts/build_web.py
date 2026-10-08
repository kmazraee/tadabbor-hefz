"""Build the two runnable copies of the prototype from the template + data.

  prototype/index.html                       -> web (GitHub Pages), fonts from Google Fonts
  android/app/src/main/assets/index.html     -> Android app, fonts bundled for offline use

Run from the repo root:  python3 scripts/build_web.py
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
tpl = (ROOT / "scripts/prototype_src.html").read_text(encoding="utf-8")
data = (ROOT / "data/juz30.json").read_text(encoding="utf-8")
assert "/*DATA*/" in tpl
body = tpl.replace("/*DATA*/", data)

HEAD = ('<!doctype html>\n<html lang="fa" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#1F4E79">\n')

# Split template: everything up to </style> belongs in <head>, the rest in <body>.
head_part, rest = body.split("</style>", 1)
head_part += "</style>\n"

web = HEAD + head_part + "</head>\n<body>\n" + rest + "\n</body>\n</html>\n"
(ROOT / "prototype/index.html").write_text(web, encoding="utf-8")

FACES = "\n".join(
    [f"@font-face{{font-family:'Vazirmatn';font-weight:{w};font-display:swap;"
     f"src:url('fonts/vazirmatn-arabic-{w}-normal.woff2') format('woff2');"
     f"unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}}\n"
     f"@font-face{{font-family:'Vazirmatn';font-weight:{w};font-display:swap;"
     f"src:url('fonts/vazirmatn-latin-{w}-normal.woff2') format('woff2')}}"
     for w in (400, 500, 700, 800)]
    + ["@font-face{font-family:'Amiri Quran';font-weight:400;font-display:swap;"
       "src:url('fonts/amiri-quran-arabic-400-normal.woff2') format('woff2')}"])

# Android: drop the Google Fonts links, use bundled fonts instead.
app_head = re.sub(r'<link rel="(preconnect|stylesheet)" href="https://fonts\.(googleapis|gstatic)\.com[^>]*>\n?', "", head_part)
assert "fonts.googleapis" not in app_head
app_head = app_head.replace("<style>", "<style>\n" + FACES + "\n", 1)
app = HEAD + app_head + "</head>\n<body>\n" + rest + "\n</body>\n</html>\n"
(ROOT / "android/app/src/main/assets/index.html").write_text(app, encoding="utf-8")
print("built prototype/index.html and android assets/index.html")
