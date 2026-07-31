/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// ui
import { Tooltip } from "@plane/propel/tooltip";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
import packageJson from "package.json";

/**
 * Sidebar footer badge. Shows version only — no Community / upgrade upsell.
 */
export const WorkspaceEditionBadge = observer(function WorkspaceEditionBadge() {
  const { isMobile } = usePlatformOS();
  const version = `v${packageJson.version}`;

  return (
    <Tooltip tooltipContent={`Version: ${version}`} isMobile={isMobile}>
      <span className="inline-flex items-center rounded-md border border-subtle bg-layer-1 px-2.5 py-1 text-12 text-tertiary">
        {version}
      </span>
    </Tooltip>
  );
});
