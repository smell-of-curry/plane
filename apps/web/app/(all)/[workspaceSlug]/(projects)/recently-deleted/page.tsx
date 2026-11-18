/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { observer } from "mobx-react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@plane/ui";
import { RecentlyDeletedService } from "@/services/recently-deleted.service";
import type { DeletedItem } from "@/services/recently-deleted.service";
import { useUser } from "@/hooks/store/user";

const service = new RecentlyDeletedService();
const types = [
  ["", "All types"],
  ["project", "Projects"],
  ["issue", "Work items"],
  ["module", "Modules"],
  ["cycle", "Cycles"],
  ["page", "Pages"],
  ["issueview", "Views"],
  ["label", "Labels"],
];

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.join(" ");
  if (data && typeof data === "object") {
    const detail = (data as { error?: string; detail?: string }).error ?? (data as { detail?: string }).detail;
    if (typeof detail === "string") return detail;
  }
  return "Unable to restore this item. Please try again.";
}

function RecentlyDeletedPage() {
  const { workspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const workspace = String(workspaceSlug);
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const { data, error, isLoading, mutate } = useSWR(
    currentUser ? ["recently-deleted", workspace, currentUser.id, type, offset] : null,
    () => service.list(workspace, type, offset)
  );

  async function restore(item: DeletedItem) {
    setRestoring(`${item.type}:${item.id}`);
    setRestoreError("");
    setMessage("");
    try {
      await service.restore(workspace, item);
      setMessage(`Restored “${item.name || "Untitled"}” and its related data.`);
      await mutate();
    } catch (restoreFailure) {
      setRestoreError(errorMessage(restoreFailure));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-3">
          <Trash2 className="size-6 text-secondary" />
          <h1 className="text-24 font-semibold">Recently Deleted</h1>
        </div>
        <p className="text-14 text-secondary">
          {data?.is_admin
            ? "Admins can restore items deleted by anyone in this workspace."
            : "Restore items you deleted in this workspace."}
          {data && ` Items are kept for ${data.retention_days} days after deletion.`} Restoring an item also restores
          the related data deleted with it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="deleted-type" className="text-14">
            Item type
          </label>
          <select
            id="deleted-type"
            value={type}
            disabled={restoring !== null}
            onChange={(event) => {
              setType(event.target.value);
              setOffset(0);
              setMessage("");
              setRestoreError("");
            }}
            className="rounded border border-subtle bg-surface-1 px-3 py-2 text-14"
          >
            {types.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button variant="neutral-primary" size="sm" onClick={() => void mutate()}>
            Refresh
          </Button>
        </div>
        {message && (
          <p role="status" className="text-14 text-primary">
            {message}
          </p>
        )}
        {restoreError && (
          <p role="alert" className="text-red-500 text-14">
            {restoreError}
          </p>
        )}
        {error ? (
          <p role="alert">Unable to load deleted items. Use Refresh to try again.</p>
        ) : isLoading ? (
          <p role="status" className="text-secondary">
            Loading deleted items…
          </p>
        ) : data?.results.length === 0 ? (
          <div className="rounded-lg border border-subtle p-10 text-center text-secondary">
            No recently deleted items.
          </div>
        ) : (
          <ul className="divide-y divide-subtle rounded-lg border border-subtle">
            {data?.results.map((item) => (
              <li key={`${item.type}:${item.id}`} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium break-words">{item.name || "Untitled"}</p>
                  <p className="text-13 text-secondary">
                    {item.type_label}
                    {item.project ? ` · ${item.project}` : ""}
                    {" · "}Deleted {new Date(item.deleted_at).toLocaleString()}
                    {item.deleted_by ? ` by ${item.deleted_by}` : " · Deleter unavailable"}
                  </p>
                  <p className="text-12 text-tertiary">
                    Available until {new Date(item.expires_at).toLocaleDateString()}
                  </p>
                  {item.legacy && (
                    <p className="text-12 text-secondary">
                      Older deletion: contact an administrator to recover its related data.
                    </p>
                  )}
                </div>
                <Button
                  variant="neutral-primary"
                  size="sm"
                  disabled={restoring !== null || !item.can_restore}
                  onClick={() => void restore(item)}
                >
                  <RotateCcw className="mr-1 size-3.5" />
                  {restoring === `${item.type}:${item.id}`
                    ? "Restoring…"
                    : item.can_restore
                      ? "Restore"
                      : "Needs recovery"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="neutral-primary"
            size="sm"
            disabled={offset === 0 || isLoading || restoring !== null}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous
          </Button>
          <span className="text-13 text-secondary">Page {Math.floor(offset / 50) + 1}</span>
          <Button
            variant="neutral-primary"
            size="sm"
            disabled={!data?.has_more || isLoading || restoring !== null}
            onClick={() => setOffset(offset + 50)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export default observer(RecentlyDeletedPage);
