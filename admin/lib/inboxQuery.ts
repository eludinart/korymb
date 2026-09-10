/** Fetch canonique pour la clé React Query `["admin-inbox"]` — toujours un tableau. */

import type { InboxActionItem } from "../components/director/InboxActionCard";
import { agentHeaders, requestJson } from "./api";

export async function fetchAdminInboxItems(limit = 100): Promise<InboxActionItem[]> {
  const { data } = await requestJson(`/admin/inbox?limit=${Math.max(1, Math.min(limit, 200))}`, {
    headers: agentHeaders(),
    retries: 1,
  });
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as InboxActionItem[]) : [];
}

export function asInboxItems(value: unknown): InboxActionItem[] {
  return Array.isArray(value) ? (value as InboxActionItem[]) : [];
}
