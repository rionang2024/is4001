"""
Bundle index.html, its CSS/JS and the CSVs into one preview.html that opens by
double-clicking (no local server needed). Plotly, PapaParse and the font still load
from the internet. Re-run after the data or code changes:

    python scripts/build_preview.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")

def inline_css(match):
    return "<style>\n" + (ROOT / match.group(1)).read_text(encoding="utf-8") + "\n</style>"


html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, html)

csvs = {}
for name, rel in re.findall(r'(\w+): "(data/dashboard/[^"]+\.csv)"', (ROOT / "js/config.js").read_text()):
    csvs[name] = (ROOT / rel).read_text(encoding="utf-8")
embed = "<script>window.EMBEDDED_CSV = " + json.dumps(csvs) + ";</script>"


def inline(match):
    src = match.group(1)
    code = (ROOT / src).read_text(encoding="utf-8")
    extra = embed + "\n" if src == "js/data.js" else ""
    return f"{extra}<script>\n{code}\n</script>"


html = re.sub(r'<script src="(js/[^"]+)"></script>', inline, html)
(ROOT / "preview.html").write_text(html, encoding="utf-8")
print("wrote preview.html", round(len(html) / 1e6, 2), "MB")
