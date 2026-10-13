"""Keep existing task assignments valid when global users/memberships change."""
from django.conf import settings
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import ProjectMembership


@receiver(post_delete, sender=ProjectMembership)
def clear_removed_member_assignments(sender, instance, using, **kwargs):
    from tasks.models import Task
    Task.objects.using(using).filter(project_id=instance.project_id, assignee_id=instance.user_id).update(assignee=None)


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def clear_inactive_user_assignments(sender, instance, using, **kwargs):
    if not instance.is_active:
        from tasks.models import Task
        Task.objects.using(using).filter(assignee_id=instance.pk).update(assignee=None)
