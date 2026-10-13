from django.urls import path
from . import views

app_name = "projects"
urlpatterns = [
    path("", views.project_list, name="list"),
    path("new/", views.project_create, name="create"),
    path("<int:project_id>/", views.project_detail, name="detail"),
    path("<int:project_id>/members/", views.project_members, name="members"),
    path("<int:project_id>/members/<int:membership_id>/remove/", views.member_remove, name="member_remove"),
]
