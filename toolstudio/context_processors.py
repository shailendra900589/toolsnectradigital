"""Template context available site-wide."""

from __future__ import annotations

from django.conf import settings


def upload_limits(request):
    max_b = int(getattr(settings, "FILE_UPLOAD_MAX_MEMORY_SIZE", 20 * 1024 * 1024))
    max_mb = max(1, round(max_b / (1024 * 1024)))
    return {
        "upload_max_bytes": max_b,
        "upload_max_mb": max_mb,
    }
