from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.test import Client
from django.urls import reverse

from projects.models import ProjectMembership
from projects.services import add_member, remove_member
from projects.tests import ProjectFixtures
from .models import Task
from .services import assign_task, create_task


class TaskTests(ProjectFixtures):
    def task_url(self, name, project=None, task=None):
        kwargs = {"project_id": (project or self.project).pk}
        if task:
            kwargs["task_id"] = task.pk
        return reverse("tasks:" + name, kwargs=kwargs)

    def test_manager_creates_task_with_project_and_todo_default(self):
        self.login_as(self.manager)
        response = self.client.post(self.task_url("create"), {"title": "  Build feature  ", "description": "Detail", "assignee": self.member.pk, "project": self.other.pk, "status": "DONE"})
        self.assertRedirects(response, self.url("detail"))
        task = Task.objects.get()
        self.assertEqual(task.title, "Build feature")
        self.assertEqual(task.description, "Detail")
        self.assertEqual(task.project, self.project)
        self.assertEqual(task.status, "TODO")
        self.assertEqual(task.assignee, self.member)

    def test_task_can_be_created_unassigned(self):
        self.login_as(self.manager)
        self.assertEqual(self.client.post(self.task_url("create"), {"title": "Unassigned"}).status_code, 302)
        self.assertIsNone(Task.objects.get().assignee)

    def test_empty_post_clears_assignment_but_empty_creation_has_errors(self):
        self.login_as(self.manager)
        response = self.client.post(self.task_url("create"), {})
        self.assertIn("title", response.context["form"].errors)
        task = create_task(self.manager, self.project, title="Clear", assignee=self.member)
        response = self.client.post(self.task_url("assign", task=task), {})
        self.assertRedirects(response, self.url("detail"))
        task.refresh_from_db()
        self.assertIsNone(task.assignee)

    def test_blank_or_oversized_title_is_rejected(self):
        self.login_as(self.manager)
        for title in ["", " ", "x" * 201]:
            with self.subTest(title=title):
                response = self.client.post(self.task_url("create"), {"title": title})
                self.assertEqual(response.status_code, 200)
                self.assertIn("title", response.context["form"].errors)
        self.assertFalse(Task.objects.exists())

    def test_creation_rejects_nonmember_and_inactive_assignees(self):
        ProjectMembership.objects.create(project=self.project, user=self.inactive)
        self.login_as(self.manager)
        for user in [self.outsider, self.other_manager, self.inactive]:
            response = self.client.post(self.task_url("create"), {"title": "Rejected", "assignee": user.pk})
            self.assertEqual(response.status_code, 200)
            self.assertIn("assignee", response.context["form"].errors)
        self.assertFalse(Task.objects.exists())

    def test_member_and_outsider_cannot_create_or_assign_tasks(self):
        task = create_task(self.manager, self.project, title="Private task")
        for user, expected in [(self.member, 403), (self.outsider, 404), (self.other_manager, 404)]:
            with self.subTest(user=user):
                self.login_as(user)
                for url in [self.task_url("create"), self.task_url("assign", task=task)]:
                    self.assertEqual(self.client.get(url).status_code, expected)
                    self.assertEqual(self.client.post(url, {"title": "Forged", "assignee": self.member.pk}).status_code, expected)
        self.assertEqual(Task.objects.count(), 1)
        task.refresh_from_db()
        self.assertIsNone(task.assignee)

    def test_other_manager_even_as_member_cannot_manage_task(self):
        add_member(self.manager, self.project, self.other_manager)
        self.login_as(self.other_manager)
        task = create_task(self.manager, self.project, title="Private")
        self.assertEqual(self.client.post(self.task_url("assign", task=task), {"assignee": self.member.pk}).status_code, 403)
        self.assertEqual(self.client.post(self.task_url("create"), {"title": "Denied"}).status_code, 403)

    def test_assign_reassign_and_clear_within_current_project(self):
        task = create_task(self.manager, self.project, title="Assign")
        self.login_as(self.manager)
        for user in [self.member, self.manager, None]:
            with self.subTest(user=user):
                response = self.client.post(self.task_url("assign", task=task), {"assignee": user.pk if user else "", "title": "Injected", "status": "DONE"})
                self.assertRedirects(response, self.url("detail"))
                task.refresh_from_db()
                self.assertEqual(task.assignee, user)
                self.assertEqual(task.title, "Assign")
                self.assertEqual(task.status, "TODO")

    def test_assign_rejects_nonmember_and_inactive_without_modifying_task(self):
        task = create_task(self.manager, self.project, title="Assign", assignee=self.member)
        ProjectMembership.objects.create(project=self.project, user=self.inactive)
        self.login_as(self.manager)
        for user in [self.other_manager, self.outsider, self.inactive]:
            response = self.client.post(self.task_url("assign", task=task), {"assignee": user.pk})
            self.assertEqual(response.status_code, 200)
            self.assertIn("assignee", response.context["form"].errors)
            task.refresh_from_db()
            self.assertEqual(task.assignee, self.member)

    def test_cross_project_task_id_and_project_url_cannot_be_used(self):
        task = create_task(self.other_manager, self.other, title="Beta secret")
        self.login_as(self.manager)
        for method in [self.client.get, self.client.post]:
            self.assertEqual(method(self.task_url("assign", task=task), {"assignee": self.member.pk}).status_code, 404)
            self.assertEqual(method(self.task_url("assign", project=self.other, task=task), {"assignee": self.member.pk}).status_code, 404)
        task.refresh_from_db()
        self.assertIsNone(task.assignee)

    def test_forms_only_offer_active_current_members(self):
        self.login_as(self.manager)
        ProjectMembership.objects.create(project=self.project, user=self.inactive)
        task = create_task(self.manager, self.project, title="Choice")
        for url in [self.task_url("create"), self.task_url("assign", task=task)]:
            choices = self.client.get(url).context["form"].fields["assignee"].queryset
            self.assertEqual(set(choices), {self.manager, self.member})

    def test_member_removal_clears_only_that_project_assignments(self):
        add_member(self.other_manager, self.other, self.member)
        first = create_task(self.manager, self.project, title="First", assignee=self.member)
        second = create_task(self.other_manager, self.other, title="Second", assignee=self.member)
        remove_member(self.manager, self.project, self.membership)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertIsNone(first.assignee)
        self.assertEqual(second.assignee, self.member)

    def test_global_user_deactivation_clears_assignments_and_rejects_login(self):
        task = create_task(self.manager, self.project, title="Deactivate", assignee=self.member)
        self.assertTrue(self.client.login(username="member", password=self.password))
        self.member.is_active = False
        self.member.save(update_fields=["is_active"])
        task.refresh_from_db()
        self.assertIsNone(task.assignee)
        self.assertEqual(self.client.get(self.url("detail")).status_code, 302)
        self.assertFalse(self.client.login(username="member", password=self.password))

    def test_global_user_deletion_clears_assignee(self):
        task = create_task(self.manager, self.project, title="Delete", assignee=self.member)
        self.member.delete()
        task.refresh_from_db()
        self.assertIsNone(task.assignee)

    def test_get_requests_do_not_mutate_and_csrf_protects_writes(self):
        task = create_task(self.manager, self.project, title="CSRF")
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(self.manager)
        for url in [self.task_url("create"), self.task_url("assign", task=task)]:
            self.assertEqual(browser.get(url).status_code, 200)
            self.assertEqual(browser.post(url, {"title": "Denied", "assignee": self.member.pk}).status_code, 403)
        task.refresh_from_db()
        self.assertIsNone(task.assignee)
        self.assertEqual(Task.objects.count(), 1)

    def test_services_and_model_reject_cross_project_assignee_or_actor(self):
        task = create_task(self.manager, self.project, title="Service")
        with self.assertRaises(PermissionDenied):
            create_task(self.member, self.project, title="Denied")
        with self.assertRaises(PermissionDenied):
            assign_task(self.member, self.project, task, self.member)
        with self.assertRaises(PermissionDenied):
            assign_task(self.other_manager, self.other, task, self.other_manager)
        with self.assertRaises(ValidationError):
            assign_task(self.manager, self.project, task, self.other_manager)
        with self.assertRaises(ValidationError):
            create_task(self.manager, self.project, title="Denied", assignee=self.inactive)
        invalid = Task(project=self.project, title="Invalid", assignee=self.other_manager)
        with self.assertRaises(ValidationError):
            invalid.full_clean()
        task.refresh_from_db()
        self.assertIsNone(task.assignee)

    def test_database_prevents_sprint2_status(self):
        task = create_task(self.manager, self.project, title="TODO only")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Task.objects.filter(pk=task.pk).update(status="DONE")

    def test_revoked_manager_cannot_create_or_assign(self):
        task = create_task(self.manager, self.project, title="Revoked")
        self.manager.groups.clear()
        self.login_as(self.manager)
        for url in [self.task_url("create"), self.task_url("assign", task=task)]:
            self.assertEqual(self.client.post(url, {"title": "Denied", "assignee": self.member.pk}).status_code, 403)

    def test_anonymous_task_routes_redirect(self):
        task = create_task(self.manager, self.project, title="Anonymous")
        for url in [self.task_url("create"), self.task_url("assign", task=task)]:
            self.assertEqual(self.client.get(url).status_code, 302)
            self.assertEqual(self.client.post(url, {}).status_code, 302)

    def test_admin_can_create_and_assign_task_without_membership(self):
        self.login_as(self.admin)
        self.assertEqual(self.client.post(self.task_url("create"), {"title": "Admin", "assignee": self.member.pk}).status_code, 302)
        task = Task.objects.get()
        self.assertEqual(self.client.post(self.task_url("assign", task=task), {"assignee": self.manager.pk}).status_code, 302)
        task.refresh_from_db()
        self.assertEqual(task.assignee, self.manager)

    def test_ordinary_member_detail_does_not_expose_task_assignment_controls(self):
        create_task(self.manager, self.project, title="Manager task index")
        self.login_as(self.member)
        response = self.client.get(self.url("detail"))
        self.assertNotContains(response, "创建任务")
        self.assertNotContains(response, "Manager task index")
