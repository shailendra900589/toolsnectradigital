"""
LaMa inpainting via ONNX Runtime (Carve/LaMa-ONNX, big-lama quality).
Falls back is handled in services.py — do not import rembg/torch here.

Model: first use downloads ~200MB to imagetools/models/lama_fp32.onnx
(or set LAMA_MODEL_PATH to an existing .onnx file).
"""

from __future__ import annotations

import logging
import os
import threading
import urllib.request
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

_LAMA_URL = (
    "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
)
_FIXED = 512
_session = None
_session_lock = threading.Lock()
_download_lock = threading.Lock()


def _model_file() -> Path:
    override = os.environ.get("LAMA_MODEL_PATH", "").strip()
    if override:
        return Path(override)
    d = Path(__file__).resolve().parent / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d / "lama_fp32.onnx"


def ensure_lama_weights() -> Path:
    """Download LaMa ONNX once if missing."""
    path = _model_file()
    if path.exists() and path.stat().st_size > 8 * 1024 * 1024:
        return path
    with _download_lock:
        if path.exists() and path.stat().st_size > 8 * 1024 * 1024:
            return path
        tmp = path.with_suffix(".part")
        logger.info("Downloading LaMa inpainting model (one-time, ~200MB)…")
        req = urllib.request.Request(
            _LAMA_URL,
            headers={"User-Agent": "imagetools/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=900) as resp:
                with open(tmp, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 512)
                        if not chunk:
                            break
                        f.write(chunk)
        except OSError as e:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            raise RuntimeError(
                "Could not download LaMa model. Set LAMA_MODEL_PATH or check network."
            ) from e
        tmp.replace(path)
        logger.info("LaMa model saved to %s", path)
    return path


def _get_session():
    global _session
    if _session is not None:
        return _session
    with _session_lock:
        if _session is not None:
            return _session
        import onnxruntime as ort

        mp = ensure_lama_weights()
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        prov = ["CPUExecutionProvider"]
        try:
            _session = ort.InferenceSession(
                str(mp), sess_options=opts, providers=prov
            )
        except Exception as e:
            raise RuntimeError(f"Failed to load LaMa ONNX: {e}") from e
    return _session


def _letterbox_512(
    rgb: np.ndarray, mask: np.ndarray
) -> tuple[np.ndarray, np.ndarray, tuple[int, int, int, int, int, int]]:
    """Resize with aspect ratio into 512×512; return meta for reverse mapping."""
    import cv2

    h0, w0 = rgb.shape[:2]
    scale = min(_FIXED / w0, _FIXED / h0)
    nw = max(1, int(round(w0 * scale)))
    nh = max(1, int(round(h0 * scale)))
    img = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
    m = cv2.resize(mask, (nw, nh), interpolation=cv2.INTER_NEAREST)
    pad_w = _FIXED - nw
    pad_h = _FIXED - nh
    top, left = pad_h // 2, pad_w // 2
    bottom, right = pad_h - top, pad_w - left
    img = cv2.copyMakeBorder(
        img, top, bottom, left, right, cv2.BORDER_REFLECT_101
    )
    m = cv2.copyMakeBorder(
        m, top, bottom, left, right, cv2.BORDER_CONSTANT, value=0
    )
    meta = (h0, w0, top, left, nh, nw)
    return img, m, meta


def _unletterbox(out512: np.ndarray, meta: tuple[int, int, int, int, int, int]) -> np.ndarray:
    import cv2

    h0, w0, top, left, nh, nw = meta
    crop = out512[top : top + nh, left : left + nw]
    return cv2.resize(crop, (w0, h0), interpolation=cv2.INTER_LANCZOS4)


def _build_feed(sess, image_nchw: np.ndarray, mask_n1hw: np.ndarray) -> dict:
    out: dict = {}
    for inp in sess.get_inputs():
        n = inp.name.lower()
        if "mask" in n:
            out[inp.name] = mask_n1hw.astype(np.float32)
        else:
            out[inp.name] = image_nchw.astype(np.float32)
    if len(out) != len(sess.get_inputs()):
        raise RuntimeError("LaMa ONNX: could not map inputs")
    return out


def infer_lama(rgb: np.ndarray, mask_u8: np.ndarray) -> np.ndarray:
    """
    rgb: H×W×3 uint8 RGB
    mask_u8: H×W uint8, >127 = region to inpaint
    Returns H×W×3 uint8 RGB.
    """
    if rgb.shape[:2] != mask_u8.shape[:2]:
        raise ValueError("Image and mask size mismatch")

    img512, m512, meta = _letterbox_512(rgb, mask_u8)

    img_chw = np.transpose(img512.astype(np.float32) / 255.0, (2, 0, 1))
    img_b = np.expand_dims(img_chw, 0)

    m_bin = (m512 > 127).astype(np.float32)
    mask_b = np.expand_dims(np.expand_dims(m_bin, 0), 0)

    sess = _get_session()
    feed = _build_feed(sess, img_b, mask_b)
    outs = sess.run(None, feed)
    raw = outs[0]
    if raw.ndim != 4:
        raise RuntimeError("Unexpected LaMa output rank")
    chw = raw[0]
    ohwc = np.transpose(chw, (1, 2, 0))

    if ohwc.dtype != np.uint8:
        mx = float(np.max(ohwc)) if ohwc.size else 0.0
        if mx <= 1.5:
            ohwc = np.clip(ohwc * 255.0, 0, 255).astype(np.uint8)
        else:
            ohwc = np.clip(ohwc, 0, 255).astype(np.uint8)

    return _unletterbox(ohwc, meta)


def lama_available() -> bool:
    """True if weights exist or download is allowed."""
    if os.environ.get("IMAGETOOLS_USE_LAMA", "1") == "0":
        return False
    p = _model_file()
    return p.exists() and p.stat().st_size > 8 * 1024 * 1024
