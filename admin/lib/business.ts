import { agentHeaders, requestJson } from "./api";

export type QuoteLine = {
  label: string;
  qty: number;
  unit_price_cents: number;
  tax_rate: number;
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
  created_at: string;
  updated_at: string;
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

export type BizOverview = {
  contacts_active: number;
  projects_active: number;
  quotes_pending: number;
  events_this_week: number;
  invoices_unpaid: number;
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

export const businessApi = {
  overview: async () => {
    const { data } = await requestJson("/business/overview", { headers: agentHeaders() });
    return data as OverviewResponse;
  },
  listContacts: async () => {
    const { data } = await requestJson("/business/contacts", { headers: agentHeaders() });
    return ((data as { contacts?: BizContact[] })?.contacts || []) as BizContact[];
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
    const { data } = await requestJson(`/business/contacts/${encodeURIComponent(id)}`, { headers: agentHeaders() });
    return data as BizContact;
  },
  updateContact: async (id: string, body: Partial<BizContact>) => {
    const { data } = await requestJson(`/business/contacts/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizContact;
  },
  deleteContact: async (id: string) => {
    await requestJson(`/business/contacts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: agentHeaders(),
    });
  },
  listInteractions: async (contact_id?: string, project_id?: string) => {
    const params = new URLSearchParams();
    if (contact_id) params.set("contact_id", contact_id);
    if (project_id) params.set("project_id", project_id);
    const q = params.toString();
    const { data } = await requestJson(`/business/interactions${q ? `?${q}` : ""}`, {
      headers: agentHeaders(),
    });
    return ((data as { interactions?: BizInteraction[] })?.interactions || []) as BizInteraction[];
  },
  listProjects: async () => {
    const { data } = await requestJson("/business/projects", { headers: agentHeaders() });
    return ((data as { projects?: BizProject[] })?.projects || []) as BizProject[];
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
    const { data } = await requestJson(`/business/projects/${encodeURIComponent(id)}`, { headers: agentHeaders() });
    return data as BizProject;
  },
  updateProject: async (id: string, body: Partial<BizProject>) => {
    const { data } = await requestJson(`/business/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizProject;
  },
  listQuotes: async () => {
    const { data } = await requestJson("/business/quotes", { headers: agentHeaders() });
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
    const { data } = await requestJson(`/business/quotes/${encodeURIComponent(id)}`, { headers: agentHeaders() });
    return data as BizQuote;
  },
  updateQuote: async (id: string, body: Partial<BizQuote> & { lines?: QuoteLine[] }) => {
    const { data } = await requestJson(`/business/quotes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizQuote;
  },
  requestTiimeInvoice: async (quoteId: string) => {
    const { data } = await requestJson(`/business/quotes/${encodeURIComponent(quoteId)}/request-tiime-invoice`, {
      method: "POST",
      headers: agentHeaders(),
    });
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
    body: Partial<Pick<BizExternalInvoice, "tiime_invoice_id" | "tiime_status" | "external_url" | "amount_cents" | "paid_at">>,
  ) => {
    const { data } = await requestJson(`/business/external-invoices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizExternalInvoice;
  },
  listEvents: async (from_at?: string, to_at?: string) => {
    const params = new URLSearchParams();
    if (from_at) params.set("from_at", from_at);
    if (to_at) params.set("to_at", to_at);
    const q = params.toString();
    const { data } = await requestJson(`/business/events${q ? `?${q}` : ""}`, { headers: agentHeaders() });
    return ((data as { events?: BizEvent[] })?.events || []) as BizEvent[];
  },
  getEvent: async (id: string) => {
    const { data } = await requestJson(`/business/events/${encodeURIComponent(id)}`, { headers: agentHeaders() });
    return data as BizEvent;
  },
  createEvent: async (body: Partial<BizEvent> & { title: string; starts_at: string }) => {
    const { data } = await requestJson("/business/events", {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizEvent;
  },
  updateEvent: async (id: string, body: Partial<BizEvent>) => {
    const { data } = await requestJson(`/business/events/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: agentHeaders(),
      body: JSON.stringify(body),
    });
    return data as BizEvent;
  },
  deleteEvent: async (id: string) => {
    await requestJson(`/business/events/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: agentHeaders(),
    });
  },
};
