from django.urls import path

from toolstudio import views
from toolstudio.views.image_tools import (
    image_studio_magic_shape,
    image_studio_shape_command,
    image_studio_to_gif,
)

urlpatterns = [
    path("", views.hub_index, name="toolstudio_hub"),
    path("pdf/studio/", views.pdf_studio, name="toolstudio_pdf_studio"),
    path("pdf/merge/", views.pdf_merge, name="toolstudio_pdf_merge"),
    path("pdf/split/", views.pdf_split, name="toolstudio_pdf_split"),
    path("pdf/extract/", views.pdf_extract, name="toolstudio_pdf_extract"),
    path("pdf/create-from-photos/", views.pdf_create_photos, name="toolstudio_pdf_create_photos"),
    path("pdf/compress/", views.pdf_compress, name="toolstudio_pdf_compress"),
    path("pdf/rotate/", views.pdf_rotate, name="toolstudio_pdf_rotate"),
    path("pdf/page-remover/", views.pdf_editor, name="toolstudio_pdf_editor"),
    path("pdf/remove-password/", views.pdf_password_remover, name="toolstudio_pdf_password_remover"),
    path("image/enhance/", views.image_enhance, name="toolstudio_image_enhance"),
    path("image/vector-outline/", views.image_vector, name="toolstudio_image_vector"),
    path("image/studio/", views.image_studio, name="toolstudio_image_studio"),
    path(
        "image/studio/api/magic-shape/",
        image_studio_magic_shape,
        name="toolstudio_image_studio_magic_shape",
    ),
    path(
        "image/studio/api/shape-command/",
        image_studio_shape_command,
        name="toolstudio_image_studio_shape_command",
    ),
    path(
        "image/studio/api/to-gif/",
        image_studio_to_gif,
        name="toolstudio_image_studio_to_gif",
    ),
]

