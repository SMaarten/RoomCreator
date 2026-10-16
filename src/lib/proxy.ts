import { t, type Key } from "./i18n";

// Shared access through the RoomKreator proxy (see proxy/). Set at build time
// with VITE_PROXY_URL. Visitors without their own key then use the site's
// keys; a visitor's own key always goes straight to Anthropic or Google.

export const PROXY_URL: string | null = (import.meta.env.VITE_PROXY_URL as string | undefined)?.replace(/\/+$/, "") || null;

const CODES = ["origin", "access_code", "daily_limit", "model", "not_configured", "bad_request"] as const;

let accessCode = "";

/** App sets this from Settings, like the language. */
export function setAccessCode(code: string) {
  accessCode = code.trim();
}

export function proxyHeaders(): Record<string, string> {
  return accessCode ? { "x-roomkreator-code": accessCode } : {};
}

/** A readable message when an error body came from the proxy, else null. */
export function proxyErrorText(body: unknown): string | null {
  const code = (body as { error?: { proxy?: unknown } } | null)?.error?.proxy;
  if (typeof code !== "string") return null;
  return t(`proxy.${(CODES as readonly string[]).includes(code) ? code : "bad_request"}` as Key);
}
