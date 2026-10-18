/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import { getPageName } from "@plane/utils";
// services
import { ProjectPageService } from "@/services/page/project-page.service";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { htmlToPlainText } from "./html-to-plain-text";

const projectPageService = new ProjectPageService();

function fileNameFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "page"}.txt`;
}

function saveTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
