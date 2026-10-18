/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { setToast, TOAST_TYPE, updateToast } from "@plane/propel/toast";
import type { TPage } from "@plane/types";
import { getPageName } from "@plane/utils";
// services
import { ProjectPageService } from "@/services/page/project-page.service";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { htmlToPlainText } from "./html-to-plain-text";
import { zipStore } from "./zip-store";

const projectPageService = new ProjectPageService();

function fileNameFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "page"}.txt`;
}

function fileStem(name: string): string {
  return fileNameFor(name).replace(/\.txt$/, "") || "page";
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveTextFile(filename: string, text: string): void {
  saveBlob(filename, new Blob([text], { type: "text/plain;charset=utf-8" }));
}

function uniqueZipName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  while (used.has(`${stem}-${index}${ext}`)) index += 1;
  const next = `${stem}-${index}${ext}`;
  used.add(next);
  return next;
}

async function mapPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await task(current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function collectFolderFiles(
  workspaceSlug: string,
  projectId: string,
  folderId: string,
  prefix: string,
  used: Set<string>,
  seen: Set<string>
): Promise<{ name: string; data: Uint8Array }[]> {
  if (seen.has(folderId)) return [];
  seen.add(folderId);

  const children = await projectPageService.fetchAll(workspaceSlug, projectId, folderId);
  const pages = children.filter(
    (child): child is TPage & { id: string } => child.node_type !== "folder" && !!child.id && !child.archived_at
  );
  const folders = children.filter((child) => child.node_type === "folder" && !!child.id && !child.archived_at);
  const encoder = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const jobs = pages.map((page) => ({
    id: page.id,
    title: getPageName(page.name) || "Untitled",
    name: uniqueZipName(`${prefix}${fileStem(getPageName(page.name) || "Untitled")}.txt`, used),
  }));

  await mapPool(jobs, 4, async (job) => {
    const detail = await projectPageService.fetchById(workspaceSlug, projectId, job.id, false);
    const title = getPageName(detail.name ?? job.title) || job.title;
    const body = htmlToPlainText(detail.description_html ?? "");
    const text = body ? `${title}\n\n${body}\n` : `${title}\n`;
    files.push({ name: job.name, data: encoder.encode(text) });
  });

  for (const folder of folders) {
    if (!folder.id) continue;
    const nested = await collectFolderFiles(
      workspaceSlug,
      projectId,
      folder.id,
      `${prefix}${fileStem(getPageName(folder.name) || "folder")}/`,
      used,
      seen
    );
    files.push(...nested);
  }

  return files;
}

async function pageHtml(page: TPageInstance, workspaceSlug: string): Promise<string> {
  const live = page.editor.editorRef?.getDocument().html;
  // ponytail: mounted editor wins so unsaved text is included. `<p></p>` means not loaded yet.
  if (live && live !== "<p></p>") return live;
  if (page.description_html && page.description_html !== "<p></p>") return page.description_html;

  const projectId = page.project_ids?.[0];
  if (!workspaceSlug || !projectId || !page.id) throw new Error("Missing page ids.");
  const detail = await projectPageService.fetchById(workspaceSlug, projectId, page.id, false);
  return detail.description_html ?? "";
}

export async function downloadPageAsText(page: TPageInstance, workspaceSlug: string): Promise<void> {
  try {
    const title = getPageName(page.name) || "Untitled";
    const body = htmlToPlainText(await pageHtml(page, workspaceSlug));
    saveTextFile(fileNameFor(title), body ? `${title}\n\n${body}\n` : `${title}\n`);
  } catch {
    setToast({
      type: TOAST_TYPE.ERROR,
      title: "Download failed",
      message: "Could not download this page as text.",
    });
  }
}

export async function downloadFolderAsText(args: {
  workspaceSlug: string;
  projectId: string;
  folderId: string;
  folderName: string;
}): Promise<void> {
  const { workspaceSlug, projectId, folderId, folderName } = args;
  const toastId = setToast({ type: TOAST_TYPE.LOADING, title: "Downloading folder…" });
  try {
    if (!workspaceSlug || !projectId || !folderId) throw new Error("Missing folder ids.");
    const files = await collectFolderFiles(workspaceSlug, projectId, folderId, "", new Set(), new Set());
    if (files.length === 0) {
      if (toastId) {
        updateToast(toastId, {
          type: TOAST_TYPE.ERROR,
          title: "Nothing to download",
          message: "This folder has no pages.",
        });
      }
      return;
    }
    const zip = zipStore(files);
    saveBlob(
      `${fileStem(folderName)}.zip`,
      new Blob([zip], { type: "application/zip" })
    );
    if (toastId) {
      updateToast(toastId, {
        type: TOAST_TYPE.SUCCESS,
        title: "Folder downloaded",
        message: `${files.length} ${files.length === 1 ? "page" : "pages"} saved as text.`,
      });
    }
  } catch {
    if (toastId) {
      updateToast(toastId, {
        type: TOAST_TYPE.ERROR,
        title: "Download failed",
        message: "Could not download this folder as text.",
      });
    }
  }
}
