"""Build public/data/hs.json from HMRC's Combined Nomenclature 2026 file (the only source).

Codes are kept exactly as they appear in the file (7 or 8 digits, stored as numbers there).
Run: python3 scripts/build_hs.py ~/Documents/cn2026.ods
"""
import json, re, sys, zipfile

src = sys.argv[1]
x = zipfile.ZipFile(src).read("content.xml").decode()
codes = {}
for row in re.findall(r"<table:table-row[^>]*>(.*?)</table:table-row>", x, flags=re.S):
    cells = re.findall(r"<table:table-cell[^>]*?(?:/>|>(.*?)</table:table-cell>)", row, flags=re.S)
    text = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
    if len(text) >= 2 and text[0].isdigit():
        desc = " ".join(text[1].split())
        codes[text[0]] = desc
out = {
    "source": "HMRC, Combined Nomenclature 2026 (Crown copyright, Open Government Licence v3.0). Codes exactly as published.",
    "codes": codes,
}
json.dump(out, open("public/data/hs.json", "w"), separators=(",", ":"), ensure_ascii=False)
lens = {}
for k in codes: lens[len(k)] = lens.get(len(k), 0) + 1
print(len(codes), "codes", lens)
