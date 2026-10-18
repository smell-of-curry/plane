/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
// plane imports
import { IconButton } from "@plane/propel/icon-button";
import { Tooltip } from "@plane/propel/tooltip";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { downloadPageAsText } from "../download-page-text";
import { PageOptionsDropdown } from "../editor/toolbar";
import { PageArchivedBadge } from "./archived-badge";
import { PageCopyLinkControl } from "./copy-link-control";
import { PageFavoriteControl } from "./favorite-control";
import { PageOfflineBadge } from "./offline-badge";
import { PageLockControl } from "./lock-control";

type Props = {
  page: TPageInstance;
  storeType: EPageStoreType;
};

export const PageHeaderActions = observer(function PageHeaderActions(props: Props) {
  const { page, storeType } = props;
  const { workspaceSlug } = useParams();

  return (
    <div className="flex items-center gap-1">
      <PageArchivedBadge page={page} />
      <PageOfflineBadge page={page} />
      <PageLockControl page={page} />
      <PageCopyLinkControl page={page} />
      {page.node_type !== "folder" && (
        <Tooltip tooltipContent="Download as text" position="bottom">
          <IconButton
            variant="ghost"
            size="lg"
            icon={Download}
            aria-label="Download as text"
            onClick={() => {
              void downloadPageAsText(page, workspaceSlug?.toString() ?? "");
            }}
          />
        </Tooltip>
      )}
      <PageFavoriteControl page={page} />
      <PageOptionsDropdown page={page} storeType={storeType} />
    </div>
  );
});
