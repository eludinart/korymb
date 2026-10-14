/** Client SSE pour POST /chat/stream (mode quotidien). */

import { apiUrl, formatHttpApiErrorPayload } from "./api";

export type ChatStreamDone = {
  status?: string;
  response?: string;
  agent?: string;
  degraded?: boolean;
  claim_guard?: { status?: string; intent?: string; dropped_count?: number };
  pending_blueprint_id?: string;
  job_id?: string;
  mirror_ack?: string;
  action_label?: string;
  proposal?: string;
};

export type ChatStreamResult =
  | { kind: "streamed"; text: string; done: ChatStreamDone }
  | { kind: "json"; data: ChatStreamDone & Record<string, unknown> };

type StreamOpts = {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onDelta?: (chunk: string, full: string) => void;
  timeoutMs?: number;
};

export async function postChatStream(opts: StreamOpts): Promise<ChatStreamResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  try {
    const res = await fetch(apiUrl("/chat/stream"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(opts.headers || {}),
      },
      body: JSON.stringify(opts.body),
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const data = (await res.json().catch(() => ({}))) as ChatStreamDone & Record<string, unknown>;
      if (!res.ok) {
        const msg = formatHttpApiErrorPayload(data);
        throw new Error(msg || `HTTP ${res.status}`);
      }
      return { kind: "json", data };
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let donePayload: ChatStreamDone = {};
    let eventName = "message";

    const flushBlock = (block: string) => {
      const lines = block.split("\n");
      let dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      if (eventName === "delta") {
        const chunk = String(data.text || "");
        if (!chunk) return;
        full += chunk;
        opts.onDelta?.(chunk, full);
      } else if (eventName === "done") {
        donePayload = data as ChatStreamDone;
        if (typeof data.response === "string" && data.response) {
          full = String(data.response);
        }
      } else if (eventName === "error") {
        throw new Error(String(data.detail || "Erreur de streaming"));
      }
      eventName = "message";
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        flushBlock(block);
      }
    }
    if (buffer.trim()) flushBlock(buffer);

    return {
      kind: "streamed",
      text: String(donePayload.response || full),
      done: donePayload,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}
