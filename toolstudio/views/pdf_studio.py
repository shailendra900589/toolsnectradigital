from django.shortcuts import render

from toolstudio.views._seo import seo_context


def pdf_studio(request):
    """Sejda-style PDF workspace: previews + edit in the browser (pdf.js + pdf-lib)."""
    ctx = seo_context(
        request,
        page_title="Best Free PDF Editor Online — Text, Highlight, Images & Whiteout | Tool Studio",
        meta_description=(
            "Best free PDF editor online in your browser: add text, highlight, whiteout, place images, "
            "sign, rotate or delete pages. PDF.js + pdf-lib — private editing without uploading the document."
        ),
        meta_keywords=(
            "best free pdf editor online, free pdf editor, add text to pdf free, highlight pdf, "
            "whiteout pdf, pdf image overlay, edit pdf in browser"
        ),
        url_name="toolstudio_pdf_studio",
        software_name="PDF Editor",
    )
    return render(request, "toolstudio/pdf_studio.html", ctx)
