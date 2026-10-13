from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction

from .models import Project, ProjectMembership
from .permissions import MANAGER_GROUP, can_create_project, is_administrator, require_management


@transaction.atomic
def create_project(actor, *, name, description="", manager=None):
    if not can_create_project(actor):
        raise PermissionDenied("无权创建项目。")
    if is_administrator(actor):
        if manager is None or not manager.is_active or not manager.groups.filter(name=MANAGER_GROUP).exists():
            raise ValidationError("请选择有效的项目经理。")
    else:
        # Never accept a forged manager identity from a project manager's request.
        manager = actor
    project = Project(name=name.strip(), description=description, manager=manager)
    project.full_clean()
    project.save()
    ProjectMembership.objects.create(project=project, user=manager)
    return project


@transaction.atomic
def add_member(actor, project, user):
    require_management(actor, project)
    if not get_user_model().objects.filter(pk=user.pk, is_active=True).exists():
        raise ValidationError("只能添加有效用户。")
    membership, created = ProjectMembership.objects.get_or_create(project=project, user=user)
    if not created:
        raise ValidationError("该用户已是项目成员。")
    return membership


@transaction.atomic
def remove_member(actor, project, membership):
    require_management(actor, project)
    if membership.project_id != project.pk:
        raise PermissionDenied("成员关系不属于此项目。")
    if membership.user_id == project.manager_id:
        raise ValidationError("不能移除项目经理。")
    # The post_delete receiver clears assignments within this transaction.
    membership.delete()
