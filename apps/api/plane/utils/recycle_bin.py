# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Track recoverable deletes without guessing from created_by or updated_by."""

from contextvars import ContextVar

from crum import get_current_user
from django.db import transaction


RECOVERABLE_MODELS = {
    "project": "Project",
    "issue": "Work item",
    "module": "Module",
    "cycle": "Cycle",
    "page": "Page",
    "issueview": "View",
    "label": "Label",
}
deletion_items = ContextVar("deletion_items", default=None)


def capture_deletion(instance):
    items = deletion_items.get()
    if items is not None:
        items.append(
            {
                "model": instance._meta.label_lower,
                "id": str(instance.pk),
                "deleted_at": instance.deleted_at.isoformat(),
            }
        )


def capture_detachment(instance, field_name):
    """Remember SET_NULL edges (sub-item parent, issue sequence, etc.)."""
    items = deletion_items.get()
    if items is not None:
        value = getattr(instance, instance._meta.get_field(field_name).attname)
        if value is not None:
            items.append(
                {
                    "model": instance._meta.label_lower,
                    "id": str(instance.pk),
                    "field": field_name,
                    "previous_id": str(value),
                }
            )


def delete_recoverable(instance, using=None):
    """Run a cascade atomically, recording exact rows before exposing it to restore.

    Recoverable roots use the existing cascade synchronously. This prevents a
    queued cascade from deleting an item again after someone restores it.
    """
    from plane.db.models import DeletionRecord

    with transaction.atomic(using=using):
        locked = type(instance).all_objects.using(using).select_for_update().get(pk=instance.pk)
        if locked.deleted_at is not None:
            return
        items = []
        token = deletion_items.set(items)
        try:
            locked.delete(using=using)
        finally:
            deletion_items.reset(token)
        actor = get_current_user()
        DeletionRecord.objects.using(using).create(
            workspace_id=locked.workspace_id,
            actor=actor if actor and actor.is_authenticated else None,
            model=locked._meta.model_name,
            object_id=locked.pk,
            deleted_at=locked.deleted_at,
            items=items,
        )
        instance.deleted_at = locked.deleted_at
