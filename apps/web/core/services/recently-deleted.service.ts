/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type DeletedItem = {
  id: string;
  type: string;
  type_label: string;
  name: string;
  deleted_at: string;
  deleted_by: string | null;
  expires_at: string;
  project: string | null;
  legacy: boolean;
  can_restore: boolean;
};

export type DeletedItemsResponse = {
  results: DeletedItem[];
  has_more: boolean;
  is_admin: boolean;
  retention_days: number;
};

export class RecentlyDeletedService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspace: string, type: string, offset: number): Promise<DeletedItemsResponse> {
    const response = await this.get(`/api/workspaces/${workspace}/recently-deleted/`, {
      params: { type: type || undefined, offset },
    });
    return response.data;
  }

  async restore(workspace: string, item: DeletedItem): Promise<void> {
    await this.post(`/api/workspaces/${workspace}/recently-deleted/${item.type}/${item.id}/restore/`);
  }
}
