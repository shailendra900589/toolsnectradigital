from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="imagetools_index"),
    path("text-remover/", views.text_remover, name="imagetools_text_remover"),
    path("api/remove-bg/", views.remove_bg, name="imagetools_remove_bg"),
    path("api/remove-text/", views.remove_text, name="imagetools_remove_text"),
]
