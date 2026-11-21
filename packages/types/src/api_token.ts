/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export interface IApiToken {
  created_at: string;
  created_by: string;
  description: string;
  expired_at: string | null;
  id: string;
  is_active: boolean;
  label: string;
  last_used: string | null;
  updated_at: string;
  updated_by: string;
  user: string;
  user_type: number;
  token?: string;
  workspace: string;
}

export type TokenWebhookEvent = "issue" | "issue_comment" | "cycle" | "module" | "project";

export interface TokenWebhookInput {
  project: string;
  url: string;
  events: TokenWebhookEvent[];
}

export interface TokenWebhook extends TokenWebhookInput {
  id: string;
}

export interface TokenWebhookSettings {
  webhooks: TokenWebhook[];
  projects: { id: string; name: string; workspace__slug: string }[];
}
