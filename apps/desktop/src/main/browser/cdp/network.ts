import type { BrowserNetworkRequest } from "../../../shared/contracts";
import type { CdpSession } from "./session";

/**
 * Per-tab network capture over CDP `Network.*` events.
 *
 * Completed requests live in a bounded ring buffer; in-flight requests are
 * tracked in a lookup map that is *always* cleared on the terminal
 * `loadingFinished` / `loadingFailed` events (the previous implementation
 * never deleted entries, leaking memory for the lifetime of the tab).
 */

const MAX_REQUESTS = 300;

function now(): string {
  return new Date().toISOString();
}

export class NetworkRecorder {
  private readonly requests: BrowserNetworkRequest[] = [];
  private readonly pending = new Map<string, BrowserNetworkRequest>();
  private readonly unsubscribe: (() => void)[] = [];
  private counter = 0;

  constructor(private readonly tabId: string) {}

  bind(session: CdpSession): void {
    this.unsubscribe.push(
      session.on("Network.requestWillBeSent", (params, sessionId) => {
        this.onRequestWillBeSent(params, sessionId);
      }),
      session.on("Network.responseReceived", (params, sessionId) => {
        this.onResponseReceived(params, sessionId);
      }),
      session.on("Network.loadingFinished", (params, sessionId) => {
        this.onLoadingFinished(params, sessionId);
      }),
      session.on("Network.loadingFailed", (params, sessionId) => {
        this.onLoadingFailed(params, sessionId);
      }),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    this.pending.clear();
    this.requests.length = 0;
  }

  private pendingKey(requestId: unknown, sessionId: string | undefined): string {
    return `${sessionId ?? "root"}:${String(requestId ?? "")}`;
  }

  private onRequestWillBeSent(
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): void {
    const request = params.request as { url?: string; method?: string } | undefined;
    const url = request?.url ?? "";
    if (!url || url.startsWith("data:")) {
      return;
    }
    this.counter += 1;
    const entry: BrowserNetworkRequest = {
      id: `req-${this.counter}`,
      tabId: this.tabId,
      method: request?.method ?? "GET",
      url,
      startedAt: now(),
      ...(typeof params.type === "string" ? { resourceType: params.type } : {}),
    };
    this.pending.set(this.pendingKey(params.requestId, sessionId), entry);
    this.requests.push(entry);
    if (this.requests.length > MAX_REQUESTS) {
      this.requests.splice(0, this.requests.length - MAX_REQUESTS);
    }
  }

  private onResponseReceived(params: Record<string, unknown>, sessionId: string | undefined): void {
    const entry = this.pending.get(this.pendingKey(params.requestId, sessionId));
    if (!entry) {
      return;
    }
    const response = params.response as { status?: number; statusText?: string } | undefined;
    if (typeof response?.status === "number") {
      entry.status = response.status;
    }
    if (typeof response?.statusText === "string" && response.statusText.length > 0) {
      entry.statusText = response.statusText;
    }
  }

  private onLoadingFinished(params: Record<string, unknown>, sessionId: string | undefined): void {
    const key = this.pendingKey(params.requestId, sessionId);
    const entry = this.pending.get(key);
    if (entry) {
      entry.completedAt = now();
    }
    this.pending.delete(key);
  }

  private onLoadingFailed(params: Record<string, unknown>, sessionId: string | undefined): void {
    const key = this.pendingKey(params.requestId, sessionId);
    const entry = this.pending.get(key);
    if (entry) {
      entry.failed = true;
      entry.completedAt = now();
      if (typeof params.errorText === "string" && params.errorText.length > 0) {
        entry.errorText = params.errorText;
      }
    }
    this.pending.delete(key);
  }

  list(filter?: {
    urlContains?: string;
    failedOnly?: boolean;
    limit?: number;
  }): BrowserNetworkRequest[] {
    let entries = this.requests.slice();
    if (filter?.urlContains) {
      const needle = filter.urlContains.toLowerCase();
      entries = entries.filter((entry) => entry.url.toLowerCase().includes(needle));
    }
    if (filter?.failedOnly) {
      entries = entries.filter(
        (entry) => entry.failed === true || (entry.status !== undefined && entry.status >= 400),
      );
    }
    const limit = filter?.limit ?? 80;
    return entries.slice(-limit);
  }

  getById(id: string): BrowserNetworkRequest | undefined {
    return this.requests.find((entry) => entry.id === id);
  }

  /** Number of requests still in flight (used for network-idle waits). */
  get inflightCount(): number {
    return this.pending.size;
  }

  clear(): void {
    this.requests.length = 0;
    this.pending.clear();
  }
}
