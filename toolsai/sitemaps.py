"""Sitemap for public tool URLs (SEO)."""

from django.contrib.sitemaps import Sitemap
from django.urls import reverse


class ToolSitemap(Sitemap):
    changefreq = "weekly"
    priority = 0.85

    def items(self):
        return [
            "imagetools_index",
            "imagetools_text_remover",
            "toolstudio_hub",
            "toolstudio_pdf_studio",
            "toolstudio_pdf_merge",
            "toolstudio_pdf_split",
            "toolstudio_pdf_extract",
            "toolstudio_pdf_create_photos",
            "toolstudio_pdf_compress",
            "toolstudio_pdf_rotate",
            "toolstudio_pdf_editor",
            "toolstudio_pdf_password_remover",
            "toolstudio_image_enhance",
            "toolstudio_image_vector",
            "toolstudio_image_studio",
        ]

    def location(self, item: str) -> str:
        return reverse(item)
