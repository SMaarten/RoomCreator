// Local usage log: every Claude and Gemini call records the token counts the
// API reported, and an estimated cost from the price table below. This is an
// estimate for this browser only; the provider consoles are the bill.

import { load, save } from "./storage";

export type UsageKind = "analyse" | "ontwerp" | "bijsturen" | "impressie";

export interface UsageMeta {
  projectId: string;
  projectName: string;
  kind: UsageKind;
  /** One analysis, design run, refinement or image; a design run spans several calls. */
  runId: string;
}

export interface UsageEntry extends UsageMeta {
  id: string;
  at: number;
  provider: "anthropic" | "google";
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  images: number;
  costUsd: number;
}

/** USD per million tokens (images: USD per image). */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes cost 1.25× input. */
  cacheWrite: number;
  perImage?: number;
}

// Anthropic list prices (October 2026). The server-side refusal fallback can
// hand a request to another model, so the likely ones are listed too.
export const DEFAULT_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  // Gemini image models: billed per generated image (1K size).
  "gemini-nano-banana-2.1": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, perImage: 0.0336 },
  "gemini-3.1-flash-lite-image": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, perImage: 0.0336 },
  "gemini-3.1-flash-image": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, perImage: 0.067 },
  "gemini-3-pro-image": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, perImage: 0.134 },
};

const LOG = "usage";
const PRICES = "prices";

export async function loadPrices(): Promise<Record<string, Price>> {
  return { ...DEFAULT_PRICES, ...((await load<Record<string, Price>>(PRICES)) ?? {}) };
}

export function savePrices(prices: Record<string, Price>) {
  return save(PRICES, prices);
}

export function costOf(e: Omit<UsageEntry, "costUsd" | "id" | "at">, prices: Record<string, Price>): number {
  // Unknown model: price like the default model rather than show zero.
  const p = prices[e.model] ?? (e.provider === "google" ? prices["gemini-nano-banana-2.1"] : prices["claude-opus-5-5"]);
  if (!p) return 0;
  return (
    (e.inputTokens * p.input + e.outputTokens * p.output + e.cacheReadTokens * p.cacheRead + e.cacheWriteTokens * p.cacheWrite) / 1_000_000 +
    e.images * (p.perImage ?? 0)
  );
}

export async function listUsage(): Promise<UsageEntry[]> {
  return (await load<UsageEntry[]>(LOG)) ?? [];
}

export async function clearUsage() {
  await save(LOG, []);
}

// Appends are queued so parallel calls never overwrite each other's entry.
let queue = Promise.resolve();

async function append(entries: Omit<UsageEntry, "costUsd" | "id" | "at">[]) {
  queue = queue.then(async () => {
    const prices = await loadPrices();
    const log = await listUsage();
    const now = Date.now();
    for (const e of entries) {
      log.push({ ...e, id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now, costUsd: costOf(e, prices) });
    }
    await save(LOG, log);
  });
  return queue;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Record one Claude response. When the refusal fallback ran, `usage.iterations`
 * lists every attempt with its own model; otherwise top-level usage is all.
 */
export function trackClaude(response: { model: string; usage: any }, meta: UsageMeta | undefined) {
  if (!meta) return;
  const usage = response.usage ?? {};
  const attempts: any[] = Array.isArray(usage.iterations) && usage.iterations.some((i: any) => "output_tokens" in i) ? usage.iterations : [usage];
  return append(
    attempts.map((u) => ({
      ...meta,
      provider: "anthropic" as const,
      model: String(u.model ?? response.model),
      inputTokens: num(u.input_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      cacheWriteTokens: num(u.cache_creation_input_tokens),
      outputTokens: num(u.output_tokens),
      images: 0,
    })),
  );
}

export function trackGemini(model: string, images: number, meta: UsageMeta | undefined) {
  if (!meta) return;
  return append([
    { ...meta, provider: "google", model, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, images },
  ]);
}
