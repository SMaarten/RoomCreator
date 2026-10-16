// RoomKreator proxy: lets visitors use Claude and Gemini without their own
// API keys. The keys live here as Worker secrets and never reach the browser.
//
// Only the calls the app makes are forwarded:
//   POST /anthropic/v1/messages                         → api.anthropic.com
//   POST /gemini/v1beta/interactions                    → generativelanguage.googleapis.com
//   POST /gemini/v1beta/models/{model}:generateContent  → generativelanguage.googleapis.com
//
// Guards: allowed origins, allowed models, an optional access code, and daily
// request limits per visitor and in total. Request bodies (photos) are passed
// through and not stored or logged.

import { DurableObject } from "cloudflare:workers";

export interface Env {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** Optional. When set, the app must send it in x-roomkreator-code. */
  ACCESS_CODE?: string;
  ALLOWED_ORIGINS: string;
  CLAUDE_MODELS: string;
  GEMINI_MODELS: string;
  CLAUDE_PER_IP_PER_DAY: string;
  CLAUDE_TOTAL_PER_DAY: string;
  GEMINI_PER_IP_PER_DAY: string;
  GEMINI_TOTAL_PER_DAY: string;
  BUDGET: DurableObjectNamespace<Budget>;
}

type Service = "claude" | "gemini";

/** Error codes the app translates; see proxy.* in src/lib/i18n.ts. */
type ProxyCode = "origin" | "access_code" | "daily_limit" | "model" | "not_configured" | "bad_request";

const ANTHROPIC = "https://api.anthropic.com";
const GOOGLE = "https://generativelanguage.googleapis.com";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = list(env.ALLOWED_ORIGINS).includes(origin);
    const cors = corsHeaders(allowed ? origin : null, request);

    if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return fail("origin", 403, cors);
    if (env.ACCESS_CODE && request.headers.get("x-roomkreator-code") !== env.ACCESS_CODE) return fail("access_code", 401, cors);
    if (request.method !== "POST") return fail("bad_request", 405, cors);

    const url = new URL(request.url);
    const route = matchRoute(url.pathname);
    if (!route) return fail("bad_request", 404, cors);

    const key = route.service === "claude" ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
    if (!key) return fail("not_configured", 503, cors);

    const body = await request.text();
    let model = route.model;
    if (!model) {
      try {
        model = JSON.parse(body)?.model;
      } catch {
        return fail("bad_request", 400, cors);
      }
    }
    const models = list(route.service === "claude" ? env.CLAUDE_MODELS : env.GEMINI_MODELS);
    if (typeof model !== "string" || !models.includes(model)) return fail("model", 403, cors);

    if (!(await withinBudget(request, env, route.service))) return fail("daily_limit", 429, cors);

    const upstream =
      route.service === "claude"
        ? await fetch(`${ANTHROPIC}${route.path}${url.search}`, {
            method: "POST",
            headers: pick(request.headers, ["content-type", "anthropic-version", "anthropic-beta"], { "x-api-key": key }),
            body,
          })
        : await fetch(`${GOOGLE}${route.path}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body,
          });

    // Streams (the design step) pass straight through.
    const headers = new Headers(cors);
    for (const name of ["content-type", "request-id", "retry-after"]) {
      const v = upstream.headers.get(name);
      if (v) headers.set(name, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function matchRoute(path: string): { service: Service; path: string; model?: string } | null {
  if (path === "/anthropic/v1/messages") return { service: "claude", path: "/v1/messages" };
  if (path === "/gemini/v1beta/interactions") return { service: "gemini", path: "/v1beta/interactions" };
  const m = path.match(/^\/gemini\/v1beta\/models\/([\w.-]+):generateContent$/);
  if (m) return { service: "gemini", path: `/v1beta/models/${m[1]}:generateContent`, model: m[1] };
  return null;
}

function pick(from: Headers, names: string[], extra: Record<string, string>): Headers {
  const h = new Headers(extra);
  for (const n of names) {
    const v = from.get(n);
    if (v) h.set(n, v);
  }
  return h;
}

function corsHeaders(origin: string | null, request: Request): Headers {
  const h = new Headers({ Vary: "Origin" });
  if (!origin) return h;
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  // The Anthropic SDK sends a varying set of x-stainless-* headers; echo what is asked.
  h.set("Access-Control-Allow-Headers", request.headers.get("Access-Control-Request-Headers") ?? "content-type");
  h.set("Access-Control-Expose-Headers", "request-id, retry-after");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

// Both API shapes: Anthropic reads error.type/message, Gemini error.status/message.
function fail(code: ProxyCode, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("content-type", "application/json");
  const message = `RoomKreator proxy: ${code}`;
  return new Response(JSON.stringify({ type: "error", error: { type: "proxy_error", status: "proxy_error", proxy: code, message } }), {
    status,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Daily limits
// ---------------------------------------------------------------------------

async function withinBudget(request: Request, env: Env, service: Service): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  // Store a hash, not the address itself.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${day}:${ip}`));
  const visitor = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const perIp = Number(service === "claude" ? env.CLAUDE_PER_IP_PER_DAY : env.GEMINI_PER_IP_PER_DAY);
  const total = Number(service === "claude" ? env.CLAUDE_TOTAL_PER_DAY : env.GEMINI_TOTAL_PER_DAY);
  const stub = env.BUDGET.get(env.BUDGET.idFromName(day));
  return stub.hit([
    { key: `${service}:${visitor}`, limit: perIp },
    { key: `${service}:all`, limit: total },
  ]);
}

/** One instance per day; counts requests and clears itself two days later. */
export class Budget extends DurableObject {
  async hit(counters: { key: string; limit: number }[]): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    for (const { key, limit } of counters) {
      const row = sql.exec<{ n: number }>("SELECT n FROM hits WHERE k = ?", key).toArray()[0];
      if ((row?.n ?? 0) >= limit) return false;
    }
    for (const { key } of counters) {
      sql.exec("INSERT INTO hits (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1", key);
    }
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 2 * 86_400_000);
    return true;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
