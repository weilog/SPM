from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class Task(models.Model):
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField("任务标题", max_length=200)
    description = models.TextField("任务说明", blank=True)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_tasks", verbose_name="负责人")
    status = models.CharField(max_length=10, default="TODO", editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        constraints = [models.CheckConstraint(condition=models.Q(status="TODO"), name="sprint1_task_todo_only")]

    def clean(self):
        super().clean()
        if self.assignee_id and not self.project.memberships.filter(user_id=self.assignee_id, user__is_active=True).exists():
            raise ValidationError({"assignee": "负责人必须是当前项目的有效成员。"})

    def __str__(self):
        return self.title
