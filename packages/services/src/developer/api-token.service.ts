/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { IApiToken, TokenWebhook, TokenWebhookInput, TokenWebhookSettings } from "@plane/types";
import { APIService } from "../api.service";

export class APITokenService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  /**
   * Retrieves all API tokens for a specific workspace
   * @returns {Promise<IApiToken[]>} Array of API tokens associated with the workspace
   * @throws {Error} Throws response data if the request fails
   */
  async list(): Promise<IApiToken[]> {
    return this.get(`/api/users/api-tokens/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Retrieves a specific API token by its ID
   * @param {string} tokenId - The unique identifier of the API token
   * @returns {Promise<IApiToken>} The requested API token's details
   * @throws {Error} Throws response data if the request fails
   */
  async retrieve(tokenId: string): Promise<IApiToken> {
    return this.get(`/api/users/api-tokens/${tokenId}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Creates a new API token for a workspace
   * @param {Partial<IApiToken>} data - The data for creating the new API token
   * @returns {Promise<IApiToken>} The newly created API token
   * @throws {Error} Throws response data if the request fails
   */
  async create(data: Partial<IApiToken>): Promise<IApiToken> {
    return this.post(`/api/users/api-tokens/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Deletes a specific API token from the workspace
   * @param {string} tokenId - The unique identifier of the API token to delete
   * @returns {Promise<IApiToken>} The deleted API token's details
   * @throws {Error} Throws response data if the request fails
   */
  async destroy(tokenId: string): Promise<IApiToken> {
    return this.delete(`/api/users/api-tokens/${tokenId}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listWebhooks(tokenId: string): Promise<TokenWebhookSettings> {
    return (await this.get(`/api/users/api-tokens/${tokenId}/webhooks/`)).data;
  }

  async createWebhook(
    tokenId: string,
    data: TokenWebhookInput & { receiver_key?: string }
  ): Promise<TokenWebhook & { secret_key: string }> {
    return (await this.post(`/api/users/api-tokens/${tokenId}/webhooks/`, data)).data;
  }

  async deleteWebhook(tokenId: string, webhookId: string): Promise<void> {
    await this.delete(`/api/users/api-tokens/${tokenId}/webhooks/${webhookId}/`);
  }
}
