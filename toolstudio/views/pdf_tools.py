from __future__ import annotations

import io
import zipfile

from django.http import FileResponse, HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from toolstudio.services import pdf as pdf_ops
from toolstudio.views._io import read_file_field, read_file_list
from toolstudio.views._seo import seo_context


def pdf_merge(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Merger Online — Combine PDFs in Order | Tool Studio",
        meta_description=(
            "Best free PDF merge tool: combine multiple PDFs into one file, reorder pages, fast download. "
            "No watermark, no signup. Files processed on the server and not stored."
        ),
        meta_keywords=(
            "best free pdf merger, merge pdf free, combine pdf online free, join pdf files, "
            "pdf merger free, merge pdf online"
        ),
        url_name="toolstudio_pdf_merge",
        software_name="Merge PDF",
    )
    if request.method == "POST":
        files = request.FILES.getlist("pdfs")
        if len(files) < 2:
            ctx["error"] = "Please upload at least two PDF files."
            return render(request, "toolstudio/pdf_merge.html", ctx)
        try:
            parts = read_file_list(files)
            out = pdf_ops.merge_pdfs(parts)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_merge.html", ctx)
        resp = HttpResponse(out, content_type="application/pdf")
        resp["Content-Disposition"] = 'attachment; filename="merged.pdf"'
        resp["X-Output-Bytes"] = str(len(out))
        return resp
    return render(request, "toolstudio/pdf_merge.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_split(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Splitter — Extract Pages or ZIP Each Page | Tool Studio",
        meta_description=(
            "Free online PDF split tool: download a ZIP with one PDF per page, or extract custom page ranges "
            "into a single PDF. Preview pages, private processing, best free PDF tools."
        ),
        meta_keywords=(
            "best free pdf splitter, split pdf free, extract pdf pages online, pdf page range, "
            "split pdf to zip, free pdf tools"
        ),
        url_name="toolstudio_pdf_split",
        software_name="Split PDF",
    )
    if request.method == "POST":
        f = request.FILES.get("pdf")
        if not f:
            ctx["error"] = "Upload a PDF file."
            return render(request, "toolstudio/pdf_split.html", ctx)
        try:
            raw = read_file_field(f)
            mode = (request.POST.get("split_mode") or "zip_each").strip()
            if mode == "single_pdf":
                spec = (request.POST.get("pages") or "").strip()
                n = pdf_ops.page_count(raw)
                pages = pdf_ops.parse_page_numbers(spec, n)
                if not pages:
                    ctx["error"] = (
                        f"Enter pages to extract (1–{n}). Example: 1,3-5,8"
                    )
                    return render(request, "toolstudio/pdf_split.html", ctx)
                out = pdf_ops.extract_pages_pdf(raw, pages)
                resp = HttpResponse(out, content_type="application/pdf")
                resp["Content-Disposition"] = 'attachment; filename="extracted-pages.pdf"'
                resp["X-Output-Bytes"] = str(len(out))
                return resp
            pairs = pdf_ops.split_pdf_each_page(raw)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_split.html", ctx)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in pairs:
                zf.writestr(name, data)
        buf.seek(0)
        zip_data = buf.getvalue()
        out = HttpResponse(zip_data, content_type="application/zip")
        out["Content-Disposition"] = 'attachment; filename="split-pages.zip"'
        out["X-Output-Bytes"] = str(len(zip_data))
        return out
    return render(request, "toolstudio/pdf_split.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_extract(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Extractor — Text or Images to ZIP | Tool Studio",
        meta_description=(
            "Best free PDF extract tool: copy-ready plain text from PDFs, or export embedded images as a ZIP. "
            "Fast, private, no account — ideal for reports and research."
        ),
        meta_keywords=(
            "extract text from pdf free, pdf to text online, extract images from pdf, "
            "pdf image export, best free pdf tools"
        ),
        url_name="toolstudio_pdf_extract",
        software_name="PDF Extract",
    )
    if request.method == "POST":
        mode = (request.POST.get("mode") or "text").strip()
        f = request.FILES.get("pdf")
        if not f:
            ctx["error"] = "Upload a PDF."
            return render(request, "toolstudio/pdf_extract.html", ctx)
        try:
            raw = read_file_field(f)
            if mode == "images":
                zip_bytes = pdf_ops.extract_images_zip(raw)
                return HttpResponse(
                    zip_bytes,
                    content_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="pdf-images.zip"'},
                )
            text = pdf_ops.extract_text_pdf(raw)
            return HttpResponse(
                text.encode("utf-8"),
                content_type="text/plain; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="extracted.txt"'},
            )
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_extract.html", ctx)
    return render(request, "toolstudio/pdf_extract.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_create_photos(request):
    ctx = seo_context(
        request,
        page_title="Best Free JPG to PDF — Create PDF from Photos Online | Tool Studio",
        meta_description=(
            "Best free image to PDF converter: combine JPG, PNG, and screenshots into one PDF in order. "
            "No watermark, works in browser, private processing."
        ),
        meta_keywords=(
            "jpg to pdf free, images to pdf online, png to pdf, create pdf from photos, "
            "best free pdf tools, photo to pdf"
        ),
        url_name="toolstudio_pdf_create_photos",
        software_name="Photos to PDF",
    )
    if request.method == "POST":
        files = request.FILES.getlist("images")
        if not files:
            ctx["error"] = "Select one or more images."
            return render(request, "toolstudio/pdf_create_photos.html", ctx)
        try:
            pairs = [(read_file_field(uf), uf.name) for uf in files]
            out = pdf_ops.images_to_pdf(pairs)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_create_photos.html", ctx)
        resp = HttpResponse(out, content_type="application/pdf")
        resp["Content-Disposition"] = 'attachment; filename="from-photos.pdf"'
        resp["X-Output-Bytes"] = str(len(out))
        return resp
    return render(request, "toolstudio/pdf_create_photos.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_compress(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Compressor — Reduce PDF Size Online | Tool Studio",
        meta_description=(
            "Compress PDF free online: shrink file size with stream compression — great for scans and "
            "large documents. Best free PDF tools, private, no signup."
        ),
        meta_keywords=(
            "compress pdf free, reduce pdf size online, optimize pdf, shrink pdf file, "
            "best free pdf compressor"
        ),
        url_name="toolstudio_pdf_compress",
        software_name="Compress PDF",
    )
    if request.method == "POST":
        f = request.FILES.get("pdf")
        if not f:
            ctx["error"] = "Upload a PDF."
            return render(request, "toolstudio/pdf_compress.html", ctx)
        try:
            raw = read_file_field(f)
            out = pdf_ops.compress_pdf(raw)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_compress.html", ctx)
        resp = HttpResponse(out, content_type="application/pdf")
        resp["Content-Disposition"] = 'attachment; filename="compressed.pdf"'
        resp["X-Output-Bytes"] = str(len(out))
        return resp
    return render(request, "toolstudio/pdf_compress.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_rotate(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Rotate — Turn Pages 90°, 180°, 270° | Tool Studio",
        meta_description=(
            "Rotate PDF pages free online: fix sideways scans and exports in one click (90°, 180°, 270°). "
            "Best free PDF tools, fast download, files not stored."
        ),
        meta_keywords=(
            "rotate pdf free, turn pdf pages online, fix sideways pdf, rotate pdf 90 degrees, "
            "best free pdf tools"
        ),
        url_name="toolstudio_pdf_rotate",
        software_name="Rotate PDF",
    )
    if request.method == "POST":
        f = request.FILES.get("pdf")
        deg = int(request.POST.get("degrees") or "90")
        if deg not in (90, 180, 270):
            deg = 90
        if not f:
            ctx["error"] = "Upload a PDF."
            return render(request, "toolstudio/pdf_rotate.html", ctx)
        try:
            raw = read_file_field(f)
            out = pdf_ops.rotate_pdf(raw, deg)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_rotate.html", ctx)
        resp = HttpResponse(out, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="rotated-{deg}.pdf"'
        resp["X-Output-Bytes"] = str(len(out))
        return resp
    return render(request, "toolstudio/pdf_rotate.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_editor(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Page Remover — Delete Pages Online | Tool Studio",
        meta_description=(
            "Remove pages from PDF free: delete unwanted pages by number or range (e.g. 1,3-5). "
            "Lightweight best free PDF tool — no desktop app required."
        ),
        meta_keywords=(
            "delete pages from pdf free, remove pdf pages online, cut pages from pdf, "
            "pdf page remover, best free pdf tools"
        ),
        url_name="toolstudio_pdf_editor",
        software_name="PDF Page Remover",
    )
    if request.method == "POST":
        f = request.FILES.get("pdf")
        spec = (request.POST.get("remove_pages") or "").strip()
        if not f:
            ctx["error"] = "Upload a PDF."
            return render(request, "toolstudio/pdf_editor.html", ctx)
        try:
            raw = read_file_field(f)
            n = pdf_ops.page_count(raw)
            to_remove = pdf_ops.parse_page_numbers(spec, n)
            if not to_remove:
                ctx["error"] = f"Enter at least one page to remove (1–{n}). Example: 1,3-5"
                return render(request, "toolstudio/pdf_editor.html", ctx)
            out = pdf_ops.remove_pages_pdf(raw, to_remove)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_editor.html", ctx)
        resp = HttpResponse(out, content_type="application/pdf")
        resp["Content-Disposition"] = 'attachment; filename="edited.pdf"'
        resp["X-Output-Bytes"] = str(len(out))
        return resp
    return render(request, "toolstudio/pdf_editor.html", ctx)


@require_http_methods(["GET", "POST"])
def pdf_password_remover(request):
    ctx = seo_context(
        request,
        page_title="Best Free PDF Password Remover — Unlock PDF Online | Tool Studio",
        meta_description=(
            "Unlock PDF free online: remove open password and restrictions when you have the password. "
            "Fast, private best free PDF tool — files not kept after processing."
        ),
        meta_keywords=(
            "remove pdf password free, unlock pdf online, pdf password remover, decrypt pdf, "
            "best free pdf tools"
        ),
        url_name="toolstudio_pdf_password_remover",
        software_name="PDF Password Remover",
    )
    if request.method == "POST":
        f = request.FILES.get("pdf")
        pwd = request.POST.get("password") or ""
        if not f:
            ctx["error"] = "Upload a PDF."
            return render(request, "toolstudio/pdf_password_remover.html", ctx)
        try:
            raw = read_file_field(f)
            out = pdf_ops.remove_password_pdf(raw, pwd)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/pdf_password_remover.html", ctx)
        resp = HttpResponse(out, content_type="application/pdf")
        resp["Content-Disposition"] = 'attachment; filename="unlocked.pdf"'
        resp["X-Output-Bytes"] = str(len(out))
        return resp
    return render(request, "toolstudio/pdf_password_remover.html", ctx)