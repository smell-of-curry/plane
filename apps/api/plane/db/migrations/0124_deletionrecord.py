# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0123_alter_draftissue_assignees_alter_issue_assignees_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DeletionRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("model", models.CharField(max_length=100)),
                ("object_id", models.UUIDField()),
                ("deleted_at", models.DateTimeField()),
                ("items", models.JSONField(default=list)),
                ("restored_at", models.DateTimeField(null=True)),
                ("restored_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="restored_deletions", to=settings.AUTH_USER_MODEL)),
                ("actor", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="db.workspace")),
            ],
            options={
                "db_table": "deletion_records",
                "indexes": [models.Index(fields=["workspace", "restored_at"], name="deletion_workspace_idx")],
            },
        ),
    ]
