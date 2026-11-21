# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import hmac
import json
import logging
from functools import partial

import requests
from celery import shared_task
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from plane.db.models import Cycle, Issue, IssueComment, Module, Project, TokenWebhook
from plane.license.utils.encryption import decrypt_data
from plane.utils.token_webhooks import accessible_projects, active_tokens
from plane.utils.url_security import pinned_fetch

logger = logging.getLogger("plane.worker")


@receiver(post_save, sender=Issue)
@receiver(post_save, sender=IssueComment)
@receiver(post_save, sender=Cycle)
@receiver(post_save, sender=Module)
@receiver(post_save, sender=Project)
def queue_token_webhooks(sender, instance, created, raw, using, update_fields, **kwargs):
    if raw or (sender is IssueComment and update_fields == {"description_id"}):
        return
    event = "issue_comment" if sender is IssueComment else instance._meta.model_name
    project_id = instance.pk if sender is Project else instance.project_id
    hooks = TokenWebhook.objects.using(using).filter(project_id=project_id, events__contains=[event])
    ids = list(hooks.values_list("pk", flat=True))
    if not ids or (sender is Issue and instance.is_draft):
        return
    data = {"id": str(instance.pk)}
    if sender is IssueComment:
        if not Issue.objects.filter(pk=instance.issue_id, is_draft=False).exists():
            return
        data["issue_id"] = str(instance.issue_id)
    if instance.deleted_at:
        action = "deleted"
    else:
        action = "created" if created else "updated"
        if sender is not IssueComment:
            data["name"] = instance.name
        if sender is Issue:
            data.update(
                sequence_id=instance.sequence_id,
                priority=instance.priority,
                state_id=str(instance.state_id) if instance.state_id else None,
            )
    for hook_id in ids:
        transaction.on_commit(
            partial(send_token_webhook.delay, str(hook_id), str(project_id), event, action, data),
            using=using,
            robust=True,
        )


@shared_task(bind=True, autoretry_for=(requests.RequestException,), retry_backoff=30, max_retries=5)
def send_token_webhook(self, hook_id, project_id, event, action, data):
    hook = (
        TokenWebhook.objects.select_related("token", "project__workspace")
        .filter(
            pk=hook_id,
            project_id=project_id,
            events__contains=[event],
            token__in=active_tokens(),
        )
        .first()
    )
    if hook is None or not accessible_projects(hook.token).filter(pk=project_id).exists():
        return

    payload = {
        "event": event,
        "action": action,
        "webhook_id": str(hook.id),
        "project_id": project_id,
        "workspace_id": str(hook.project.workspace_id),
        "workspace_slug": hook.project.workspace.slug,
        "data": data,
    }
    body = json.dumps(payload).encode()
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Plane-Webhooks",
        "Idempotency-Key": self.request.id,
        "X-Plane-Delivery": self.request.id,
        "X-Plane-Event": event,
        "X-Plane-Signature": hmac.new(hook.secret_key.encode(), body, hashlib.sha256).hexdigest(),
    }
    if hook.encrypted_receiver_key:
        receiver_key = decrypt_data(hook.encrypted_receiver_key)
        if not receiver_key:
            logger.error("Unable to read the receiver key for token webhook %s", hook_id)
            return
        headers["Authorization"] = f"Bearer {receiver_key}"
    try:
        with pinned_fetch("POST", hook.url, headers=headers, data=body, stream=True, timeout=10) as response:
            if response.status_code == 429 or response.status_code >= 500:
                raise requests.RequestException("Receiver temporarily unavailable")
            if not 200 <= response.status_code < 300:
                logger.warning("Token webhook %s returned HTTP %s", hook_id, response.status_code)
    except ValueError:
        logger.warning("Token webhook %s has a disallowed destination", hook_id)
