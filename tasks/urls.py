from django.urls import path
from . import views

app_name = "tasks"
urlpatterns = [
    path("<int:project_id>/tasks/new/", views.task_create, name="create"),
    path("<int:project_id>/tasks/<int:task_id>/assign/", views.task_assign, name="assign"),
]
