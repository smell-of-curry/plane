# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from urllib.parse import urlsplit

from django.conf import settings
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response

from plane.api.views.base import BaseAPIView as ExternalAPIView
from plane.app.views.base import BaseAPIView
from plane.db.models import TokenWebhook
from plane.license.utils.encryption import encrypt_data
from plane.utils.ip_address import validate_url
from plane.utils.token_webhooks import EVENTS, accessible_projects, active_tokens


class TokenWebhookSerializer(serializers.ModelSerializer):
    receiver_key = serializers.RegexField(r"^[!-~]+$", write_only=True, required=False, max_length=4096)
    project = serializers.UUIDField(source="project_id")
    events = serializers.ListField(
        child=serializers.ChoiceField(choices=EVENTS), allow_empty=False, max_length=len(EVENTS)
    )

    class Meta:
        model = TokenWebhook
        fields = ("id", "project", "url", "events", "receiver_key")

    def create(self, validated_data):
        receiver_key = validated_data.pop("receiver_key", None)
        if receiver_key:
            encrypted = encrypt_data(receiver_key)
            if not encrypted:
                raise serializers.ValidationError({"receiver_key": "Could not store the receiver key."})
            validated_data["encrypted_receiver_key"] = encrypted
        return super().create(validated_data)

    def validate_url(self, value):
        parsed = urlsplit(value)
        host = (parsed.hostname or "").rstrip(".").lower()
        blocked = [*settings.WEBHOOK_DISALLOWED_DOMAINS, self.context["request"].get_host().split(":")[0].lower()]
        if (
            parsed.username is not None
            or parsed.fragment
            or parsed.scheme != "https"
            or any(host == domain or host.endswith("." + domain) for domain in blocked)
        ):
            raise serializers.ValidationError("Enter a public HTTPS callback URL on a different host.")
        try:
            validate_url(value)
        except ValueError:
            raise serializers.ValidationError("The callback must resolve to a public address.")
        return value


class TokenWebhooksMixin:
    serializer_class = TokenWebhookSerializer

    def get_token(self, request, token_id):
        tokens = active_tokens().filter(user=request.user)
        if token_id is None:
            return get_object_or_404(tokens, token=request.auth)
        return get_object_or_404(tokens, pk=token_id)

    def get(self, request, token_id=None):
        token = self.get_token(request, token_id)
        subscriptions = TokenWebhook.objects.filter(token=token).order_by("id")
        projects = (
            accessible_projects(token).order_by("workspace__name", "name").values("id", "name", "workspace__slug")
        )
        return Response({"webhooks": TokenWebhookSerializer(subscriptions, many=True).data, "projects": list(projects)})

    def post(self, request, token_id=None):
        token = self.get_token(request, token_id)
        serializer = TokenWebhookSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        project_id = serializer.validated_data["project_id"]
        get_object_or_404(accessible_projects(token), pk=project_id)
        try:
            with transaction.atomic():
                hook = serializer.save(token=token)
        except IntegrityError:
            if TokenWebhook.objects.filter(
                token=token, project_id=project_id, url=serializer.validated_data["url"]
            ).exists():
                return Response({"detail": "This project already uses this URL for this token."}, status=409)
            raise
        return Response({**serializer.data, "secret_key": hook.secret_key}, status=status.HTTP_201_CREATED)

    def delete(self, request, pk, token_id=None):
        token = self.get_token(request, token_id)
        get_object_or_404(TokenWebhook, token=token, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TokenWebhooksEndpoint(TokenWebhooksMixin, BaseAPIView):
    pass


class ExternalTokenWebhooksEndpoint(TokenWebhooksMixin, ExternalAPIView):
    pass
