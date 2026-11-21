# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Q
from django.utils import timezone

from plane.db.models import APIToken, Project, ProjectMember, WorkspaceMember

EVENTS = ("issue", "issue_comment", "cycle", "module", "project")


def active_tokens():
    return APIToken.objects.filter(
        Q(expired_at__isnull=True) | Q(expired_at__gt=timezone.now()),
        is_active=True,
        is_service=False,
        user__is_active=True,
    )


def accessible_projects(token):
    members = {"member_id": token.user_id, "is_active": True, "role__in": (15, 20)}
    projects = Project.objects.filter(
        archived_at__isnull=True,
        workspace__deleted_at__isnull=True,
        workspace_id__in=WorkspaceMember.objects.filter(**members).values("workspace_id"),
        id__in=ProjectMember.objects.filter(**members).values("project_id"),
    )
    if token.workspace_id:
        projects = projects.filter(workspace_id=token.workspace_id)
    return projects
