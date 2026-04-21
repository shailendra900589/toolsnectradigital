/**
 * Shared PDF.js helpers for Tool Studio (ES module).
 */
const PDFJS_VER = "4.4.168";
let pdfjsMod = null;

export async function getPdfjs() {
  if (!pdfjsMod) {
    try {
      pdfjsMod = await import(
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/+esm`
      );
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error(
        "Could not load PDF.js (" + msg + "). Check your network or try disabling extensions that block scripts."
      );
    }
    pdfjsMod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.mjs`;
  }
  return pdfjsMod;
}

export async function loadPdfFromFile(file) {
  const pdfjsLib = await getPdfjs();
  const buf = await file.arrayBuffer();
  try {
    return await pdfjsLib.getDocument({ data: buf }).promise;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    throw new Error("Invalid or encrypted PDF: " + msg);
  }
}

/** Await a PDF.js render task (v3/v4 compatible). */
async function renderTaskDone(task) {
  if (task && typeof task.promise === "object" && task.promise) {
    await task.promise;
  } else if (task && typeof task.then === "function") {
    await task;
  }
}

export async function renderPageToCanvas(pdf, pageNumber1, canvas, maxWidth) {
  const page = await pdf.getPage(pageNumber1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, 2.5);
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await renderTaskDone(page.render({ canvasContext: ctx, viewport }));
}

/** First-page preview; returns total page count. */
export async function previewFirstPage(file, canvas, maxWidth = 720) {
  const pdf = await loadPdfFromFile(file);
  await renderPageToCanvas(pdf, 1, canvas, maxWidth);
  return pdf.numPages;
}

/** Vertical strip of small thumbnails (up to maxPages). */
export async function renderThumbStrip(file, container, maxPages = 12, thumbW = 120) {
  const pdf = await loadPdfFromFile(file);
  container.innerHTML = "";
  const n = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const sc = thumbW / base.width;
    const vp = page.getViewport({ scale: sc });
    const c = document.createElement("canvas");
    const cx = c.getContext("2d");
    c.width = vp.width;
    c.height = vp.height;
    c.className = "rounded border border-secondary border-opacity-25 mb-1";
    await renderTaskDone(page.render({ canvasContext: cx, viewport: vp }));
    const wrap = document.createElement("div");
    wrap.className = "text-center small text-secondary";
    wrap.appendChild(c);
    wrap.appendChild(document.createTextNode("p." + i));
    container.appendChild(wrap);
  }
  if (pdf.numPages > maxPages) {
    const more = document.createElement("p");
    more.className = "small text-muted mb-0";
    more.textContent = "+ " + (pdf.numPages - maxPages) + " more…";
    container.appendChild(more);
  }
  return pdf.numPages;
}

export function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}
