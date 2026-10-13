from django.contrib.admin import AdminSite
from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.exceptions import ValidationError


class SystemAdminAuthenticationForm(AdminAuthenticationForm):
    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_superuser:
            raise ValidationError(self.error_messages["invalid_login"], code="invalid_login", params={"username": self.username_field.verbose_name})


class SystemAdminSite(AdminSite):
    login_form = SystemAdminAuthenticationForm
    site_header = "爱管理 · 全局用户与权限"
    site_title = "爱管理"
    index_title = "系统管理"

    def has_permission(self, request):
        """US02: staff/model permissions must never grant global administration."""
        user = request.user
        return user.is_active and user.is_staff and user.is_superuser
