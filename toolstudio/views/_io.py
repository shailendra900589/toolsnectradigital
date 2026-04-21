"""Upload size guards."""

from django.conf import settings

MAX_BYTES = getattr(settings, "FILE_UPLOAD_MAX_MEMORY_SIZE", 20 * 1024 * 1024)


def read_file_field(f) -> bytes:
    raw = f.read()
    if len(raw) > MAX_BYTES:
        raise ValueError("File too large for this server limit")
    return raw


def read_file_list(files) -> list[bytes]:
    out: list[bytes] = []
    for uf in files:
        out.append(read_file_field(uf))
    return out
