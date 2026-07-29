/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
// plane imports
import type { TFileHandler } from "@plane/editor";
import { getEditorAssetDownloadSrc, getEditorAssetSrc } from "@plane/utils";
// hooks
import { useEditorAsset } from "@/hooks/store/use-editor-asset";
// plane web hooks
import { useExtendedEditorConfig } from "@/hooks/editor/use-extended-editor-config";
import { useFileSize } from "@/hooks/use-file-size";
// services
import { FileService } from "@/services/file.service";
const fileService = new FileService();

/**
 * Absolute MinIO/S3 signed URLs expire. If we can recover an asset UUID from the
 * path, return it so callers rebuild a fresh `/api/assets/v2/...` URL instead of
 * reusing a dead `X-Amz-...` link.
 */
const extractAssetIdFromPath = (path: string): string | null => {
  if (!path) return null;
  const apiMatch = path.match(
    /\/api\/assets\/v2\/workspaces\/[^/]+\/projects\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?/i
  );
  if (apiMatch?.[1]) return apiMatch[1];
  // MinIO object key: `{workspaceId}/{uuid}-{filename}`
  const objectMatch = path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[^/?#]+/i);
  if (objectMatch?.[1]) return objectMatch[1];
  return null;
};

type TArgs = {
  projectId?: string;
  uploadFile: TFileHandler["upload"];
  duplicateFile: TFileHandler["duplicate"];
  workspaceId: string;
  workspaceSlug: string;
};

export const useEditorConfig = () => {
  // store hooks
  const { assetsUploadPercentage } = useEditorAsset();
  // file size
  const { maxFileSize } = useFileSize();
  const { getExtendedEditorFileHandlers } = useExtendedEditorConfig();

  const getEditorFileHandlers = useCallback(
    (args: TArgs): TFileHandler => {
      const { projectId, uploadFile, duplicateFile, workspaceId, workspaceSlug } = args;

      return {
        assetsUploadStatus: assetsUploadPercentage,
        cancel: fileService.cancelUpload,
        checkIfAssetExists: async (assetId: string) => {
          const res = await fileService.checkIfAssetExists(workspaceSlug, assetId);
          return res?.exists ?? false;
        },
        delete: async (src: string) => {
          if (src?.startsWith("http")) {
            await fileService.deleteOldWorkspaceAsset(workspaceId, src);
          } else {
            await fileService.deleteNewAsset(
              getEditorAssetSrc({
                assetId: src,
                projectId,
                workspaceSlug,
              }) ?? ""
            );
          }
        },
        getAssetDownloadSrc: async (path) => {
          if (!path) return "";
          const recoveredId = path.startsWith("http") ? extractAssetIdFromPath(path) : null;
          const assetId = recoveredId || (!path.startsWith("http") ? path : null);
          if (assetId) {
            return (
              getEditorAssetDownloadSrc({
                assetId,
                projectId,
                workspaceSlug,
              }) ?? ""
            );
          }
          return path;
        },
        getAssetSrc: async (path) => {
          if (!path) return "";
          const recoveredId = path.startsWith("http") ? extractAssetIdFromPath(path) : null;
          const assetId = recoveredId || (!path.startsWith("http") ? path : null);
          if (assetId) {
            return (
              getEditorAssetSrc({
                assetId,
                projectId,
                workspaceSlug,
              }) ?? ""
            );
          }
          return path;
        },
        restore: async (src: string) => {
          if (src?.startsWith("http")) {
            await fileService.restoreOldEditorAsset(workspaceId, src);
          } else {
            await fileService.restoreNewAsset(workspaceSlug, src);
          }
        },
        upload: uploadFile,
        duplicate: duplicateFile,
        validation: {
          maxFileSize,
        },
        ...getExtendedEditorFileHandlers({ projectId, workspaceSlug }),
      };
    },
    [assetsUploadPercentage, getExtendedEditorFileHandlers, maxFileSize]
  );

  return {
    getEditorFileHandlers,
  };
};
