# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace recycle bin. Authorization is based on deletion provenance."""

from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.permissions import WorkspaceMemberPermission
from plane.app.views.base import BaseAPIView
from plane.db.models import DeletionRecord, ProjectMember, ProjectPage, WorkspaceMember
from plane.utils.recycle_bin import RECOVERABLE_MODELS


def visible_items(model_name, slug, user, admin):
    model = apps.get_model("db", model_name)
    cutoff = timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS)
    queryset = model.all_objects.filter(workspace__slug=slug, deleted_at__gte=cutoff)
    if admin:
        return queryset
    provenance = DeletionRecord.objects.filter(
        workspace__slug=slug,
        model=model_name,
        object_id=OuterRef("pk"),
        deleted_at=OuterRef("deleted_at"),
        actor=user,
        restored_at__isnull=True,
    )
    queryset = queryset.filter(Exists(provenance))
    if any(field.name == "project" for field in model._meta.fields):
        queryset = queryset.filter(
            Q(project__isnull=True)
            | Q(
                project_id__in=ProjectMember.objects.filter(
                    workspace__slug=slug,
                    member=user,
                    is_active=True,
                    project__deleted_at__isnull=True,
                ).values("project_id")
            )
        )
    if model_name == "page":
        # Match page visibility: private pages belong only to their owner.
        queryset = queryset.filter(Q(access=0) | Q(owned_by=user))
        # Project pages also require current project membership.
        accessible = ProjectMember.objects.filter(
            workspace__slug=slug,
            member=user,
            is_active=True,
            project__deleted_at__isnull=True,
        ).values("project_id")
        page_projects = ProjectPage.all_objects.filter(page_id=OuterRef("pk"))
        queryset = queryset.filter(~Exists(page_projects) | Exists(page_projects.filter(project_id__in=accessible)))
    if model_name == "issueview":
        queryset = queryset.filter(Q(access=1) | Q(owned_by=user))
    return queryset


def restore_items(items):
    """Restore only exact versions captured by the deletion, in one transaction."""
    pending = []
    keys = {(item["model"], item["id"]) for item in items}
    for item in items:
        model = apps.get_model(item["model"])
        instance = model.all_objects.select_for_update().filter(pk=item["id"]).first()
        if instance is None:
            raise ValidationError("Some related data was permanently deleted. Contact an administrator.")
        if "field" in item:
            field = model._meta.get_field(item["field"])
            value = getattr(instance, field.attname)
            if value is not None and str(value) != item["previous_id"]:
                raise ValidationError("Related data has changed since deletion. Contact an administrator.")
            pending.append((model, instance.pk, {field.attname: item["previous_id"]}))
            continue
        if instance.deleted_at is None:
            continue
        if instance.deleted_at != parse_datetime(item["deleted_at"]):
            raise ValidationError("This item was deleted again. Refresh Recently Deleted and try again.")
        for field in model._meta.fields:
            if not field.is_relation or not field.many_to_one:
                continue
            parent_id = getattr(instance, field.attname)
            parent_model = field.remote_field.model
            if parent_id and hasattr(parent_model, "all_objects"):
                if (parent_model._meta.label_lower, str(parent_id)) not in keys:
                    if parent_model.all_objects.filter(pk=parent_id, deleted_at__isnull=False).exists():
                        raise ValidationError("Restore this item's deleted parent first.")
        pending.append((model, instance.pk, {"deleted_at": None}))
    for model, pk, changes in pending:
        model.all_objects.filter(pk=pk).update(**changes)
    return len(pending)


class RecentlyDeletedEndpoint(BaseAPIView):
    permission_classes = [WorkspaceMemberPermission]

    def is_admin(self, request, slug):
        return WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            is_active=True,
            role=20,
        ).exists()

    def get(self, request, slug, model_name=None, object_id=None):
        if model_name is not None:
            return Response(status=405)
        admin = self.is_admin(request, slug)
        try:
            offset = max(0, min(int(request.query_params.get("offset", 0)), 10000))
        except ValueError:
            raise ValidationError("Invalid offset.")
        limit = 50
        rows = []
        records = list(
            DeletionRecord.objects.filter(
                workspace__slug=slug,
                restored_at__isnull=True,
                deleted_at__gte=timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS),
            ).select_related("actor")
        )
        roots = {(record.model, record.object_id, record.deleted_at): record for record in records}
        children = set()
        for record in records:
            for item in record.items:
                if "deleted_at" not in item:
                    continue
                key = (item["model"].split(".")[-1], item["id"], parse_datetime(item["deleted_at"]))
                if key != (record.model, str(record.object_id), record.deleted_at):
                    children.add(key)
        kind = request.query_params.get("type")
        if kind and kind not in RECOVERABLE_MODELS:
            raise ValidationError("Unknown item type.")
        for model_name, label in RECOVERABLE_MODELS.items():
            if kind and model_name != kind:
                continue
            queryset = visible_items(model_name, slug, request.user, admin)
            if any(field.name == "project" for field in queryset.model._meta.fields):
                queryset = queryset.select_related("project")
            count = 0
            for obj in queryset.order_by("-deleted_at", "-id").iterator(chunk_size=100):
                # Cascaded work items/modules are recovered through their deleted
                # parent. Avoid presenting them as independent/legacy deletions.
                if (model_name, str(obj.pk), obj.deleted_at) in children:
                    continue
                record = roots.get((model_name, obj.pk, obj.deleted_at))
                rows.append(
                    {
                        "id": str(obj.pk),
                        "type": model_name,
                        "type_label": label,
                        "name": obj.name,
                        "deleted_at": obj.deleted_at,
                        "deleted_by": record.actor.display_name if record and record.actor else None,
                        "expires_at": obj.deleted_at + timedelta(days=settings.HARD_DELETE_AFTER_DAYS),
                        "project": getattr(getattr(obj, "project", None), "name", None),
                        "legacy": record is None,
                        "can_restore": record is not None,
                    }
                )
                count += 1
                if count >= offset + limit + 1:
                    break
        rows.sort(key=lambda row: (row["deleted_at"], row["id"]), reverse=True)
        return Response(
            {
                "results": rows[offset : offset + limit],
                "has_more": len(rows) > offset + limit,
                "is_admin": admin,
                "retention_days": settings.HARD_DELETE_AFTER_DAYS,
            }
        )

    def post(self, request, slug, model_name=None, object_id=None):
        if model_name is None:
            return Response(status=405)
        if model_name not in RECOVERABLE_MODELS:
            raise NotFound()
        admin = self.is_admin(request, slug)
        try:
            with transaction.atomic():
                obj = (
                    visible_items(model_name, slug, request.user, admin)
                    .select_for_update()
                    .filter(pk=object_id)
                    .first()
                )
                if obj is None:
                    raise NotFound("Item not found or you do not have permission to restore it.")
                record = (
                    DeletionRecord.objects.select_for_update()
                    .filter(
                        workspace__slug=slug,
                        model=model_name,
                        object_id=object_id,
                        deleted_at=obj.deleted_at,
                        restored_at__isnull=True,
                    )
                    .first()
                )
                if record is None:
                    # Old deletions have no trustworthy cascade/actor provenance.
                    # Do not guess which related rows belonged to that operation.
                    raise ValidationError(
                        "This older deletion needs administrator-assisted recovery of its related data."
                    )
                if not admin and record.actor_id != request.user.pk:
                    raise PermissionDenied()
                restored = restore_items(record.items)
                record.restored_at = timezone.now()
                record.restored_by = request.user
                record.save(update_fields=["restored_at", "restored_by"])
        except IntegrityError:
            return Response(
                {
                    "error": (
                        "Restore conflicts with existing data. Rename the conflicting item "
                        "or ask an administrator to review the related records."
                    )
                },
                status=409,
            )
        return Response({"restored": restored})
