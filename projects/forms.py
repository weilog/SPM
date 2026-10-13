from django import forms
from django.contrib.auth import get_user_model

from .models import Project
from .permissions import MANAGER_GROUP, is_administrator


class ProjectForm(forms.ModelForm):
    manager = forms.ModelChoiceField(label="项目经理", queryset=get_user_model().objects.none())

    class Meta:
        model = Project
        fields = ["name", "description"]

    def __init__(self, *args, actor, **kwargs):
        super().__init__(*args, **kwargs)
        if is_administrator(actor):
            self.fields["manager"].queryset = get_user_model().objects.filter(is_active=True, groups__name=MANAGER_GROUP).distinct()
        else:
            del self.fields["manager"]


class MembershipForm(forms.Form):
    user = forms.ModelChoiceField(label="添加成员", queryset=get_user_model().objects.none())

    def __init__(self, *args, project, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["user"].queryset = get_user_model().objects.filter(is_active=True).exclude(project_memberships__project=project)
