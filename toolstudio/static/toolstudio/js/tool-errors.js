/**
 * Parse Django HTML error pages or JSON { error } from failed fetch responses.
 */
export async function parseToolErrorResponse(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  let text = "";
  try {
    text = await res.text();
  } catch {
    return `Request failed (${res.status}).`;
  }
  if (ct.includes("application/json")) {
    try {
      const j = JSON.parse(text);
      if (j && typeof j === "object") {
        if (j.error != null) return String(j.error);
        if (j.detail != null) return String(j.detail);
      }
    } catch {
      /* fall through */
    }
  }
  if (text.includes("alert-danger")) {
    try {
      const doc = new DOMParser().parseFromString(text, "text/html");
      const el = doc.querySelector(".alert-danger");
      if (el) {
        const msg = el.textContent.trim().replace(/\s+/g, " ");
        if (msg) return msg;
      }
    } catch {
      /* ignore */
    }
  }
  const plain = text.trim();
  if (plain.length && plain.length < 500 && !plain.startsWith("<!")) {
    return plain;
  }
  return `Something went wrong (${res.status}). Try a smaller file or a different format.`;
}

/** Skip files over the configured app limit (see base template TOOLSTUDIO_UPLOAD). */
export function rejectOversizeFiles(files, label = "File") {
  const max = typeof window !== "undefined" && window.TOOLSTUDIO_UPLOAD
    ? window.TOOLSTUDIO_UPLOAD.maxBytes
    : null;
  const maxMb = typeof window !== "undefined" && window.TOOLSTUDIO_UPLOAD
    ? window.TOOLSTUDIO_UPLOAD.maxMb
    : 20;
  if (!max) return Array.from(files);
  const ok = [];
  for (const f of files) {
    if (f.size > max) {
      alert(`${label} "${f.name}" is larger than ${maxMb} MB (this app’s limit).`);
      continue;
    }
    ok.push(f);
  }
  return ok;
}
