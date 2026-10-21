"""Convierte una píldora Markdown en el HTML del correo diario.

Uso:  python3 render_email.py pildoras/dia-01.md salida.html
Requiere: pip install markdown-it-py   (renderizado compatible con GitHub)
"""

import re
import sys
from pathlib import Path

from markdown_it import MarkdownIt

CSS = """
body{font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2328;max-width:760px;margin:auto}
pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto;font-size:12.5px;line-height:1.35}
code{font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f6f8fa;padding:1px 4px;border-radius:4px}
pre code{background:none;padding:0}
table{border-collapse:collapse;margin:10px 0;font-size:13.5px}
td,th{border:1px solid #d0d7de;padding:6px 8px;vertical-align:top}th{background:#f6f8fa}
blockquote{border-left:4px solid #d0d7de;margin:0;padding:4px 12px;color:#57606a}
h1{font-size:22px}h2{font-size:18px;border-bottom:1px solid #d0d7de;padding-bottom:4px}
"""

REPO = "https://github.com/Pepe-alms/AGENT4U/blob/aprendizaje/docs/aprendizaje"


def render(md_path: Path) -> str:
    md = md_path.read_text(encoding="utf-8")
    md = re.sub(r"^- \[ \] ", "- ☐ ", md, flags=re.M)  # checklists legibles en correo
    body = MarkdownIt("commonmark", {"linkify": False}).enable("table").render(md)
    rel = md_path.as_posix().split("docs/aprendizaje/")[-1]
    cabecera = (
        f'<p style="font-size:13px;color:#57606a">También en GitHub: '
        f'<a href="{REPO}/{rel}">{rel}</a> · <a href="{REPO}/PLAN.md">Plan completo</a></p>'
    )
    return f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{cabecera}{body}</body></html>"


if __name__ == "__main__":
    origen, destino = Path(sys.argv[1]), Path(sys.argv[2])
    destino.write_text(render(origen), encoding="utf-8")
    print(f"OK {destino} ({destino.stat().st_size} bytes)")
