#!/usr/bin/env python3
"""Build the ResearchMan overview / intro deck (.pptx) from a Markdown outline.

The outline text is NEVER altered here — this script only lays it out.
16 layouts are supported: cover / section / shot / shot-annotated /
shot-split / grid / flow / funnel / compare / stats / table / timeline /
bullets / legend / closing / case-detail.

Usage:
    uv run --with python-pptx --with pillow python scripts/build-overview-deck.py \
        --outline <path>.md --shots <dir> --out <path>.pptx

    # machine verification of the generated pptx (exit 0 = OK)
    uv run --with python-pptx --with pillow python scripts/build-overview-deck.py verify \
        --outline <path>.md --shots <dir> --out <path>.pptx

    # simple Pillow-rendered PNG preview per slide (no PowerPoint/LibreOffice needed)
    uv run --with python-pptx --with pillow python scripts/build-overview-deck.py preview \
        --outline <path>.md --shots <dir> --out <path>.pptx --preview <dir>

NOTE: scripts/build-ops-deck.py (a sibling script by the same author) is NOT
modified. A handful of small helpers (outline chunking approach, the
<a:ea>/<a:cs> font-injection helper, rectangle/text-box helpers) follow the
same pattern used there, rewritten for this deck's richer key set.
"""
from __future__ import annotations

import argparse
import math
import re
import sys
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.oxml.ns import qn

try:
    from PIL import Image as PILImage
    from PIL import ImageDraw, ImageFont
    try:
        _PIL_RESAMPLE = PILImage.Resampling.LANCZOS
    except AttributeError:  # older Pillow
        _PIL_RESAMPLE = PILImage.LANCZOS
except ImportError:  # pragma: no cover
    PILImage = None
    ImageDraw = None
    ImageFont = None
    _PIL_RESAMPLE = None

# --------------------------------------------------------------------------
# Design tokens
# --------------------------------------------------------------------------

SLIDE_W_IN, SLIDE_H_IN = 13.333, 7.5

PAPER = "EEECE7"
PAPER_SUBTLE = "F6F4EF"
WHITE = "FFFFFF"
INK = "111111"
RULE = "D6D1C7"
TEXT_1 = "111111"
TEXT_2 = "5F5A52"
TEXT_3 = "96907F"
ACCENT = "9C7A1F"
ACCENT_LT = "B08D2D"
SIGNAL = "C92018"
OK = "0E7D3D"
SECTION_NUM = "3A3733"
SECTION_SUB = "BFB9AE"

CAT_COLORS = {
    "SPATIAL_3D": "2456D4", "MOTION_BODY": "C92018", "GENVIDEO": "8A4BC9",
    "CREATORTOOLS": "F2C200", "AI_AGENTS": "0E7D3D", "HCI_MEDIAART": "E8651A",
    "AUDIO_MUSIC": "F0A1BD", "CASE_REMIX": "1F1F1F",
}

FONT = "Meiryo"
MARGIN_X = 0.62
MARGIN_TOP = 0.50
BOTTOM_MARGIN = 0.30

CONTENT_LEFT = MARGIN_X
CONTENT_WIDTH = SLIDE_W_IN - 2 * MARGIN_X


def RGB(hexstr: str) -> RGBColor:
    return RGBColor.from_string(hexstr)


DEFAULT_OUTLINE = str(
    Path(__file__).resolve().parent.parent / "docs" / "deck-outline.md"
)
DEFAULT_SHOTS = str(Path(__file__).resolve().parent.parent / "docs" / "shots")
DEFAULT_OUT = str(
    Path(__file__).resolve().parent.parent / "docs" / "ResearchMan_Overview_2026-09-08.pptx"
)

# --------------------------------------------------------------------------
# Outline parsing
# --------------------------------------------------------------------------

# A directive key line: ALL-CAPS identifier (letters/underscore) + ":" + value.
# Bullet lines ("- foo"), table rows ("| a | b |"), callout rows
# ("1 | 0.1,0.2 | ..") never match this, so they stay part of the previous
# directive's multi-line buffer.
DIRECTIVE_RE = re.compile(r"^([A-Z][A-Z_0-9]*):\s*(.*)$")


@dataclass
class Slide:
    number: int
    layout: str = ""
    raw: dict[str, list[str]] = field(default_factory=dict)

    def text(self, key: str, default: str = "") -> str:
        lines = self.raw.get(key)
        if not lines:
            return default
        return " ".join(x.strip() for x in lines if x.strip() != "" or True).strip()

    def lines(self, key: str) -> list[str]:
        return [ln for ln in self.raw.get(key, []) if ln.strip()]

    def has(self, key: str) -> bool:
        return key in self.raw and any(x.strip() for x in self.raw[key])


def parse_outline(path: Path) -> list[Slide]:
    text = path.read_text(encoding="utf-8")
    chunks = re.split(r"^## S(\d+)\s*$", text, flags=re.MULTILINE)
    slides: list[Slide] = []
    for i in range(1, len(chunks), 2):
        num = int(chunks[i])
        slides.append(_parse_slide(num, chunks[i + 1]))
    slides.sort(key=lambda s: s.number)
    return slides


def _parse_slide(number: int, text: str) -> Slide:
    slide = Slide(number=number)
    current: str | None = None
    buf: list[str] = []

    def flush():
        nonlocal current, buf
        if current is not None:
            slide.raw[current] = buf
        buf = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r")
        if line.strip() == "---":
            continue
        m = DIRECTIVE_RE.match(line)
        if m:
            flush()
            current = m.group(1)
            if current == "LAYOUT":
                slide.layout = m.group(2).strip()
                current = None
                continue
            inline = m.group(2).strip()
            buf = [inline] if inline else []
        else:
            if current is None:
                continue
            buf.append(line)
    flush()
    return slide


def _strip_bullet(line: str) -> str:
    return line.strip()[2:].strip() if line.strip().startswith("- ") else line.strip()


def parse_bullets(lines: list[str]) -> list[tuple[int, str]]:
    """2-level bullet parser: '-' = level0, '  -' (indent >= 2) = level1."""
    out: list[tuple[int, str]] = []
    for raw_line in lines:
        if not raw_line.strip():
            continue
        stripped = raw_line.lstrip(" ")
        indent = len(raw_line) - len(stripped)
        level = 1 if indent >= 2 else 0
        text = stripped[2:].strip() if stripped.startswith("- ") else stripped.strip()
        out.append((level, text))
    return out


def parse_pipe_row(line: str) -> list[str]:
    return [c.strip() for c in line.split("|")]


def parse_md_table(lines: list[str]) -> list[list[str]]:
    rows = []
    for ln in lines:
        if not ln.strip():
            continue
        # skip markdown separator rows like |---|---|
        if re.match(r"^\s*\|?\s*:?-{2,}", ln) and set(ln.replace("|", "").strip()) <= set("-: "):
            continue
        rows.append(parse_pipe_row(ln.strip().strip("|")))
    return rows


# --------------------------------------------------------------------------
# Font / text helpers
# --------------------------------------------------------------------------


def set_run_font(run, size=None, bold=None, color=None, italic=None, spacing_pt=None,
                  font_name=FONT):
    run.font.name = font_name
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = RGB(color) if isinstance(color, str) else color
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set("typeface", font_name)
    if spacing_pt is not None:
        rPr.set("spc", str(int(spacing_pt * 100)))


def _effective_len(text: str) -> float:
    """CJK/full-width glyphs ~1em wide; ASCII roughly half that."""
    return sum(1.0 if ord(ch) > 0x2E7F else 0.55 for ch in text)


def _line_count_for(text: str, font_size_pt: float, box_width_in: float) -> int:
    if not text:
        return 1
    box_width_pt = max(0.2, box_width_in) * 72.0
    chars_per_line = max(1.0, box_width_pt / (font_size_pt * 1.0))
    explicit_lines = text.split("\n")
    total = 0
    for ln in explicit_lines:
        total += max(1, math.ceil(_effective_len(ln) / chars_per_line))
    return max(1, total)


LineSpec = tuple[float, str]  # (font_size_pt, text)


def estimate_lines_height_pt(specs: list[LineSpec], box_width_in: float,
                              line_height_mult: float = 1.45, para_gap_ratio: float = 0.30) -> float:
    total = 0.0
    for size, text in specs:
        if not text:
            continue
        n = _line_count_for(text, size, box_width_in)
        total += n * size * line_height_mult + size * para_gap_ratio
    return total


def shrink_to_fit(make_specs, box_width_in: float, box_height_in: float,
                   base_size_pt: float, min_ratio: float = 0.70, step: float = 0.5):
    """make_specs(size)->list[LineSpec]. Returns (chosen_size, fits: bool)."""
    size = base_size_pt
    min_size = round(base_size_pt * min_ratio, 1)
    height_pt = box_height_in * 72.0
    best = min_size
    while size >= min_size - 1e-6:
        specs = make_specs(size)
        needed = estimate_lines_height_pt(specs, box_width_in)
        if needed <= height_pt:
            return round(size, 1), True
        best = size
        size -= step
    return min_size, False


# --------------------------------------------------------------------------
# Hanging-indent bullets (real a:pPr marL/indent, not literal leading spaces)
# --------------------------------------------------------------------------

# Widths are expressed as multiples of the paragraph's own font size ("em"),
# since python-pptx has no paragraph_format.left_indent/first_line_indent for
# this — the raw <a:pPr marL="…" indent="…"/> attributes are set directly
# (EMU; 1pt = 12700 EMU). The SAME ratios are used by write_bullets() (what
# actually gets drawn), estimate_bullets_height_pt() (the overflow check) and
# the Pillow preview's wrapping (_draw_paragraphs), so all three always agree.
BULLET_L0_MARKER_RATIO = 1.05  # "・" glyph + small gap, level 0
BULLET_L1_HANG_RATIO = 0.90    # "‑ " marker + gap, level 1


def bullet_indents_pt(level0_size_pt: float, level1_size_pt: float) -> tuple[float, float, float]:
    """Returns (marL0_pt, marL1_pt, hang1_pt).

    Level 0: marL0 = hang0; indent = -marL0 (marker sits at column 0, wrapped
    lines land at marL0).
    Level 1: marL1 = marL0 + hang1; indent = -hang1 (marker starts at column
    marL0, i.e. nested under level 0's text; wrapped lines land at marL1).
    """
    marL0 = level0_size_pt * BULLET_L0_MARKER_RATIO
    hang1 = level1_size_pt * BULLET_L1_HANG_RATIO
    marL1 = marL0 + hang1
    return marL0, marL1, hang1


def set_paragraph_indent(paragraph, marL_pt: float, indent_pt: float):
    """Inject marL/indent (hanging indent) into <a:pPr> directly, in EMU."""
    pPr = paragraph._p.get_or_add_pPr()
    pPr.set("marL", str(int(round(marL_pt * 12700))))
    pPr.set("indent", str(int(round(indent_pt * 12700))))


def estimate_bullets_height_pt(bullets: list[tuple[int, str]], base_size_pt: float,
                                box_width_in: float, sub_ratio: float = 0.85,
                                line_height_mult: float = 1.45,
                                para_gap_ratio: float = 0.30) -> float:
    """Same as estimate_lines_height_pt, but reduces the wrap width by each
    item's own hanging-indent marL (a conservative approximation: the real
    first line is slightly wider since indent is negative, but continuation
    lines are exactly this narrow — using the narrower width everywhere never
    under-estimates the needed height)."""
    lvl1_size = round(base_size_pt * sub_ratio, 1)
    marL0, marL1, _ = bullet_indents_pt(base_size_pt, lvl1_size)
    total = 0.0
    for level, text in bullets:
        if not text:
            continue
        size = base_size_pt if level == 0 else lvl1_size
        marL_in = (marL0 if level == 0 else marL1) / 72.0
        eff_w = max(0.3, box_width_in - marL_in)
        n = _line_count_for(text, size, eff_w)
        total += n * size * line_height_mult + size * para_gap_ratio
    return total


def shrink_bullets_to_fit(bullets: list[tuple[int, str]], box_width_in: float,
                           box_height_in: float, base_size_pt: float,
                           min_ratio: float = 0.70, step: float = 0.5,
                           sub_ratio: float = 0.85) -> tuple[float, bool]:
    """Bullet-aware counterpart of shrink_to_fit(): accounts for the hanging
    indent (see estimate_bullets_height_pt). Returns (chosen_size, fits)."""
    size = base_size_pt
    min_size = round(base_size_pt * min_ratio, 1)
    height_pt = box_height_in * 72.0
    while size >= min_size - 1e-6:
        needed = estimate_bullets_height_pt(bullets, size, box_width_in, sub_ratio=sub_ratio)
        if needed <= height_pt:
            return round(size, 1), True
        size -= step
    return min_size, False


# --------------------------------------------------------------------------
# Global collectors used by build + verify + preview
# --------------------------------------------------------------------------


@dataclass
class BuildReport:
    layout_counts: dict[str, int] = field(default_factory=dict)
    missing_images: list[tuple[int, str]] = field(default_factory=list)
    overflow: list[tuple[int, str]] = field(default_factory=list)  # (slide, role)
    boxes: list[tuple] = field(default_factory=list)  # (slide, role, kind, l, t, w, h)

    def reg(self, slide_num, role, kind, l, t, w, h):
        self.boxes.append((slide_num, role, kind, l, t, w, h))

    def note_overflow(self, slide_num, role):
        self.overflow.append((slide_num, role))

    def note_missing_image(self, slide_num, filename):
        self.missing_images.append((slide_num, filename))


# --------------------------------------------------------------------------
# Shape helpers
# --------------------------------------------------------------------------


def add_rect(slide, left, top, width, height, fill_color=None, line_color=None,
             line_w_pt=0.75, dash=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top),
                                  Inches(width), Inches(height))
    shp.shadow.inherit = False
    if fill_color is not None:
        shp.fill.solid()
        shp.fill.fore_color.rgb = RGB(fill_color)
    else:
        shp.fill.background()
    if line_color is not None:
        shp.line.color.rgb = RGB(line_color)
        shp.line.width = Pt(line_w_pt)
        if dash:
            ln = shp.line._get_or_add_ln()
            d = ln.makeelement(qn("a:prstDash"), {"val": dash})
            ln.append(d)
    else:
        shp.line.fill.background()
    return shp


def add_hline(slide, left, top, width, color=RULE, weight_pt=0.75):
    return add_rect(slide, left, top, width, weight_pt / 72.0, fill_color=color)


def add_vline(slide, left, top, height, color=RULE, weight_pt=0.75):
    return add_rect(slide, left, top, weight_pt / 72.0, height, fill_color=color)


def add_textbox(slide, left, top, width, height, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT):
    tb = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(max(width, 0.05)),
                                   Inches(max(height, 0.05)))
    tf = tb.text_frame
    tf.word_wrap = True
    try:
        tf.auto_size = None
    except Exception:
        pass
    tf.margin_left = Pt(1)
    tf.margin_right = Pt(1)
    tf.margin_top = Pt(1)
    tf.margin_bottom = Pt(1)
    tf.vertical_anchor = anchor
    return tb, tf


def write_single(tf, text, size, color=TEXT_1, bold=False, align=PP_ALIGN.LEFT,
                  spacing_pt=None, first=True):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    run = p.add_run()
    run.text = text
    set_run_font(run, size=size, bold=bold, color=color, spacing_pt=spacing_pt)
    return p


def write_bullets(tf, bullets, size, color=TEXT_1, sub_ratio=0.85, sub_color=None,
                   align=PP_ALIGN.LEFT):
    sub_color = sub_color or color
    lvl1_size = round(size * sub_ratio, 1)
    marL0, marL1, hang1 = bullet_indents_pt(size, lvl1_size)
    first = True
    for level, text in bullets:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = align
        p.space_after = Pt(4 if level else 7)
        run = p.add_run()
        prefix = "・" if level == 0 else "‑ "
        run.text = f"{prefix}{text}"
        this_size = size if level == 0 else lvl1_size
        set_run_font(run, size=this_size, color=color if level == 0 else sub_color)
        if level == 0:
            set_paragraph_indent(p, marL0, -marL0)
        else:
            set_paragraph_indent(p, marL1, -hang1)


FOOTER_TOP = SLIDE_H_IN - 0.34  # top edge of the page-number / "ResearchMan" footer row


def add_page_number(slide, number, report: BuildReport):
    w, h = 0.6, 0.3
    l, t = SLIDE_W_IN - MARGIN_X - w, FOOTER_TOP
    tb, tf = add_textbox(slide, l, t, w, h, anchor=MSO_ANCHOR.MIDDLE)
    write_single(tf, str(number), 8.5, color=TEXT_3, align=PP_ALIGN.RIGHT)
    report.reg(number, "page_number", "footer", l, t, w, h)

    l2, w2 = MARGIN_X, 1.6
    tb2, tf2 = add_textbox(slide, l2, t, w2, h, anchor=MSO_ANCHOR.MIDDLE)
    write_single(tf2, "ResearchMan", 8.5, color=TEXT_3)
    report.reg(number, "brand_footer", "footer", l2, t, w2, h)


def add_header(slide, s: Slide, report: BuildReport) -> float:
    """Eyebrow + rule + title + sub for all non-cover/section layouts.
    Returns the y (in) where content area starts."""
    top = MARGIN_TOP
    eyebrow = s.text("EYEBROW")
    if eyebrow:
        tb, tf = add_textbox(slide, CONTENT_LEFT, top, CONTENT_WIDTH, 0.24)
        write_single(tf, eyebrow.upper(), 9.5, color=ACCENT, bold=True, spacing_pt=2.2)
        report.reg(s.number, "eyebrow", "content", CONTENT_LEFT, top, CONTENT_WIDTH, 0.24)
        top += 0.30

    add_hline(slide, CONTENT_LEFT, top, CONTENT_WIDTH, color=RULE, weight_pt=0.75)
    top += 0.10

    title = s.text("TITLE")
    title_h = 0.50
    title_size, fits = shrink_to_fit(lambda sz: [(sz, title)], CONTENT_WIDTH, 0.62, 30, min_ratio=0.6)
    if not fits:
        report.note_overflow(s.number, "title")
    tb, tf = add_textbox(slide, CONTENT_LEFT, top, CONTENT_WIDTH, 0.62)
    write_single(tf, title, title_size, color=TEXT_1, bold=True, spacing_pt=-0.3)
    report.reg(s.number, "title", "content", CONTENT_LEFT, top, CONTENT_WIDTH, 0.62)
    top += 0.66

    sub = s.text("SUB")
    if sub:
        tb, tf = add_textbox(slide, CONTENT_LEFT, top, CONTENT_WIDTH, 0.34)
        write_single(tf, sub, 14, color=TEXT_2)
        report.reg(s.number, "sub", "content", CONTENT_LEFT, top, CONTENT_WIDTH, 0.34)
        top += 0.36

    return top + 0.08


NOTE_GAP_ABOVE_FOOTER = 0.12  # in — required clearance between NOTE's bottom edge and FOOTER_TOP
NOTE_GAP_ABOVE_CONTENT = 0.06
NOTE_DEFAULT_SIZE = 9.0
NOTE_MIN_SIZE = 8.0
NOTE_MAX_HEIGHT_IN = 0.62  # generous budget (~2-3 lines at 8-9pt) before flagging as overflow


def add_note(slide, s: Slide, report: BuildReport, bottom: float) -> float:
    """NOTE hugs its own real (possibly 2-line) height and is pinned so its
    bottom edge always stays >= NOTE_GAP_ABOVE_FOOTER above the footer row —
    it can never touch/overlap the page-number / "ResearchMan" footer text.
    If it doesn't fit even at NOTE_MIN_SIZE, this is reported via verify()
    instead of silently truncating the text."""
    note = s.text("NOTE")
    if not note:
        return bottom
    box_bottom = min(bottom, FOOTER_TOP - NOTE_GAP_ABOVE_FOOTER)

    size = NOTE_DEFAULT_SIZE
    h = estimate_lines_height_pt([(size, note)], CONTENT_WIDTH) / 72.0
    while h > NOTE_MAX_HEIGHT_IN and size > NOTE_MIN_SIZE - 1e-6:
        size = round(size - 0.5, 1)
        h = estimate_lines_height_pt([(size, note)], CONTENT_WIDTH) / 72.0
    if h > NOTE_MAX_HEIGHT_IN:
        report.note_overflow(s.number, "note")

    top = box_bottom - h
    tb, tf = add_textbox(slide, CONTENT_LEFT, top, CONTENT_WIDTH, h)
    write_single(tf, note, size, color=TEXT_3)
    report.reg(s.number, "note", "content", CONTENT_LEFT, top, CONTENT_WIDTH, h)
    return top - NOTE_GAP_ABOVE_CONTENT


def apply_speaker_note(slide, s: Slide):
    speaker = s.text("SPEAKER")
    if speaker:
        slide.notes_slide.notes_text_frame.text = speaker


# --------------------------------------------------------------------------
# Image resolution + placement (contain / cover, aspect-ratio preserved)
# --------------------------------------------------------------------------


def resolve_image(shots_dir: Path, filename: str) -> Path | None:
    if not filename:
        return None
    p = shots_dir / filename
    return p if p.is_file() else None


def image_size(path: Path) -> tuple[int, int] | None:
    if PILImage is None:
        return None
    try:
        with PILImage.open(path) as im:
            return im.size
    except Exception:
        return None


def add_placeholder(slide, left, top, width, height, filename, report: BuildReport, slide_num,
                     kind="image"):
    add_rect(slide, left, top, width, height, fill_color=PAPER_SUBTLE, line_color=RULE,
              line_w_pt=1.0, dash="dash")
    tb, tf = add_textbox(slide, left, top, width, height, anchor=MSO_ANCHOR.MIDDLE)
    write_single(tf, f"（画像なし: {filename}）", 10.5, color=TEXT_3, align=PP_ALIGN.CENTER)
    report.note_missing_image(slide_num, filename)
    report.reg(slide_num, f"image_placeholder:{filename}", kind, left, top, width, height)


def add_image_contain(slide, shots_dir: Path, filename: str, left, top, width, height,
                       report: BuildReport, slide_num, role="image", kind="image"):
    """Fit image inside box preserving aspect ratio (letterboxed, centered)."""
    path = resolve_image(shots_dir, filename)
    if path is None:
        add_placeholder(slide, left, top, width, height, filename, report, slide_num, kind=kind)
        return None
    size = image_size(path)
    if size is None:
        add_placeholder(slide, left, top, width, height, filename, report, slide_num, kind=kind)
        return None
    iw, ih = size
    box_ratio = width / height
    img_ratio = iw / ih
    if img_ratio > box_ratio:
        draw_w = width
        draw_h = width / img_ratio
    else:
        draw_h = height
        draw_w = height * img_ratio
    draw_l = left + (width - draw_w) / 2
    draw_t = top + (height - draw_h) / 2
    pic = slide.shapes.add_picture(str(path), Inches(draw_l), Inches(draw_t),
                                    Inches(draw_w), Inches(draw_h))
    report.reg(slide_num, role, "image", draw_l, draw_t, draw_w, draw_h)
    return pic


def add_image_cover(slide, shots_dir: Path, filename: str, left, top, width, height,
                     report: BuildReport, slide_num, role="cover_image", kind="image"):
    """Fill box fully preserving aspect ratio, cropping overflow via picture.crop_*.

    kind="bg" is used for full-bleed backgrounds (cover photo) that are
    intentionally outside the normal content margins and intentionally sit
    under the title/sub/meta text — both are excluded from the margin and
    overlap checks in verify() via this tag.
    """
    path = resolve_image(shots_dir, filename)
    if path is None:
        add_placeholder(slide, left, top, width, height, filename, report, slide_num, kind=kind)
        return None
    size = image_size(path)
    if size is None:
        add_placeholder(slide, left, top, width, height, filename, report, slide_num, kind=kind)
        return None
    iw, ih = size
    box_ratio = width / height
    img_ratio = iw / ih
    pic = slide.shapes.add_picture(str(path), Inches(left), Inches(top), Inches(width), Inches(height))
    if img_ratio > box_ratio:
        # image is wider than box -> crop left/right
        visible_frac = box_ratio / img_ratio
        crop = (1 - visible_frac) / 2
        pic.crop_left = crop
        pic.crop_right = crop
    else:
        # image is taller than box -> crop top/bottom
        visible_frac = img_ratio / box_ratio
        crop = (1 - visible_frac) / 2
        pic.crop_top = crop
        pic.crop_bottom = crop
    report.reg(slide_num, role, kind, left, top, width, height)
    return pic


# --------------------------------------------------------------------------
# Layout builders
# --------------------------------------------------------------------------


COVER_SPLIT_Y = 4.40  # in — hard split between the photo band and the INK panel
COVER_META_COLOR = "9A968E"  # PAPER at ~60% perceived lightness, used for META only


def build_cover(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    image = s.text("IMAGE")

    # Top band: full-bleed photo, cover-cropped, aspect ratio preserved.
    add_image_cover(slide, shots_dir, image, 0, 0, SLIDE_W_IN, COVER_SPLIT_Y, report, s.number,
                     role="cover_bg", kind="bg")

    # Bottom band: solid INK panel. Title/sub/meta live entirely inside it, so
    # they never compete with the busy photo for contrast (hard split instead
    # of a scrim).
    panel_top = COVER_SPLIT_Y
    panel_h = SLIDE_H_IN - panel_top
    add_rect(slide, 0, panel_top, SLIDE_W_IN, panel_h, fill_color=INK)

    # Accent rule right on the seam between photo and panel.
    line_w_pt = 3.0
    add_rect(slide, 0, panel_top - (line_w_pt / 72.0) / 2, SLIDE_W_IN, line_w_pt / 72.0,
              fill_color=ACCENT)

    pad = 0.38
    title_top = panel_top + pad
    title_h = 0.95
    title = s.text("TITLE")
    tb, tf = add_textbox(slide, CONTENT_LEFT, title_top, CONTENT_WIDTH, title_h)
    size, fits = shrink_to_fit(lambda sz: [(sz, title)], CONTENT_WIDTH, title_h, 46, min_ratio=0.6)
    if not fits:
        report.note_overflow(s.number, "cover_title")
    write_single(tf, title, size, color=PAPER, bold=True, spacing_pt=-0.5)
    report.reg(s.number, "title", "content", CONTENT_LEFT, title_top, CONTENT_WIDTH, title_h)

    sub_top = title_top + title_h + 0.10
    sub_h = 0.40
    sub = s.text("SUB")
    if sub:
        tb2, tf2 = add_textbox(slide, CONTENT_LEFT, sub_top, CONTENT_WIDTH, sub_h)
        write_single(tf2, sub, 16, color=PAPER)
        report.reg(s.number, "sub", "content", CONTENT_LEFT, sub_top, CONTENT_WIDTH, sub_h)

    meta_top = sub_top + sub_h + 0.26
    meta_h = 0.30
    meta = s.text("META")
    if meta:
        tb3, tf3 = add_textbox(slide, CONTENT_LEFT, meta_top, CONTENT_WIDTH, meta_h)
        write_single(tf3, meta, 10, color=COVER_META_COLOR)
        report.reg(s.number, "meta", "content", CONTENT_LEFT, meta_top, CONTENT_WIDTH, meta_h)

    apply_speaker_note(slide, s)
    return slide


def _set_fill_alpha(shape, alpha_pct: int):
    """Set solidFill alpha (0-100 -> looser opacity) via raw XML."""
    sp = shape.fill._xPr.find(qn("a:solidFill"))
    if sp is None:
        return
    srgb = sp.find(qn("a:srgbClr"))
    if srgb is None:
        return
    alpha_el = srgb.makeelement(qn("a:alpha"), {"val": str(alpha_pct * 1000)})
    srgb.append(alpha_el)


def build_section(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=INK)

    num = s.text("NUM")
    if num:
        tb, tf = add_textbox(slide, 0.55, 1.7, 3.6, 2.0, anchor=MSO_ANCHOR.TOP)
        write_single(tf, num, 120, color=SECTION_NUM, bold=True)
        report.reg(s.number, "num", "content", 0.55, 1.7, 3.6, 2.0)

    title = s.text("TITLE")
    title_box_h = 1.3
    title_top = 3.8
    tb2, tf2 = add_textbox(slide, 0.62, title_top, SLIDE_W_IN - 1.24, title_box_h)
    size, fits = shrink_to_fit(lambda sz: [(sz, title)], SLIDE_W_IN - 1.24, title_box_h, 46, min_ratio=0.6)
    if not fits:
        report.note_overflow(s.number, "section_title")
    write_single(tf2, title, size, color=PAPER, bold=True, spacing_pt=-0.5)
    report.reg(s.number, "title", "content", 0.62, title_top, SLIDE_W_IN - 1.24, title_box_h)

    top = title_top + title_box_h + 0.08
    sub = s.text("SUB")
    sub_h = 0.36
    if sub:
        tb3, tf3 = add_textbox(slide, 0.62, top, SLIDE_W_IN - 1.24, sub_h)
        write_single(tf3, sub, 15, color=SECTION_SUB)
        report.reg(s.number, "sub", "content", 0.62, top, SLIDE_W_IN - 1.24, sub_h)
        top += sub_h + 0.10

    items = s.lines("ITEMS")[:6]
    if items:
        items_bottom = SLIDE_H_IN - BOTTOM_MARGIN - 0.10
        items_h = max(0.3, items_bottom - top)
        item_bullets = [(0, _strip_bullet(it)) for it in items]
        size_items, fits_items = shrink_bullets_to_fit(
            item_bullets, SLIDE_W_IN - 1.24, items_h, 12, min_ratio=0.75)
        if not fits_items:
            report.note_overflow(s.number, "section_items")
        marL0_items, _, _ = bullet_indents_pt(size_items, size_items)
        tb4, tf4 = add_textbox(slide, 0.62, top, SLIDE_W_IN - 1.24, items_h)
        first = True
        for _, text in item_bullets:
            p = tf4.paragraphs[0] if first else tf4.add_paragraph()
            first = False
            p.space_after = Pt(4)
            run = p.add_run()
            run.text = f"・{text}"
            set_run_font(run, size=size_items, color=RGB(SECTION_SUB))
            set_paragraph_indent(p, marL0_items, -marL0_items)
        report.reg(s.number, "items", "content", 0.62, top, SLIDE_W_IN - 1.24, items_h)

    apply_speaker_note(slide, s)
    return slide


def build_shot(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    badges = s.text("BADGES")
    if badges:
        pills = [b.strip() for b in badges.split("|") if b.strip()]
        px = CONTENT_LEFT
        py = top
        for pill in pills:
            w = 0.16 + 0.085 * len(pill)
            add_rect(slide, px, py, w, 0.26, fill_color=PAPER_SUBTLE, line_color=RULE, line_w_pt=0.75)
            tb, tf = add_textbox(slide, px, py, w, 0.26, anchor=MSO_ANCHOR.MIDDLE)
            write_single(tf, pill, 9, color=TEXT_2, align=PP_ALIGN.CENTER)
            report.reg(s.number, f"badge:{pill}", "content", px, py, w, 0.26)
            px += w + 0.1
        top += 0.36

    caption = s.text("CAPTION")
    cap_h = 0.32 if caption else 0.0
    img_top = top
    img_bottom = content_bottom - cap_h - (0.06 if caption else 0.0)
    img_h = max(0.3, img_bottom - img_top)

    add_image_contain(slide, shots_dir, s.text("IMAGE"), CONTENT_LEFT, img_top, CONTENT_WIDTH,
                       img_h, report, s.number, role="shot_image")

    if caption:
        tb, tf = add_textbox(slide, CONTENT_LEFT, content_bottom - cap_h, CONTENT_WIDTH, cap_h,
                              anchor=MSO_ANCHOR.MIDDLE)
        write_single(tf, caption, 10.5, color=TEXT_2, align=PP_ALIGN.CENTER)
        report.reg(s.number, "caption", "content", CONTENT_LEFT, content_bottom - cap_h,
                    CONTENT_WIDTH, cap_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_shot_annotated(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    img_w = CONTENT_WIDTH * 0.62
    gap = CONTENT_WIDTH * 0.04
    list_w = CONTENT_WIDTH - img_w - gap
    img_h = content_bottom - top

    pic = add_image_contain(slide, shots_dir, s.text("IMAGE"), CONTENT_LEFT, top, img_w, img_h,
                             report, s.number, role="annotated_image")
    # actual drawn image bbox (registered as last box for this slide/role)
    img_box = next((b for b in reversed(report.boxes)
                     if b[0] == s.number and b[1] == "annotated_image"), None)
    if img_box:
        _, _, _, ail, ait, aiw, aih = img_box
    else:
        ail, ait, aiw, aih = CONTENT_LEFT, top, img_w, img_h

    callouts = []
    for ln in s.lines("CALLOUTS")[:10]:
        parts = [p.strip() for p in ln.split("|")]
        if len(parts) < 3:
            continue
        num = parts[0]
        try:
            x_norm, y_norm = (float(v) for v in parts[1].split(","))
        except ValueError:
            continue
        heading = parts[2]
        note = parts[3] if len(parts) > 3 else ""
        callouts.append((num, x_norm, y_norm, heading, note))

    marker_d = 0.30
    marker_r = marker_d / 2
    for num, xn, yn, heading, note in callouts:
        cx = ail + xn * aiw
        cy = ait + yn * aih
        # Clamp the circle's center so the marker never spills outside the image
        # rect (normalized coords near 0/1 would otherwise push it half off-canvas).
        # Clamp as little as possible: only push in from the edge the marker
        # would actually cross.
        if aiw >= marker_d:
            cx = min(max(cx, ail + marker_r), ail + aiw - marker_r)
        else:
            cx = ail + aiw / 2
        if aih >= marker_d:
            cy = min(max(cy, ait + marker_r), ait + aih - marker_r)
        else:
            cy = ait + aih / 2
        circ = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - marker_d / 2),
                                       Inches(cy - marker_d / 2), Inches(marker_d), Inches(marker_d))
        circ.shadow.inherit = False
        circ.fill.solid()
        circ.fill.fore_color.rgb = RGB(SIGNAL)
        circ.line.fill.background()
        add_shape_text(circ, num, size=11, bold=True, color=WHITE)
        report.reg(s.number, f"marker:{num}", "marker", cx - marker_d / 2, cy - marker_d / 2,
                    marker_d, marker_d)

    list_left = ail + aiw + gap
    list_top = top
    row_h = img_h / max(1, len(callouts))
    row_h = min(row_h, 0.9)
    cursor = list_top
    for num, xn, yn, heading, note in callouts:
        mini_d = 0.24
        circ = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(list_left), Inches(cursor + 0.02),
                                       Inches(mini_d), Inches(mini_d))
        circ.shadow.inherit = False
        circ.fill.solid()
        circ.fill.fore_color.rgb = RGB(SIGNAL)
        circ.line.fill.background()
        add_shape_text(circ, num, size=9, bold=True, color=WHITE)
        text_left = list_left + mini_d + 0.1
        text_w = list_w - mini_d - 0.1
        tb, tf = add_textbox(slide, text_left, cursor, text_w, row_h)
        heading_size, fits = shrink_to_fit(lambda sz: [(sz, heading)] + ([(sz * 0.86, note)] if note else []),
                                           text_w, row_h, 11, min_ratio=0.75)
        if not fits:
            report.note_overflow(s.number, f"callout:{num}")
        write_single(tf, heading, heading_size, color=TEXT_1, bold=True)
        if note:
            write_single(tf, note, round(heading_size * 0.86, 1), color=TEXT_2, first=False)
        report.reg(s.number, f"callout_text:{num}", "content", list_left, cursor, list_w, row_h)
        cursor += row_h
        if cursor < list_top + img_h - row_h * 0.4:
            add_hline(slide, list_left, cursor - 0.04, list_w, color=RULE, weight_pt=0.5)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def add_shape_text(shape, text, size=11, bold=False, color=WHITE, align=PP_ALIGN.CENTER):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = Pt(1)
    tf.margin_right = Pt(1)
    tf.margin_top = Pt(0)
    tf.margin_bottom = Pt(0)
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    set_run_font(run, size=size, bold=bold, color=color)


def build_shot_split(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    img_w = CONTENT_WIDTH * 0.54
    gap = CONTENT_WIDTH * 0.04
    body_w = CONTENT_WIDTH - img_w - gap
    box_h = content_bottom - top

    add_image_contain(slide, shots_dir, s.text("IMAGE"), CONTENT_LEFT, top, img_w, box_h, report,
                       s.number, role="split_image")

    bullets = parse_bullets(s.lines("BODY"))
    body_left = CONTENT_LEFT + img_w + gap
    size, fits = shrink_bullets_to_fit(bullets, body_w, box_h, 13, min_ratio=0.75)
    if not fits:
        report.note_overflow(s.number, "split_body")
    tb, tf = add_textbox(slide, body_left, top, body_w, box_h)
    write_bullets(tf, bullets, size, color=TEXT_1, sub_color=RGB(TEXT_2))
    report.reg(s.number, "split_body", "content", body_left, top, body_w, box_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


GRID_LAYOUTS = {2: (2, 1), 3: (3, 1), 4: (2, 2), 5: (3, 2), 6: (3, 2)}


GRID_LABEL_SIZE = 10
GRID_DESC_SIZE = 9
GRID_CARD_PAD = 0.12
GRID_GAP_IMG_TEXT = 0.07
GRID_GAP_LABEL_DESC = 0.02
GRID_PLACEHOLDER_HW_RATIO = 0.625  # fallback h/w when the image can't be read


def _grid_item_metrics(shots_dir: Path, fname: str, label: str, desc: str, img_area_w: float):
    """Natural (hug-content) sizes for one grid card, independent of row/scale."""
    path = resolve_image(shots_dir, fname) if fname else None
    size = image_size(path) if path else None
    if size:
        iw, ih = size
        img_h = img_area_w * ih / iw
    else:
        img_h = img_area_w * GRID_PLACEHOLDER_HW_RATIO
    label_h = estimate_lines_height_pt([(GRID_LABEL_SIZE, label)], img_area_w) / 72.0 if label else 0.0
    desc_h = estimate_lines_height_pt([(GRID_DESC_SIZE, desc)], img_area_w) / 72.0 if desc else 0.0
    fixed_h = 2 * GRID_CARD_PAD
    if label or desc:
        fixed_h += GRID_GAP_IMG_TEXT
    if label and desc:
        fixed_h += GRID_GAP_LABEL_DESC
    fixed_h += label_h + desc_h
    return {"img_h": img_h, "label_h": label_h, "desc_h": desc_h, "fixed_h": fixed_h}


def build_grid(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    items = []
    for ln in s.lines("IMAGES"):
        parts = [p.strip() for p in ln.split("|")]
        while len(parts) < 3:
            parts.append("")
        items.append(tuple(parts[:3]))

    n = len(items)
    cols, rows = GRID_LAYOUTS.get(n, (3, math.ceil(n / 3) if n else 1))
    gap = 0.2
    cell_w = (CONTENT_WIDTH - gap * (cols - 1)) / cols
    img_area_w = cell_w - 2 * GRID_CARD_PAD
    available_h = content_bottom - top

    # Cards hug their content: height = padding + real (contain-fit) image
    # height + label + description, each measured at its real font size/width.
    metrics = [_grid_item_metrics(shots_dir, fname, label, desc, img_area_w)
               for fname, label, desc in items]

    row_img_max = [0.0] * rows
    row_fixed_max = [0.0] * rows
    for idx, m in enumerate(metrics):
        r = idx // cols
        row_img_max[r] = max(row_img_max[r], m["img_h"])
        row_fixed_max[r] = max(row_fixed_max[r], m["fixed_h"])

    total_fixed = sum(row_fixed_max) + gap * (rows - 1)
    total_img = sum(row_img_max)
    total_natural = total_fixed + total_img

    scale = 1.0
    if total_natural > available_h + 1e-6:
        # Rows are taller than the available area: shrink every image by the
        # same factor (aspect ratio preserved) until the block fits. Text is
        # never shrunk to make room for images.
        avail_for_img = available_h - total_fixed
        if avail_for_img <= 0:
            report.note_overflow(s.number, "grid_rows")
            scale = 0.0
        else:
            scale = max(0.0, avail_for_img / total_img) if total_img > 0 else 1.0

    row_img_h = [row_img_max[r] * scale for r in range(rows)]  # shared H_row per row
    row_heights = [row_fixed_max[r] + row_img_h[r] for r in range(rows)]
    # Top-aligned: cards sit directly below the header/sub. Any leftover space
    # (block shorter than the available area) falls below the grid instead of
    # being centered — a centered block reads as "sinking" under the subtitle.
    grid_top = top

    cursor_y = grid_top
    for r in range(rows):
        row_h = row_heights[r]
        img_h = row_img_h[r]  # every card in the row shares this image-box height,
        # so mixed aspect ratios (wide screenshot next to a very tall full-page
        # shot) never leave one card shorter than its row-mates.
        for c in range(cols):
            idx = r * cols + c
            if idx >= n:
                continue
            fname, label, desc = items[idx]
            cl = CONTENT_LEFT + c * (cell_w + gap)
            ct = cursor_y
            add_rect(slide, cl, ct, cell_w, row_h, fill_color=WHITE, line_color=RULE, line_w_pt=0.75)

            # Each image is contained (aspect preserved) into the SAME
            # img_area_w x img_h box and centered within it — wide images are
            # width-limited (centered vertically), tall/portrait images are
            # height-limited and narrower than img_area_w (centered
            # horizontally, per the coordinator's spec).
            add_image_contain(slide, shots_dir, fname, cl + GRID_CARD_PAD, ct + GRID_CARD_PAD,
                               img_area_w, img_h, report, s.number, role=f"grid_image:{idx}")

            text_top = ct + GRID_CARD_PAD + img_h
            if label or desc:
                text_top += GRID_GAP_IMG_TEXT
            text_bottom = ct + row_h - GRID_CARD_PAD
            text_h = max(0.05, text_bottom - text_top)
            tb, tf = add_textbox(slide, cl + GRID_CARD_PAD, text_top, img_area_w, text_h)
            if label:
                write_single(tf, label, GRID_LABEL_SIZE, color=TEXT_1, bold=True)
            if desc:
                write_single(tf, desc, GRID_DESC_SIZE, color=TEXT_2, first=not label)
            report.reg(s.number, f"grid_text:{idx}", "content", cl + GRID_CARD_PAD, text_top,
                       img_area_w, text_h)
        cursor_y += row_h + gap

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def _text_color_for_bg(hexstr: str) -> str:
    r, g, b = int(hexstr[0:2], 16), int(hexstr[2:4], 16), int(hexstr[4:6], 16)
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return INK if luminance > 150 else WHITE


def _lerp_color(c1: str, c2: str, t: float) -> str:
    r1, g1, b1 = int(c1[0:2], 16), int(c1[2:4], 16), int(c1[4:6], 16)
    r2, g2, b2 = int(c2[0:2], 16), int(c2[2:4], 16), int(c2[4:6], 16)
    r = int(r1 + (r2 - r1) * t)
    g = int(g1 + (g2 - g1) * t)
    b = int(b1 + (b2 - b1) * t)
    return f"{r:02X}{g:02X}{b:02X}"


def build_flow(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    steps = []
    for ln in s.lines("STEPS"):
        parts = [p.strip() for p in ln.split("|")]
        while len(parts) < 2:
            parts.append("")
        steps.append((parts[0], parts[1]))
    n = len(steps)
    lane = s.text("LANE")
    lane_h = 0.4 if lane else 0.0
    avail_h = content_bottom - top - lane_h

    if n <= 5:
        gap = 0.35
        box_w = (CONTENT_WIDTH - gap * (n - 1)) / n
        box_h = min(avail_h, 1.7)
        box_top = top + (avail_h - box_h) / 2
        centers = []
        for i, (heading, desc) in enumerate(steps):
            bl = CONTENT_LEFT + i * (box_w + gap)
            add_rect(slide, bl, box_top, box_w, box_h, fill_color=WHITE, line_color=RULE, line_w_pt=0.75)
            tb, tf = add_textbox(slide, bl + 0.08, box_top + 0.08, box_w - 0.16, box_h - 0.16,
                                  anchor=MSO_ANCHOR.MIDDLE)
            size, fits = shrink_to_fit(lambda sz: [(sz, heading), (sz * 0.83, desc)],
                                       box_w - 0.16, box_h - 0.16, 11.5, min_ratio=0.75)
            if not fits:
                report.note_overflow(s.number, f"flow_step:{i+1}")
            write_single(tf, heading, size, color=TEXT_1, bold=True, align=PP_ALIGN.CENTER)
            write_single(tf, desc, round(size * 0.83, 1), color=TEXT_2, align=PP_ALIGN.CENTER, first=False)
            report.reg(s.number, f"flow_step:{i+1}", "content", bl, box_top, box_w, box_h)
            centers.append((bl, box_top, box_w, box_h))
            if i < n - 1:
                _draw_h_arrow(slide, bl + box_w, box_top + box_h / 2, gap)
        if lane:
            lane_top = box_top + box_h + 0.1
            add_dashed_feedback(slide, centers, lane_top, lane, report, s.number)
    else:
        row1 = steps[: math.ceil(n / 2)]
        row2 = steps[math.ceil(n / 2):]
        gap = 0.3
        row_gap = 0.3 if not lane else 0.24
        row_h = min((avail_h - row_gap) / 2, 1.5)
        last_row_boxes: list[tuple[float, float, float, float]] = []
        for row_idx, row in enumerate([row1, row2]):
            m = len(row)
            box_w = (CONTENT_WIDTH - gap * (m - 1)) / m
            box_top = top + row_idx * (row_h + row_gap)
            for i, (heading, desc) in enumerate(row):
                bl = CONTENT_LEFT + i * (box_w + gap)
                add_rect(slide, bl, box_top, box_w, row_h, fill_color=WHITE, line_color=RULE, line_w_pt=0.75)
                tb, tf = add_textbox(slide, bl + 0.06, box_top + 0.06, box_w - 0.12, row_h - 0.12,
                                      anchor=MSO_ANCHOR.MIDDLE)
                size, fits = shrink_to_fit(lambda sz: [(sz, heading), (sz * 0.83, desc)],
                                           box_w - 0.12, row_h - 0.12, 11.5, min_ratio=0.7)
                if not fits:
                    report.note_overflow(s.number, f"flow_step_r{row_idx}:{i+1}")
                write_single(tf, heading, size, color=TEXT_1, bold=True, align=PP_ALIGN.CENTER)
                write_single(tf, desc, round(size * 0.83, 1), color=TEXT_2, align=PP_ALIGN.CENTER, first=False)
                report.reg(s.number, f"flow_step_r{row_idx}:{i+1}", "content", bl, box_top, box_w, row_h)
                if i < m - 1:
                    _draw_h_arrow(slide, bl + box_w, box_top + row_h / 2, gap)
                if row_idx == 1:
                    last_row_boxes.append((bl, box_top, box_w, row_h))
        # fold arrow: end of row1 down to start of row2 (right edge -> right edge)
        row1_m = len(row1)
        row1_w = (CONTENT_WIDTH - gap * (row1_m - 1)) / row1_m
        fold_x = CONTENT_LEFT + row1_m * row1_w + (row1_m - 1) * gap - 0.02
        _draw_v_arrow(slide, fold_x, top + row_h, row_gap)
        if lane and last_row_boxes:
            lane_top = last_row_boxes[0][1] + last_row_boxes[0][3] + 0.1
            add_dashed_feedback(slide, last_row_boxes, lane_top, lane, report, s.number)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def _draw_h_arrow(slide, x, y, gap_w):
    line = add_rect(slide, x + gap_w * 0.12, y - 0.008, gap_w * 0.66, 0.016, fill_color=ACCENT)
    tri = slide.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(x + gap_w * 0.76), Inches(y - 0.06),
                                  Inches(0.12), Inches(0.12))
    tri.rotation = 90
    tri.shadow.inherit = False
    tri.fill.solid()
    tri.fill.fore_color.rgb = RGB(ACCENT)
    tri.line.fill.background()


def _draw_v_arrow(slide, x, y, h):
    add_rect(slide, x - 0.008, y, 0.016, h * 0.75, fill_color=ACCENT)
    tri = slide.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(x - 0.06), Inches(y + h * 0.72),
                                  Inches(0.12), Inches(0.12))
    tri.rotation = 180
    tri.shadow.inherit = False
    tri.fill.solid()
    tri.fill.fore_color.rgb = RGB(ACCENT)
    tri.line.fill.background()


def add_dashed_feedback(slide, centers, lane_top, lane_text, report, slide_num):
    x1 = centers[-1][0] + centers[-1][2] / 2
    x0 = centers[0][0] + centers[0][2] / 2
    y = lane_top
    shp = slide.shapes.add_connector(2, Inches(x1), Inches(y), Inches(x0), Inches(y))
    shp.line.color.rgb = RGB(TEXT_3)
    shp.line.width = Pt(1.0)
    ln = shp.line._get_or_add_ln()
    d = ln.makeelement(qn("a:prstDash"), {"val": "dash"})
    ln.append(d)
    tb, tf = add_textbox(slide, x0, y + 0.03, x1 - x0, 0.3, align=PP_ALIGN.CENTER)
    write_single(tf, lane_text, 10, color=TEXT_3, align=PP_ALIGN.CENTER)
    report.reg(slide_num, "flow_lane", "content", x0, y, x1 - x0, 0.3)


def build_funnel(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    steps = []
    for ln in s.lines("STEPS"):
        parts = [p.strip() for p in ln.split("|")]
        while len(parts) < 3:
            parts.append("")
        steps.append(tuple(parts[:3]))
    n = len(steps)
    drops = []
    for ln in s.lines("DROPS"):
        drops.extend([d.strip() for d in ln.split("/") if d.strip()])

    right_w = CONTENT_WIDTH * 0.24 if drops else 0.0
    funnel_w_max = CONTENT_WIDTH - right_w - (0.3 if drops else 0.0)
    gap = 0.12
    row_h = (content_bottom - top - gap * (n - 1)) / n

    for i, (label, cond, desc) in enumerate(steps):
        t_ratio = i / max(1, n - 1)
        width_ratio = 1.0 - 0.42 * t_ratio
        row_w = funnel_w_max * width_ratio
        row_left = CONTENT_LEFT + (funnel_w_max - row_w) / 2
        row_top = top + i * (row_h + gap)
        color = _lerp_color(ACCENT, TEXT_3, t_ratio)
        add_rect(slide, row_left, row_top, row_w, row_h, fill_color=color)
        text_color = _text_color_for_bg(color)
        tb, tf = add_textbox(slide, row_left + 0.12, row_top, row_w - 0.24, row_h,
                              anchor=MSO_ANCHOR.MIDDLE)
        combined = f"{label}　{cond}" if cond else label
        size, fits = shrink_to_fit(lambda sz: [(sz, combined), (sz * 0.82, desc)],
                                   row_w - 0.24, row_h, 12, min_ratio=0.7)
        if not fits:
            report.note_overflow(s.number, f"funnel_step:{i+1}")
        write_single(tf, combined, size, color=text_color, bold=True)
        if desc:
            write_single(tf, desc, round(size * 0.82, 1), color=text_color, first=False)
        report.reg(s.number, f"funnel_step:{i+1}", "content", row_left, row_top, row_w, row_h)

    if drops:
        dx = CONTENT_LEFT + funnel_w_max + 0.3
        tb, tf = add_textbox(slide, dx, top, right_w, 0.24)
        write_single(tf, "落ちたもの", 9.5, color=SIGNAL, bold=True)
        report.reg(s.number, "drops_label", "content", dx, top, right_w, 0.24)
        dy = top + 0.3
        for i, d in enumerate(drops[:8]):
            tb2, tf2 = add_textbox(slide, dx, dy, right_w, 0.26)
            write_single(tf2, f"× {d}", 10, color=SIGNAL)
            report.reg(s.number, f"drop:{i+1}", "content", dx, dy, right_w, 0.26)
            dy += 0.28

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_compare(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    col_gap = 0.16
    col_w = (CONTENT_WIDTH - col_gap) / 2
    header_h = 0.5

    for idx, side in enumerate(("A", "B")):
        cl = CONTENT_LEFT + idx * (col_w + col_gap)
        col_title = s.text(f"COL_{side}_TITLE")
        col_tag = s.text(f"COL_{side}_TAG")
        add_rect(slide, cl, top, col_w, header_h, fill_color=INK)
        tb, tf = add_textbox(slide, cl + 0.14, top, col_w - 0.28, header_h, anchor=MSO_ANCHOR.MIDDLE)
        write_single(tf, col_title, 14, color=PAPER, bold=True)
        if col_tag:
            tb2, tf2 = add_textbox(slide, cl + col_w - 1.3, top + 0.06, 1.16, 0.24)
            write_single(tf2, col_tag, 8.5, color=RGB(ACCENT_LT), align=PP_ALIGN.RIGHT)
        report.reg(s.number, f"col_{side}_header", "content", cl, top, col_w, header_h)

        bullets = parse_bullets(s.lines(f"COL_{side}"))
        body_top = top + header_h + 0.14
        body_h = content_bottom - body_top
        size, fits = shrink_bullets_to_fit(bullets, col_w, body_h, 13, min_ratio=0.7)
        if not fits:
            report.note_overflow(s.number, f"compare_col_{side}")
        tb3, tf3 = add_textbox(slide, cl, body_top, col_w, body_h)
        write_bullets(tf3, bullets, size, color=TEXT_1, sub_color=RGB(TEXT_2))
        report.reg(s.number, f"col_{side}_body", "content", cl, body_top, col_w, body_h)

    mid_x = CONTENT_LEFT + col_w + col_gap / 2
    add_vline(slide, mid_x, top, content_bottom - top, color=RULE, weight_pt=0.75)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_stats(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    stats = []
    for ln in s.lines("STATS"):
        parts = [p.strip() for p in ln.split("|")]
        while len(parts) < 4:
            parts.append("")
        stats.append(tuple(parts[:4]))
    n = len(stats)
    col_w = CONTENT_WIDTH / n
    box_h = content_bottom - top

    for i, (value, unit, label, note) in enumerate(stats):
        cl = CONTENT_LEFT + i * col_w
        pad = 0.18
        tb, tf = add_textbox(slide, cl + pad, top, col_w - 2 * pad, box_h)
        value_text = f"{value}{unit}" if unit else value
        v_size, fits = shrink_to_fit(lambda sz: [(sz, value)], col_w - 2 * pad, box_h * 0.5, 54,
                                     min_ratio=0.6)
        if not fits:
            report.note_overflow(s.number, f"stat_value:{i+1}")
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = value
        set_run_font(run, size=v_size, bold=True, color=INK, spacing_pt=-1.0)
        if unit:
            run2 = p.add_run()
            run2.text = f" {unit}"
            set_run_font(run2, size=v_size * 0.3, color=RGB(TEXT_2))
        p2 = tf.add_paragraph()
        p2.space_before = Pt(6)
        run3 = p2.add_run()
        run3.text = label
        set_run_font(run3, size=11, bold=True, color=INK)
        if note:
            p3 = tf.add_paragraph()
            p3.space_before = Pt(2)
            run4 = p3.add_run()
            run4.text = note
            set_run_font(run4, size=9.5, color=RGB(TEXT_2))
        report.reg(s.number, f"stat:{i+1}", "content", cl + pad, top, col_w - 2 * pad, box_h)
        if i < n - 1:
            add_vline(slide, cl + col_w, top, box_h, color=RULE, weight_pt=0.75)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_table(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    rows = parse_md_table(s.lines("TABLE"))
    if not rows:
        add_page_number(slide, s.number, report)
        return slide
    n_rows = len(rows)
    n_cols = len(rows[0])
    box_h = content_bottom - top

    font_size = 10.5
    for candidate in (10.5, 10, 9.5, 9, 8.5, 8):
        row_h_needed = candidate * 2.4
        if row_h_needed * n_rows <= box_h * 72.0:
            font_size = candidate
            break
    else:
        font_size = 8
        report.note_overflow(s.number, "table")

    gfx = slide.shapes.add_table(n_rows, n_cols, Inches(CONTENT_LEFT), Inches(top),
                                  Inches(CONTENT_WIDTH), Inches(box_h))
    table = gfx.table
    max_len = [1] * n_cols
    for row in rows:
        for c, cell in enumerate(row):
            if c < n_cols:
                max_len[c] = max(max_len[c], _effective_len(cell))
    total = sum(max_len)
    for c in range(n_cols):
        table.columns[c].width = Emu(int(CONTENT_WIDTH * (max_len[c] / total) * 914400))
    row_h = Emu(int((box_h / n_rows) * 914400))
    for r in range(n_rows):
        table.rows[r].height = row_h
        for c in range(n_cols):
            cell = table.cell(r, c)
            cell.margin_left = Pt(4)
            cell.margin_right = Pt(4)
            cell.margin_top = Pt(2)
            cell.margin_bottom = Pt(2)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            run = p.add_run()
            run.text = rows[r][c] if c < len(rows[r]) else ""
            if r == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGB(INK)
                set_run_font(run, size=10.5, bold=True, color=WHITE)
            else:
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGB(PAPER_SUBTLE) if r % 2 == 1 else RGB(WHITE)
                set_run_font(run, size=font_size, color=RGB(TEXT_1))
    report.reg(s.number, "table", "content", CONTENT_LEFT, top, CONTENT_WIDTH, box_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_timeline(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    events = []
    for ln in s.lines("EVENTS")[:10]:
        parts = [p.strip() for p in ln.split("|")]
        while len(parts) < 3:
            parts.append("")
        events.append(tuple(parts[:3]))
    n = len(events)
    axis_x = CONTENT_LEFT + 1.05
    row_h = (content_bottom - top) / max(1, n)

    add_vline(slide, axis_x, top, content_bottom - top, color=RULE, weight_pt=1.0)

    for i, (date, happened, mechanism) in enumerate(events):
        row_top = top + i * row_h
        dot_d = 0.14
        dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(axis_x - dot_d / 2),
                                      Inches(row_top + 0.06), Inches(dot_d), Inches(dot_d))
        dot.shadow.inherit = False
        dot.fill.solid()
        dot.fill.fore_color.rgb = RGB(SIGNAL)
        dot.line.fill.background()

        tb, tf = add_textbox(slide, CONTENT_LEFT, row_top, 0.95, row_h, anchor=MSO_ANCHOR.TOP)
        write_single(tf, date, 9.5, color=TEXT_3, bold=True)

        text_left = axis_x + 0.2
        text_w = CONTENT_LEFT + CONTENT_WIDTH - text_left
        tb2, tf2 = add_textbox(slide, text_left, row_top, text_w, row_h)
        happened_text = happened
        mech_text = f"→ {mechanism}" if mechanism else ""
        size, fits = shrink_to_fit(lambda sz: [(sz, happened_text), (sz * 0.86, mech_text)],
                                   text_w, row_h, 11, min_ratio=0.75)
        if not fits:
            report.note_overflow(s.number, f"timeline_event:{i+1}")
        write_single(tf2, happened_text, size, color=TEXT_1)
        if mech_text:
            write_single(tf2, mech_text, round(size * 0.86, 1), color=RGB(OK), first=False)
        report.reg(s.number, f"event:{i+1}", "content", text_left, row_top, text_w, row_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_bullets(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    bullets = parse_bullets(s.lines("BODY"))
    box_h = content_bottom - top
    size, fits = shrink_bullets_to_fit(bullets, CONTENT_WIDTH, box_h, 16, min_ratio=0.7)
    if not fits:
        report.note_overflow(s.number, "bullets_body")
    tb, tf = add_textbox(slide, CONTENT_LEFT, top, CONTENT_WIDTH, box_h)
    write_bullets(tf, bullets, size, color=TEXT_1, sub_color=RGB(TEXT_2))
    report.reg(s.number, "bullets_body", "content", CONTENT_LEFT, top, CONTENT_WIDTH, box_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_legend(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    top = add_header(slide, s, report)
    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    items = []
    for ln in s.lines("ITEMS"):
        parts = [p.strip() for p in ln.split("|")]
        while len(parts) < 3:
            parts.append("")
        items.append(tuple(parts[:3]))
    n = len(items)
    cols = 2 if n > 4 else 1
    rows = math.ceil(n / cols)
    col_w = CONTENT_WIDTH / cols
    row_h = min(0.62, (content_bottom - top) / max(1, rows))

    for i, (key, label, desc) in enumerate(items):
        r, c = divmod(i, cols)
        cl = CONTENT_LEFT + c * col_w
        ct = top + r * row_h
        chip_color = CAT_COLORS.get(key, TEXT_3)
        add_rect(slide, cl, ct + 0.06, 0.22, 0.22, fill_color=chip_color)
        tb, tf = add_textbox(slide, cl + 0.32, ct, col_w - 0.4, row_h)
        write_single(tf, label, 11.5, color=TEXT_1, bold=True)
        if desc:
            desc_size, fits = shrink_to_fit(lambda sz: [(sz, desc)], col_w - 0.4, row_h - 0.24, 10,
                                             min_ratio=0.75)
            if not fits:
                report.note_overflow(s.number, f"legend_desc:{i+1}")
            write_single(tf, desc, desc_size, color=TEXT_2, first=False)
        report.reg(s.number, f"legend_item:{i+1}", "content", cl, ct, col_w, row_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


def build_closing(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)
    add_hline(slide, 0, MARGIN_TOP - 0.06, SLIDE_W_IN, color=INK, weight_pt=2.0)
    bottom_rule_y = SLIDE_H_IN - 0.6
    add_hline(slide, 0, bottom_rule_y, SLIDE_W_IN, color=INK, weight_pt=2.0)

    title = s.text("TITLE")
    title_h = 1.0
    tb, tf = add_textbox(slide, CONTENT_LEFT, 1.1, CONTENT_WIDTH, title_h)
    size, fits = shrink_to_fit(lambda sz: [(sz, title)], CONTENT_WIDTH, title_h, 34, min_ratio=0.6)
    if not fits:
        report.note_overflow(s.number, "closing_title")
    write_single(tf, title, size, color=TEXT_1, bold=True)
    report.reg(s.number, "title", "content", CONTENT_LEFT, 1.1, CONTENT_WIDTH, title_h)

    bullets = parse_bullets(s.lines("BODY"))
    body_top = 2.2
    body_h = 2.6
    b_size, fits = shrink_bullets_to_fit(bullets, CONTENT_WIDTH, body_h, 15, min_ratio=0.7)
    if not fits:
        report.note_overflow(s.number, "closing_body")
    tb2, tf2 = add_textbox(slide, CONTENT_LEFT, body_top, CONTENT_WIDTH, body_h)
    write_bullets(tf2, bullets, b_size, color=TEXT_1, sub_color=RGB(TEXT_2))
    report.reg(s.number, "closing_body", "content", CONTENT_LEFT, body_top, CONTENT_WIDTH, body_h)

    url = s.text("URL")
    if url:
        tb3, tf3 = add_textbox(slide, CONTENT_LEFT, SLIDE_H_IN - 1.15, CONTENT_WIDTH, 0.5)
        write_single(tf3, url, 16, color=RGB(ACCENT), bold=True)
        report.reg(s.number, "url", "content", CONTENT_LEFT, SLIDE_H_IN - 1.15, CONTENT_WIDTH, 0.5)

    note = s.text("NOTE")
    if note:
        note_box_bottom = FOOTER_TOP - NOTE_GAP_ABOVE_FOOTER
        note_size = NOTE_DEFAULT_SIZE
        note_h = estimate_lines_height_pt([(note_size, note)], CONTENT_WIDTH) / 72.0
        while note_h > NOTE_MAX_HEIGHT_IN and note_size > NOTE_MIN_SIZE - 1e-6:
            note_size = round(note_size - 0.5, 1)
            note_h = estimate_lines_height_pt([(note_size, note)], CONTENT_WIDTH) / 72.0
        if note_h > NOTE_MAX_HEIGHT_IN:
            report.note_overflow(s.number, "note")
        note_top = max(bottom_rule_y + 0.08, note_box_bottom - note_h)
        tb4, tf4 = add_textbox(slide, CONTENT_LEFT, note_top, CONTENT_WIDTH, note_h)
        write_single(tf4, note, note_size, color=TEXT_3)
        report.reg(s.number, "note", "content", CONTENT_LEFT, note_top, CONTENT_WIDTH, note_h)

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


# --------------------------------------------------------------------------
# case-detail: one Cannes work per slide (title, awards, thumbnail, meta,
# 4-section body). See docs-level spec (CASE_DETAIL_SPEC.md) for the layout
# diagram this follows.
# --------------------------------------------------------------------------

AWARD_LEVEL_COLORS = {
    "GRAND PRIX": (INK, WHITE),
    "TITANIUM": (INK, WHITE),
    "GOLD": (ACCENT_LT, WHITE),
    "SILVER": ("8A8A8A", WHITE),
    "BRONZE": ("9C6B3F", WHITE),
}
AWARD_LEVEL_FALLBACK = ("E9ECF0", INK)


def _award_level_colors(level: str) -> tuple[str, str]:
    return AWARD_LEVEL_COLORS.get(level.strip().upper(), AWARD_LEVEL_FALLBACK)


# --------------------------------------------------------------------------
# case-detail's TITLE/SUMMARY: "wrap into <=2 lines first, only shrink the
# font if that still doesn't fit" (CASE_DETAIL_SPEC.md). A bare shrink_to_fit()
# + word_wrap=True cannot do this on its own: as the font shrinks, more
# characters fit per line, so the *same* algorithm that is supposed to be
# choosing a font size for a fixed 2-line paragraph quietly re-wraps the text
# down to a single long line once the font is small enough — which is exactly
# the bug (SUMMARY collapsing to ~9pt on one line spanning the full margin
# width instead of staying 2 lines). Fixing this needs the line breaks
# decided once, then only the font size shrinking for that fixed split.
# --------------------------------------------------------------------------


def _split_max_lines(text: str, font_size_pt: float, box_width_in: float,
                      max_lines: int = 2) -> tuple[list[str], str]:
    """Greedy character-based wrap (same per-char weighting as
    _line_count_for) of `text` into at most `max_lines` lines at the given
    font size / box width. Returns (lines, remainder) — remainder is any tail
    text that did not fit within max_lines (empty when everything fit)."""
    box_width_pt = max(0.2, box_width_in) * 72.0
    cap = max(1.0, box_width_pt / font_size_pt)
    lines: list[str] = []
    cur = ""
    cur_len = 0.0
    i = 0
    n = len(text)
    while i < n and len(lines) < max_lines:
        ch = text[i]
        w = 1.0 if ord(ch) > 0x2E7F else 0.55
        if cur and cur_len + w > cap:
            lines.append(cur)
            cur, cur_len = "", 0.0
            continue
        cur += ch
        cur_len += w
        i += 1
    if cur:
        lines.append(cur)
    return lines, text[i:]


def fit_case_text_block(text: str, box_width_in: float, box_height_in: float,
                         base_size_pt: float, min_ratio: float = 0.7,
                         step: float = 0.5, max_lines: int = 2
                         ) -> tuple[list[str], float, bool]:
    """TITLE/SUMMARY-style fit for case-detail: wrap into <= max_lines lines
    FIRST, only shrink the font afterwards. Returns (lines, size_pt, fits).

    Two distinct overflow cases, handled in order (both step the font down by
    `step`, floor at base_size_pt * min_ratio):
      1. line-count overflow — the text needs more than max_lines even at
         base_size_pt, so the split itself is re-computed at each smaller
         candidate size (a smaller font is what actually buys room for more
         of the sentence per line).
      2. height overflow — the max_lines split from step 1 still doesn't fit
         box_height_in vertically. The font shrinks further but the split
         from step 1 is kept FIXED (re-wrapping here is exactly the bug this
         function exists to avoid: it would silently collapse back to 1 line).
    `fits` is False if either case still fails to resolve at the size floor.
    """
    size = base_size_pt
    min_size = round(base_size_pt * min_ratio, 1)
    height_pt_avail = box_height_in * 72.0

    lines, remainder = _split_max_lines(text, size, box_width_in, max_lines)
    while remainder and size > min_size + 1e-6:
        size = max(min_size, round(size - step, 1))
        lines, remainder = _split_max_lines(text, size, box_width_in, max_lines)
    line_count_fits = not remainder

    def block_h(sz: float, n: int) -> float:
        return n * sz * 1.45 + sz * 0.30

    n_lines = max(1, len(lines))
    while block_h(size, n_lines) > height_pt_avail and size > min_size + 1e-6:
        size = max(min_size, round(size - step, 1))
    height_fits = block_h(size, n_lines) <= height_pt_avail

    return lines, size, line_count_fits and height_fits


def write_case_text_lines(tf, lines: list[str], size: float, color, bold: bool = False,
                           spacing_pt: float | None = None) -> None:
    for i, line in enumerate(lines):
        write_single(tf, line, size, color=color, bold=bold, spacing_pt=spacing_pt, first=(i == 0))


def build_case_detail(prs, s: Slide, shots_dir: Path, report: BuildReport):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_rect(slide, 0, 0, SLIDE_W_IN, SLIDE_H_IN, fill_color=PAPER)

    # Eyebrow + rule only (same geometry as add_header()) — TITLE/SUB are laid
    # out separately below with case-detail's own positions/sizes.
    top = MARGIN_TOP
    eyebrow = s.text("EYEBROW")
    if eyebrow:
        tb, tf = add_textbox(slide, CONTENT_LEFT, top, CONTENT_WIDTH, 0.24)
        write_single(tf, eyebrow.upper(), 9.5, color=ACCENT, bold=True, spacing_pt=2.2)
        report.reg(s.number, "eyebrow", "content", CONTENT_LEFT, top, CONTENT_WIDTH, 0.24)
        top += 0.30
    add_hline(slide, CONTENT_LEFT, top, CONTENT_WIDTH, color=RULE, weight_pt=0.75)
    top += 0.10

    content_bottom = SLIDE_H_IN - BOTTOM_MARGIN
    content_bottom = add_note(slide, s, report, content_bottom)

    # --- AWARDS: 1-4 badges, department (top line) + level (bottom line) ---
    awards = []
    for ln in s.lines("AWARDS")[:4]:
        parts = [p.strip() for p in ln.split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            awards.append((parts[0], parts[1]))

    badge_top = top
    badge_h = 0.46
    badge_pad = 0.10
    badge_gap = 0.10
    dept_size, level_size = 9.0, 10.5

    def _badge_text_width_in(text, size_pt):
        # Bold Meiryo, calibrated against actual glyph metrics (measured via
        # PIL ImageFont.textlength on "GRAND PRIX" / "OUTDOOR" / etc at 9pt
        # and 10.5pt bold): ~0.0097 in/pt/char, +5% safety margin so a badge
        # never wraps mid-word. _effective_len()'s 0.55 ASCII factor (tuned
        # for regular-weight body copy) undershoots bold all-caps labels.
        # +0.03in covers add_textbox()'s own 1pt left/right margins.
        return 0.0108 * size_pt * len(text) + 0.03

    def _badge_widths(dsize, lsize):
        widths = []
        for dept, level in awards:
            dw = _badge_text_width_in(dept, dsize)
            lw = _badge_text_width_in(level.upper(), lsize)
            widths.append(max(dw, lw) + 2 * badge_pad)
        return widths

    badge_widths = _badge_widths(dept_size, level_size)
    total_badge_w = sum(badge_widths) + badge_gap * max(0, len(badge_widths) - 1)
    if awards and total_badge_w > CONTENT_WIDTH:
        # single 1pt step-down per spec, then let verify's margin check catch
        # anything that still doesn't fit (badges are still drawn, not cut).
        dept_size -= 1.0
        level_size -= 1.0
        badge_widths = _badge_widths(dept_size, level_size)
        total_badge_w = sum(badge_widths) + badge_gap * max(0, len(badge_widths) - 1)
        if total_badge_w > CONTENT_WIDTH:
            report.note_overflow(s.number, "awards")

    bx = CONTENT_LEFT
    for (dept, level), bw in zip(awards, badge_widths):
        bg, fg = _award_level_colors(level)
        add_rect(slide, bx, badge_top, bw, badge_h, fill_color=bg)
        tb, tf = add_textbox(slide, bx + badge_pad, badge_top + badge_pad,
                              bw - 2 * badge_pad, badge_h - 2 * badge_pad, anchor=MSO_ANCHOR.MIDDLE)
        tf.word_wrap = False  # each line (dept / level) is meant to stay single-line
        write_single(tf, dept, dept_size, color=fg, bold=True)
        write_single(tf, level.upper(), level_size, color=fg, bold=True, first=False)
        report.reg(s.number, f"award:{dept}", "content", bx, badge_top, bw, badge_h)
        bx += bw + badge_gap

    # --- TITLE ---
    # title_box_h / summary_top / summary_h are chained (each reserved height
    # is exactly the actual footprint the chosen font/line-count needs) so the
    # registered boxes can never overlap each other or the fixed IMAGE top
    # below, regardless of whether the title/summary end up wrapping to 2
    # lines. TITLE/SUMMARY both wrap into <=2 lines *before* any shrinking
    # (see fit_case_text_block) — the ceiling passed in is the theoretical
    # "2 lines at base size" height, i.e. only a real >2-line overflow (or,
    # for SUMMARY, genuinely running out of room before the fixed IMAGE top)
    # triggers a font shrink.
    title = s.text("TITLE")
    title_top = 1.46
    title_base_size, title_min_ratio = 26, 0.65
    title_ceiling_h = (2 * title_base_size * 1.45 + title_base_size * 0.30) / 72.0
    title_lines, title_size, fits = fit_case_text_block(
        title, CONTENT_WIDTH, title_ceiling_h, title_base_size, min_ratio=title_min_ratio)
    if not fits:
        report.note_overflow(s.number, "case_title")
    title_box_h = max(0.05, (len(title_lines) * title_size * 1.45 + title_size * 0.30) / 72.0)
    tb, tf = add_textbox(slide, CONTENT_LEFT, title_top, CONTENT_WIDTH, title_box_h)
    write_case_text_lines(tf, title_lines, title_size, color=TEXT_1, bold=True, spacing_pt=-0.3)
    report.reg(s.number, "title", "content", CONTENT_LEFT, title_top, CONTENT_WIDTH, title_box_h)

    # --- SUMMARY ---
    summary = s.text("SUMMARY")
    summary_top = title_top + title_box_h + 0.05
    summary_h = max(0.05, 2.55 - summary_top - 0.02)  # 2.55in = fixed IMAGE top
    if summary:
        summary_lines, summary_size, fits_s = fit_case_text_block(
            summary, CONTENT_WIDTH, summary_h, 11.5, min_ratio=0.7)
        if not fits_s:
            report.note_overflow(s.number, "summary")
        tb, tf = add_textbox(slide, CONTENT_LEFT, summary_top, CONTENT_WIDTH, summary_h)
        write_case_text_lines(tf, summary_lines, summary_size, color=TEXT_2)
        report.reg(s.number, "summary", "content", CONTENT_LEFT, summary_top, CONTENT_WIDTH, summary_h)

    # --- LEFT COLUMN: thumbnail (contain) + META + TAGS + LINK ---
    left_w = 4.60
    img_top = 2.55
    img_h_budget = 2.90
    add_image_contain(slide, shots_dir, s.text("IMAGE"), CONTENT_LEFT, img_top, left_w,
                       img_h_budget, report, s.number, role="case_image")

    meta_rows = []
    for ln in s.lines("META")[:5]:
        parts = [p.strip() for p in ln.split("|")]
        if len(parts) >= 2 and parts[0]:
            meta_rows.append((parts[0], parts[1]))

    row_h = 0.22
    label_w = 1.35
    value_w = left_w - label_w
    my = img_top + img_h_budget + 0.10
    for label, value in meta_rows:
        tbl, tfl = add_textbox(slide, CONTENT_LEFT, my, label_w, row_h)
        write_single(tfl, label, 8.5, color=TEXT_3)
        tbv, tfv = add_textbox(slide, CONTENT_LEFT + label_w, my, value_w, row_h)
        write_single(tfv, value, 10, color=TEXT_1)
        report.reg(s.number, f"meta:{label}", "content", CONTENT_LEFT, my, left_w, row_h)
        my += row_h

    tags = s.text("TAGS")
    if tags:
        my += 0.05
        tag_h = 0.20
        tb, tf = add_textbox(slide, CONTENT_LEFT, my, left_w, tag_h)
        write_single(tf, tags, 9, color=TEXT_2)
        report.reg(s.number, "tags", "content", CONTENT_LEFT, my, left_w, tag_h)
        my += tag_h

    link = s.text("LINK")
    if link:
        my += 0.05
        link_h = 0.22
        tb, tf = add_textbox(slide, CONTENT_LEFT, my, left_w, link_h)
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = "一次ソースを見る →"
        set_run_font(run, size=10, color=ACCENT)
        run.font.underline = True
        run.hyperlink.address = link
        report.reg(s.number, "link", "content", CONTENT_LEFT, my, left_w, link_h)

    # --- RIGHT COLUMN: SECTIONS (2-4 heading + body pairs) ---
    right_left = 5.55
    right_w = SLIDE_W_IN - MARGIN_X - right_left
    right_top = img_top
    right_h = content_bottom - right_top

    sections = []
    for ln in s.lines("SECTIONS")[:4]:
        parts = [p.strip() for p in ln.split("|", 1)]
        if len(parts) >= 2 and parts[0]:
            sections.append((parts[0], parts[1]))

    heading_size = 10.5
    heading_gap = 0.09
    min_body_size = 8.0
    # estimate_lines_height_pt()'s per-char wrap estimate can undercount by
    # one line on longer CJK paragraphs at this column width; budgeting
    # against a slightly narrower width (drawing itself still uses the full
    # right_w) keeps the reserved height from running short.
    est_w = right_w * 0.92

    def _section_total_h(body_size):
        total = 0.0
        for heading, body in sections:
            heading_h = estimate_lines_height_pt([(heading_size, heading)], est_w) / 72.0
            body_h = estimate_lines_height_pt([(body_size, body)], est_w) / 72.0
            total += heading_gap + heading_h + body_h
        return total

    body_size = 10.0
    fits_sections = True
    while True:
        needed = _section_total_h(body_size)
        if needed <= right_h or body_size <= min_body_size - 1e-6:
            fits_sections = needed <= right_h
            break
        body_size = round(body_size - 0.5, 1)
    if not fits_sections:
        report.note_overflow(s.number, "sections")

    cursor = right_top
    for heading, body in sections:
        cursor += heading_gap
        heading_h = estimate_lines_height_pt([(heading_size, heading)], est_w) / 72.0
        tb, tf = add_textbox(slide, right_left, cursor, right_w, heading_h)
        write_single(tf, heading, heading_size, color=TEXT_1, bold=True)
        report.reg(s.number, f"section_heading:{heading}", "content", right_left, cursor, right_w,
                    heading_h)
        cursor += heading_h
        body_h = estimate_lines_height_pt([(body_size, body)], est_w) / 72.0
        tb2, tf2 = add_textbox(slide, right_left, cursor, right_w, body_h)
        write_single(tf2, body, body_size, color=TEXT_1)
        report.reg(s.number, f"section_body:{heading}", "content", right_left, cursor, right_w, body_h)
        cursor += body_h

    add_page_number(slide, s.number, report)
    apply_speaker_note(slide, s)
    return slide


LAYOUT_BUILDERS = {
    "cover": build_cover,
    "section": build_section,
    "shot": build_shot,
    "shot-annotated": build_shot_annotated,
    "shot-split": build_shot_split,
    "grid": build_grid,
    "flow": build_flow,
    "funnel": build_funnel,
    "compare": build_compare,
    "stats": build_stats,
    "table": build_table,
    "timeline": build_timeline,
    "bullets": build_bullets,
    "legend": build_legend,
    "closing": build_closing,
    "case-detail": build_case_detail,
}


# --------------------------------------------------------------------------
# Deck building
# --------------------------------------------------------------------------


def build_deck(outline_path: Path, shots_dir: Path, out_path: Path) -> tuple[int, BuildReport]:
    slides = parse_outline(outline_path)
    report = BuildReport()
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W_IN)
    prs.slide_height = Inches(SLIDE_H_IN)

    for s in slides:
        builder = LAYOUT_BUILDERS.get(s.layout)
        if builder is None:
            raise ValueError(f"S{s.number}: 未知の LAYOUT '{s.layout}'")
        builder(prs, s, shots_dir, report)
        report.layout_counts[s.layout] = report.layout_counts.get(s.layout, 0) + 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))
    return len(slides), report


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------


def _boxes_overlap(b1, b2) -> bool:
    _, _, _, l1, t1, w1, h1 = b1
    _, _, _, l2, t2, w2, h2 = b2
    r1, bo1 = l1 + w1, t1 + h1
    r2, bo2 = l2 + w2, t2 + h2
    ix = max(0.0, min(r1, r2) - max(l1, l2))
    iy = max(0.0, min(bo1, bo2) - max(t1, t2))
    return ix > 0.01 and iy > 0.01


def check_margins(report: BuildReport) -> list[tuple[int, str]]:
    issues = []
    for slide_num, role, kind, l, t, w, h in report.boxes:
        if kind in ("bg", "footer", "decor"):
            continue
        right = l + w
        bottom = t + h
        if l < 0.5 - 1e-3 or right > SLIDE_W_IN - 0.5 + 1e-3:
            issues.append((slide_num, f"{role} (左右マージン外: l={l:.2f} r={right:.2f})"))
        elif t < 0.4 - 1e-3:
            issues.append((slide_num, f"{role} (上マージン外: t={t:.2f})"))
        elif bottom > SLIDE_H_IN - 0.3 + 1e-3:
            issues.append((slide_num, f"{role} (下マージン外: bottom={bottom:.2f})"))
    return issues


def check_overlaps(report: BuildReport) -> list[tuple[int, str, str]]:
    issues = []
    by_slide: dict[int, list] = {}
    for b in report.boxes:
        if b[2] not in ("content", "image"):
            continue
        by_slide.setdefault(b[0], []).append(b)
    for slide_num, boxes in by_slide.items():
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if _boxes_overlap(boxes[i], boxes[j]):
                    issues.append((slide_num, boxes[i][1], boxes[j][1]))
    return issues


def verify(outline_path: Path, shots_dir: Path, out_path: Path) -> bool:
    n, report = build_deck(outline_path, shots_dir, out_path)
    ok = True

    print(f"[1] スライド総数: {n}")
    print("    レイアウト別枚数:")
    for layout, count in sorted(report.layout_counts.items()):
        print(f"      {layout}: {count}")
    missing_layouts = set(LAYOUT_BUILDERS) - set(report.layout_counts)
    if missing_layouts:
        print(f"    (このアウトラインに含まれないレイアウト: {sorted(missing_layouts)})")

    print(f"[2] 画像未検出: {len(report.missing_images)}")
    if report.missing_images:
        for slide_num, fname in report.missing_images:
            print(f"    NG S{slide_num}: {fname!r} が見つからない")

    print(f"[3] 縮小しても収まらなかったテキスト枠: {len(report.overflow)}")
    if report.overflow:
        ok = False
        for slide_num, role in report.overflow:
            print(f"    NG S{slide_num}: role={role}")

    margin_issues = check_margins(report)
    print(f"[4] マージン外にはみ出した図形: {len(margin_issues)}")
    if margin_issues:
        ok = False
        for slide_num, msg in margin_issues:
            print(f"    NG S{slide_num}: {msg}")

    overlap_issues = check_overlaps(report)
    print(f"[5] 図形の重なり（意図的なマーカー重なりを除く）: {len(overlap_issues)}")
    if overlap_issues:
        ok = False
        for slide_num, a, b in overlap_issues:
            print(f"    NG S{slide_num}: {a} <-> {b}")

    print(f"RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


# --------------------------------------------------------------------------
# Pillow preview renderer (no PowerPoint / LibreOffice required)
# --------------------------------------------------------------------------


_FONT_PATHS = {
    False: (r"C:\Windows\Fonts\meiryo.ttc", r"C:\Windows\Fonts\YuGothM.ttc",
            r"C:\Windows\Fonts\msgothic.ttc"),
    True: (r"C:\Windows\Fonts\meiryob.ttc", r"C:\Windows\Fonts\YuGothB.ttc",
           r"C:\Windows\Fonts\msgothic.ttc"),
}


def _len_px(length, dpi: float, default: float = 0.0) -> float:
    """Convert any python-pptx Length (Pt/Emu/Inches — all EMU-based ints) to px."""
    if length is None:
        return default
    return length / 914400.0 * dpi


def _read_fill(obj):
    """Return (rgb_tuple_or_None, alpha_0_255) for a shape/cell's solid fill."""
    try:
        if obj.fill.type is None:
            return None, 0
        rgb = obj.fill.fore_color.rgb
    except Exception:
        return None, 0
    alpha = 255
    try:
        xPr = obj.fill._xPr
        solid = xPr.find(qn("a:solidFill"))
        if solid is not None:
            srgb = solid.find(qn("a:srgbClr"))
            if srgb is not None:
                a_el = srgb.find(qn("a:alpha"))
                if a_el is not None:
                    val = int(a_el.get("val"))
                    alpha = max(0, min(255, round(val / 100000 * 255)))
    except Exception:
        pass
    return (rgb[0], rgb[1], rgb[2]), alpha


def _read_line(shape):
    """Return (rgb_or_None, width_pt, dash_val_or_None) for a shape's outline."""
    color, width_pt, dash = None, 0.0, None
    try:
        line = shape.line
        if line.color is not None and line.color.type is not None:
            c = line.color.rgb
            color = (c[0], c[1], c[2])
        if line.width is not None:
            width_pt = line.width.pt
    except Exception:
        pass
    try:
        ln = shape.line._get_or_add_ln()
        d = ln.find(qn("a:prstDash"))
        if d is not None:
            dash = d.get("val")
    except Exception:
        pass
    return color, width_pt, dash


def _read_run_spc_pt(run) -> float:
    try:
        rPr = run._r.find(qn("a:rPr"))
        if rPr is not None:
            spc = rPr.get("spc")
            if spc:
                return int(spc) / 100.0
    except Exception:
        pass
    return 0.0


def _fill_region(img, kind: str, l: float, t: float, w: float, h: float,
                  rgb, alpha: int, points=None):
    """Alpha-composite a filled region (rect/ellipse/polygon) into img (mode RGB)."""
    if rgb is None or alpha <= 0 or w <= 0 or h <= 0:
        return
    l0, t0 = int(math.floor(l)), int(math.floor(t))
    w0 = max(1, int(math.ceil(l + w)) - l0)
    h0 = max(1, int(math.ceil(t + h)) - t0)
    mask = PILImage.new("L", (w0, h0), 0)
    md = ImageDraw.Draw(mask)
    if kind == "ellipse":
        md.ellipse([0, 0, w0 - 1, h0 - 1], fill=alpha)
    elif kind == "polygon" and points:
        md.polygon([(px - l0, py - t0) for px, py in points], fill=alpha)
    else:
        md.rectangle([0, 0, w0 - 1, h0 - 1], fill=alpha)
    color_layer = PILImage.new("RGB", (w0, h0), rgb)
    img.paste(color_layer, (l0, t0), mask)


def _rotate_pt(px, py, cx, cy, deg):
    rad = math.radians(deg)
    dx, dy = px - cx, py - cy
    rx = dx * math.cos(rad) - dy * math.sin(rad)
    ry = dx * math.sin(rad) + dy * math.cos(rad)
    return (cx + rx, cy + ry)


def _draw_dashed_line(draw, x0, y0, x1, y1, color, width_px, dash_px=8.0, gap_px=5.0):
    length = math.hypot(x1 - x0, y1 - y0)
    if length < 1e-6:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    d = 0.0
    on = True
    while d < length:
        seg = dash_px if on else gap_px
        d2 = min(length, d + seg)
        if on:
            draw.line([x0 + ux * d, y0 + uy * d, x0 + ux * d2, y0 + uy * d2],
                      fill=color, width=max(1, int(round(width_px))))
        d = d2
        on = not on


def _draw_picture(img, shape, l: float, t: float, w: float, h: float):
    """Paste the picture's real bytes, applying the same crop_* fractions used
    when it was placed into the pptx (so contain/cover math is never redone)."""
    try:
        blob = shape.image.blob
    except Exception:
        return
    try:
        pic = PILImage.open(BytesIO(blob)).convert("RGB")
    except Exception:
        return
    iw, ih = pic.size
    cl = getattr(shape, "crop_left", 0.0) or 0.0
    cr = getattr(shape, "crop_right", 0.0) or 0.0
    ct = getattr(shape, "crop_top", 0.0) or 0.0
    cb = getattr(shape, "crop_bottom", 0.0) or 0.0
    x0, y0 = int(iw * cl), int(ih * ct)
    x1, y1 = int(iw * (1 - cr)), int(ih * (1 - cb))
    if x1 <= x0 or y1 <= y0:
        x0, y0, x1, y1 = 0, 0, iw, ih
    cropped = pic.crop((x0, y0, x1, y1))
    w_i, h_i = max(1, int(round(w))), max(1, int(round(h)))
    resized = cropped.resize((w_i, h_i), _PIL_RESAMPLE)
    img.paste(resized, (int(round(l)), int(round(t))))


def _read_paragraph_indent_px(p, dpi: float) -> tuple[float, float]:
    """Return (marL_px, indent_px) from a paragraph's raw <a:pPr> (EMU), or
    (0, 0) if unset — mirrors set_paragraph_indent()'s hanging-indent."""
    try:
        pPr = p._p.pPr
    except Exception:
        pPr = None
    if pPr is None:
        return 0.0, 0.0
    marL = pPr.get("marL")
    indent = pPr.get("indent")
    marL_px = (int(marL) / 914400.0 * dpi) if marL else 0.0
    indent_px = (int(indent) / 914400.0 * dpi) if indent else 0.0
    return marL_px, indent_px


def _draw_paragraphs(draw, tf, l, t, w, h, dpi, get_font, anchor_override=None):
    """Render a text_frame's paragraphs using each run's real font/size/color/
    bold/tracking, wrapped by measured glyph width (not re-derived heuristics).
    Honors each paragraph's hanging indent (marL/indent, see
    set_paragraph_indent()): the first line starts at marL+indent and wraps at
    width w-(marL+indent); continuation lines start at marL and wrap at
    width w-marL. Only applied for left-aligned paragraphs (the only
    alignment used with hanging indents in this deck)."""
    anchor = anchor_override if anchor_override is not None else getattr(tf, "vertical_anchor", None)

    para_plans = []
    for p in tf.paragraphs:
        tokens = []  # (char, font, color, tracking_px, size_px)
        for run in p.runs:
            text = run.text
            if not text:
                continue
            bold = bool(run.font.bold)
            color = (17, 17, 17)
            try:
                if run.font.color is not None and run.font.color.type is not None:
                    c = run.font.color.rgb
                    color = (c[0], c[1], c[2])
            except Exception:
                pass
            size_px = max(6, round(_len_px(run.font.size, dpi, default=12.0 * dpi / 72.0)))
            font = get_font(size_px, bold)
            tracking_px = _read_run_spc_pt(run) * dpi / 72.0
            for ch in text:
                tokens.append((ch, font, color, tracking_px, size_px))

        align = p.alignment or PP_ALIGN.LEFT
        space_before = _len_px(p.space_before, dpi, 0.0)
        space_after = _len_px(p.space_after, dpi, 0.0)

        marL_px, indent_px = 0.0, 0.0
        if align == PP_ALIGN.LEFT:
            marL_px, indent_px = _read_paragraph_indent_px(p, dpi)
        first_offset = max(0.0, marL_px + indent_px)
        rest_offset = max(0.0, marL_px)
        first_w = max(1.0, w - first_offset)
        rest_w = max(1.0, w - rest_offset)

        lines = []  # list of (tokens, x_offset)
        if tokens:
            cur, cur_w = [], 0.0
            cur_offset = first_offset
            cur_max_w = first_w
            for tok in tokens:
                ch = tok[0]
                if ch == "\n":
                    lines.append((cur, cur_offset))
                    cur, cur_w = [], 0.0
                    cur_offset, cur_max_w = rest_offset, rest_w
                    continue
                cw = draw.textlength(ch, font=tok[1]) + tok[3]
                if cur and cur_w + cw > cur_max_w and ch not in "、。」』）,.!?":
                    lines.append((cur, cur_offset))
                    cur, cur_w = [], 0.0
                    cur_offset, cur_max_w = rest_offset, rest_w
                cur.append(tok)
                cur_w += cw
            lines.append((cur, cur_offset))
        para_plans.append({"lines": lines, "align": align,
                            "space_before": space_before, "space_after": space_after})

    def _line_height(line_tokens):
        if not line_tokens:
            return 14.0 * dpi / 72.0 * 1.3
        return max(tok[4] for tok in line_tokens) * 1.3

    total_h = 0.0
    for plan in para_plans:
        total_h += plan["space_before"] + plan["space_after"]
        total_h += sum(_line_height(ln) for ln, _off in plan["lines"])

    if anchor == MSO_ANCHOR.MIDDLE:
        y = t + max(0.0, (h - total_h) / 2)
    elif anchor == MSO_ANCHOR.BOTTOM:
        y = t + max(0.0, h - total_h)
    else:
        y = t

    for plan in para_plans:
        y += plan["space_before"]
        for ln, off in plan["lines"]:
            lh = _line_height(ln)
            line_w = sum(draw.textlength(tok[0], font=tok[1]) + tok[3] for tok in ln)
            if plan["align"] == PP_ALIGN.CENTER:
                x = l + max(0.0, (w - line_w) / 2)
            elif plan["align"] == PP_ALIGN.RIGHT:
                x = l + max(0.0, w - line_w)
            else:
                x = l + off
            for ch, font, color, trk, _size_px in ln:
                draw.text((x, y), ch, font=font, fill=color)
                x += draw.textlength(ch, font=font) + trk
            y += lh
        y += plan["space_after"]


def _draw_table(img, draw, shape, l, t, w, h, dpi, get_font):
    table = shape.table
    n_rows, n_cols = len(table.rows), len(table.columns)
    row_heights = [_len_px(table.rows[r].height, dpi) for r in range(n_rows)]
    col_widths = [_len_px(table.columns[c].width, dpi) for c in range(n_cols)]
    ry = t
    for r in range(n_rows):
        rh = row_heights[r]
        rx = l
        for c in range(n_cols):
            cw = col_widths[c]
            cell = table.cell(r, c)
            rgb, alpha = _read_fill(cell)
            _fill_region(img, "rect", rx, ry, cw, rh, rgb, alpha)
            draw.rectangle([rx, ry, rx + cw, ry + rh], outline=(180, 180, 180))
            pad_l = _len_px(cell.margin_left, dpi, 2.0 * dpi / 72.0)
            pad_r = _len_px(cell.margin_right, dpi, 2.0 * dpi / 72.0)
            pad_t = _len_px(cell.margin_top, dpi, 1.0 * dpi / 72.0)
            pad_b = _len_px(cell.margin_bottom, dpi, 1.0 * dpi / 72.0)
            _draw_paragraphs(draw, cell.text_frame, rx + pad_l, ry + pad_t,
                              max(1.0, cw - pad_l - pad_r), max(1.0, rh - pad_t - pad_b),
                              dpi, get_font, anchor_override=cell.vertical_anchor)
            rx += cw
        ry += rh


def render_preview(out_path: Path, preview_dir: Path, dpi: int = 120):
    if PILImage is None:
        print("Pillow が使えないため preview を生成できません", file=sys.stderr)
        return

    prs = Presentation(str(out_path))
    preview_dir.mkdir(parents=True, exist_ok=True)

    font_cache: dict[tuple[int, bool], "ImageFont.FreeTypeFont"] = {}

    def get_font(size_px: int, bold: bool = False):
        size_px = max(6, int(size_px))
        key = (size_px, bold)
        if key in font_cache:
            return font_cache[key]
        f = None
        for candidate in _FONT_PATHS[bold]:
            try:
                f = ImageFont.truetype(candidate, size_px)
                break
            except Exception:
                continue
        if f is None:
            for candidate in _FONT_PATHS[False]:
                try:
                    f = ImageFont.truetype(candidate, size_px)
                    break
                except Exception:
                    continue
        if f is None:
            f = ImageFont.load_default()
        font_cache[key] = f
        return f

    w_px = int(SLIDE_W_IN * dpi)
    h_px = int(SLIDE_H_IN * dpi)

    for idx, slide in enumerate(prs.slides, start=1):
        img = PILImage.new("RGB", (w_px, h_px), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        for shape in slide.shapes:
            try:
                l = _len_px(shape.left, dpi)
                t = _len_px(shape.top, dpi)
                w = _len_px(shape.width, dpi)
                h = _len_px(shape.height, dpi)
            except TypeError:
                continue

            # --- pictures: paste real bytes with the actual crop applied ---
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                _draw_picture(img, shape, l, t, w, h)
                continue

            # --- tables: cell fill + borders + text ---
            if shape.has_table:
                _draw_table(img, draw, shape, l, t, w, h, dpi, get_font)
                continue

            # --- connectors (dashed feedback arrow) ---
            is_connector = (shape.shape_type == MSO_SHAPE_TYPE.LINE
                             or type(shape).__name__ == "Connector")
            if is_connector:
                color, width_pt, dash = _read_line(shape)
                color = color or (150, 150, 150)
                width_px = max(1.0, width_pt * dpi / 72.0)
                try:
                    x0, y0 = _len_px(shape.begin_x, dpi), _len_px(shape.begin_y, dpi)
                    x1, y1 = _len_px(shape.end_x, dpi), _len_px(shape.end_y, dpi)
                except Exception:
                    x0, y0, x1, y1 = l, t, l + w, t + h
                if dash:
                    _draw_dashed_line(draw, x0, y0, x1, y1, color, width_px)
                else:
                    draw.line([x0, y0, x1, y1], fill=color, width=int(round(width_px)))
                continue

            # --- autoshapes / textboxes: fill (with alpha) + line + text ---
            rgb, alpha = _read_fill(shape)
            line_color, line_w_pt, dash = _read_line(shape)
            rotation = getattr(shape, "rotation", 0.0) or 0.0
            shape_kind = "rect"
            points = None
            try:
                ast = shape.auto_shape_type
            except Exception:
                ast = None
            if ast == MSO_SHAPE.OVAL:
                shape_kind = "ellipse"
            elif ast == MSO_SHAPE.ISOSCELES_TRIANGLE:
                shape_kind = "polygon"
                cx, cy = l + w / 2, t + h / 2
                apex, bl_pt, br_pt = (l + w / 2, t), (l, t + h), (l + w, t + h)
                points = [_rotate_pt(px, py, cx, cy, rotation) for px, py in (apex, bl_pt, br_pt)]

            if rgb is not None and alpha > 0:
                _fill_region(img, shape_kind, l, t, w, h, rgb, alpha, points=points)

            if line_color is not None and line_w_pt > 0:
                width_px = max(1.0, line_w_pt * dpi / 72.0)
                if shape_kind == "ellipse":
                    draw.ellipse([l, t, l + w, t + h], outline=line_color, width=int(round(width_px)))
                elif shape_kind == "polygon" and points:
                    ring = points + [points[0]]
                    for i in range(len(ring) - 1):
                        draw.line([ring[i], ring[i + 1]], fill=line_color, width=int(round(width_px)))
                elif dash:
                    corners = [(l, t), (l + w, t), (l + w, t + h), (l, t + h), (l, t)]
                    for i in range(4):
                        _draw_dashed_line(draw, *corners[i], *corners[i + 1], line_color, width_px)
                else:
                    draw.rectangle([l, t, l + w, t + h], outline=line_color, width=int(round(width_px)))

            if shape.has_text_frame:
                tf = shape.text_frame
                pad_l = _len_px(tf.margin_left, dpi, 1.0 * dpi / 72.0)
                pad_r = _len_px(tf.margin_right, dpi, 1.0 * dpi / 72.0)
                pad_t = _len_px(tf.margin_top, dpi, 1.0 * dpi / 72.0)
                pad_b = _len_px(tf.margin_bottom, dpi, 1.0 * dpi / 72.0)
                _draw_paragraphs(draw, tf, l + pad_l, t + pad_t,
                                  max(1.0, w - pad_l - pad_r), max(1.0, h - pad_t - pad_b),
                                  dpi, get_font)

        out_file = preview_dir / f"slide-{idx:02d}.png"
        img.save(out_file)
    print(f"Preview PNGs -> {preview_dir} ({len(prs.slides)} 枚)")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", default="build", choices=["build", "verify", "preview"])
    parser.add_argument("--outline", default=DEFAULT_OUTLINE)
    parser.add_argument("--shots", default=DEFAULT_SHOTS)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--preview", default=None, help="preview PNG 出力先ディレクトリ")
    args = parser.parse_args(argv)

    outline_path = Path(args.outline)
    shots_dir = Path(args.shots)
    out_path = Path(args.out)

    if args.command == "build":
        n, report = build_deck(outline_path, shots_dir, out_path)
        print(f"Built {n} slides -> {out_path}")
        if report.missing_images:
            print(f"警告: 画像未検出 {len(report.missing_images)} 件（プレースホルダで代替）")
        if report.overflow:
            print(f"警告: テキストがはみ出した枠 {len(report.overflow)} 件")
        if args.preview:
            render_preview(out_path, Path(args.preview))
    elif args.command == "verify":
        ok = verify(outline_path, shots_dir, out_path)
        if args.preview:
            render_preview(out_path, Path(args.preview))
        sys.exit(0 if ok else 1)
    else:  # preview
        if not out_path.exists():
            build_deck(outline_path, shots_dir, out_path)
        render_preview(out_path, Path(args.preview or "./preview"))


if __name__ == "__main__":
    main()
