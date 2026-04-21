"""
Shared SEO: titles, meta tags, canonical URLs, and JSON-LD (Schema.org).
"""
from __future__ import annotations

import json

from django.urls import reverse
from django.utils.safestring import mark_safe

# Brand strings used in titles and structured data
SEO_BRAND = "Tool Studio"
SEO_TAGLINE = "Best Free Tools Online"


def _site_root(request) -> str:
    root = request.build_absolute_uri("/")
    if not root.endswith("/"):
        root += "/"
    return root


def _json_ld_script(payload: dict) -> str:
    raw = json.dumps(payload, ensure_ascii=False)
    return mark_safe(f'<script type="application/ld+json">\n{raw}\n</script>')


def seo_context(
    request,
    *,
    page_title: str,
    meta_description: str,
    meta_keywords: str,
    url_name: str,
    software_name: str | None = None,
    include_software_application: bool = True,
) -> dict:
    """
    Standard tool page SEO + Schema.org WebSite, WebPage, and optionally SoftwareApplication.
    """
    path = reverse(url_name)
    canonical = request.build_absolute_uri(path)
    site_root = _site_root(request)
    site_id = site_root.rstrip("/") + "/#website"

    short_name = (software_name or page_title.split("—")[0].split("|")[0]).strip()

    graph: list[dict] = [
        {
            "@type": "WebSite",
            "@id": site_id,
            "name": f"{SEO_BRAND} — {SEO_TAGLINE}",
            "alternateName": [SEO_TAGLINE, "Free online PDF and image tools"],
            "url": site_root.rstrip("/") + "/",
            "description": (
                "Best free tools online: PDF merge, split, compress, editor, password remover, "
                "AI image enhancer, background removal, and more. Private processing, no account."
            ),
            "inLanguage": "en-US",
        },
        {
            "@type": "WebPage",
            "@id": canonical + "#webpage",
            "url": canonical,
            "name": page_title,
            "description": meta_description[:320],
            "isPartOf": {"@id": site_id},
            "inLanguage": "en-US",
        },
    ]
    if include_software_application:
        graph.append(
            {
                "@type": "SoftwareApplication",
                "name": short_name,
                "applicationCategory": "UtilitiesApplication",
                "applicationSubCategory": "PDF & image utilities",
                "operatingSystem": "Web browser",
                "browserRequirements": "Requires HTML5 and JavaScript.",
                "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD",
                    "availability": "https://schema.org/InStock",
                },
                "description": meta_description[:500],
                "url": canonical,
            }
        )

    payload = {"@context": "https://schema.org", "@graph": graph}
    return {
        "page_title": page_title,
        "meta_description": meta_description,
        "meta_keywords": meta_keywords,
        "canonical_url": canonical,
        "og_title": page_title,
        "og_description": meta_description[:200],
        "twitter_title": page_title,
        "twitter_description": meta_description[:200],
        "json_ld": _json_ld_script(payload),
    }


def hub_seo_context(
    request,
    *,
    page_title: str,
    meta_description: str,
    meta_keywords: str,
    url_name: str,
) -> dict:
    """
    Hub home: WebSite + WebPage + ItemList of featured tools (rich results / discovery).
    """
    path = reverse(url_name)
    canonical = request.build_absolute_uri(path)
    site_root = _site_root(request)
    site_id = site_root.rstrip("/") + "/#website"

    def abs_url(name: str) -> str:
        return request.build_absolute_uri(reverse(name))

    item_list = [
        {"@type": "ListItem", "position": 1, "name": "PDF Editor (browser)", "url": abs_url("toolstudio_pdf_studio")},
        {"@type": "ListItem", "position": 2, "name": "AI Image Enhancer", "url": abs_url("toolstudio_image_enhance")},
        {"@type": "ListItem", "position": 3, "name": "Merge PDF", "url": abs_url("toolstudio_pdf_merge")},
        {"@type": "ListItem", "position": 4, "name": "Split PDF", "url": abs_url("toolstudio_pdf_split")},
        {"@type": "ListItem", "position": 5, "name": "Extract text & images from PDF", "url": abs_url("toolstudio_pdf_extract")},
        {"@type": "ListItem", "position": 6, "name": "Compress PDF", "url": abs_url("toolstudio_pdf_compress")},
        {"@type": "ListItem", "position": 7, "name": "Background remover", "url": abs_url("imagetools_index")},
        {"@type": "ListItem", "position": 8, "name": "Erase text & objects from image", "url": abs_url("imagetools_text_remover")},
    ]

    graph: list[dict] = [
        {
            "@type": "WebSite",
            "@id": site_id,
            "name": f"{SEO_BRAND} — {SEO_TAGLINE}",
            "alternateName": [SEO_TAGLINE, "Best free PDF tools", "Best free image tools"],
            "url": site_root.rstrip("/") + "/",
            "description": meta_description[:320],
            "inLanguage": "en-US",
        },
        {
            "@type": "WebPage",
            "@id": canonical + "#webpage",
            "url": canonical,
            "name": page_title,
            "description": meta_description[:320],
            "isPartOf": {"@id": site_id},
            "inLanguage": "en-US",
        },
        {
            "@type": "ItemList",
            "name": f"{SEO_BRAND} — free PDF & image tools",
            "description": "Best free online tools for PDF and images: edit, merge, split, enhance, and remove backgrounds.",
            "numberOfItems": len(item_list),
            "itemListElement": item_list,
        },
    ]

    payload = {"@context": "https://schema.org", "@graph": graph}
    return {
        "page_title": page_title,
        "meta_description": meta_description,
        "meta_keywords": meta_keywords,
        "canonical_url": canonical,
        "og_title": page_title,
        "og_description": meta_description[:200],
        "twitter_title": page_title,
        "twitter_description": meta_description[:200],
        "json_ld": _json_ld_script(payload),
    }
