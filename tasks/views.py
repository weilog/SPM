from django.contrib.auth.decorators import login_required
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_http_methods
from projects.permissions import require_management
from projects.views import authorized_project
from .forms import AssignmentForm, TaskForm
from .models import Task
from .services import assign_task, create_task


@login_required
@require_http_methods(["GET", "POST"])
def task_create(request, project_id):
    project = authorized_project(request.user, project_id)
    require_management(request.user, project)
    form = TaskForm(request.POST if request.method == "POST" else None, project=project)
    if request.method == "POST" and form.is_valid():
        try:
            create_task(request.user, project, **form.cleaned_data)
        except ValidationError as error:
            form.add_error(None, ValidationError(error.messages))
        else:
            return redirect("projects:detail", project_id=project.pk)
    return render(request, "tasks/create.html", {"project": project, "form": form})


@login_required
@require_http_methods(["GET", "POST"])
def task_assign(request, project_id, task_id):
    project = authorized_project(request.user, project_id)
    require_management(request.user, project)
    task = get_object_or_404(Task, pk=task_id, project=project)
    form = AssignmentForm(request.POST if request.method == "POST" else None, project=project, initial={"assignee": task.assignee_id})
    if request.method == "POST" and form.is_valid():
        try:
            assign_task(request.user, project, task, form.cleaned_data["assignee"])
        except ValidationError as error:
            form.add_error(None, ValidationError(error.messages))
        else:
            return redirect("projects:detail", project_id=project.pk)
    return render(request, "tasks/assign.html", {"project": project, "task": task, "form": form})
