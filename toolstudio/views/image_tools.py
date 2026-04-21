from __future__ import annotations

import json

from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from toolstudio.services import image as image_ops
from toolstudio.services import image_studio_canvas as studio_canvas
from toolstudio.views._io import read_file_field
from toolstudio.views._seo import seo_context


@require_http_methods(["GET", "POST"])
def image_enhance(request):
    ctx = seo_context(
        request,
        page_title="Best Free AI Image Enhancer — Upscale, Denoise & Deblur | Tool Studio",
        meta_description=(
            "Best free AI image enhancer online: before/after preview, 2x/4x upscale, denoise, deblur, "
            "face enhance, color correction. Drag the slider. Private server processing — best free image tools."
        ),
        meta_keywords=(
            "best free ai image enhancer, upscale image free, denoise photo online, deblur image free, "
            "face enhance photo, free image tools, ai photo enhancer"
        ),
        url_name="toolstudio_image_enhance",
        software_name="AI Image Enhancer",
    )
    if request.method == "POST":
        f = request.FILES.get("image")
        if not f:
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse({"error": "Choose an image."}, status=400)
            ctx["error"] = "Choose an image."
            return render(request, "toolstudio/image_enhance.html", ctx)
        try:
            raw = read_file_field(f)
            mode = (request.POST.get("mode") or "auto").strip().lower()

            if mode == "pipeline":
                # Full pipeline mode — Cutout.com style
                brightness = float(request.POST.get("brightness") or "1")
                contrast = float(request.POST.get("contrast") or "1")
                sharpness = float(request.POST.get("sharpness") or "1")
                saturation = float(request.POST.get("saturation") or "1")
                denoise_strength = int(request.POST.get("denoise") or "0")
                deblur_strength = float(request.POST.get("deblur") or "0")
                upscale_factor = int(request.POST.get("upscale") or "1")
                warmth = float(request.POST.get("warmth") or "0")
                face_enh = request.POST.get("face_enhance") == "on"
                auto_enh = request.POST.get("auto_enhance") == "on"

                out, mime = image_ops.full_enhance_pipeline(
                    raw,
                    brightness=brightness,
                    contrast=contrast,
                    sharpness=sharpness,
                    saturation=saturation,
                    denoise_strength=denoise_strength,
                    deblur_strength=deblur_strength,
                    upscale_factor=upscale_factor,
                    warmth=warmth,
                    face_enhance=face_enh,
                    auto_enhance=auto_enh,
                )
            elif mode == "upscale":
                scale = int(request.POST.get("scale") or "2")
                out, mime = image_ops.upscale_image(raw, scale)
            elif mode == "denoise":
                strength = int(request.POST.get("strength") or "10")
                out, mime = image_ops.denoise_image(raw, strength)
            elif mode == "deblur":
                strength = float(request.POST.get("strength") or "1.5")
                out, mime = image_ops.deblur_image(raw, strength)
            elif mode == "face":
                out, mime = image_ops.face_enhance_image(raw)
            elif mode == "color":
                warmth = float(request.POST.get("warmth") or "0")
                vibrance = float(request.POST.get("vibrance") or "1")
                out, mime = image_ops.color_correct_image(raw, warmth=warmth, vibrance=vibrance)
            elif mode == "manual":
                bright = float(request.POST.get("brightness") or "1")
                contrast = float(request.POST.get("contrast") or "1")
                sharp = float(request.POST.get("sharpness") or "1")
                sat = float(request.POST.get("saturation") or "1")
                auto = request.POST.get("autocontrast") == "on"
                out, mime = image_ops.enhance_image(
                    raw,
                    brightness=bright,
                    contrast=contrast,
                    sharpness=sharp,
                    saturation=sat,
                    autocontrast=auto,
                )
            else:
                out, mime = image_ops.auto_enhance_image(raw)
        except Exception as e:
            if request.headers.get("X-Requested-With") == "XMLHttpRequest":
                return JsonResponse({"error": str(e)}, status=500)
            ctx["error"] = str(e)
            return render(request, "toolstudio/image_enhance.html", ctx)

        disp = request.POST.get("disposition") or "attachment"
        cd = 'inline; filename="enhanced.png"' if disp == "inline" else 'attachment; filename="enhanced.png"'
        return HttpResponse(out, content_type=mime, headers={"Content-Disposition": cd})
    return render(request, "toolstudio/image_enhance.html", ctx)


@require_http_methods(["GET", "POST"])
def image_vector(request):
    ctx = seo_context(
        request,
        page_title="Best Free Image to SVG Outline — Edge Vector Preview | Tool Studio",
        meta_description=(
            "Best free image to SVG tool: turn photo edges into an SVG line drawing for logos and "
            "high-contrast art. Free online vector outline preview — use pro software for final print work."
        ),
        meta_keywords=(
            "image to svg free, raster to vector outline, edge to svg, free image tools, "
            "best free online tools"
        ),
        url_name="toolstudio_image_vector",
        software_name="Image to SVG Outline",
    )
    if request.method == "POST":
        f = request.FILES.get("image")
        if not f:
            ctx["error"] = "Choose an image."
            return render(request, "toolstudio/image_vector.html", ctx)
        try:
            raw = read_file_field(f)
            svg = image_ops.raster_to_svg_edges(raw)
        except Exception as e:
            ctx["error"] = str(e)
            return render(request, "toolstudio/image_vector.html", ctx)
        disp = request.POST.get("disposition") or "attachment"
        cd = 'inline; filename="outline.svg"' if disp == "inline" else 'attachment; filename="outline.svg"'
        return HttpResponse(
            svg.encode("utf-8"),
            content_type="image/svg+xml; charset=utf-8",
            headers={"Content-Disposition": cd},
        )
    return render(request, "toolstudio/image_vector.html", ctx)


@require_http_methods(["GET"])
def image_studio(request):
    """
    Client-side interactive Image Studio.
    Supports cropping, filters, resizing, and format conversion (PNG, JPEG, WEBP).
    """
    ctx = seo_context(
        request,
        page_title="Best Free Image Studio — Crop, Filters, GIF & PDF Export | Tool Studio",
        meta_description=(
            "Best free online image editor: crop, filters, multi-tab photos, Pro canvas with shapes and text, "
            "GIF and PDF export. Private browser processing — top free image tools."
        ),
        meta_keywords=(
            "best free image editor online, crop image free, free image studio, gif maker free, "
            "canvas image editor, best free image tools"
        ),
        url_name="toolstudio_image_studio",
        software_name="Image Studio",
    )
    return render(request, "toolstudio/image_studio.html", ctx)


@require_http_methods(["POST"])
def image_studio_magic_shape(request):
    """
    Pillow-generated decorative shape (PNG, RGBA) for Image Studio Pro canvas.
    Expects JSON: { "width", "height", "style", "seed" }.
    """
    try:
        body = json.loads(request.body.decode() or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON.")
    try:
        w = int(body.get("width") or 512)
        h = int(body.get("height") or 512)
    except (TypeError, ValueError):
        return HttpResponseBadRequest("Invalid dimensions.")
    style = (body.get("style") or "organic").strip().lower()
    seed = body.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            seed = None
    try:
        png, ctype = studio_canvas.generate_magic_shape_png(
            width=w, height=h, style=style, seed=seed
        )
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    return HttpResponse(png, content_type=ctype)


@require_http_methods(["POST"])
def image_studio_shape_command(request):
    """Free-text command → PNG artwork (see image_studio_canvas.generate_shape_from_command)."""
    try:
        body = json.loads(request.body.decode() or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Invalid JSON.")
    command = (body.get("command") or "").strip()
    try:
        w = int(body.get("width") or 512)
        h = int(body.get("height") or 512)
    except (TypeError, ValueError):
        return HttpResponseBadRequest("Invalid dimensions.")
    seed = body.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            seed = None
    try:
        png, ctype = studio_canvas.generate_shape_from_command(
            command, width=w, height=h, seed=seed
        )
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    return HttpResponse(png, content_type=ctype)


@require_http_methods(["POST"])
def image_studio_to_gif(request):
    """Convert raw PNG bytes in body to GIF."""
    raw = request.body
    if not raw:
        return HttpResponseBadRequest("Empty body (send PNG bytes).")
    try:
        gif, ctype = studio_canvas.png_bytes_to_gif(raw)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    return HttpResponse(gif, content_type=ctype)