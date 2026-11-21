# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import hmac
import json
from datetime import timedelta
from unittest.mock import patch

from django.db import transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from plane.bgtasks.token_webhook import send_token_webhook
from plane.middleware.logger import process_logs
from plane.db.models import (
    APIToken,
    Issue,
    Module,
    Project,
    ProjectMember,
    TokenWebhook,
    User,
    Workspace,
    WorkspaceMember,
)


class TokenWebhookTests(TestCase):
    def setUp(self):
        delay = patch("celery.app.task.Task.delay")
        delay.start()
        self.addCleanup(delay.stop)
        self.user = User.objects.create(email="user@hook.test", username="hooks-member")
        self.token = APIToken.objects.create(user=self.user)
        self.workspace = Workspace.objects.create(name="Hooks", slug="hooks", owner=self.user)
        self.member = WorkspaceMember.objects.create(workspace=self.workspace, member=self.user, role=15)
        self.project = Project.objects.create(workspace=self.workspace, name="Items", identifier="IT")
        self.private = Project.objects.create(workspace=self.workspace, name="Other", identifier="OT")
        self.project_member = ProjectMember.objects.create(project=self.project, member=self.user, role=15)
        self.client = APIClient()
        self.client.credentials(HTTP_X_API_KEY=self.token.token)
        self.api = "/api/v1/webhooks/"
        self.app = f"/api/users/api-tokens/{self.token.id}/webhooks/"
        self.data = {
            "project": str(self.project.id),
            "events": ["issue", "module"],
            "url": "https://receiver.example/plane",
        }
        for target in ["plane.app.views.webhook.token.validate_url", "plane.middleware.logger.process_logs.delay"]:
            mock = patch(target)
            mock.start()
            self.addCleanup(mock.stop)

    def subscribe(self):
        response = self.client.post(self.api, self.data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_lifecycle_and_secret_visibility(self):
        hook = self.subscribe()
        self.assertTrue(hook["secret_key"])
        self.assertNotIn("receiver_key", hook)
        self.assertEqual(self.client.post(self.api, self.data, format="json").status_code, 409)
        self.assertNotIn("secret_key", self.client.get(self.api).data["webhooks"][0])
        api_log = process_logs.delay
        self.assertIsNone(api_log.call_args.kwargs["log_data"]["response_body"])
        self.assertIsNone(api_log.call_args.kwargs["log_data"]["body"])
        self.client.credentials(HTTP_X_API_KEY=APIToken.objects.create(user=self.user).token)
        self.assertEqual(self.client.get(self.api).data["webhooks"], [])
        self.assertEqual(self.client.delete(f"{self.api}{hook['id']}/").status_code, 404)
        self.client.credentials()
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.app).data["webhooks"][0]["id"], hook["id"])
        self.assertEqual(self.client.delete(f"{self.app}{hook['id']}/").status_code, 204)

    def test_project_and_token_ownership(self):
        self.assertEqual([item["id"] for item in self.client.get(self.api).data["projects"]], [self.project.pk])
        self.data["project"] = str(self.private.id)
        self.assertEqual(self.client.post(self.api, self.data, format="json").status_code, 404)
        self.client.credentials()
        stranger = User.objects.create(email="stranger@hook.test", username="other")
        self.client.force_login(stranger)
        self.assertEqual(self.client.get(self.app).status_code, 404)
        self.assertIn(self.client.get(self.api).status_code, (401, 403))

    def test_filter_and_url_validation(self):
        for value in [[], ["invalid"]]:
            self.assertEqual(self.client.post(self.api, {**self.data, "events": value}, format="json").status_code, 400)
        for url in ["http://receiver.example/hook", "https://testserver/hook"]:
            self.assertEqual(self.client.post(self.api, {**self.data, "url": url}, format="json").status_code, 400)
        with patch("plane.app.views.webhook.token.validate_url", side_effect=ValueError):
            self.assertEqual(self.client.post(self.api, self.data, format="json").status_code, 400)

    @patch("plane.bgtasks.token_webhook.send_token_webhook.delay")
    def test_commit_filtering_and_actions(self, enqueue):
        hook = self.subscribe()
        with self.captureOnCommitCallbacks(execute=True):
            item = Module.objects.create(project=self.project, name="First")
            item.name = "Renamed"
            item.save()
            Module.objects.create(project=self.private, name="Private")
            Issue.objects.create(project=self.project, name="Draft", is_draft=True)
            with transaction.atomic():
                Module.objects.create(project=self.project, name="Aborted")
                transaction.set_rollback(True)
            item.delete()
        self.assertEqual([call.args[3] for call in enqueue.call_args_list], ["created", "updated", "deleted"])
        for call in enqueue.call_args_list:
            self.assertEqual(call.args[:3], (hook["id"], str(self.project.id), "module"))
            self.assertEqual(call.args[4]["id"], str(item.id))

    @patch("plane.bgtasks.token_webhook.pinned_fetch")
    def test_signed_delivery_and_revocation(self, fetch):
        self.data["receiver_key"] = "dummy-receiver-key"
        hook = self.subscribe()
        self.assertNotIn("dummy-receiver-key", TokenWebhook.objects.get(pk=hook["id"]).encrypted_receiver_key)
        fetch.return_value.__enter__.return_value.status_code = 204
        args = (hook["id"], str(self.project.id), "issue", "updated", {"id": "sample-id"})

        def deliver():
            send_token_webhook.apply(args=args, task_id="stable-delivery-id", throw=True)

        deliver()
        kwargs = fetch.call_args.kwargs
        self.assertEqual(json.loads(kwargs["data"])["workspace_slug"], "hooks")
        self.assertEqual(kwargs["headers"]["X-Plane-Delivery"], "stable-delivery-id")
        self.assertEqual(
            kwargs["headers"]["X-Plane-Signature"],
            hmac.new(hook["secret_key"].encode(), kwargs["data"], hashlib.sha256).hexdigest(),
        )
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer dummy-receiver-key")
        self.assertEqual(kwargs["headers"]["Idempotency-Key"], "stable-delivery-id")
        self.assertNotIn(self.token.token, str(fetch.call_args))
        for model, pk, changed, reset in [
            (ProjectMember, self.project_member.pk, {"role": 5}, {"role": 15}),
            (WorkspaceMember, self.member.pk, {"is_active": False}, {"is_active": True}),
            (APIToken, self.token.pk, {"expired_at": timezone.now() - timedelta(minutes=1)}, {"expired_at": None}),
            (APIToken, self.token.pk, {"is_active": False}, {"is_active": True}),
            (User, self.user.pk, {"is_active": False}, {"is_active": True}),
        ]:
            model.objects.filter(pk=pk).update(**changed)
            deliver()
            model.objects.filter(pk=pk).update(**reset)
        TokenWebhook.objects.filter(pk=hook["id"]).delete()
        deliver()
        self.assertEqual(fetch.call_count, 1)
