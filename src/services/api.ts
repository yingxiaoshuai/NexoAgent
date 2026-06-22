import { NEXO_API_PORT, NEXO_API_URL, VITE_DEV_PORT } from "../shared/ports";

export const isElectron = () =>
  typeof window !== "undefined" && "nexoDesktop" in window;

let runtimeBaseUrl = "";

export function setRuntimeApiBase(baseUrl?: string) {
  runtimeBaseUrl = baseUrl?.trim().replace(/\/+$/, "") || "";
}

export function getRuntimeApiBase() {
  return runtimeBaseUrl;
}

function resolveApiBase() {
  if (runtimeBaseUrl) {
    return runtimeBaseUrl;
  }

  if (typeof window !== "undefined") {
    const { hostname, port, protocol } = window.location;

    if (protocol === "file:") {
      return NEXO_API_URL;
    }

    const isLocalPreview =
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      (port === String(VITE_DEV_PORT) || port === "5173" || port === "5174" || port === "4173" || port === "4174");

    if (isLocalPreview) {
      return NEXO_API_URL;
    }
  }

  if (typeof location !== "undefined" && location.port !== String(NEXO_API_PORT) && location.hostname === "0.0.0.0") {
    return NEXO_API_URL;
  }

  return "";
}

export function getApiBase() {
  return resolveApiBase();
}

async function toApiError(response: Response, fallback: string) {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json() as { error?: string };
      if (data?.error) return new Error(data.error);
    } else {
      const text = await response.text();
      if (/<!doctype html>/i.test(text)) {
        return new Error(`API request hit an HTML page instead of the Nexo backend. Make sure the local backend is running on ${NEXO_API_URL}.`);
      }
    }
  } catch {
    // ignore JSON parse failures
  }
  return new Error(fallback);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`);
  if (!response.ok) throw await toApiError(response, `GET ${path} failed: ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    if (/<!doctype html>/i.test(text)) {
      throw new Error(`API request hit an HTML page instead of JSON. Check that the Nexo backend is reachable on ${NEXO_API_URL}.`);
    }
    throw new Error(`GET ${path} returned unexpected content type: ${contentType || "unknown"}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response, `POST ${path} failed: ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    if (/<!doctype html>/i.test(text)) {
      throw new Error(`API request hit an HTML page instead of JSON. Check that the Nexo backend is reachable on ${NEXO_API_URL}.`);
    }
    throw new Error(`POST ${path} returned unexpected content type: ${contentType || "unknown"}`);
  }
  return response.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${getApiBase()}${path}`, { method: "DELETE" });
  if (!response.ok) throw await toApiError(response, `DELETE ${path} failed: ${response.status}`);
}

export async function apiPatch(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response, `PATCH ${path} failed: ${response.status}`);
}

export function subscribeStream(
  requestId: string,
  onEvent: (event: { type: string; [key: string]: unknown }) => void
): () => void {
  const stream = new EventSource(`${getApiBase()}/api/stream/${requestId}`);
  stream.onmessage = (event) => {
    const data = JSON.parse(event.data as string) as { type: string; [key: string]: unknown };
    onEvent(data);
    if (data.type === "done" || data.type === "error") stream.close();
  };
  stream.onerror = () => {
    onEvent({ type: "error", message: "Real-time response stream was interrupted. Please try again." });
    stream.close();
  };
  return () => stream.close();
}
