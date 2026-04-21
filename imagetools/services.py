"""Background removal and compositing helpers."""

from __future__ import annotations

import io
import logging
import os
import re
from typing import BinaryIO

logger = logging.getLogger(__name__)

import numpy as np
from django.conf import settings
from PIL import Image, ImageOps
from rembg import remove


MAX_DIMENSION = 4096
MAX_FILE_BYTES = int(getattr(settings, "FILE_UPLOAD_MAX_MEMORY_SIZE", 20 * 1024 * 1024))

# Preset gradient keys → (top_rgb, bottom_rgb) linear top-to-bottom
GRADIENT_PRESETS: dict[str, tuple[tuple[int, int, int], tuple[int, int, int]]] = {
    "sunset": ((255, 94, 77), (106, 17, 203)),
    "ocean": ((2, 27, 121), (0, 212, 255)),
    "forest": ((22, 91, 45), (144, 238, 144)),
    "studio": ((245, 245, 250), (200, 200, 210)),
    "peach": ((255, 216, 177), (255, 154, 158)),
    "midnight": ((25, 25, 112), (72, 61, 139)),
}


def _clamp_size(w: int, h: int) -> tuple[int, int]:
    m = max(w, h)
    if m <= MAX_DIMENSION:
        return w, h
    scale = MAX_DIMENSION / m
    return max(1, int(w * scale)), max(1, int(h * scale))


def _read_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGBA")


def remove_background(
    data: bytes,
    *,
    alpha_matting: bool = True,
    post_process_mask: bool = True,
) -> bytes:
    """
    Return PNG bytes with alpha (subject kept, background removed).
    Uses alpha matting + mask cleanup for cleaner hair and edges (slower than naive).
    """
    out = remove(
        data,
        alpha_matting=alpha_matting,
        post_process_mask=post_process_mask,
        force_return_bytes=True,
    )
    if isinstance(out, bytes):
        return out
    return bytes(out)


def normalize_input_bytes(foreground_bytes: bytes) -> tuple[bytes, int, int]:
    """Resize if needed; return bytes suitable for rembg and final dimensions after cut."""
    if len(foreground_bytes) > MAX_FILE_BYTES:
        raise ValueError("File too large")

    fg_img = _read_image(foreground_bytes)
    ow, oh = fg_img.size
    nw, nh = _clamp_size(ow, oh)
    if (nw, nh) != (ow, oh):
        fg_img = fg_img.resize((nw, nh), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        fg_img.save(buf, format="PNG")
        return buf.getvalue(), nw, nh
    return foreground_bytes, ow, oh


def extract_cutout_png(foreground_bytes: bytes) -> tuple[bytes, int, int]:
    """
    Full pipeline: normalize → rembg with careful edges → optimized PNG.
    Returns (png_bytes, width, height).
    """
    to_remove, _w, _h = normalize_input_bytes(foreground_bytes)
    cut_bytes = remove_background(to_remove)
    subject = Image.open(io.BytesIO(cut_bytes)).convert("RGBA")
    w, h = subject.size
    out = io.BytesIO()
    subject.save(out, format="PNG", optimize=True)
    return out.getvalue(), w, h


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    s = value.strip()
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", s):
        raise ValueError("Invalid hex color")
    if s.startswith("#"):
        s = s[1:]
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def solid_background(size: tuple[int, int], rgb: tuple[int, int, int]) -> Image.Image:
    w, h = size
    return Image.new("RGB", (w, h), rgb)


def linear_gradient_rgb(
    size: tuple[int, int],
    top: tuple[int, int, int],
    bottom: tuple[int, int, int],
) -> Image.Image:
    w, h = size
    arr = np.empty((h, w, 3), dtype=np.uint8)
    t_vec = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, np.newaxis]
    top_a = np.array(top, dtype=np.float32)
    bot_a = np.array(bottom, dtype=np.float32)
    row = top_a * (1 - t_vec) + bot_a * t_vec
    arr[:, :] = np.clip(row, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def cover_resize_center(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Scale image to cover target box, center-crop."""
    img = img.convert("RGB")
    tw, th = img.size
    scale = max(target_w / tw, target_h / th)
    nw, nh = max(1, int(round(tw * scale))), max(1, int(round(th * scale)))
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - target_w) // 2
    top = (nh - target_h) // 2
    return img.crop((left, top, left + target_w, top + target_h))


def composite_subject_on_background(
    subject_rgba: Image.Image,
    background_rgb: Image.Image,
) -> Image.Image:
    """Alpha-composite subject over background (same size)."""
    if subject_rgba.size != background_rgb.size:
        background_rgb = cover_resize_center(
            background_rgb, subject_rgba.width, subject_rgba.height
        )
    bg = background_rgb.convert("RGBA")
    fg = subject_rgba.convert("RGBA")
    return Image.alpha_composite(bg, fg)


def process_pipeline(
    foreground_bytes: bytes,
    *,
    transparent_only: bool,
    bg_kind: str,
    color_hex: str | None,
    template_key: str | None,
    background_file: BinaryIO | None,
) -> tuple[bytes, str]:
    """
    Returns (png_bytes, suggested_filename).
    bg_kind: 'transparent' | 'color' | 'template' | 'upload'
    """
    cut_bytes, _w, _h = extract_cutout_png(foreground_bytes)
    subject = Image.open(io.BytesIO(cut_bytes)).convert("RGBA")

    w, h = subject.size
    fname = "cutout.png"

    if transparent_only or bg_kind == "transparent":
        out = io.BytesIO()
        subject.save(out, format="PNG", optimize=True)
        return out.getvalue(), fname

    if bg_kind == "color":
        if not color_hex:
            raise ValueError("Color required")
        rgb = hex_to_rgb(color_hex)
        bg = solid_background((w, h), rgb)
    elif bg_kind == "template":
        key = (template_key or "").strip().lower()
        if key not in GRADIENT_PRESETS:
            raise ValueError("Unknown template")
        top, bottom = GRADIENT_PRESETS[key]
        bg = linear_gradient_rgb((w, h), top, bottom)
    elif bg_kind == "upload":
        if background_file is None:
            raise ValueError("Background image required")
        raw = background_file.read()
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("Background file too large")
        bg = _read_image(raw).convert("RGB")
        bg = cover_resize_center(bg, w, h)
    else:
        raise ValueError("Invalid background mode")

    result = composite_subject_on_background(subject, bg)
    out = io.BytesIO()
    result.save(out, format="PNG", optimize=True)
    return out.getvalue(), "result.png"


# Rectangles: high limit for batching many small boxes.
MAX_INPAINT_RECTANGLES = 20000


def _validate_norm_regions(
    regions: list[dict[str, float]],
) -> list[tuple[float, float, float, float]]:
    if len(regions) > MAX_INPAINT_RECTANGLES:
        raise ValueError(
            f"Too many rectangles ({len(regions)}). Max {MAX_INPAINT_RECTANGLES}."
        )
    out: list[tuple[float, float, float, float]] = []
    for i, r in enumerate(regions):
        try:
            x = float(r["x"])
            y = float(r["y"])
            w = float(r["w"])
            h = float(r["h"])
        except (KeyError, TypeError, ValueError) as e:
            raise ValueError(f"Invalid region #{i + 1}") from e
        if w <= 0 or h <= 0:
            raise ValueError(f"Region #{i + 1} must have positive size")
        if not (0 <= x < 1 and 0 <= y < 1 and x + w <= 1 + 1e-6 and y + h <= 1 + 1e-6):
            raise ValueError(f"Region #{i + 1} is outside the image")
        out.append((max(0.0, x), max(0.0, y), min(w, 1.0 - x), min(h, 1.0 - y)))
    if not out:
        raise ValueError("Add at least one rectangle over the text to remove")
    return out


def _mask_from_norm_rects(w: int, h: int, normed: list[tuple[float, float, float, float]]) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    for rx, ry, rw, rh in normed:
        x0 = int(rx * w)
        y0 = int(ry * h)
        x1 = int((rx + rw) * w)
        y1 = int((ry + rh) * h)
        x0, x1 = sorted((max(0, x0), min(w, x1)))
        y0, y1 = sorted((max(0, y0), min(h, y1)))
        if x1 <= x0 or y1 <= y0:
            continue
        mask[y0:y1, x0:x1] = 255
    return mask


def _prepare_inpaint_mask(mask_u8: np.ndarray) -> np.ndarray:
    """Clean user mask: binarize, close small gaps in brush strokes."""
    import cv2

    m = (mask_u8 > 96).astype(np.uint8) * 255
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k3, iterations=1)
    return m


def _adaptive_inpaint_radius(r_user: int, coverage: float) -> int:
    """
    Classical inpaint smears when the hole is huge or radius is huge.
    Tighter radius keeps synthesis more local → less muddy blur on textures (snow, rust).
    """
    r = max(3, min(28, int(r_user)))
    if coverage <= 0.02:
        return r
    if coverage >= 0.18:
        return min(r, 9)
    if coverage >= 0.08:
        return min(r, 10 + int((0.18 - coverage) / 0.10 * 5))
    # 0.02 < cov < 0.08
    t = (coverage - 0.02) / 0.06
    cap = int(r * (1.0 - 0.35 * t))
    return max(5, min(r, cap))


def _rgb_to_png_bytes(rgb: np.ndarray) -> bytes:
    pil = Image.fromarray(rgb, mode="RGB")
    buf = io.BytesIO()
    pil.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _inpaint_opencv_fallback(
    rgb: np.ndarray,
    m: np.ndarray,
    inpaint_radius: int,
) -> bytes:
    """
    Classical OpenCV inpaint (fallback). Tuned NS + light dilation; can look blurry
    on texture compared to LaMa.
    """
    import cv2

    h, w = m.shape[:2]
    coverage = float(np.count_nonzero(m)) / float(h * w)
    r = _adaptive_inpaint_radius(inpaint_radius, coverage)

    kd = max(3, min(7, (r + 2) // 4)) | 1
    dil_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kd, kd))
    mask_d = cv2.dilate(m, dil_kernel, iterations=1)

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    out_bgr = cv2.inpaint(bgr, mask_d, inpaintRadius=r, flags=cv2.INPAINT_NS)

    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    inner = cv2.erode(mask_d, k3, iterations=2)
    if np.any(inner):
        boundary_band = cv2.subtract(mask_d, inner)
        if np.any(boundary_band):
            r2 = max(3, min(14, (r * 2 + 2) // 3))
            out_bgr = cv2.inpaint(
                out_bgr, boundary_band, inpaintRadius=r2, flags=cv2.INPAINT_NS
            )

    out_rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)
    return _rgb_to_png_bytes(out_rgb)


def _inpaint_rgb_with_mask(
    rgb: np.ndarray,
    mask_u8: np.ndarray,
    inpaint_radius: int,
) -> bytes:
    """
    Neural inpainting (LaMa ONNX) when enabled; OpenCV NS inpaint as fallback.

    Set IMAGETOOLS_USE_LAMA=0 to force OpenCV only.
    """
    if mask_u8.shape[0] != rgb.shape[0] or mask_u8.shape[1] != rgb.shape[1]:
        raise ValueError("Mask size must match image")
    if not np.any(mask_u8):
        raise ValueError("Selection is empty — mark text to remove")

    m = _prepare_inpaint_mask(mask_u8)
    if not np.any(m):
        raise ValueError("Selection is empty — mark text to remove")

    use_lama = os.environ.get("IMAGETOOLS_USE_LAMA", "1").strip() != "0"
    if use_lama:
        try:
            from . import lama_onnx

            out = lama_onnx.infer_lama(rgb, m)
            return _rgb_to_png_bytes(out)
        except Exception as e:
            logger.warning(
                "LaMa inpaint unavailable (%s); using OpenCV fallback.",
                e,
            )

    return _inpaint_opencv_fallback(rgb, m, inpaint_radius)


def inpaint_text_regions(
    image_bytes: bytes,
    regions: list[dict[str, float]],
    *,
    inpaint_radius: int = 8,
) -> bytes:
    """
    Remove content inside axis-aligned rectangles (LaMa neural inpaint + OpenCV fallback).
    Regions use normalized coordinates: x, y, width, height in [0, 1].
    """
    if len(image_bytes) > MAX_FILE_BYTES:
        raise ValueError("File too large")

    normed = _validate_norm_regions(regions)
    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    rgb = np.array(img.convert("RGB"))
    h, w = rgb.shape[:2]
    if max(w, h) > MAX_DIMENSION:
        raise ValueError("Image dimensions too large")

    mask = _mask_from_norm_rects(w, h, normed)
    return _inpaint_rgb_with_mask(rgb, mask, inpaint_radius)


def inpaint_with_selection_mask(
    image_bytes: bytes,
    mask_bytes: bytes,
    *,
    inpaint_radius: int = 8,
) -> bytes:
    """
    Inpaint using a user mask (white = remove, black = keep). LaMa ONNX first, else OpenCV.
    Mask is resized to match the image with nearest-neighbor (sharp edges).
    """
    if len(image_bytes) > MAX_FILE_BYTES or len(mask_bytes) > MAX_FILE_BYTES:
        raise ValueError("File too large")

    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    rgb = np.array(img.convert("RGB"))
    h, w = rgb.shape[:2]
    if max(w, h) > MAX_DIMENSION:
        raise ValueError("Image dimensions too large")

    m = Image.open(io.BytesIO(mask_bytes)).convert("L")
    m = m.resize((w, h), Image.Resampling.NEAREST)
    mask = np.array(m, dtype=np.uint8)
    mask = np.where(mask > 96, 255, 0).astype(np.uint8)

    return _inpaint_rgb_with_mask(rgb, mask, inpaint_radius)
