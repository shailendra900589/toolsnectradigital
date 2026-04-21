from django.shortcuts import render

from toolstudio.views._seo import hub_seo_context


def hub_index(request):
    ctx = hub_seo_context(
        request,
        page_title="Best Free PDF & Image Tools Online — Merge, Split, Edit & More | Tool Studio",
        meta_description=(
            "Discover the best free tools online: merge and split PDFs, compress and rotate PDF, "
            "unlock passwords, extract text and images, free PDF editor, AI image enhancer, "
            "background remover, and image text eraser. Fast, private, no watermark, no signup."
        ),
        meta_keywords=(
            "best free tools, free online tools, free pdf tools, best free pdf tools, merge pdf free, "
            "split pdf online, compress pdf free, pdf editor online free, free image tools, "
            "ai image enhancer free, background remover free, remove text from image free"
        ),
        url_name="toolstudio_hub",
    )
    return render(request, "toolstudio/hub.html", ctx)
