/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// store types
import type { TPageInstance } from "@/store/pages/base-page";

export type TMovePageModalProps = {
  isOpen: boolean;
  onClose: () => void;
  page: TPageInstance;
};

/** CE stub — project-to-project move is a paid feature; folder move uses MoveToFolderModal. */
export function MovePageModal(_props: TMovePageModalProps) {
  return null;
}
