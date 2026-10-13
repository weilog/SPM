from django.core.exceptions import PermissionDenied
from django.db.models import Q

from .models import Project

MANAGER_GROUP = "项目经理"


def is_administrator(user):
    return user.is_authenticated and user.is_active and user.is_staff and user.is_superuser


def is_project_manager(user):
    return user.is_authenticated and user.is_active and user.groups.filter(name=MANAGER_GROUP).exists()


def can_create_project(user):
    return is_administrator(user) or is_project_manager(user)


def visible_projects(user):
    if not user.is_authenticated or not user.is_active:
        return Project.objects.none()
    if is_administrator(user):
        return Project.objects.all()
    return Project.objects.filter(Q(manager=user) | Q(memberships__user=user)).distinct()


def can_manage_project(user, project):
    return is_administrator(user) or (is_project_manager(user) and project.manager_id == user.pk)


def require_management(user, project):
    if not can_manage_project(user, project):
        raise PermissionDenied("无权管理此项目。")
