/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Trash2 } from "lucide-react";
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
import { useAppTheme } from "@/hooks/store/use-app-theme";

export const RecentlyDeletedSidebarLink = observer(function RecentlyDeletedSidebarLink() {
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  const { toggleSidebar, toggleExtendedSidebar } = useAppTheme();
  const href = `/${workspaceSlug}/recently-deleted`;

  return (
    <Link
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      onClick={() => {
        if (window.innerWidth < 768) toggleSidebar();
        toggleExtendedSidebar(false);
      }}
    >
      <SidebarNavItem isActive={pathname === href}>
        <div className="flex items-center gap-1.5 py-[1px]">
          <Trash2 className="size-4 flex-shrink-0" />
          <span className="text-13 leading-5 font-medium">Recently Deleted</span>
        </div>
      </SidebarNavItem>
    </Link>
  );
});
