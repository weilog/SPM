from django.core.exceptions import PermissionDenied
from django.db import transaction
from projects.permissions import require_management
from .models import Task


@transaction.atomic
def create_task(actor, project, *, title, description="", assignee=None):
    require_management(actor, project)
    task = Task(project=project, title=title.strip(), description=description, assignee=assignee)
    task.full_clean()
    task.save()
    return task


@transaction.atomic
def assign_task(actor, project, task, assignee):
    require_management(actor, project)
    if task.project_id != project.pk:
        raise PermissionDenied("任务不属于当前项目。")
    task.assignee = assignee
    task.full_clean()
    task.save(update_fields=["assignee"])
    return task
