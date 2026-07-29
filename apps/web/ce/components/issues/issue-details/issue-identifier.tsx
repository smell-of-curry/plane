/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import type { TIssueIdentifierProps, TIssueTypeIdentifier } from "@plane/types";
// components
import { IdentifierText } from "@/components/issues/issue-detail/identifier-text";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useModule } from "@/hooks/store/use-module";
import { useProject } from "@/hooks/store/use-project";

/**
 * Resolve display label for a work item identifier.
 * Prefers module name(s) so board cards stay readable when titles are generic
 * (e.g. "coding", "Review"); falls back to PROJECT-SEQ when no modules.
 */
function getModuleLabel(moduleIds: string[] | null | undefined, getModuleNameById: (id: string) => string | undefined) {
  if (!moduleIds?.length) return null;
  const names = moduleIds.map((id) => getModuleNameById(id)?.trim()).filter((name): name is string => !!name);
  if (!names.length) return null;
  return names.join(", ");
}

export const IssueIdentifier = observer(function IssueIdentifier(props: TIssueIdentifierProps) {
  const { projectId, variant, size, displayProperties, enableClickToCopyIdentifier = false } = props;
  // store hooks
  const { getProjectIdentifierById } = useProject();
  const { getModuleNameById } = useModule();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  // Determine if the component is using store data or not
  const isUsingStoreData = "issueId" in props;
  // derived values
  const issue = isUsingStoreData ? getIssueById(props.issueId) : null;
  const projectIdentifier = isUsingStoreData ? getProjectIdentifierById(projectId) : props.projectIdentifier;
  const issueSequenceId = isUsingStoreData ? issue?.sequence_id : props.issueSequenceId;
  const shouldRenderIssueID = displayProperties ? displayProperties.key : true;
  const issueIdKey = `${projectIdentifier}-${issueSequenceId}`;
  const moduleLabel = isUsingStoreData ? getModuleLabel(issue?.module_ids, getModuleNameById) : null;
  const displayLabel = moduleLabel || issueIdKey;

  if (!shouldRenderIssueID) return null;

  return (
    <div className="flex min-w-0 shrink items-center space-x-2">
      <IdentifierText
        identifier={displayLabel}
        clipboardText={issueIdKey}
        tooltipContent={moduleLabel ? issueIdKey : undefined}
        enableClickToCopyIdentifier={enableClickToCopyIdentifier}
        variant={variant}
        size={size}
      />
    </div>
  );
});

export const IssueTypeIdentifier = observer(function IssueTypeIdentifier(_props: TIssueTypeIdentifier) {
  return <></>;
});
