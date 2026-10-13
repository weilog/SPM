"""Request-level acceptance and negative authorization cases for US01/US02."""
import secrets

from django.contrib.auth import SESSION_KEY, get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

User = get_user_model()


class AccountFixtures(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.password = secrets.token_urlsafe(24)
        cls.admin = User.objects.create_superuser("administrator", password=cls.password)
        cls.member = User.objects.create_user("member", password=cls.password)
        cls.manager = User.objects.create_user("manager", password=cls.password)
        cls.manager.groups.add(Group.objects.get(name="项目经理"))
        cls.staff = User.objects.create_user("staff", password=cls.password, is_staff=True)
        cls.staff.user_permissions.set(Permission.objects.filter(content_type__app_label="auth"))
        cls.inactive = User.objects.create_user("inactive", password=cls.password, is_active=False)


class AuthenticationTests(AccountFixtures):
    def test_anonymous_home_requires_login(self):
        self.assertRedirects(self.client.get("/"), "/login/?next=/")

    def test_valid_login_creates_session_and_renders_home(self):
        response = self.client.post("/login/", {"username": "member", "password": self.password})
        self.assertRedirects(response, "/")
        self.assertEqual(self.client.session[SESSION_KEY], str(self.member.pk))
        self.assertContains(self.client.get("/"), "欢迎，member")

    def test_wrong_unknown_or_inactive_login_is_rejected(self):
        for username, password in [("member", "wrong"), ("missing", self.password), ("inactive", self.password)]:
            with self.subTest(username=username):
                response = self.client.post("/login/", {"username": username, "password": password})
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["form"].errors)
                self.assertNotIn(SESSION_KEY, self.client.session)

    def test_post_logout_ends_session_and_protects_home(self):
        self.client.force_login(self.member)
        self.assertRedirects(self.client.post("/logout/"), "/login/")
        self.assertNotIn(SESSION_KEY, self.client.session)
        self.assertRedirects(self.client.get("/"), "/login/?next=/")

    def test_get_logout_is_disallowed_and_preserves_session(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.get("/logout/").status_code, 405)
        self.assertIn(SESSION_KEY, self.client.session)

    def test_external_next_cannot_redirect_off_site(self):
        for next_url in ["https://example.com/", "//example.com/"]:
            with self.subTest(next_url=next_url):
                self.client.logout()
                response = self.client.post("/login/", {"username": "member", "password": self.password, "next": next_url})
                self.assertRedirects(response, "/")

    def test_local_next_is_respected(self):
        response = self.client.post("/login/?next=/", {"username": "member", "password": self.password, "next": "/"})
        self.assertRedirects(response, "/")

    def test_login_and_logout_enforce_csrf(self):
        browser = Client(enforce_csrf_checks=True)
        credentials = {"username": "member", "password": self.password}
        self.assertEqual(browser.post("/login/", credentials).status_code, 403)
        browser.get("/login/")
        token = browser.cookies["csrftoken"].value
        response = browser.post("/login/", {**credentials, "csrfmiddlewaretoken": token})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(browser.post("/logout/").status_code, 403)
        browser.get("/")
        token = browser.cookies["csrftoken"].value
        self.assertEqual(browser.post("/logout/", {"csrfmiddlewaretoken": token}).status_code, 302)
        self.assertNotIn(SESSION_KEY, browser.session)

    def test_deactivated_user_session_loses_access(self):
        self.client.force_login(self.member)
        self.member.is_active = False
        self.member.save()
        self.assertRedirects(self.client.get("/"), "/login/?next=/")

    def test_admin_link_visible_only_to_system_admin(self):
        for user in [self.member, self.manager, self.staff, self.admin]:
            with self.subTest(user=user.username):
                self.client.force_login(user)
                response = self.client.get("/")
                if user.is_superuser:
                    self.assertContains(response, 'href="/admin/"')
                else:
                    self.assertNotContains(response, 'href="/admin/"')


class GlobalAdministrationTests(AccountFixtures):
    def setUp(self):
        self.client.force_login(self.admin)

    def user_change_data(self, user, **changes):
        data = {"username": user.username, "first_name": "", "last_name": "", "email": "", "is_active": "on", "groups": [], "user_permissions": []}
        joined = timezone.localtime(user.date_joined)
        data.update({"date_joined_0": joined.strftime("%Y-%m-%d"), "date_joined_1": joined.strftime("%H:%M:%S")})
        data.update(changes)
        return data

    def test_admin_can_open_users_and_groups(self):
        for url in ["/admin/", reverse("admin:auth_user_changelist"), reverse("admin:auth_group_changelist")]:
            self.assertEqual(self.client.get(url).status_code, 200)

    def test_system_admin_can_log_in_through_admin_form(self):
        browser = Client()
        response = browser.post("/admin/login/?next=/admin/", {"username": "administrator", "password": self.password, "next": "/admin/"})
        self.assertRedirects(response, "/admin/")
        self.assertEqual(browser.session[SESSION_KEY], str(self.admin.pk))

    def test_admin_can_create_user_with_hashed_password(self):
        password = secrets.token_urlsafe(24)
        response = self.client.post(reverse("admin:auth_user_add"), {"username": "created", "password1": password, "password2": password, "usable_password": "true"})
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(username="created")
        self.assertTrue(user.check_password(password))
        self.assertNotEqual(user.password, password)
        self.assertFalse(user.is_superuser)

    def test_admin_rejects_duplicate_and_weak_password(self):
        for username, password in [("member", self.password), ("weak", "123")]:
            with self.subTest(username=username):
                response = self.client.post(reverse("admin:auth_user_add"), {"username": username, "password1": password, "password2": password, "usable_password": "true"})
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["adminform"].form.errors)
        self.assertFalse(User.objects.filter(username="weak").exists())

    def test_admin_can_edit_profile_and_grant_group_permission(self):
        group = Group.objects.get(name="项目经理")
        permission = Permission.objects.get(codename="view_user")
        response = self.client.post(reverse("admin:auth_user_change", args=[self.member.pk]), self.user_change_data(self.member, email="member@example.com", groups=[group.pk], user_permissions=[permission.pk]))
        self.assertEqual(response.status_code, 302)
        self.member.refresh_from_db()
        self.assertEqual(self.member.email, "member@example.com")
        self.assertTrue(self.member.groups.filter(pk=group.pk).exists())
        self.assertTrue(self.member.user_permissions.filter(pk=permission.pk).exists())

    def test_admin_can_revoke_global_grants(self):
        self.member.groups.add(Group.objects.get(name="项目经理"))
        self.member.user_permissions.add(Permission.objects.get(codename="view_user"))
        response = self.client.post(reverse("admin:auth_user_change", args=[self.member.pk]), self.user_change_data(self.member))
        self.assertEqual(response.status_code, 302)
        self.assertFalse(self.member.groups.exists())
        self.assertFalse(self.member.user_permissions.exists())

    def test_admin_can_grant_and_revoke_system_administrator(self):
        url = reverse("admin:auth_user_change", args=[self.member.pk])
        response = self.client.post(url, self.user_change_data(self.member, is_staff="on", is_superuser="on"))
        self.assertEqual(response.status_code, 302)
        self.member.refresh_from_db()
        browser = Client()
        browser.force_login(self.member)
        self.assertEqual(browser.get("/admin/").status_code, 200)
        self.assertEqual(self.client.post(url, self.user_change_data(self.member)).status_code, 302)
        self.assertEqual(browser.get("/admin/").status_code, 302)

    def test_admin_can_disable_and_delete_user(self):
        response = self.client.post(reverse("admin:auth_user_change", args=[self.member.pk]), self.user_change_data(self.member, is_active=""))
        self.assertEqual(response.status_code, 302)
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)
        response = self.client.post(reverse("admin:auth_user_delete", args=[self.member.pk]), {"post": "yes"})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(User.objects.filter(pk=self.member.pk).exists())

    def test_admin_can_reset_password(self):
        password = secrets.token_urlsafe(24)
        response = self.client.post(reverse("admin:auth_user_password_change", args=[self.member.pk]), {"password1": password, "password2": password, "usable_password": "true"})
        self.assertEqual(response.status_code, 302)
        self.member.refresh_from_db()
        self.assertTrue(self.member.check_password(password))

    def test_admin_can_manage_group_permissions(self):
        permission = Permission.objects.get(codename="view_user")
        response = self.client.post(reverse("admin:auth_group_add"), {"name": "演示组", "permissions": [permission.pk]})
        self.assertEqual(response.status_code, 302)
        group = Group.objects.get(name="演示组")
        self.assertTrue(group.permissions.filter(pk=permission.pk).exists())
        response = self.client.post(reverse("admin:auth_group_change", args=[group.pk]), {"name": "演示组", "permissions": []})
        self.assertEqual(response.status_code, 302)
        self.assertFalse(group.permissions.exists())
        self.assertEqual(self.client.post(reverse("admin:auth_group_delete", args=[group.pk]), {"post": "yes"}).status_code, 302)
        self.assertFalse(Group.objects.filter(pk=group.pk).exists())

    def test_non_admin_direct_reads_and_writes_cannot_manage_users(self):
        urls = ["/admin/", reverse("admin:auth_user_changelist"), reverse("admin:auth_user_add"), reverse("admin:auth_user_change", args=[self.member.pk]), reverse("admin:auth_user_delete", args=[self.member.pk]), reverse("admin:auth_user_password_change", args=[self.member.pk]), reverse("admin:auth_group_add"), reverse("admin:auth_group_change", args=[Group.objects.get(name="项目经理").pk])]
        for user in [None, self.member, self.manager, self.staff, self.inactive]:
            for url in urls:
                with self.subTest(user=user, url=url):
                    browser = Client()
                    if user:
                        browser.force_login(user)
                    self.assertEqual(browser.get(url).status_code, 302)
                    self.assertEqual(browser.post(url, {"username": "intruder", "is_superuser": "on", "post": "yes", "name": "changed", "password1": "bad", "password2": "bad"}).status_code, 302)
        self.member.refresh_from_db()
        self.assertEqual(self.member.username, "member")
        self.assertFalse(self.member.is_superuser)
        self.assertTrue(self.member.check_password(self.password))
        self.assertTrue(Group.objects.filter(name="项目经理").exists())
        self.assertFalse(User.objects.filter(username="intruder").exists())

    def test_staff_login_does_not_bypass_admin_site_policy(self):
        browser = Client()
        response = browser.post("/admin/login/?next=/admin/", {"username": "staff", "password": self.password, "next": "/admin/"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["form"].errors)
        self.assertNotIn(SESSION_KEY, browser.session)
        self.assertEqual(browser.get("/admin/").status_code, 302)

    def test_inactive_or_non_staff_superuser_cannot_access_admin(self):
        for flags in [{"is_active": False}, {"is_staff": False}]:
            with self.subTest(flags=flags):
                user = User.objects.create_superuser("restricted" + secrets.token_hex(4), password=self.password, **flags) if "is_staff" not in flags else User.objects.create_user("restricted" + secrets.token_hex(4), password=self.password, is_superuser=True, **flags)
                browser = Client()
                browser.force_login(user)
                self.assertEqual(browser.get("/admin/").status_code, 302)

    def test_admin_mutation_requires_csrf(self):
        browser = Client(enforce_csrf_checks=True)
        browser.force_login(self.admin)
        self.assertEqual(browser.post(reverse("admin:auth_user_delete", args=[self.member.pk]), {"post": "yes"}).status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.member.pk).exists())

    def test_manager_group_has_no_business_or_admin_permissions(self):
        self.assertFalse(Group.objects.get(name="项目经理").permissions.exists())
