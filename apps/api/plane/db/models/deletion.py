# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Deletion provenance and exact cascade membership for the recycle bin."""

import uuid

from django.conf import settings
from django.db import models


class DeletionRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    model = models.CharField(max_length=100)
    object_id = models.UUIDField()
    deleted_at = models.DateTimeField()
    # Only rows actually deleted by this operation; never an inferred time window.
    items = models.JSONField(default=list)
    restored_at = models.DateTimeField(null=True)
    restored_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="restored_deletions",
    )

    class Meta:
        db_table = "deletion_records"
        indexes = [models.Index(fields=["workspace", "restored_at"], name="deletion_workspace_idx")]
