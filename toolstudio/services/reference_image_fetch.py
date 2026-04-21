"""Fetch reference images via DuckDuckGo (server-only; never exposed to clients)."""

from __future__ import annotations

import logging
import time
import warnings
from typing import TYPE_CHECKING
from urllib.parse import urlparse
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

MAX_DOWNLOAD_BYTES = 6 * 1024 * 1024
REQUEST_TIMEOUT_S = 18
USER_AGENT = (
    "Mozilla/5.0 (compatible; ToolStudioRefBot/1.0; +https://localhost; image fetch for composition)"
)


def _allowed_image_url(url: str) -> bool:
    try:
        p = urlparse(url.strip())
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    if not p.netloc or p.netloc.startswith("127.") or p.netloc == "localhost":
        return False
    host = p.netloc.lower().split(":")[0]
    if host.endswith(".local") or host == "0.0.0.0":
        return False
    return True


def duckduckgo_image_urls(query: str, *, max_results: int = 12) -> list[str]:
    """
    Return image URLs from DuckDuckGo image search (no HTML UI; API-style use of DDG).
    Retries on rate limits; results are never sent to the browser.
    """
    q = (query or "").strip()
    if not q:
        return []
    try:
        from duckduckgo_search import DDGS  # type: ignore[import-untyped]
        from duckduckgo_search.exceptions import RatelimitException  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("duckduckgo_search not installed; skipping web reference")
        return []

    urls: list[str] = []
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                with DDGS() as ddgs:
                    for row in ddgs.images(
                        q,
                        max_results=max(1, min(max_results, 25)),
                        region="us-en",
                        safesearch="moderate",
                        type_image="photo",
                    ):
                        u = (row.get("image") or row.get("thumbnail") or "").strip()
                        if u and _allowed_image_url(u) and u not in urls:
                            urls.append(u)
            break
        except RatelimitException as e:
            last_err = e
            wait = 1.2 * (attempt + 1) ** 1.35
            logger.info("DuckDuckGo rate limit (attempt %s), retry in %.1fs", attempt + 1, wait)
            time.sleep(wait)
        except Exception as e:
            last_err = e
            logger.info("DuckDuckGo image search failed: %s", e)
            break
    if not urls and last_err:
        logger.debug("No DDG image URLs: %s", last_err)
    return urls


def fetch_url_bytes(url: str) -> bytes | None:
    if not _allowed_image_url(url):
        return None
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*;q=0.8"})
    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            chunks: list[bytes] = []
            total = 0
            while True:
                block = resp.read(65536)
                if not block:
                    break
                total += len(block)
                if total > MAX_DOWNLOAD_BYTES:
                    return None
                chunks.append(block)
            return b"".join(chunks)
    except Exception as e:
        logger.debug("fetch failed %s: %s", url[:80], e)
        return None


def build_photo_search_query(subject_slug: str, user_text: str) -> str:
    """
    English query for DuckDuckGo image search (photo / product style).
    subject_slug uses underscores e.g. dragon_fruit → 'dragon fruit'.
    """
    subj = (subject_slug or "object").replace("_", " ").strip()
    low = user_text.lower()
    base = f"{subj} fruit single whole isolated photograph white background high quality"
    if subj == "mango":
        base = "ripe mango fruit single whole photograph isolated high quality"
        if "leaf" in low or "leaves" in low:
            base += " with stem leaves"
    if any(k in low for k in ("yellow", "golden")):
        base += " yellow"
    if any(k in low for k in ("red", "redshade", "crimson")):
        base += " red"
    if "green" in low:
        base += " green"
    return base


def build_mango_search_query(user_text: str) -> str:
    """Backward-compatible wrapper."""
    return build_photo_search_query("mango", user_text)
