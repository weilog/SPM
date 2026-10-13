from django.db import migrations


def create_project_manager_group(apps, schema_editor):
    # Global identity only. Project permissions belong to later approved stages.
    Group = apps.get_model("auth", "Group")
    Group.objects.using(schema_editor.connection.alias).get_or_create(name="项目经理")


class Migration(migrations.Migration):
    dependencies = [("auth", "0012_alter_user_first_name_max_length")]
    operations = [migrations.RunPython(create_project_manager_group, migrations.RunPython.noop)]
