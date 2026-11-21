/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { isAxiosError } from "axios";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { APITokenService } from "@plane/services";
import type { TokenWebhookEvent } from "@plane/types";

const service = new APITokenService();
const eventLabels: Record<TokenWebhookEvent, string> = {
  issue: "Work items",
  issue_comment: "Comments",
  cycle: "Cycles",
  module: "Modules",
  project: "Project details",
};
const events = Object.keys(eventLabels) as TokenWebhookEvent[];

export function TokenWebhooks({ tokenId }: { tokenId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Close webhooks" : "Manage webhooks"}
      </Button>
      {open && <TokenWebhookForm tokenId={tokenId} />}
    </div>
  );
}

function TokenWebhookForm({ tokenId }: { tokenId: string }) {
  const { data, error, mutate } = useSWR(["token-webhooks", tokenId], () => service.listWebhooks(tokenId));
  const [project, setProject] = useState("");
  const [receiverKey, setReceiverKey] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<TokenWebhookEvent[]>(["issue"]);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!data) return <p role="status">{error ? "Could not load webhooks." : "Loading webhooks…"}</p>;

  const projectId = project || data.projects[0]?.id;
  const selectClass = "rounded-md border border-subtle bg-surface-1 px-2 py-1.5 text-primary";
  async function remove(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await service.deleteWebhook(tokenId, id);
      await mutate();
    } catch {
      setMessage("Could not remove the webhook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-4 rounded-md border border-subtle p-4 text-13">
      <p>Send signed project events to an integration. Revoking this token stops delivery.</p>
      {data.webhooks.map((hook) => (
        <div key={hook.id} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{hook.url}</p>
            <p className="text-tertiary">
              {data.projects.find((item) => item.id === hook.project)?.name ?? "Unavailable project"} ·{" "}
              {hook.events.map((event) => eventLabels[event]).join(", ")}
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void remove(hook.id)}>
            Remove
          </Button>
        </div>
      ))}
      {secret && (
        <div role="status" className="space-y-2">
          <p>Copy this signing secret to your receiver. Plane shows it once.</p>
          <input
            className={selectClass + " font-mono w-full"}
            aria-label="Webhook signing secret"
            readOnly
            value={secret}
            onFocus={(e) => e.target.select()}
          />
          <Button variant="secondary" size="sm" onClick={() => setSecret("")}>
            Done
          </Button>
        </div>
      )}
      {!secret &&
        (projectId ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage("");
              try {
                const hook = await service.createWebhook(tokenId, {
                  project: projectId,
                  url: url.trim(),
                  events: selected,
                  receiver_key: receiverKey.trim() || undefined,
                });
                setSecret(hook.secret_key);
                setUrl("");
                setReceiverKey("");
                await mutate();
              } catch (err) {
                const reason = isAxiosError(err) ? err.response?.data : undefined;
                setMessage(
                  reason?.url?.[0] ?? reason?.receiver_key?.[0] ?? reason?.detail ?? "Could not create the webhook."
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="flex flex-col gap-1">
              Project
              <select className={selectClass} value={projectId} onChange={(e) => setProject(e.target.value)}>
                {data.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.workspace__slug} / {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Callback URL
              <input
                type="url"
                required
                placeholder="https://example.com/hooks/plane"
                className={selectClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              Receiver bearer key (optional)
              <input
                type="password"
                autoComplete="off"
                className={selectClass}
                value={receiverKey}
                onChange={(e) => setReceiverKey(e.target.value)}
              />
              <span className="text-tertiary">For Stirrup, paste the key from the routine’s Webhook trigger.</span>
            </label>
            <fieldset>
              <legend>Events</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {events.map((kind) => (
                  <label key={kind} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selected.includes(kind)}
                      onChange={(e) =>
                        setSelected(e.target.checked ? [...selected, kind] : selected.filter((item) => item !== kind))
                      }
                    />
                    {eventLabels[kind]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" variant="primary" className="self-start" disabled={busy || !selected.length}>
              Add webhook
            </Button>
          </form>
        ) : (
          <p>Join a project as a member or admin to subscribe to its events.</p>
        ))}
      {message && (
        <p role="alert" className="text-danger-primary">
          {message}
        </p>
      )}
    </div>
  );
}
