import secrets

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase
from django.urls import reverse

from .models import Project, ProjectMembership
from .services import add_member, create_project, remove_member

User = get_user_model()


class ProjectFixtures(TestCase):
    @classmethod
    def setUpTestData(cls):
        password = secrets.token_urlsafe(24)
        cls.password = password
        cls.admin = User.objects.create_superuser("admin", password=password)
        cls.manager = User.objects.create_user("manager", password=password)
        cls.other_manager = User.objects.create_user("other-manager", password=password)
        group = Group.objects.get(name="项目经理")
        cls.manager.groups.add(group)
        cls.other_manager.groups.add(group)
        cls.member = User.objects.create_user("member", password=password)
        cls.outsider = User.objects.create_user("outsider", password=password)
        cls.inactive = User.objects.create_user("inactive", password=password, is_active=False)
        cls.project = create_project(cls.manager, name="Alpha", description="Alpha private description")
        cls.other = create_project(cls.other_manager, name="Beta", description="Beta private description")
        cls.membership = add_member(cls.manager, cls.project, cls.member)

    def login_as(self, user):
        self.client.force_login(user)

    def url(self, name, project=None, **kwargs):
        return reverse("projects:" + name, kwargs={"project_id": (project or self.project).pk, **kwargs})


class ProjectCreationTests(ProjectFixtures):
    def test_manager_creates_persistent_project_and_own_membership(self):
        self.login_as(self.manager)
        response = self.client.post(reverse("projects:create"), {"name": "  New project  ", "description": "Notes", "manager": self.other_manager.pk})
        project = Project.objects.get(name="New project")
        self.assertRedirects(response, self.url("detail", project))
        self.assertEqual(project.manager, self.manager)
        self.assertEqual(project.description, "Notes")
        self.assertEqual(project.memberships.get().user, self.manager)

    def test_admin_must_choose_active_global_project_manager(self):
        self.login_as(self.admin)
        response = self.client.post(reverse("projects:create"), {"name": "Admin project", "manager": self.other_manager.pk})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Project.objects.get(name="Admin project").manager, self.other_manager)
        for manager in [None, self.member.pk, self.inactive.pk]:
            with self.subTest(manager=manager):
                data = {"name": "Rejected", "manager": manager or ""}
                response = self.client.post(reverse("projects:create"), data)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["form"].errors)
        self.assertFalse(Project.objects.filter(name="Rejected").exists())

    def test_ordinary_user_cannot_create_project_get_or_post(self):
        self.login_as(self.member)
        for method in [self.client.get, self.client.post]:
            self.assertEqual(method(reverse("projects:create"), {"name": "Forged"}).status_code, 403)
        self.assertFalse(Project.objects.filter(name="Forged").exists())

    def test_project_name_required_and_length_validated(self):
        self.login_as(self.manager)
        for name in ["", "   ", "x" * 201]:
            with self.subTest(name=name):
                response = self.client.post(reverse("projects:create"), {"name": name})
                self.assertEqual(response.status_code, 200)
                self.assertIn("name", response.context["form"].errors)
        self.assertEqual(Project.objects.count(), 2)

    def test_service_rejects_unprivileged_actor_and_invalid_admin_manager(self):
        with self.assertRaises(PermissionDenied):
            create_project(self.member, name="Blocked")
        with self.assertRaises(ValidationError):
            create_project(self.admin, name="Blocked", manager=self.member)
        with self.assertRaises(ValidationError):
            create_project(self.manager, name=" ")
        self.assertEqual(Project.objects.count(), 2)

    def test_project_creation_requires_csrf(self):
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(self.manager)
        self.assertEqual(browser.post(reverse("projects:create"), {"name": "Blocked"}).status_code, 403)
        self.assertFalse(Project.objects.filter(name="Blocked").exists())

    def test_empty_post_renders_required_field_errors(self):
        self.login_as(self.manager)
        response = self.client.post(reverse("projects:create"), {})
        self.assertIn("name", response.context["form"].errors)


class ProjectVisibilityTests(ProjectFixtures):
    def test_member_list_contains_only_authorized_projects(self):
        self.login_as(self.member)
        response = self.client.get(reverse("projects:list"))
        self.assertContains(response, "Alpha")
        self.assertNotContains(response, "Beta")
        self.assertNotContains(response, "创建项目")
        self.assertEqual(list(response.context["projects"]), [self.project])

    def test_multi_project_member_can_switch_using_explicit_context(self):
        add_member(self.other_manager, self.other, self.member)
        self.login_as(self.member)
        response = self.client.get(reverse("projects:list"))
        self.assertContains(response, self.url("detail", self.project))
        self.assertContains(response, self.url("detail", self.other))
        for project in [self.project, self.other]:
            response = self.client.get(self.url("detail", project))
            self.assertEqual(response.context["project"], project)
            self.assertContains(response, project.description)

    def test_unauthorized_project_direct_url_is_not_found(self):
        for user in [self.member, self.manager, self.outsider]:
            with self.subTest(user=user):
                self.login_as(user)
                response = self.client.get(self.url("detail", self.other))
                self.assertEqual(response.status_code, 404)
                self.assertNotContains(response, self.other.description, status_code=404)

    def test_admin_can_view_all_projects(self):
        self.login_as(self.admin)
        self.assertEqual(set(self.client.get(reverse("projects:list")).context["projects"]), {self.project, self.other})
        self.assertEqual(self.client.get(self.url("detail", self.other)).status_code, 200)

    def test_removed_membership_immediately_revokes_read_access(self):
        self.login_as(self.member)
        self.assertEqual(self.client.get(self.url("detail")).status_code, 200)
        remove_member(self.manager, self.project, self.membership)
        self.assertEqual(self.client.get(self.url("detail")).status_code, 404)
        self.assertNotContains(self.client.get(reverse("projects:list")), "Alpha")

    def test_anonymous_routes_redirect_to_login(self):
        for url in [reverse("projects:list"), reverse("projects:create"), self.url("detail"), self.url("members")]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 302)
                self.assertTrue(self.client.get(url)["Location"].startswith("/login/?next="))

    def test_names_and_descriptions_are_html_escaped(self):
        project = create_project(self.manager, name="<script>alert(1)</script>", description="<img src=x onerror=alert(1)>")
        self.login_as(self.manager)
        response = self.client.get(self.url("detail", project))
        self.assertContains(response, "&lt;script&gt;")
        self.assertNotContains(response, "<script>alert")
        self.assertNotContains(response, "<img src=x")


class MembershipTests(ProjectFixtures):
    def test_manager_adds_and_removes_active_member(self):
        self.login_as(self.manager)
        response = self.client.post(self.url("members"), {"user": self.outsider.pk})
        self.assertRedirects(response, self.url("members"))
        membership = self.project.memberships.get(user=self.outsider)
        response = self.client.post(self.url("member_remove", membership_id=membership.pk))
        self.assertRedirects(response, self.url("members"))
        self.assertFalse(self.project.memberships.filter(user=self.outsider).exists())

    def test_duplicate_and_inactive_users_rejected(self):
        self.login_as(self.manager)
        for user in [self.member, self.inactive]:
            with self.subTest(user=user):
                response = self.client.post(self.url("members"), {"user": user.pk})
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["form"].errors)
        self.assertEqual(self.project.memberships.count(), 2)
        with self.assertRaises(ValidationError):
            add_member(self.manager, self.project, self.member)

    def test_database_prevents_duplicate_membership(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            ProjectMembership.objects.create(project=self.project, user=self.member)

    def test_member_cannot_manage_members_get_or_post(self):
        self.login_as(self.member)
        self.assertEqual(self.client.get(self.url("members")).status_code, 403)
        self.assertEqual(self.client.post(self.url("members"), {"user": self.outsider.pk}).status_code, 403)
        self.assertEqual(self.client.post(self.url("member_remove", membership_id=self.membership.pk)).status_code, 403)
        self.assertTrue(ProjectMembership.objects.filter(pk=self.membership.pk).exists())

    def test_other_manager_cannot_manage_even_if_project_member(self):
        add_member(self.manager, self.project, self.other_manager)
        self.login_as(self.other_manager)
        self.assertEqual(self.client.post(self.url("members"), {"user": self.outsider.pk}).status_code, 403)
        self.assertEqual(self.client.post(self.url("member_remove", membership_id=self.membership.pk)).status_code, 403)

    def test_cross_project_membership_id_cannot_be_removed(self):
        membership = add_member(self.other_manager, self.other, self.outsider)
        self.login_as(self.manager)
        self.assertEqual(self.client.post(self.url("member_remove", membership_id=membership.pk)).status_code, 404)
        self.assertTrue(ProjectMembership.objects.filter(pk=membership.pk).exists())

    def test_manager_cannot_be_removed_and_get_does_not_mutate(self):
        self.login_as(self.manager)
        membership = self.project.memberships.get(user=self.manager)
        url = self.url("member_remove", membership_id=membership.pk)
        self.assertEqual(self.client.get(url).status_code, 405)
        self.assertContains(self.client.post(url, follow=True), "不能移除项目经理")
        self.assertTrue(ProjectMembership.objects.filter(pk=membership.pk).exists())

    def test_revoked_global_manager_group_removes_management_rights(self):
        self.manager.groups.clear()
        self.login_as(self.manager)
        self.assertEqual(self.client.get(self.url("detail")).status_code, 200)
        self.assertEqual(self.client.post(self.url("members"), {"user": self.outsider.pk}).status_code, 403)
        self.assertEqual(self.client.post(reverse("projects:create"), {"name": "Denied"}).status_code, 403)

    def test_member_management_requires_csrf(self):
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(self.manager)
        for url, data in [(self.url("members"), {"user": self.outsider.pk}), (self.url("member_remove", membership_id=self.membership.pk), {})]:
            self.assertEqual(browser.post(url, data).status_code, 403)
        self.assertTrue(ProjectMembership.objects.filter(pk=self.membership.pk).exists())

    def test_services_independently_reject_cross_project_or_unprivileged_mutations(self):
        with self.assertRaises(PermissionDenied):
            add_member(self.member, self.project, self.outsider)
        with self.assertRaises(PermissionDenied):
            remove_member(self.manager, self.other, self.membership)
        with self.assertRaises(PermissionDenied):
            remove_member(self.other_manager, self.other, self.membership)
        with self.assertRaises(ValidationError):
            add_member(self.manager, self.project, self.inactive)

    def test_admin_can_manage_members(self):
        self.login_as(self.admin)
        self.assertEqual(self.client.post(self.url("members"), {"user": self.outsider.pk}).status_code, 302)
        self.assertTrue(self.project.memberships.filter(user=self.outsider).exists())
