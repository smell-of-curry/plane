# Personal access token webhooks

In **Profile settings → Personal Access Tokens**, open **Manage webhooks** on an active token. Choose a project, enter a public HTTPS callback URL, select events, and click **Add webhook**. Project and workspace members or admins can subscribe. Each delivery checks current access. Removing the webhook, revoking the token, or losing project access stops pending deliveries as well.

For a Stirrup routine, enable its **Webhook** trigger and paste its URL and key into Plane’s **Callback URL** and **Receiver bearer key** fields. Plane encrypts the receiver key at rest and sends it in the HTTP Authorization bearer header. The separate signing secret Plane displays on creation is for receivers that verify Plane signatures.

## Manage subscriptions with the API

Authenticate requests with the personal token in the `X-API-Key` header.

- `GET /api/v1/webhooks/` returns this token’s subscriptions and eligible projects.
- `POST /api/v1/webhooks/` creates a subscription and returns its ID and one-time `secret_key`. A duplicate project and URL for the same token returns HTTP 409.
- `DELETE /api/v1/webhooks/{id}/` removes the subscription and returns HTTP 204.

Example request body (replace the project UUID and callback URL):

```json
{
  "project": "2b88a37d-728f-45b2-8c50-2ba165c7cc6f",
  "url": "https://receiver.example/plane",
  "events": ["issue", "issue_comment"]
}
```

Pass `receiver_key` when the destination requires a bearer token. Available event types are `issue`, `issue_comment`, `cycle`, `module`, and `project`.

## Receive events

The JSON body contains `event`, `action`, `webhook_id`, `project_id`, `workspace_id`, `workspace_slug`, and `data.id`. Actions are `created`, `updated`, and `deleted`. Work item snapshots also include name, sequence ID, priority, and state ID. Comment events include their parent issue ID. Receivers can use these IDs with the Plane API to fetch more detail. Delivery covers individual model saves, including soft deletions in an accessible project. Bulk database updates that bypass model saves do not emit events.

Verify `X-Plane-Signature` by computing the lowercase hex HMAC-SHA256 of the raw HTTP body with the signing secret. Compare the values in constant time. Return a 2xx response once the receiver accepts the event. Plane retries network errors, HTTP 429, and HTTP 5xx up to five times. Use `Idempotency-Key` or `X-Plane-Delivery` to recognize repeated attempts for the same event delivery.
