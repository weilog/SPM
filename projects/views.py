from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied, ValidationError
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .forms import MembershipForm, ProjectForm
from .models import ProjectMembership
from .permissions import can_create_project, can_manage_project, require_management, visible_projects
from .services import add_member, create_project, remove_member


def authorized_project(user, project_id):
    # Scope before lookup: inaccessible projects reveal no contents or existence.
    return get_object_or_404(visible_projects(user), pk=project_id)


@login_required
@require_GET
def project_list(request):
    return render(request, "projects/list.html", {"projects": visible_projects(request.user).select_related("manager"), "can_create": can_create_project(request.user)})


@login_required
@require_http_methods(["GET", "POST"])
def project_create(request):
    if not can_create_project(request.user):
        raise PermissionDenied("无权创建项目。")
    form = ProjectForm(request.POST if request.method == "POST" else None, actor=request.user)
    if request.method == "POST" and form.is_valid():
        try:
            project = create_project(request.user, name=form.cleaned_data["name"], description=form.cleaned_data["description"], manager=form.cleaned_data.get("manager"))
        except ValidationError as error:
            form.add_error(None, error)
        else:
            return redirect("projects:detail", project_id=project.pk)
    return render(request, "projects/form.html", {"form": form})


@login_required
@require_GET
def project_detail(request, project_id):
    project = authorized_project(request.user, project_id)
    manage = can_manage_project(request.user, project)
    return render(request, "projects/detail.html", {
        "project": project, "can_manage": manage,
        # Only managers need this minimal index to perform US09 assignments.
        "assignable_tasks": project.tasks.select_related("assignee") if manage else [],
    })


@login_required
@require_http_methods(["GET", "POST"])
def project_members(request, project_id):
    project = authorized_project(request.user, project_id)
    require_management(request.user, project)
    form = MembershipForm(request.POST if request.method == "POST" else None, project=project)
    if request.method == "POST" and form.is_valid():
        try:
            add_member(request.user, project, form.cleaned_data["user"])
        except ValidationError as error:
            form.add_error(None, error)
        else:
            return redirect("projects:members", project_id=project.pk)
    return render(request, "projects/members.html", {"project": project, "form": form, "memberships": project.memberships.select_related("user")})


@login_required
@require_POST
def member_remove(request, project_id, membership_id):
    project = authorized_project(request.user, project_id)
    require_management(request.user, project)
    membership = get_object_or_404(ProjectMembership, pk=membership_id, project=project)
    try:
        remove_member(request.user, project, membership)
    except ValidationError as error:
        messages.error(request, "；".join(error.messages))
    return redirect("projects:members", project_id=project.pk)
