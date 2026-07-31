#!/usr/bin/env python3
"""Build the ARIB television-symbol SVG and WOFF font subset."""

import argparse
from pathlib import Path
from xml.sax.saxutils import escape

from fontTools import subset
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "runtime" / "fonts"
CODEPOINTS = tuple(range(0x1F19B, 0x1F1AD))


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source_font",
        type=Path,
        help="OFL font containing U+1F19B through U+1F1AC",
    )
    return parser.parse_args()


def validate_source(font: TTFont):
    cmap = font.getBestCmap() or {}
    missing = [f"U+{codepoint:04X}" for codepoint in CODEPOINTS if codepoint not in cmap]
    if missing:
        raise SystemExit(f"source font is missing: {', '.join(missing)}")
    license_records = [
        record.toUnicode()
        for record in font["name"].names
        if record.nameID == 13
    ]
    if not any("SIL Open Font License" in value for value in license_records):
        raise SystemExit("source font does not declare the SIL Open Font License")


def build_svg(font: TTFont):
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    units_per_em = font["head"].unitsPerEm
    ascent = font["hhea"].ascent
    descent = font["hhea"].descent
    glyphs = []
    for codepoint in CODEPOINTS:
        glyph_name = cmap[codepoint]
        glyph = glyph_set[glyph_name]
        pen = SVGPathPen(glyph_set)
        glyph.draw(pen)
        path = pen.getCommands()
        glyphs.append(
            f'      <glyph glyph-name="u{codepoint:05X}" unicode="&#x{codepoint:X};" '
            f'horiz-adv-x="{round(glyph.width)}" d="{escape(path)}" />'
        )
    document = "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '  <defs>',
        f'    <font id="AribSymbols" horiz-adv-x="{units_per_em}">',
        f'      <font-face font-family="ARIB Symbols" units-per-em="{units_per_em}" '
        f'ascent="{ascent}" descent="{descent}" />',
        f'      <missing-glyph horiz-adv-x="{units_per_em}" />',
        *glyphs,
        '    </font>',
        '  </defs>',
        '</svg>',
        '',
    ])
    (OUTPUT / "arib-symbols.svg").write_text(document, encoding="utf-8")


def build_woff(source_font: Path):
    font = TTFont(source_font)
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.recalc_bounds = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=CODEPOINTS)
    subsetter.subset(font)
    font.flavor = "woff"
    font.save(OUTPUT / "arib-symbols.woff", reorderTables=False)


def main():
    args = arguments()
    font = TTFont(args.source_font)
    validate_source(font)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    build_svg(font)
    build_woff(args.source_font)


if __name__ == "__main__":
    main()
