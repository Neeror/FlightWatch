import re, pathlib
SPR = pathlib.Path("public/assets/icons.svg")
MAP = {"ic-recon":"public/orion.svg", "ic-molniya":"public/Молнія.svg",
       "ic-kab2":"public/Каб.svg", "ic-fpv":"public/ФПВ.svg", "ic-jet":"public/Герань-4.svg"}
src = SPR.read_text(encoding="utf-8")

def symbol(sid, path):
    s = pathlib.Path(path).read_text(encoding="utf-8")
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    inner = re.search(r'<svg[^>]*>(.*)</svg>', s, re.S).group(1)
    # неймспейсимо внутрішні id, інакше clipPath/gradient з різних файлів переб'ють один одного
    inner = re.sub(r'id="([^"]+)"', lambda m: f'id="{sid}-{m.group(1)}"', inner)
    inner = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{sid}-{m.group(1)})', inner)
    inner = re.sub(r'(xlink:href|href)="#([^"]+)"', lambda m: f'{m.group(1)}="#{sid}-{m.group(2)}"', inner)
    return f'<symbol id="{sid}" viewBox="{vb}">{inner}</symbol>'

for sid, path in MAP.items():
    new, pat = symbol(sid, path), re.compile(r'<symbol id="%s".*?</symbol>' % sid, re.S)
    src = pat.sub(lambda _: new, src) if pat.search(src) else src.replace("</svg>", new + "</svg>")
SPR.write_text(src, encoding="utf-8")