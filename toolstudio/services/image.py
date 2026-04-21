"""Image enhancement and vector-style export."""

from __future__ import annotations

import io
import xml.sax.saxutils as xml_esc

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


# ---------------------------------------------------------------------------
# Auto-enhance (CLAHE + mild colour / sharpness)
# ---------------------------------------------------------------------------
def auto_enhance_image(data: bytes) -> tuple[bytes, str]:
    """
    One-click enhancement: adaptive CLAHE (LAB), gentle autocontrast, mild color lift,
    and unsharp masking. Tuned for typical phone/camera photos (dark, flat, hazy).
    Returns (PNG bytes, mime).
    """
    import cv2

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    max_edge = max(w, h)
    if max_edge > 4096:
        s = 4096 / max_edge
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    rgb = np.asarray(im, dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    mean_l = float(np.mean(l_ch))

    # Dark scenes need stronger local contrast; bright scenes gentler
    if mean_l < 70:
        clip = 3.0
    elif mean_l < 110:
        clip = 2.2
    else:
        clip = 1.6

    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    l2 = clahe.apply(l_ch)
    lab2 = cv2.merge([l2, a_ch, b_ch])
    bgr2 = cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)
    rgb2 = cv2.cvtColor(bgr2, cv2.COLOR_BGR2RGB)
    out = Image.fromarray(rgb2)

    cutoff = 1.2 if mean_l < 95 else 0.6
    out = ImageOps.autocontrast(out, cutoff=cutoff)

    # Slight vibrance if the image looks washed out (low color variance)
    arr = np.asarray(out).astype(np.float32) / 255.0
    std = float(np.std(arr))
    if std < 0.12:
        out = ImageEnhance.Color(out).enhance(1.12)
    else:
        out = ImageEnhance.Color(out).enhance(1.05)

    out = ImageEnhance.Sharpness(out).enhance(1.15)
    out = out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=125, threshold=2))

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Manual enhance (individual sliders)
# ---------------------------------------------------------------------------
def enhance_image(
    data: bytes,
    *,
    brightness: float = 1.0,
    contrast: float = 1.0,
    sharpness: float = 1.0,
    saturation: float = 1.0,
    autocontrast: bool = False,
) -> tuple[bytes, str]:
    """
    Returns (png_or_jpeg_bytes, mime).
    brightness/contrast/sharpness/saturation: 1.0 = no change, typical 0.5–1.8
    """
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")

    if autocontrast:
        im = ImageOps.autocontrast(im, cutoff=1)

    if brightness != 1.0:
        im = ImageEnhance.Brightness(im).enhance(brightness)
    if contrast != 1.0:
        im = ImageEnhance.Contrast(im).enhance(contrast)
    if saturation != 1.0:
        im = ImageEnhance.Color(im).enhance(saturation)
    if sharpness != 1.0:
        im = ImageEnhance.Sharpness(im).enhance(sharpness)

    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Upscale (Lanczos + sharpen)
# ---------------------------------------------------------------------------
def upscale_image(data: bytes, scale: int = 2) -> tuple[bytes, str]:
    """Upscale image by 2x or 4x using Lanczos interpolation + sharpening."""
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    scale = max(1, min(scale, 4))
    new_w, new_h = w * scale, h * scale
    max_dim = 8192
    if max(new_w, new_h) > max_dim:
        ratio = max_dim / max(new_w, new_h)
        new_w = int(new_w * ratio)
        new_h = int(new_h * ratio)
    im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    im = ImageEnhance.Sharpness(im).enhance(1.25)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.5, percent=100, threshold=2))
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Denoise (OpenCV fastNlMeansDenoising)
# ---------------------------------------------------------------------------
def denoise_image(data: bytes, strength: int = 10) -> tuple[bytes, str]:
    """Remove noise from image using OpenCV non-local means denoising."""
    import cv2

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    max_edge = max(w, h)
    if max_edge > 4096:
        s = 4096 / max_edge
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    arr = np.asarray(im, dtype=np.uint8)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    strength = max(1, min(strength, 30))
    denoised = cv2.fastNlMeansDenoisingColored(bgr, None, strength, strength, 7, 21)
    rgb_out = cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB)
    out = Image.fromarray(rgb_out)
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Deblur / sharpen (Unsharp mask based)
# ---------------------------------------------------------------------------
def deblur_image(data: bytes, strength: float = 1.5) -> tuple[bytes, str]:
    """Deblur/sharpen using unsharp mask and Laplacian sharpening."""
    import cv2

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    max_edge = max(w, h)
    if max_edge > 4096:
        s = 4096 / max_edge
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    strength = max(0.5, min(strength, 4.0))
    arr = np.asarray(im, dtype=np.uint8)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

    # Laplacian-based sharpening
    blur = cv2.GaussianBlur(bgr, (0, 0), 3)
    sharp = cv2.addWeighted(bgr, 1.0 + strength, blur, -strength, 0)
    sharp = np.clip(sharp, 0, 255).astype(np.uint8)

    rgb_out = cv2.cvtColor(sharp, cv2.COLOR_BGR2RGB)
    out = Image.fromarray(rgb_out)
    # Additional Pillow-level unsharp mask
    pct = int(80 * strength)
    out = out.filter(ImageFilter.UnsharpMask(radius=2.0, percent=pct, threshold=2))
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Face enhance (detect faces → local CLAHE + sharpen on face regions)
# ---------------------------------------------------------------------------
def face_enhance_image(data: bytes) -> tuple[bytes, str]:
    """Detect faces and apply localised enhancement to skin/features."""
    import cv2

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    max_edge = max(w, h)
    if max_edge > 4096:
        s = 4096 / max_edge
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    arr = np.asarray(im, dtype=np.uint8).copy()
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # Try to find Haar cascade for face detection
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

    if len(faces) > 0:
        for (fx, fy, fw, fh) in faces:
            # Expand region by 20%
            pad_x = int(fw * 0.2)
            pad_y = int(fh * 0.2)
            x1 = max(0, fx - pad_x)
            y1 = max(0, fy - pad_y)
            x2 = min(bgr.shape[1], fx + fw + pad_x)
            y2 = min(bgr.shape[0], fy + fh + pad_y)

            face_roi = bgr[y1:y2, x1:x2]
            # Apply CLAHE to face region
            lab = cv2.cvtColor(face_roi, cv2.COLOR_BGR2LAB)
            l_ch, a_ch, b_ch = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
            l2 = clahe.apply(l_ch)
            lab2 = cv2.merge([l2, a_ch, b_ch])
            enhanced_roi = cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)

            # Slight bilateral filter for skin smoothing
            enhanced_roi = cv2.bilateralFilter(enhanced_roi, 5, 40, 40)

            # Sharpen face
            blur = cv2.GaussianBlur(enhanced_roi, (0, 0), 1.5)
            enhanced_roi = cv2.addWeighted(enhanced_roi, 1.3, blur, -0.3, 0)

            bgr[y1:y2, x1:x2] = enhanced_roi

    # Also do mild global enhancement
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
    l2 = clahe.apply(l_ch)
    lab2 = cv2.merge([l2, a_ch, b_ch])
    bgr = cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)

    rgb_out = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    out = Image.fromarray(rgb_out)
    out = ImageEnhance.Sharpness(out).enhance(1.1)
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Color correction (white balance + vibrancy)
# ---------------------------------------------------------------------------
def color_correct_image(data: bytes, warmth: float = 0.0, vibrance: float = 1.0) -> tuple[bytes, str]:
    """
    Adjust white balance (warmth: -1 cool to +1 warm) and vibrance (0.5–2.0).
    """
    import cv2

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    max_edge = max(w, h)
    if max_edge > 4096:
        s = 4096 / max_edge
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    arr = np.asarray(im, dtype=np.float32)

    # White balance: shift blue/red channels
    warmth = max(-1.0, min(1.0, warmth))
    if warmth != 0:
        # Warm = boost red slightly, cool blue; Cool = opposite
        arr[:, :, 0] = np.clip(arr[:, :, 0] + warmth * 15, 0, 255)  # R
        arr[:, :, 2] = np.clip(arr[:, :, 2] - warmth * 15, 0, 255)  # B

    out = Image.fromarray(arr.astype(np.uint8))

    # Vibrance
    vibrance = max(0.5, min(2.0, vibrance))
    if vibrance != 1.0:
        out = ImageEnhance.Color(out).enhance(vibrance)

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# Combined full pipeline (Cutout.pro style)
# ---------------------------------------------------------------------------
def full_enhance_pipeline(
    data: bytes,
    *,
    brightness: float = 1.0,
    contrast: float = 1.0,
    sharpness: float = 1.0,
    saturation: float = 1.0,
    denoise_strength: int = 0,
    deblur_strength: float = 0.0,
    upscale_factor: int = 1,
    warmth: float = 0.0,
    face_enhance: bool = False,
    auto_enhance: bool = False,
) -> tuple[bytes, str]:
    """
    Combined enhancement pipeline — applies all adjustments in optimal order.
    Returns (PNG bytes, mime).
    """
    import cv2

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    w, h = im.size
    max_edge = max(w, h)
    if max_edge > 4096:
        s = 4096 / max_edge
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    # Step 1: Denoise first (before other processing)
    if denoise_strength > 0:
        arr = np.asarray(im, dtype=np.uint8)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        strength = max(1, min(denoise_strength, 30))
        denoised = cv2.fastNlMeansDenoisingColored(bgr, None, strength, strength, 7, 21)
        rgb_out = cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB)
        im = Image.fromarray(rgb_out)

    # Step 2: Auto CLAHE if requested
    if auto_enhance:
        arr = np.asarray(im, dtype=np.uint8)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        mean_l = float(np.mean(l_ch))
        clip = 3.0 if mean_l < 70 else (2.2 if mean_l < 110 else 1.6)
        clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
        l2 = clahe.apply(l_ch)
        lab2 = cv2.merge([l2, a_ch, b_ch])
        bgr2 = cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)
        rgb2 = cv2.cvtColor(bgr2, cv2.COLOR_BGR2RGB)
        im = Image.fromarray(rgb2)
        cutoff = 1.2 if mean_l < 95 else 0.6
        im = ImageOps.autocontrast(im, cutoff=cutoff)

    # Step 3: Face enhance
    if face_enhance:
        arr = np.asarray(im, dtype=np.uint8).copy()
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30, 30))
        for (fx, fy, fw, fh) in faces:
            pad_x, pad_y = int(fw * 0.15), int(fh * 0.15)
            x1 = max(0, fx - pad_x)
            y1 = max(0, fy - pad_y)
            x2 = min(bgr.shape[1], fx + fw + pad_x)
            y2 = min(bgr.shape[0], fy + fh + pad_y)
            roi = bgr[y1:y2, x1:x2]
            roi = cv2.bilateralFilter(roi, 5, 35, 35)
            lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)
            lc, ac, bc = cv2.split(lab)
            cl = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(4, 4))
            lc = cl.apply(lc)
            roi = cv2.cvtColor(cv2.merge([lc, ac, bc]), cv2.COLOR_LAB2BGR)
            bgr[y1:y2, x1:x2] = roi
        im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

    # Step 4: Adjustments
    if brightness != 1.0:
        im = ImageEnhance.Brightness(im).enhance(max(0.2, min(2.5, brightness)))
    if contrast != 1.0:
        im = ImageEnhance.Contrast(im).enhance(max(0.2, min(2.5, contrast)))
    if saturation != 1.0:
        im = ImageEnhance.Color(im).enhance(max(0.0, min(2.5, saturation)))

    # Step 5: Warmth / color correction
    if warmth != 0:
        arr = np.asarray(im, dtype=np.float32)
        warmth = max(-1.0, min(1.0, warmth))
        arr[:, :, 0] = np.clip(arr[:, :, 0] + warmth * 15, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] - warmth * 15, 0, 255)
        im = Image.fromarray(arr.astype(np.uint8))

    # Step 6: Deblur
    if deblur_strength > 0:
        deblur_strength = max(0.5, min(4.0, deblur_strength))
        arr = np.asarray(im, dtype=np.uint8)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        blur = cv2.GaussianBlur(bgr, (0, 0), 3)
        sharp = cv2.addWeighted(bgr, 1.0 + deblur_strength, blur, -deblur_strength, 0)
        sharp = np.clip(sharp, 0, 255).astype(np.uint8)
        im = Image.fromarray(cv2.cvtColor(sharp, cv2.COLOR_BGR2RGB))

    # Step 7: Sharpness
    if sharpness != 1.0:
        im = ImageEnhance.Sharpness(im).enhance(max(0.0, min(3.0, sharpness)))
        if sharpness > 1.2:
            pct = int(60 * (sharpness - 1.0))
            im = im.filter(ImageFilter.UnsharpMask(radius=1.5, percent=pct, threshold=2))

    # Step 8: Upscale (last, operates on final result)
    if upscale_factor > 1:
        scale = max(1, min(4, upscale_factor))
        w, h = im.size
        new_w, new_h = w * scale, h * scale
        max_dim = 8192
        if max(new_w, new_h) > max_dim:
            ratio = max_dim / max(new_w, new_h)
            new_w = int(new_w * ratio)
            new_h = int(new_h * ratio)
        im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
        im = ImageEnhance.Sharpness(im).enhance(1.2)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.5, percent=90, threshold=2))

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


# ---------------------------------------------------------------------------
# SVG contour-based vector
# ---------------------------------------------------------------------------
def raster_to_svg_edges(data: bytes, *, blur: float = 1.2) -> str:
    """
    Contour-based SVG (artistic / posterize style). Not true centerline tracing.
    """
    import cv2

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    if max(w, h) > 1600:
        scale = 1600 / max(w, h)
        gray = cv2.resize(
            gray,
            (max(1, int(w * scale)), max(1, int(h * scale))),
            interpolation=cv2.INTER_AREA,
        )
        h, w = gray.shape[:2]

    gray = cv2.GaussianBlur(gray, (0, 0), blur)
    edges = cv2.Canny(gray, 40, 120)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    paths: list[str] = []
    for cnt in contours:
        if len(cnt) < 3:
            continue
        eps = 0.002 * cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, eps, True)
        pts = approx.reshape(-1, 2)
        if len(pts) < 2:
            continue
        d = f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"
        for i in range(1, len(pts)):
            d += f" L {pts[i][0]:.2f} {pts[i][1]:.2f}"
        d += " Z"
        paths.append(f'<path d="{xml_esc.escape(d)}" fill="none" stroke="#e2e8f0" stroke-width="1.2" />')

    if not paths:
        paths.append(
            f'<text x="{w // 2}" y="{h // 2}" text-anchor="middle" fill="#94a3b8" font-size="14">No edges detected — try a higher-contrast photo</text>'
        )

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  {"".join(paths)}
</svg>'''
    return svg
