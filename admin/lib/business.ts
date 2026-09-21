import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "./api";
import type { StorefrontParticipant } from "./storefront";

export type QuoteLine = {
  label: string;
  qty: number;
  unit_price_cents: number;
  tax_rate: number;
};

export type ContactReachability = {
  score: number;
  level: "complete" | "partial" | "unreachable" | string;
  label: string;
  missing: string[];
  verified_at?: string | null;
};

export type BizContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  contact_type: string;
  status: string;
  tags: string[];
  notes: string;
  outreach_suggestions?: string;
  website?: string;
  linkedin_url?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  socials?: Record<string, string>;
  verified_at?: string | null;
  reachability?: ContactReachability;
  created_at: string;
  updated_at: string;
};

export type ContactEnrichmentProposal = {
  id: string;
  contact_id: string;
  job_id?: string;
  status: string;
  proposed: Record<string, unknown>;
  sources: string[];
  summary?: string;
  agent_key?: string;
  created_at: string;
  updated_at?: string;
  resolved_at?: string | null;
};

export type BizInteraction = {
  id: string;
  contact_id: string | null;
  project_id: string | null;
  quote_id: string | null;
  interaction_type: string;
  summary: string;
  details: string;
  agent_key: string;
  job_id: string;
  created_at: string;
};

export type EmailAttachment = {
  id: string;
  filename: string;
  mime?: string;
  size?: number;
  source?: string;
};

export type ContactEmailMessage = {
  id: string;
  thread_id: string;
  direction: "outbound" | "inbound" | string;
  subject: string;
  body: string;
  reply_text?: string;
  quoted_text?: string;
  from_email: string;
  to_email: string;
  message_id_header?: string;
  gmail_message_id?: string;
  in_reply_to?: string;
  ticket_id?: string;
  attachments?: EmailAttachment[];
  created_at: string;
};

export type ContactEmailThread = {
  id: string;
  contact_id: string | null;
  subject: string;
  to_email: string;
  status: string;
  gmail_thread_id?: string;
  last_message_at?: string;
  follow_up_event_id?: string;
  ticket_id?: string;
  job_id?: string;
  created_at: string;
  updated_at: string;
  messages?: ContactEmailMessage[];
};

export type MailboxThread = ContactEmailThread & {
  bucket?: "needs_reply" | "awaiting" | "closed" | string;
  contact?: { id?: string; name?: string; email?: string } | null;
  last_direction?: string;
  preview?: string;
  message_count?: number;
  has_attachments?: boolean;
};

export type MailboxDraft = {
  id: string;
  title?: string;
  subject?: string;
  to?: string;
  contact_id?: string;
  contact?: { id?: string; name?: string; email?: string } | null;
  created_at?: string;
  attachment_count?: number;
};

export type MailboxPayload = {
  threads: MailboxThread[];
  drafts?: MailboxDraft[];
  counts?: {
    all?: number;
    needs_reply?: number;
    awaiting?: number;
    closed?: number;
    drafts?: number;
  };
  sync?: { last_run_at?: string; enabled?: boolean; interval_minutes?: number };
};

export type BizProject = {
  id: string;
  contact_id: string | null;
  title: string;
  description: string;
  project_type: string;
  status: string;
  location: string;
  start_date: string | null;
  end_date: string | null;
  milestones: { label: string; done?: boolean }[];
  linked_job_ids: string[];
  created_at: string;
  updated_at: string;
};

export type BizQuote = {
  id: string;
  contact_id: string | null;
  project_id: string | null;
  quote_number: string;
  title: string;
  status: string;
  currency: string;
  lines: QuoteLine[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  valid_until: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  external_invoices?: BizExternalInvoice[];
};

export type BizExternalInvoice = {
  id: string;
  quote_id: string | null;
  tiime_invoice_id: string;
  tiime_status: string;
  external_url: string;
  amount_cents: number;
  currency: string;
  issued_at: string | null;
  paid_at: string | null;
};

export type BizEvent = {
  id: string;
  contact_id: string | null;
  project_id: string | null;
  event_type: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  status: string;
  notes: string;
  is_public?: boolean;
  visibility?: string;
  audience_contact_ids?: string[];
  audience_user_ids?: string[];
  modality?: string;
  nature?: string;
  resource_type?: string;
  resource_url?: string;
  resource_file_id?: string;
  resource_filename?: string;
  resource_file_size?: number;
  resource_file_mime?: string;
  cover_file_id?: string;
  has_cover?: boolean;
  cover_source?: string;
  cover_mime?: string;
  cover_filename?: string;
  is_follow_up?: boolean;
};

export type BizOverview = {
  contacts_active: number;
  projects_active: number;
  quotes_pending: number;
  events_this_week: number;
  invoices_unpaid: number;
  email_needs_reply?: number;
};

type OverviewResponse = {
  stats: BizOverview;
  tiime: { automation_configured: boolean; app_url: string };
};

type TiimeInvoiceResponse = {
  mode: string;
  success?: boolean;
  message: string;
  tiime_app_url: string;
};

const BIN_API = "/api/korymb-bin";

export function emailFileUrl(fileId: string, inline = false) {
  const q = inline ? "?inline=true" : "";
  return `${BIN_API}/business/email-files/${encodeURIComponent(fileId)}${q}`;
}

export function emailMessageAttachmentUrl(
  messageId: string,
  attachmentId: string,
  inline = false,
) {
  const q = inline ? "?inline=true" : "";
  return `${BIN_API}/business/emails/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}${q}`;
}

export function resourceFileUrl(fileId: string, inline = false) {
  const q = inline ? "?inline=true" : "";
  return `${BIN_API}/business/resource-files/${encodeURIComponent(fileId)}${q}`;
}

export function subscriberResourceFileUrl(eventId: string, inline = false) {
  const q = inline ? "?inline=true" : "";
  return `${BIN_API}/subscriber/events/${encodeURIComponent(eventId)}/file${q}`;
}

export function publicStorefrontResourceFileUrl(slug: string, eventId: string, inline = false) {
  const q = inline ? "?inline=true" : "";
  return `/api/public/storefront/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/file${q}`;
}

export function publicStorefrontEventCoverUrl(slug: string, eventId: string) {
  return `/api/public/storefront/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/cover?inline=true`;
}

export function subscriberEventCoverUrl(eventId: string) {
  return `${BIN_API}/subscriber/events/${encodeURIComponent(eventId)}/cover?inline=true`;
}

export function canInlineEmailAttachment(mime?: string) {
  const m = (mime || "").toLowerCase();
  return (
    m.startsWith("image/") ||
    m === "application/pdf" ||
    m.startsWith("text/plain") ||
    m === "text/csv"
  );
}

export const businessApi = {
  overview: async () => {
    const { data } = await requestJson("/business/overview", {
      headers: agentHeaders(),
    });
    return data as OverviewResponse;
  },
  listContacts: async () => {
    const { data } = await requestJson("/business/contacts", {
      headers: agentHeaders(),
    });
    return ((data as { contacts?: BizContact[] })?.contacts ||
      []) as BizContact[];
  },
  createContact: async (body: Partial<BizContact> & { name: string }) => {
    const { data } = await requestJson("/business/contacts", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizContact;
  },
  getContact: async (id: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}`,
      { headers: agentHeaders() },
    );
    return data as BizContact;
  },
  updateContact: async (id: string, body: Partial<BizContact>) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      },
    );
    return data as BizContact;
  },
  deleteContact: async (id: string) => {
    await requestJson(`/business/contacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: agentHeaders(),
    });
  },
  exploreContact: async (id: string, force = false) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}/explore`,
      {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ force }),
        timeoutMs: 20_000,
      },
    );
    return data as {
      contact_id: string;
      job_id: string;
      status: string;
      message?: string;
      forced?: boolean;
      reachability?: ContactReachability;
    };
  },
  getContactExploration: async (id: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}/exploration`,
      {
        headers: agentHeaders(),
      },
    );
    return data as {
      contact_id: string;
      job_id: string | null;
      status: string | null;
      agent?: string;
      result?: string | null;
      summary?: string | null;
      can_fill?: boolean;
      already_filled?: boolean;
      created_at?: string;
      updated_at?: string;
    };
  },
  fillContactFromExploration: async (id: string, apply = false) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}/exploration/fill`,
      {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ apply }),
        timeoutMs: 20_000,
      },
    );
    return data as {
      contact?: BizContact;
      applied: boolean;
      skipped: boolean;
      reason?: string;
      job_id?: string;
      fields?: Record<string, unknown>;
      proposal?: ContactEnrichmentProposal;
    };
  },
  launchOutreachSuggestions: async (id: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}/outreach`,
      {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 20_000,
      },
    );
    return data as {
      contact_id: string;
      job_id: string;
      status: string;
      message?: string;
    };
  },
  getOutreachSuggestionsJob: async (id: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}/outreach`,
      {
        headers: agentHeaders(),
      },
    );
    return data as {
      contact_id: string;
      job_id: string | null;
      status: string | null;
      result?: string | null;
      can_apply?: boolean;
      already_applied?: boolean;
    };
  },
  applyOutreachSuggestions: async (id: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(id)}/outreach/apply`,
      {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 20_000,
      },
    );
    return data as {
      contact?: BizContact;
      applied: boolean;
      skipped: boolean;
      reason?: string;
      job_id?: string;
      fields?: Record<string, unknown>;
    };
  },
  listEnrichmentProposals: async (contactId: string, status = "pending") => {
    const q = new URLSearchParams({ status });
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/enrichment-proposals?${q}`,
      { headers: agentHeaders() },
    );
    return ((data as { proposals?: ContactEnrichmentProposal[] })?.proposals ||
      []) as ContactEnrichmentProposal[];
  },
  applyEnrichmentProposal: async (
    contactId: string,
    proposalId: string,
    fields?: string[],
  ) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/enrichment-proposals/${encodeURIComponent(proposalId)}/apply`,
      {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(fields ? { fields } : {}),
      },
    );
    return data as { contact: BizContact; proposal: ContactEnrichmentProposal };
  },
  rejectEnrichmentProposal: async (contactId: string, proposalId: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/enrichment-proposals/${encodeURIComponent(proposalId)}/reject`,
      { method: "POST", headers: agentHeaders() },
    );
    return data as { proposal: ContactEnrichmentProposal };
  },
  listInteractions: async (contact_id?: string, project_id?: string) => {
    const params = new URLSearchParams();
    if (contact_id) params.set("contact_id", contact_id);
    if (project_id) params.set("project_id", project_id);
    const q = params.toString();
    const { data } = await requestJson(
      `/business/interactions${q ? `?${q}` : ""}`,
      {
        headers: agentHeaders(),
      },
    );
    return ((data as { interactions?: BizInteraction[] })?.interactions ||
      []) as BizInteraction[];
  },
  listContactEmails: async (contactId: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails`,
      {
        headers: agentHeaders(),
      },
    );
    return ((data as { threads?: ContactEmailThread[] })?.threads ||
      []) as ContactEmailThread[];
  },
  listMailbox: async (bucket = "all") => {
    const params = new URLSearchParams();
    if (bucket && bucket !== "all") params.set("bucket", bucket);
    const q = params.toString();
    const { data } = await requestJson(`/business/emails${q ? `?${q}` : ""}`, {
      headers: agentHeaders(),
    });
    return data as MailboxPayload;
  },
  syncMailbox: async () => {
    const { data } = await requestJson("/business/emails/sync", {
      method: "POST",
      headers: agentHeaders(),
      timeoutMs: 90_000,
    });
    return data as MailboxPayload & {
      success: boolean;
      imported?: number;
      updated?: number;
      skipped?: number;
      contacts_synced?: number;
      contacts_attempted?: number;
      errors?: Array<{ contact_id?: string; error?: string }>;
    };
  },
  prepareContactEmail: async (
    contactId: string,
    body: {
      subject?: string;
      body?: string;
      job_id?: string;
      thread_id?: string;
      in_reply_to?: string;
      gmail_thread_id?: string;
      attachment_ids?: string[];
    } = {},
  ) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails/prepare`,
      {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 20_000,
      },
    );
    return data as {
      success: boolean;
      ticket?: { id: string; status?: string; title?: string };
      chain?: { steps?: string[] };
      contact?: { id?: string; name?: string; email?: string };
    };
  },
  sendContactEmail: async (
    contactId: string,
    body: {
      subject?: string;
      body?: string;
      job_id?: string;
      thread_id?: string;
      in_reply_to?: string;
      gmail_thread_id?: string;
      attachment_ids?: string[];
    } = {},
  ) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails/send`,
      {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      },
    );
    return data as {
      success: boolean;
      ticket?: { id: string; status?: string; title?: string };
      result?: string;
      chain?: { steps?: string[] };
      contact?: { id?: string; name?: string; email?: string };
      threads?: ContactEmailThread[];
    };
  },
  uploadEmailFile: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${BIN_API}/business/email-files`, {
      method: "POST",
      body,
      credentials: "include",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      file?: EmailAttachment;
      detail?: unknown;
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(
        formatHttpApiErrorPayload(data) || data.error || "Upload impossible",
      );
    }
    return data.file;
  },
  uploadResourceFile: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${BIN_API}/business/resource-files`, {
      method: "POST",
      body,
      credentials: "include",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      file?: EmailAttachment;
      detail?: unknown;
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(
        formatHttpApiErrorPayload(data) || data.error || "Upload impossible",
      );
    }
    return data.file;
  },
  syncContactEmails: async (contactId: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails/sync`,
      {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 45_000,
      },
    );
    return data as {
      success: boolean;
      imported?: number;
      updated?: number;
      skipped?: number;
      threads?: ContactEmailThread[];
      details?: Array<{ thread_id?: string; cancelled_follow_ups?: number }>;
    };
  },
  deleteContactEmailMessage: async (contactId: string, messageId: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE", headers: agentHeaders() },
    );
    return data as {
      success: boolean;
      deleted?: string;
      message_id?: string;
      thread_deleted?: boolean;
      threads?: ContactEmailThread[];
    };
  },
  deleteContactEmailThread: async (contactId: string, threadId: string) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails/threads/${encodeURIComponent(threadId)}`,
      { method: "DELETE", headers: agentHeaders() },
    );
    return data as {
      success: boolean;
      deleted?: string;
      thread_id?: string;
      threads?: ContactEmailThread[];
    };
  },
  suggestContactEmailReplies: async (
    contactId: string,
    body: {
      thread_id?: string;
      message_id?: string;
      guidance?: string;
      seed_body?: string;
      seed_subject?: string;
    } = {},
  ) => {
    const { data } = await requestJson(
      `/business/contacts/${encodeURIComponent(contactId)}/emails/suggest-replies`,
      {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 45_000,
      },
    );
    return data as {
      success: boolean;
      source?: string;
      inbound_text?: string;
      thread_id?: string;
      message_id?: string;
      suggestions?: Array<{
        id: string;
        label: string;
        angle: string;
        subject: string;
        body: string;
      }>;
    };
  },
  listProjects: async () => {
    const { data } = await requestJson("/business/projects", {
      headers: agentHeaders(),
    });
    return ((data as { projects?: BizProject[] })?.projects ||
      []) as BizProject[];
  },
  createProject: async (body: Partial<BizProject> & { title: string }) => {
    const { data } = await requestJson("/business/projects", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizProject;
  },
  getProject: async (id: string) => {
    const { data } = await requestJson(
      `/business/projects/${encodeURIComponent(id)}`,
      { headers: agentHeaders() },
    );
    return data as BizProject;
  },
  updateProject: async (id: string, body: Partial<BizProject>) => {
    const { data } = await requestJson(
      `/business/projects/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      },
    );
    return data as BizProject;
  },
  deleteProject: async (id: string) => {
    const { res, data } = await requestJson(`/business/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: agentHeaders(),
      expectOk: false,
    });
    if (!res.ok) {
      throw new Error(formatHttpApiErrorPayload(data) || "Impossible de supprimer ce dossier.");
    }
    return data as { deleted?: boolean };
  },
  listQuotes: async () => {
    const { data } = await requestJson("/business/quotes", {
      headers: agentHeaders(),
    });
    return ((data as { quotes?: BizQuote[] })?.quotes || []) as BizQuote[];
  },
  createQuote: async (body: {
    title: string;
    contact_id?: string | null;
    project_id?: string | null;
    lines: QuoteLine[];
    status?: string;
    notes?: string;
  }) => {
    const { data } = await requestJson("/business/quotes", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizQuote;
  },
  getQuote: async (id: string) => {
    const { data } = await requestJson(
      `/business/quotes/${encodeURIComponent(id)}`,
      { headers: agentHeaders() },
    );
    return data as BizQuote;
  },
  updateQuote: async (
    id: string,
    body: Partial<BizQuote> & { lines?: QuoteLine[] },
  ) => {
    const { data } = await requestJson(
      `/business/quotes/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      },
    );
    return data as BizQuote;
  },
  requestTiimeInvoice: async (quoteId: string) => {
    const { data } = await requestJson(
      `/business/quotes/${encodeURIComponent(quoteId)}/request-tiime-invoice`,
      {
        method: "POST",
        headers: agentHeaders(),
      },
    );
    return data as TiimeInvoiceResponse;
  },
  recordTiimeInvoice: async (body: {
    quote_id: string;
    tiime_invoice_id: string;
    external_url?: string;
    tiime_status?: string;
    amount_cents?: number;
  }) => {
    const { data } = await requestJson("/business/external-invoices", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizExternalInvoice;
  },
  updateExternalInvoice: async (
    id: string,
    body: Partial<
      Pick<
        BizExternalInvoice,
        | "tiime_invoice_id"
        | "tiime_status"
        | "external_url"
        | "amount_cents"
        | "paid_at"
      >
    >,
  ) => {
    const { data } = await requestJson(
      `/business/external-invoices/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      },
    );
    return data as BizExternalInvoice;
  },
  listEvents: async (from_at?: string, to_at?: string, limit?: number, project_id?: string) => {
    const params = new URLSearchParams();
    if (from_at) params.set("from_at", from_at);
    if (to_at) params.set("to_at", to_at);
    if (limit) params.set("limit", String(limit));
    if (project_id) params.set("project_id", project_id);
    const q = params.toString();
    const { data } = await requestJson(`/business/events${q ? `?${q}` : ""}`, {
      headers: agentHeaders(),
    });
    return ((data as { events?: BizEvent[] })?.events || []) as BizEvent[];
  },
  listParticipants: async () => {
    const { data } = await requestJson("/storefront/participants", {
      headers: agentHeaders(),
    });
    return ((data as { participants?: StorefrontParticipant[] })?.participants || []) as StorefrontParticipant[];
  },
  getEvent: async (id: string) => {
    const { data } = await requestJson(
      `/business/events/${encodeURIComponent(id)}`,
      { headers: agentHeaders() },
    );
    return data as BizEvent;
  },
  createEvent: async (
    body: Partial<BizEvent> & { title: string; starts_at: string },
  ) => {
    const { data } = await requestJson("/business/events", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizEvent;
  },
  updateEvent: async (id: string, body: Partial<BizEvent>) => {
    const { data } = await requestJson(
      `/business/events/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      },
    );
    return data as BizEvent;
  },
  deleteEvent: async (id: string) => {
    await requestJson(`/business/events/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: agentHeaders(),
    });
  },
};
