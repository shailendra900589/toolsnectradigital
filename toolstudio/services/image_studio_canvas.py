"""Server-side helpers for Image Studio Pro: procedural shapes & export helpers."""

from __future__ import annotations

import io
import math
import random
import re
from typing import Literal

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

try:
    import cv2  # type: ignore[import-untyped]
    import numpy as np
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]

try:
    from rembg import remove as rembg_remove
except ImportError:  # pragma: no cover
    rembg_remove = None  # type: ignore[assignment]

from toolstudio.services.reference_image_fetch import (
    build_photo_search_query,
    duckduckgo_image_urls,
    fetch_url_bytes,
)

StyleName = Literal["organic", "geometric", "crystal", "network"]


def generate_magic_shape_png(
    width: int = 512,
    height: int = 512,
    style: StyleName | str = "organic",
    seed: int | None = None,
) -> tuple[bytes, str]:
    """
    Generate a decorative PNG with alpha (transparent outside shapes).
    Used by the Pro Canvas "Magic shape" tool.
    """
    w = max(64, min(int(width), 2048))
    h = max(64, min(int(height), 2048))
    style = (style or "organic").strip().lower()
    if style not in ("organic", "geometric", "crystal", "network"):
        style = "organic"

    rng = random.Random(seed if seed is not None else random.randint(0, 2**30))

    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)

    if style == "organic":
        for _ in range(rng.randint(6, 14)):
            x0 = rng.randint(-w // 4, w)
            y0 = rng.randint(-h // 4, h)
            x1 = x0 + rng.randint(w // 8, w // 2)
            y1 = y0 + rng.randint(h // 8, h // 2)
            c = (
                rng.randint(40, 255),
                rng.randint(40, 255),
                rng.randint(40, 255),
                rng.randint(40, 200),
            )
            dr.ellipse([x0, y0, x1, y1], fill=c)

    elif style == "geometric":
        n = rng.randint(10, 22)
        pts = []
        for _ in range(n):
            pts.append((rng.randint(0, w), rng.randint(0, h)))
        for i in range(n):
            j = (i + 1) % n
            dr.line(
                [pts[i], pts[j]],
                fill=(
                    rng.randint(120, 255),
                    rng.randint(120, 255),
                    rng.randint(120, 255),
                    rng.randint(160, 240),
                ),
                width=rng.randint(2, 6),
            )
        cx, cy = w // 2, h // 2
        for _ in range(rng.randint(4, 10)):
            r = rng.randint(20, min(w, h) // 3)
            dr.rectangle(
                [cx - r, cy - r, cx + r, cy + r],
                outline=(
                    rng.randint(80, 255),
                    rng.randint(80, 255),
                    rng.randint(80, 255),
                    rng.randint(180, 255),
                ),
                width=2,
            )

    elif style == "crystal":
        cx, cy = w // 2, h // 2
        for layer in range(rng.randint(5, 12)):
            angle = rng.uniform(0, math.tau)
            r = min(w, h) * (0.08 + layer * 0.06)
            poly = []
            sides = rng.choice([3, 4, 5, 6])
            for s in range(sides):
                a = angle + (math.tau / sides) * s + rng.uniform(-0.15, 0.15)
                poly.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
            dr.polygon(
                poly,
                fill=(
                    rng.randint(60, 255),
                    rng.randint(60, 255),
                    rng.randint(60, 255),
                    rng.randint(50, 160),
                ),
                outline=(255, 255, 255, 120),
            )

    else:  # network
        nodes = [(rng.randint(0, w), rng.randint(0, h)) for _ in range(rng.randint(14, 28))]
        for (x, y) in nodes:
            dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(180, 220, 255, 220))
        for i, a in enumerate(nodes):
            for b in nodes[i + 1 : i + 4]:
                dr.line([a, b], fill=(100, 180, 255, rng.randint(40, 120)), width=1)

    # Slight blur merge for organic look (skip heavy on huge images)
    if max(w, h) <= 1024 and style == "organic":
        im = im.filter(ImageFilter.GaussianBlur(radius=0.8))

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# --- Named colours (command parser) ---
_COLOR_NAMES: dict[str, tuple[int, int, int, int]] = {
    "red": (220, 60, 60, 230),
    "blue": (59, 130, 246, 230),
    "green": (34, 197, 94, 230),
    "yellow": (234, 179, 8, 230),
    "orange": (249, 115, 22, 230),
    "purple": (168, 85, 247, 230),
    "pink": (236, 72, 153, 230),
    "white": (255, 255, 255, 240),
    "black": (30, 30, 30, 240),
    "cyan": (34, 211, 238, 230),
    "magenta": (236, 72, 153, 230),
    "gold": (250, 204, 21, 230),
    "silver": (148, 163, 184, 230),
    "navy": (30, 58, 138, 230),
    "lime": (163, 230, 53, 230),
    "teal": (45, 212, 191, 230),
}


def _parse_color(cmd: str, default: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    m = re.search(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", cmd)
    if m:
        hx = m.group(1)
        if len(hx) == 3:
            hx = "".join(c * 2 for c in hx)
        r = int(hx[0:2], 16)
        g = int(hx[2:4], 16)
        b = int(hx[4:6], 16)
        return (r, g, b, 240)
    low = cmd.lower()
    for name, rgba in _COLOR_NAMES.items():
        if re.search(r"\b" + re.escape(name) + r"\b", low):
            return rgba
    return default


def _first_int(cmd: str, default: int) -> int:
    m = re.search(r"\b(\d{2,4})\b", cmd)
    if m:
        return max(8, min(1800, int(m.group(1))))
    return default


def _normalize_command_text(cmd: str) -> str:
    """Fix common typos so color/shape keywords still match."""
    low = cmd.lower()
    replacements = (
        ("greel", "green"),
        ("yelow", "yellow"),
        ("yello", "yellow"),
        ("redd", "red"),
        ("readshade", "redshade"),
        ("banane", "banana"),
        ("bananna", "banana"),
        ("seb", "apple"),
        ("aam", "mango"),
        ("kela", "banana"),
    )
    for a, b in replacements:
        low = low.replace(a, b)
    return low


# Longest multi-word phrases first (avoid matching substrings incorrectly)
_REFERENCE_SUBJECT_PHRASES: tuple[tuple[str, str], ...] = (
    ("dragon_fruit", r"\bdragon\s*fruit\b"),
    ("passion_fruit", r"\bpassion\s+fruit\b"),
    ("orange_fruit", r"\borange\s+fruit\b|\bcitrus\s+orange\b"),
    ("green_apple", r"\bgreen\s+apple\b"),
    ("red_apple", r"\bred\s+apple\b"),
)

# Single-word subjects (order: longer unique stems first where relevant)
_REFERENCE_SUBJECT_WORDS: tuple[str, ...] = (
    "watermelon",
    "strawberry",
    "pineapple",
    "pomegranate",
    "grapefruit",
    "cantaloupe",
    "honeydew",
    "blackberry",
    "raspberry",
    "mangosteen",
    "mango",
    "banana",
    "cherry",
    "coconut",
    "papaya",
    "guava",
    "lychee",
    "peach",
    "pear",
    "kiwi",
    "grape",
    "plum",
    "apricot",
    "tomato",
    "fig",
    "date",
    "apple",
    "lemon",
    "lime",
)


def detect_reference_subject(low: str) -> str | None:
    """
    Detect a fruit / food subject for web-photo + cutout generation.
    Returns slug like 'mango', 'green_apple', 'dragon_fruit'.
    """
    for slug, pattern in _REFERENCE_SUBJECT_PHRASES:
        if re.search(pattern, low, re.IGNORECASE):
            return slug
    if re.search(r"\bgrapes?\b", low, re.IGNORECASE):
        return "grape"
    for w in _REFERENCE_SUBJECT_WORDS:
        if re.search(r"\b" + re.escape(w) + r"\b", low, re.IGNORECASE):
            return w
    return None


def _palette_from_command(raw: str, low: str) -> dict[str, tuple[int, int, int]]:
    """
    Pull multiple colours from free text for fruit/organic shapes.
    Order: prefer explicit names; defaults are mango-like.
    """
    palette = {
        "yellow": (255, 214, 60),
        "orange": (255, 150, 45),
        "red": (220, 55, 55),
        "green": (38, 160, 72),
    }
    # Single hex applies to body highlight if present
    m = re.search(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", raw)
    if m:
        hx = m.group(1)
        if len(hx) == 3:
            hx = "".join(c * 2 for c in hx)
        palette["accent"] = (
            int(hx[0:2], 16),
            int(hx[2:4], 16),
            int(hx[4:6], 16),
        )
    for name in ("yellow", "gold", "orange", "red", "crimson", "green", "lime", "emerald"):
        if re.search(r"\b" + re.escape(name) + r"\b", low):
            c = _parse_color(name, palette.get("yellow", (255, 214, 60)))
            if name in ("yellow", "gold"):
                palette["yellow"] = (c[0], c[1], c[2])
            elif name in ("orange",):
                palette["orange"] = (c[0], c[1], c[2])
            elif name in ("red", "crimson"):
                palette["red"] = (c[0], c[1], c[2])
            elif name in ("green", "lime", "emerald"):
                palette["green"] = (c[0], c[1], c[2])
    if "redshade" in low or "red shade" in low or "reddish" in low:
        palette["red"] = (210, 40, 55)
    if "colorful" in low:
        palette["yellow"] = (255, 220, 70)
        palette["orange"] = (255, 130, 40)
        palette["red"] = (215, 50, 60)
        palette["green"] = (42, 170, 78)
    return palette


def _chaikin_closed(pts: list[tuple[float, float]], iterations: int = 3) -> list[tuple[float, float]]:
    """Corner cutting — smoother organic outline (fewer visible facets)."""
    if len(pts) < 3:
        return pts
    p = list(pts)
    for _ in range(iterations):
        q = p + [p[0]]
        new_pts: list[tuple[float, float]] = []
        for i in range(len(q) - 1):
            a, b = q[i], q[i + 1]
            new_pts.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            new_pts.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        p = new_pts
    return p


def _mango_outline_points(cx: float, cy: float, scale: float) -> list[tuple[float, float]]:
    """Closed polygon approximating a mango silhouette (stem at top)."""
    # Normalized asymmetric blob, stem narrow at top (negative y)
    norm = [
        (0.0, -0.92),
        (0.22, -0.82),
        (0.48, -0.52),
        (0.62, -0.12),
        (0.66, 0.28),
        (0.55, 0.62),
        (0.28, 0.82),
        (0.0, 0.92),
        (-0.28, 0.82),
        (-0.52, 0.55),
        (-0.62, 0.18),
        (-0.55, -0.28),
        (-0.38, -0.62),
        (-0.15, -0.82),
    ]
    pts: list[tuple[float, float]] = []
    for nx, ny in norm:
        pts.append((cx + nx * scale, cy + ny * scale * 1.05))
    return pts


def _rotated_ellipse_polygon(
    cx: float,
    cy: float,
    rw: float,
    rh: float,
    angle_deg: float,
    n: int = 36,
) -> list[tuple[float, float]]:
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    pts: list[tuple[float, float]] = []
    for i in range(n):
        t = (math.tau * i) / n
        ex = (rw / 2) * math.cos(t)
        ey = (rh / 2) * math.sin(t)
        px = cx + ex * cos_a - ey * sin_a
        py = cy + ex * sin_a + ey * cos_a
        pts.append((px, py))
    return pts


def _draw_leaf_ellipse(
    dr: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    w: float,
    h: float,
    angle_deg: float,
    fill: tuple[int, int, int, int],
    outline: tuple[int, int, int, int],
) -> None:
    poly = _rotated_ellipse_polygon(cx, cy, w, h, angle_deg, n=32)
    dr.polygon(poly, fill=fill, outline=outline, width=2)


def _downscale_max_side(im: Image.Image, max_side: int) -> Image.Image:
    w, h = im.size
    m = max(w, h)
    if m <= max_side:
        return im
    s = max_side / m
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def _composite_fit_center(fg: Image.Image, cw: int, ch: int) -> Image.Image:
    fw, fh = fg.size
    scale = min(cw * 0.92 / fw, ch * 0.92 / fh)
    scale = min(scale, 3.0)
    nw, nh = max(1, int(fw * scale)), max(1, int(fh * scale))
    fg = fg.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.paste(fg, ((cw - nw) // 2, (ch - nh) // 2), fg)
    return canvas


def _grade_reference_with_palette(subject: Image.Image, pal: dict[str, tuple[int, int, int]]) -> Image.Image:
    """Warm, ripe look + user palette (yellow / orange / red blush) — keeps alpha."""
    if np is None or cv2 is None:
        return ImageEnhance.Color(subject).enhance(1.12)

    arr = np.array(subject.convert("RGBA"), dtype=np.uint8)
    rgb = arr[:, :, :3].copy()
    a = arr[:, :, 3]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1].astype(np.float32) * 1.16, 0, 255).astype(np.uint8)
    warm_rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB).astype(np.float32)
    h, w = rgb.shape[:2]
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    y_col = np.array(pal["yellow"], dtype=np.float32)
    o_col = np.array(pal["orange"], dtype=np.float32)
    tint = y_col * (1.0 - yy) + o_col * yy
    out = warm_rgb * 0.74 + tint * 0.26
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]
    row = np.clip(1.0 - np.abs(np.linspace(-1.0, 1.0, h, dtype=np.float32))[:, None, None] * 0.4, 0.35, 1.0)
    blush = np.clip((xx - 0.36) * 2.0, 0, 1) * row
    r_col = np.array(pal["red"], dtype=np.float32)
    out[:, :, 0] = np.clip(out[:, :, 0] + blush[:, :, 0] * (r_col[0] * 0.14), 0, 255)
    out[:, :, 1] = np.clip(out[:, :, 1] - blush[:, :, 0] * 10.0, 0, 255)
    out[:, :, 2] = np.clip(out[:, :, 2] - blush[:, :, 0] * 14.0, 0, 255)
    mask = (a > 20)[:, :, None]
    arr[:, :, :3] = np.where(mask, np.clip(out, 0, 255).astype(np.uint8), arr[:, :, :3])
    return Image.fromarray(arr, mode="RGBA")


def _overlay_mango_leaves(
    im: Image.Image,
    pal: dict[str, tuple[int, int, int]],
    rng: random.Random,
) -> Image.Image:
    """Extra stylized leaves at top of bbox (reference photo may lack greens)."""
    bbox = im.getbbox()
    if not bbox:
        return im
    w, h = im.size
    cx = (bbox[0] + bbox[2]) / 2.0
    stem_y = bbox[1] + (bbox[3] - bbox[1]) * 0.05
    scale = min(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.2
    g_col = pal["green"]
    dr = ImageDraw.Draw(im)
    n_leaves = rng.randint(4, 7)
    for i in range(n_leaves):
        ang = -55 + i * 32 + rng.uniform(-8, 8)
        ox = cx + math.cos(math.radians(ang + 90)) * scale * 0.35
        oy = stem_y - scale * 0.12 + math.sin(math.radians(ang)) * scale * 0.1
        lg = (
            g_col[0] + rng.randint(-20, 20),
            g_col[1] + rng.randint(-15, 15),
            g_col[2] + rng.randint(-12, 12),
            235,
        )
        og = (max(0, g_col[0] - 45), max(0, g_col[1] - 35), max(0, g_col[2] - 25), 255)
        _draw_leaf_ellipse(
            dr,
            float(ox),
            float(oy),
            scale * (0.9 + rng.uniform(-0.05, 0.08)),
            scale * (0.38 + rng.uniform(-0.04, 0.06)),
            ang,
            lg,
            og,
        )
    return im


def try_subject_from_web_reference(
    width: int,
    height: int,
    raw_command: str,
    rng: random.Random,
    subject_slug: str,
) -> Image.Image | None:
    """
    DuckDuckGo image search (server-only) → download → rembg cutout → grade → composite.
    subject_slug: e.g. mango, apple, banana, dragon_fruit (underscores ok).
    Returns None if search/download/cutout fails (caller falls back to procedural art).
    """
    query = build_photo_search_query(subject_slug, raw_command)
    urls = duckduckgo_image_urls(query, max_results=18)
    if not urls:
        return None

    low = _normalize_command_text(raw_command)
    pal = _palette_from_command(raw_command, low)

    for url in urls[:12]:
        data = fetch_url_bytes(url)
        if not data:
            continue
        try:
            im = Image.open(io.BytesIO(data))
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGBA")
        except Exception:
            continue

        if im.size[0] * im.size[1] < 70 * 70:
            continue

        im = _downscale_max_side(im, 1000)

        try:
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            raw_png = buf.getvalue()
            if rembg_remove is not None:
                cut = rembg_remove(
                    raw_png,
                    alpha_matting=True,
                    post_process_mask=True,
                    force_return_bytes=True,
                )
                if not isinstance(cut, bytes):
                    cut = bytes(cut)
                subject = Image.open(io.BytesIO(cut)).convert("RGBA")
            else:
                subject = im
        except Exception:
            continue

        a = subject.split()[-1]
        if a.getextrema()[1] < 28:
            continue

        bbox = subject.getbbox()
        if bbox:
            subject = subject.crop(bbox)

        graded = _grade_reference_with_palette(subject, pal)
        canvas = _composite_fit_center(graded, width, height)
        if subject_slug == "mango" and any(
            k in low
            for k in (
                "leaf",
                "leaves",
                "green",
                "greel",
            )
        ):
            canvas = _overlay_mango_leaves(canvas, pal, rng)
        if cv2 is not None and np is not None:
            arr = np.array(canvas, dtype=np.uint8)
            a_ch = arr[:, :, 3].astype(np.float32)
            a_ch = cv2.GaussianBlur(a_ch, (0, 0), 0.55)
            arr[:, :, 3] = np.clip(a_ch, 0, 255).astype(np.uint8)
            canvas = Image.fromarray(arr, mode="RGBA")
        return canvas

    return None


def _draw_mango_procedural(
    width: int,
    height: int,
    raw_command: str,
    rng: random.Random,
) -> Image.Image:
    """Procedural mango only (no web)."""
    w, h = width, height
    low = _normalize_command_text(raw_command)
    pal = _palette_from_command(raw_command, low)

    y_col = pal["yellow"]
    o_col = pal["orange"]
    r_col = pal["red"]
    g_col = pal["green"]

    cx, cy = w * 0.5, h * 0.52
    scale = min(w, h) * 0.38
    outline = _chaikin_closed(_mango_outline_points(cx, cy, scale), iterations=3)

    mask = Image.new("L", (w, h), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.polygon(outline, fill=255)
    if np is None:
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        dr.polygon(outline, fill=(*y_col, 240), outline=(180, 100, 20, 255), width=2)
        # minimal leaves
        stem_y = cy - scale * 0.92
        _draw_leaf_ellipse(
            dr, cx - scale * 0.35, stem_y - scale * 0.08, scale * 0.35, scale * 0.14, -35,
            (*g_col, 240), (20, 90, 30, 255),
        )
        _draw_leaf_ellipse(
            dr, cx + scale * 0.32, stem_y - scale * 0.06, scale * 0.32, scale * 0.13, 40,
            (*g_col, 230), (20, 90, 30, 255),
        )
        return im

    m = np.array(mask, dtype=np.float32) / 255.0
    yy, xx = np.indices((h, w))
    # Normalized coords relative to center (-1..1)
    nx = (xx - cx) / (scale + 1e-6)
    ny = (yy - cy) / (scale + 1e-6)

    # Vertical ripeness: more orange/red toward bottom
    vy = (ny + 0.9) / 1.85
    vy = np.clip(vy, 0, 1)
    base_r = y_col[0] * (1 - vy) + o_col[0] * vy
    base_g = y_col[1] * (1 - vy) + o_col[1] * vy
    base_b = y_col[2] * (1 - vy) + o_col[2] * vy

    # Red blush on right cheek
    blush = np.clip((nx - 0.05) * 2.2, 0, 1) * np.clip(1.0 - np.abs(ny) * 1.1, 0, 1)
    base_r = base_r * (1 - blush * 0.35) + r_col[0] * (blush * 0.65)
    base_g = base_g * (1 - blush * 0.25) + r_col[1] * (blush * 0.45)
    base_b = base_b * (1 - blush * 0.2) + r_col[2] * (blush * 0.35)

    # Subtle highlight (light from top-left)
    hl = np.clip(1.0 - 0.9 * ((nx + 0.35) ** 2 + (ny + 0.55) ** 2), 0, 1)
    base_r = np.clip(base_r + hl * 35, 0, 255)
    base_g = np.clip(base_g + hl * 30, 0, 255)
    base_b = np.clip(base_b + hl * 10, 0, 255)

    alpha = (m * 255).astype(np.uint8)
    base_r = np.clip(base_r, 0, 255)
    base_g = np.clip(base_g, 0, 255)
    base_b = np.clip(base_b, 0, 255)
    rgb = np.stack(
        [
            base_r.astype(np.uint8),
            base_g.astype(np.uint8),
            base_b.astype(np.uint8),
        ],
        axis=-1,
    )
    rgb = np.where(m[..., None] > 0.01, rgb, 0)
    rgba = np.dstack([rgb, alpha])

    im = Image.fromarray(rgba, mode="RGBA")
    dr = ImageDraw.Draw(im)

    # Stem nub
    stem_top = cy - scale * 0.92
    dr.ellipse(
        [
            cx - scale * 0.06,
            stem_top - scale * 0.08,
            cx + scale * 0.06,
            stem_top + scale * 0.04,
        ],
        fill=(120, 75, 35, 255),
        outline=(80, 50, 25, 255),
        width=1,
    )

    n_leaves = rng.randint(4, 6) if "many" in low else 3
    for i in range(n_leaves):
        ang = -50 + i * 38 + rng.uniform(-6, 6)
        ox = cx + math.cos(math.radians(ang + 90)) * scale * 0.15
        oy = stem_top - scale * 0.05 + math.sin(math.radians(ang)) * scale * 0.08
        lg = (
            g_col[0] + rng.randint(-15, 15),
            g_col[1] + rng.randint(-10, 10),
            g_col[2] + rng.randint(-8, 8),
            245,
        )
        og = (max(0, g_col[0] - 40), max(0, g_col[1] - 30), max(0, g_col[2] - 20), 255)
        _draw_leaf_ellipse(
            dr,
            float(ox),
            float(oy),
            scale * (0.28 + rng.uniform(-0.02, 0.04)),
            scale * (0.11 + rng.uniform(-0.01, 0.02)),
            ang,
            lg,
            og,
        )
    # Tiny vein line on leaves
    dr.line(
        [(cx - scale * 0.2, stem_top - scale * 0.02), (cx - scale * 0.05, stem_top + scale * 0.1)],
        fill=(25, 100, 40, 180),
        width=max(1, int(scale * 0.015)),
    )

    # Slight edge softening (OpenCV + NumPy); keeps PNG alpha clean
    if cv2 is not None:
        arr = np.array(im, dtype=np.uint8)
        a = arr[:, :, 3]
        rgb = arr[:, :, :3]
        rgb = cv2.GaussianBlur(rgb, (3, 3), 0)
        arr[:, :, :3] = np.where(a[:, :, None] > 8, rgb, arr[:, :, :3])
        a2 = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 0.65)
        arr[:, :, 3] = np.clip(a2, 0, 255).astype(np.uint8)
        im = Image.fromarray(arr, mode="RGBA")

    return im


def _draw_apple_procedural(
    width: int,
    height: int,
    raw_command: str,
    rng: random.Random,
    subject_slug: str,
) -> Image.Image:
    low = _normalize_command_text(raw_command)
    pal = _palette_from_command(raw_command, low)
    w, h = width, height
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    cx, cy = w // 2, h // 2
    r = int(min(w, h) * 0.24)
    green = subject_slug == "green_apple" or ("green" in low and "red" not in low)
    if green:
        fill = (*pal["green"][:3], 245)
        stroke = (max(0, pal["green"][0] - 50), max(0, pal["green"][1] - 40), max(0, pal["green"][2] - 30), 255)
    else:
        fill = (*pal["red"][:3], 245)
        stroke = (max(0, pal["red"][0] - 60), 30, 30, 255)
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=stroke, width=3)
    dr.ellipse(
        [cx - r // 2, cy - r + r // 5, cx + r // 6, cy - r // 4],
        fill=(255, 255, 255, 70),
    )
    stem_w = max(3, r // 12)
    dr.rectangle(
        [cx - stem_w, cy - r - int(r * 0.22), cx + stem_w, cy - r + stem_w],
        fill=(95, 58, 32, 255),
        outline=(55, 35, 20, 255),
        width=1,
    )
    return im


def _draw_banana_procedural(
    width: int,
    height: int,
    raw_command: str,
    rng: random.Random,
) -> Image.Image:
    low = _normalize_command_text(raw_command)
    pal = _palette_from_command(raw_command, low)
    w, h = width, height
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    cx, cy = w // 2, h // 2
    rw = int(min(w, h) * 0.38)
    rh = int(min(w, h) * 0.14)
    yel = (*pal["yellow"][:3], 245)
    edge = (200, 150, 40, 255)
    poly = _rotated_ellipse_polygon(float(cx), float(cy), float(rw * 2), float(rh * 2), -22.0, n=48)
    dr.polygon(poly, fill=yel, outline=edge, width=3)
    tip1 = poly[5] if len(poly) > 5 else (cx + rw, cy)
    tip2 = poly[-3] if len(poly) > 3 else (cx - rw, cy)
    dr.ellipse([tip1[0] - 5, tip1[1] - 5, tip1[0] + 5, tip1[1] + 5], fill=(120, 90, 40, 220))
    dr.ellipse([tip2[0] - 5, tip2[1] - 5, tip2[0] + 5, tip2[1] + 5], fill=(90, 70, 35, 220))
    return im


def _draw_generic_fruit_procedural(
    width: int,
    height: int,
    subject_slug: str,
    raw_command: str,
    rng: random.Random,
) -> Image.Image:
    low = _normalize_command_text(raw_command)
    pal = _palette_from_command(raw_command, low)
    w, h = width, height
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    cx, cy = w // 2, h // 2
    rx = int(min(w, h) * 0.28)
    ry = int(min(w, h) * 0.22)
    base = pal["orange"] if subject_slug in ("orange", "orange_fruit") else pal["yellow"]
    if subject_slug in ("lemon", "lime"):
        base = (255, 240, 120) if subject_slug == "lemon" else (160, 210, 80)
    fill = (*base[:3], 238) if isinstance(base, tuple) else (*pal["yellow"][:3], 238)
    dr.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill, outline=(120, 90, 40, 255), width=2)
    return im


def draw_subject_procedural_fallback(subject_slug: str, width: int, height: int, raw_command: str, rng: random.Random) -> Image.Image:
    """When web search / rembg fails — still match subject (not a random circle)."""
    if subject_slug == "mango":
        return _draw_mango_procedural(width, height, raw_command, rng)
    if subject_slug in ("apple", "green_apple", "red_apple"):
        return _draw_apple_procedural(width, height, raw_command, rng, subject_slug)
    if subject_slug == "banana":
        return _draw_banana_procedural(width, height, raw_command, rng)
    return _draw_generic_fruit_procedural(width, height, subject_slug, raw_command, rng)


def draw_mango_scene(
    width: int,
    height: int,
    raw_command: str,
    rng: random.Random,
) -> Image.Image:
    """Backward-compatible alias — procedural mango only."""
    return _draw_mango_procedural(width, height, raw_command, rng)


def generate_shape_from_command(
    command: str,
    width: int = 512,
    height: int = 512,
    seed: int | None = None,
) -> tuple[bytes, str]:
    """
    Interpret a free-text command and draw a PNG (RGBA).
    Examples: "red circle 200", "blue star", "gradient purple blue", "abstract", "hexagon green"
    """
    raw = (command or "").strip()
    if not raw:
        raw = "abstract blue"

    w = max(64, min(int(width), 2048))
    h = max(64, min(int(height), 2048))
    rng = random.Random(seed if seed is not None else random.randint(0, 2**30))
    low = _normalize_command_text(raw)

    # Delegate to existing styles
    if any(k in low for k in ("abstract", "random", "organic", "mesh", "crystal", "network", "magic")):
        style = "organic"
        if "mesh" in low or "geometric" in low:
            style = "geometric"
        elif "crystal" in low:
            style = "crystal"
        elif "network" in low:
            style = "network"
        return generate_magic_shape_png(w, h, style=style, seed=rng.randint(0, 2**30))

    # Named fruits / foods → web photo + cutout (else procedural silhouette — never a plain circle)
    ref_subj = detect_reference_subject(low)
    if ref_subj:
        ref_img = try_subject_from_web_reference(w, h, raw, rng, ref_subj)
        if ref_img is None:
            ref_img = draw_subject_procedural_fallback(ref_subj, w, h, raw, rng)
        buf = io.BytesIO()
        ref_img.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png"

    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    fill = _parse_color(raw, (56, 189, 248, 220))
    stroke = (
        max(0, fill[0] - 40),
        max(0, fill[1] - 40),
        max(0, fill[2] - 40),
        255,
    )
    cx, cy = w // 2, h // 2
    size = _first_int(raw, min(w, h) // 3)

    def poly_points(sides: int, r: float) -> list[tuple[float, float]]:
        pts = []
        for i in range(sides):
            a = -math.pi / 2 + (math.tau / sides) * i
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        return pts

    if "gradient" in low:
        c2 = _parse_color(raw.replace("gradient", ""), (129, 140, 248, 255))
        # Vertical blend using thin rects
        for y in range(h):
            t = y / max(h - 1, 1)
            r = int(fill[0] * (1 - t) + c2[0] * t)
            g = int(fill[1] * (1 - t) + c2[1] * t)
            b = int(fill[2] * (1 - t) + c2[2] * t)
            dr.line([(0, y), (w, y)], fill=(r, g, b, 255), width=1)
    elif "star" in low or "tara" in low or "तारा" in raw:
        spikes = 5
        m = re.search(r"(\d+)\s*point", low)
        if m:
            spikes = max(3, min(16, int(m.group(1))))
        outer = size // 2
        inner = outer // 2
        pts = []
        for i in range(spikes * 2):
            a = -math.pi / 2 + (math.pi / spikes) * i
            r = outer if i % 2 == 0 else inner
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        dr.polygon(pts, fill=fill, outline=stroke, width=2)
    elif "triangle" in low or "tri" in low:
        pts = poly_points(3, size / 2)
        dr.polygon(pts, fill=fill, outline=stroke, width=2)
    elif "hexagon" in low:
        pts = poly_points(6, size / 2)
        dr.polygon(pts, fill=fill, outline=stroke, width=2)
    elif "pentagon" in low:
        pts = poly_points(5, size / 2)
        dr.polygon(pts, fill=fill, outline=stroke, width=2)
    elif "diamond" in low:
        pts = [(cx, cy - size // 2), (cx + size // 2, cy), (cx, cy + size // 2), (cx - size // 2, cy)]
        dr.polygon(pts, fill=fill, outline=stroke, width=2)
    elif "square" in low or "rect" in low:
        r = size // 2
        dr.rectangle([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=stroke, width=3)
    elif "ring" in low or "donut" in low:
        r_out = size // 2
        r_in = max(10, r_out * 2 // 3)
        dr.ellipse(
            [cx - r_out, cy - r_out, cx + r_out, cy + r_out],
            outline=fill,
            width=max(6, r_out - r_in),
        )
    elif "line" in low or "arrow" in low:
        x1, x2 = cx - size // 2, cx + size // 2
        dr.line([(x1, cy), (x2, cy)], fill=fill, width=max(4, size // 40))
        if "arrow" in low:
            aw = size // 8
            dr.polygon([(x2, cy), (x2 - aw, cy - aw // 2), (x2 - aw, cy + aw // 2)], fill=fill)
    elif "heart" in low:
        r = max(12, size // 5)
        dr.ellipse([cx - r - r // 2, cy - r, cx - r // 2, cy + r], fill=fill)
        dr.ellipse([cx + r // 2, cy - r, cx + r + r // 2, cy + r], fill=fill)
        dr.polygon([(cx - r * 2, cy), (cx + r * 2, cy), (cx, cy + int(r * 2.4))], fill=fill)
    elif "circle" in low or "ellipse" in low or "gol" in low:
        r = size // 2
        ry = r if "ellipse" not in low else int(r * 0.65)
        dr.ellipse([cx - r, cy - ry, cx + r, cy + ry], fill=fill, outline=stroke, width=2)
    elif "wave" in low:
        pts = []
        step = w / 40
        for i in range(41):
            x = i * step
            y = cy + math.sin(i * 0.5) * (size // 4)
            pts.append((x, y))
        dr.line(pts, fill=fill, width=max(3, size // 50))
    else:
        # Default: soft circle
        r = size // 2
        dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=stroke, width=2)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


def png_bytes_to_gif(png_bytes: bytes) -> tuple[bytes, str]:
    """Encode image bytes (PNG/RGBA) as a GIF."""
    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    buf = io.BytesIO()
    im.save(buf, format="GIF", optimize=True)
    return buf.getvalue(), "image/gif"
