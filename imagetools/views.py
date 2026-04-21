import json

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from toolstudio.views._seo import seo_context

from . import services


def _common_context() -> dict:
    return {
        "max_mb": services.MAX_FILE_BYTES // (1024 * 1024),
    }


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    gradients = {
        k: [list(top), list(bot)]
        for k, (top, bot) in services.GRADIENT_PRESETS.items()
    }
    context = {
        **_common_context(),
        **seo_context(
            request,
            page_title="Best Free Background Remover — AI Transparent PNG Online | Image Studio",
            meta_description=(
                "Best free background remover online: AI cutout, live preview, transparent PNG export, "
                "gradients and composite backgrounds. Top free image tools — files not stored."
            ),
            meta_keywords=(
                "best free background remover, remove background free, ai background removal, "
                "transparent png, cutout online, best free image tools, free online tools"
            ),
            url_name="imagetools_index",
            software_name="Background Remover",
        ),
        "presets_gradients_json": json.dumps(gradients),
        "remove_bg_api_url": reverse("imagetools_remove_bg"),
    }
    return render(request, "imagetools/index.html", context)


@require_GET
def text_remover(request: HttpRequest) -> HttpResponse:
    context = {
        **_common_context(),
        **seo_context(
            request,
            page_title="Best Free Text & Object Eraser — Remove Text from Image Online | Image Studio",
            meta_description=(
                "Best free tool to remove text from images: draw boxes over logos or words; "
                "LaMa inpainting fills only what you mark. Private processing, best free image tools."
            ),
            meta_keywords=(
                "remove text from image free, erase text from photo online, inpaint image, "
                "object remover free, best free image tools, free online tools"
            ),
            url_name="imagetools_text_remover",
            software_name="Text & Object Eraser",
        ),
        "remove_text_api_url": reverse("imagetools_remove_text"),
    }
    return render(request, "imagetools/text_remover.html", context)


@require_POST
def remove_bg(request: HttpRequest) -> HttpResponse:
    upload = request.FILES.get("image")
    if not upload:
        return JsonResponse({"error": "No image file was uploaded."}, status=400)
    try:
        raw = upload.read()
    except OSError:
        return JsonResponse({"error": "Could not read the uploaded file."}, status=400)

    try:
        png_bytes, w, h = services.extract_cutout_png(raw)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except OSError:
        return JsonResponse({"error": "Invalid or unsupported image file."}, status=400)
    except Exception:
        return JsonResponse(
            {"error": "Processing failed. Try a different image or a smaller file."},
            status=500,
        )

    resp = HttpResponse(png_bytes, content_type="image/png")
    resp["Cache-Control"] = "no-store"
    resp["X-Cutout-Width"] = str(w)
    resp["X-Cutout-Height"] = str(h)
    return resp


@require_POST
def remove_text(request: HttpRequest) -> HttpResponse:
    upload = request.FILES.get("image")
    if not upload:
        return JsonResponse({"error": "No image uploaded."}, status=400)
    try:
        raw = upload.read()
    except OSError:
        return JsonResponse({"error": "Could not read the file."}, status=400)

    try:
        radius = int(request.POST.get("radius") or "8")
    except ValueError:
        radius = 8
    radius = max(3, min(28, radius))

    mask_upload = request.FILES.get("mask")
    if mask_upload:
        try:
            mask_raw = mask_upload.read()
        except OSError:
            return JsonResponse({"error": "Could not read the mask file."}, status=400)
        try:
            png = services.inpaint_with_selection_mask(
                raw, mask_raw, inpaint_radius=radius
            )
        except ValueError as e:
            return JsonResponse({"error": str(e)}, status=400)
        except OSError:
            return JsonResponse({"error": "Invalid mask or image."}, status=400)
        except Exception:
            return JsonResponse({"error": "Inpainting failed."}, status=500)
        resp = HttpResponse(png, content_type="image/png")
        resp["Cache-Control"] = "no-store"
        return resp

    raw_json = (request.POST.get("regions") or "").strip()
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid regions JSON."}, status=400)
    if not isinstance(data, list):
        return JsonResponse({"error": "Regions must be a list."}, status=400)

    regions: list[dict[str, float]] = []
    for item in data:
        if not isinstance(item, dict):
            return JsonResponse({"error": "Each region must be an object."}, status=400)
        regions.append(item)

    try:
        png = services.inpaint_text_regions(raw, regions, inpaint_radius=radius)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except OSError:
        return JsonResponse({"error": "Invalid or corrupted image."}, status=400)
    except Exception:
        return JsonResponse({"error": "Inpainting failed. Try smaller regions."}, status=500)

    resp = HttpResponse(png, content_type="image/png")
    resp["Cache-Control"] = "no-store"
    return resp
