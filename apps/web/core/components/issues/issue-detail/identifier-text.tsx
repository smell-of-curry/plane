/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIdentifierTextProps, TIdentifierTextVariant, TIssueIdentifierSize } from "@plane/types";
import { cn } from "@plane/utils";

const SIZE_MAP: Record<TIssueIdentifierSize, string> = {
  xs: "text-caption-sm-regular",
  sm: "text-caption-sm-medium",
  md: "text-caption-md-medium",
  lg: "text-caption-lg-medium",
};

const VARIANT_MAP: Record<TIdentifierTextVariant, string> = {
  default: "text-tertiary",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  primary: "text-primary",
  "primary-subtle": "text-primary/80",
  success: "text-success-primary",
};

export function IdentifierText(props: TIdentifierTextProps) {
  const {
    identifier,
    clipboardText,
    tooltipContent,
    enableClickToCopyIdentifier = false,
    size = "lg",
    variant = "default",
  } = props;
  const textToCopy = clipboardText || identifier;
  // handlers
  const handleCopyIssueIdentifier = () => {
    if (enableClickToCopyIdentifier) {
      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "Work item ID copied to clipboard",
          });
          return;
        })
        .catch(() => {
          console.error("Failed to copy work item ID");
        });
    }
  };

  const textSizeClassName = SIZE_MAP[size];
  const variantClassName = VARIANT_MAP[variant];
  const resolvedTooltip = enableClickToCopyIdentifier ? "Click to copy" : tooltipContent;
  const showTooltip = enableClickToCopyIdentifier || !!tooltipContent;

  return (
    <Tooltip tooltipContent={resolvedTooltip || ""} disabled={!showTooltip} position="top">
      <button
        type="button"
        className={cn(
          "max-w-full truncate text-12 font-medium whitespace-nowrap text-tertiary",
          textSizeClassName,
          variantClassName,
          {
            "cursor-pointer": enableClickToCopyIdentifier,
          }
        )}
        onClick={handleCopyIssueIdentifier}
        disabled={!enableClickToCopyIdentifier}
      >
        {identifier}
      </button>
    </Tooltip>
  );
}
