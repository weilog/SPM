from django.apps import AppConfig
from django.contrib.admin.apps import AdminConfig


class SystemAdminConfig(AdminConfig):
    default_site = "accounts.admin_site.SystemAdminSite"


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"
    verbose_name = "账户"
