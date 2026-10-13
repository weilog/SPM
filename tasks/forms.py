from django import forms
from django.contrib.auth import get_user_model
from .models import Task


def eligible_assignees(project):
    return get_user_model().objects.filter(is_active=True, project_memberships__project=project).distinct()


class TaskForm(forms.ModelForm):
    class Meta:
        model = Task
        fields = ["title", "description", "assignee"]

    def __init__(self, *args, project, **kwargs):
        super().__init__(*args, **kwargs)
        self.instance.project = project
        self.fields["assignee"].queryset = eligible_assignees(project)


class AssignmentForm(forms.Form):
    assignee = forms.ModelChoiceField(label="负责人", required=False, queryset=get_user_model().objects.none())

    def __init__(self, *args, project, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["assignee"].queryset = eligible_assignees(project)
