import { translateText } from "./translate";

let installed = false;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function translateMessage(message: string, reason: unknown): string {
  const translated = translateText(message);
  if (translated !== message) return translated;
  if (reason === "seat_limit") return "已达到当前许可证允许的同时在线数上限";
  if (reason === "license" && !message.startsWith("许可证被拒绝：")) {
    return `许可证被拒绝：${message}`;
  }
  return message;
}

/** Rewrite known API error text. Returns whether anything changed. */
function translatePayload(data: unknown): boolean {
  let changed = false;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.detail === "string") {
      const next = translateText(obj.detail);
      if (next !== obj.detail) {
        obj.detail = next;
        changed = true;
      }
    } else if (obj.detail && typeof obj.detail === "object") {
      const detail = obj.detail as Record<string, unknown>;
      if (typeof detail.message === "string") {
        const next = translateMessage(detail.message, detail.reason);
        if (next !== detail.message) {
          detail.message = next;
          changed = true;
        }
      }
    }
    const lastError = obj.last_error;
    if (lastError && typeof lastError === "object") {
      const last = lastError as Record<string, unknown>;
      if (typeof last.message === "string") {
        const next = translateMessage(last.message, last.reason);
        if (next !== last.message) {
          last.message = next;
          changed = true;
        }
      }
    }
    if (typeof obj.ok === "boolean" && typeof obj.error === "string") {
      const next = translateText(obj.error);
      if (next !== obj.error) {
        obj.error = next;
        changed = true;
      }
    }
    if (typeof obj.warning === "string") {
      const next = translateText(obj.warning);
      if (next !== obj.warning) {
        obj.warning = next;
        changed = true;
      }
    }
  };
  visit(data);
  return changed;
}

/** Apply Chinese to API payloads and the document language. Safe to call once. */
export function installZh(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.documentElement.lang = "zh-CN";
  if (document.title === "CloakBrowser Manager") {
    document.title = "CloakBrowser 管理器";
  }

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    if (!requestUrl(input).includes("/api/")) return response;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) return response;

    let data: unknown;
    try {
      data = await response.clone().json();
    } catch {
      return response;
    }
    if (!translatePayload(data)) return response;

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
