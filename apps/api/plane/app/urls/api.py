# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path
from plane.app.views import ApiTokenEndpoint

from plane.app.views.webhook.token import TokenWebhooksEndpoint


urlpatterns = [
    path(
        "users/api-tokens/<uuid:token_id>/webhooks/",
        TokenWebhooksEndpoint.as_view(http_method_names=["get", "post", "options"]),
        name="token-webhooks",
    ),
    path(
        "users/api-tokens/<uuid:token_id>/webhooks/<uuid:pk>/",
        TokenWebhooksEndpoint.as_view(http_method_names=["delete", "options"]),
        name="token-webhook-detail",
    ),
    # API Tokens
    path(
        "users/api-tokens/",
        ApiTokenEndpoint.as_view(),
        name="api-tokens",
    ),
    path(
        "users/api-tokens/<uuid:pk>/",
        ApiTokenEndpoint.as_view(),
        name="api-tokens-details",
    ),
    ## End API Tokens
]
