import { t } from "./i18n";
import { splitDataUrl } from "./image";
import { buildGeometry } from "./layout";
import { PROXY_URL, proxyErrorText, proxyHeaders } from "./proxy";
import { cameraFor, describeFromCamera, planPng, type PlanLabel } from "./scene";
import { trackGemini, type UsageMeta } from "./usage";
import type { Design, Photo, Room, RoomAnalysis } from "./types";

// Gemini image editing ("Nano Banana"). Called straight from the browser with
// the user's own key, or through the site's proxy when there is none. The model gets the room photo, a numbered top-down plan
// with the camera position, and the real IKEA product photos as references,
// so it can put the right pieces in the right places.

export const DEFAULT_GEMINI_MODEL = "gemini-nano-banana-2.1";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_REFERENCES = 10;
const ASPECTS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

export interface RenderInput {
  photo: Photo;
  design: Design;
  room: Room;
  analysis: RoomAnalysis | null;
  styleLabel: string;
}

type Part = { kind: "text"; text: string } | { kind: "image"; mime: string; data: string };

export async function renderAfterImage(apiKey: string, model: string, input: RenderInput, meta?: UsageMeta): Promise<string> {
  const { parts, aspect } = await buildParts(input);
  const { base, headers } = endpoint(apiKey);

  // Current API: Interactions endpoint.
  const interactions = (withAspect: boolean) =>
    fetch(`${base}/interactions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: parts.map((p) => (p.kind === "text" ? { type: "text", text: p.text } : { type: "image", mime_type: p.mime, data: p.data })),
        ...(withAspect ? { response_format: { type: "image", aspect_ratio: aspect } } : {}),
      }),
    });

  let res = await interactions(true);
  // Not every model accepts an aspect ratio; retry without rather than fail.
  if (res.status === 400) {
    const body = await res.clone().json().catch(() => null);
    if (/aspect|response_format/i.test(body?.error?.message ?? "")) res = await interactions(false);
  }

  let json: unknown;
  if (res.status === 404) {
    // Older image models only exist on generateContent.
    const legacy = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ parts: parts.map((p) => (p.kind === "text" ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.data } })) }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    json = await readOrThrow(legacy);
  } else {
    json = await readOrThrow(res);
  }

  const image = findImage(json);
  if (!image) throw new Error(t("err.geminiNoImage"));
  trackGemini(model, 1, meta);
  return `data:${image.mime};base64,${image.data}`;
}

/** Exported for testing: the exact text and images sent to the model. */
export async function buildParts({ photo, design, room, analysis, styleLabel }: RenderInput): Promise<{ parts: Part[]; aspect: string }> {
  const g = buildGeometry(room);
  const cam = cameraFor(g, photo.facing);
  const items = design.items.filter((i) => !i.removed);
  const placed = items.filter((i) => i.placement);
  const loose = items.filter((i) => !i.placement);
  const names = new Map(analysis?.existing.map((e) => [e.id, e.name]));

  const numbered = placed.map((item, idx) => {
    const spot = cam ? describeFromCamera(item.placement!, cam, g) : null;
    return { n: idx + 1, item, spot };
  });
  const inView = numbered.filter((x) => !x.spot || x.spot.visible);
  const outOfView = numbered.filter((x) => x.spot && !x.spot.visible);

  // Reference photos for the biggest visible pieces first; they matter most.
  const withRefs = [...inView]
    .sort((a, b) => b.item.placement!.width * b.item.placement!.depth - a.item.placement!.width * a.item.placement!.depth)
    .slice(0, MAX_REFERENCES);
  const refs = new Map<number, { mime: string; data: string }>();
  await Promise.all(
    withRefs.map(async ({ n, item }) => {
      const img = await fetchImage(item.product.imageUrl);
      if (img) refs.set(n, img);
    }),
  );

  const planLabels: PlanLabel[] = [
    ...numbered.map(({ n, item }) => ({ n, placement: item.placement! })),
    ...design.kept.map((k) => ({ n: 0, placement: k.placement, kept: true })),
  ];
  const plan = splitDataUrl(await planPng(room, planLabels, cam));
  const shot = splitDataUrl(photo.dataUrl);

  const describe = ({ n, item, spot }: (typeof numbered)[number]) => {
    const p = item.product;
    const colour = p.colors.length ? ` (${p.colors.join("/")})` : "";
    const size = p.measure ? `, size ${p.measure}` : "";
    const where = spot ? ` Position: ${spot.phrase}.` : "";
    const ref = refs.has(n) ? ` Must look like reference image ${n}.` : "";
    return `${n}. IKEA ${p.name} ${p.typeName}${colour}${size}, footprint ${item.placement!.width} × ${item.placement!.depth} cm on the plan.${where}${ref}`;
  };

  const keep = design.kept.map((k) => names.get(k.existingId)).filter(Boolean);
  const remove = analysis?.existing.filter((e) => !e.keep).map((e) => e.name) ?? [];

  const instructions = [
    "You are editing a real photo of a room to show it furnished with specific IKEA products.",
    "",
    "Rules:",
    "1. Keep the camera position, perspective, lens, walls, windows, doors, floor, ceiling and light of the photo exactly as they are. The output shows the same view.",
    "2. Add exactly the numbered products listed below that are in view, and nothing else new. Do not invent extra furniture or decoration.",
    `3. Every product must look like its reference image (shape, colour, material) and have its real size. Use the given sizes and the ceiling height of ${room.height} cm for scale.`,
    "4. Put every product where the floor plan and the position notes say. The plan (second image) is a top-down view in centimetres: numbers on the plan match the product numbers, grey boxes marked K are existing furniture that stays." +
      (cam
        ? " The yellow CAMERA marker shows where the photo was taken from and the dashed lines show its field of view; left and right in the notes are as seen in the photo."
        : " The camera position is unknown: work out from the photo which part of the plan is in view."),
    remove.length ? `5. Remove this existing furniture from the photo: ${remove.join(", ")}.` : "5. Remove no existing furniture except what a new product replaces.",
    keep.length ? `6. Keep this existing furniture where it is: ${keep.join(", ")}.` : "6. Nothing existing needs to stay in place.",
    "7. Photorealistic result, natural light. No text, labels, numbers or plan markings in the image.",
    "",
    `Style: ${styleLabel}. Concept: ${design.summary}`,
    "",
    "Products to place:",
    ...inView.map(describe),
    ...(outOfView.length
      ? ["", "These products stand behind the camera and are not in this view, so do not show them:", ...outOfView.map(({ n, item }) => `${n}. IKEA ${item.product.name} ${item.product.typeName}`)]
      : []),
    ...(loose.length
      ? ["", "Small items to place naturally on or near the furniture, only if they fit the view:", ...loose.map((i) => `- IKEA ${i.product.name} ${i.product.typeName}${i.product.colors.length ? ` (${i.product.colors.join("/")})` : ""}`)]
      : []),
  ].join("\n");

  const parts: Part[] = [
    { kind: "text", text: instructions },
    { kind: "text", text: "First image: the room photo to edit." },
    { kind: "image", mime: shot.mediaType, data: shot.data },
    { kind: "text", text: "Second image: the numbered floor plan (top-down)." },
    { kind: "image", mime: plan.mediaType, data: plan.data },
  ];
  for (const { n, item } of inView) {
    const ref = refs.get(n);
    if (!ref) continue;
    parts.push({ kind: "text", text: `Reference image ${n}: IKEA ${item.product.name} ${item.product.typeName}.` });
    parts.push({ kind: "image", mime: ref.mime, data: ref.data });
  }
  parts.push({ kind: "text", text: "Now produce the edited room photo, with every listed product that is in view, each in its place." });

  return { parts, aspect: await closestAspect(photo.dataUrl) };
}

/** IKEA product photos allow cross-origin requests; a small size is enough. */
async function fetchImage(url: string): Promise<{ mime: string; data: string } | null> {
  if (!url) return null;
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}f=s`);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    const { mediaType, data } = splitDataUrl(dataUrl);
    return { mime: mediaType, data };
  } catch {
    return null;
  }
}

async function closestAspect(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode().catch(() => undefined);
  const ratio = img.width && img.height ? img.width / img.height : 4 / 3;
  return ASPECTS.reduce((best, a) => {
    const [w, h] = a.split(":").map(Number);
    const [bw, bh] = best.split(":").map(Number);
    return Math.abs(Math.log(w / h / ratio)) < Math.abs(Math.log(bw / bh / ratio)) ? a : best;
  });
}

function endpoint(apiKey: string): { base: string; headers: Record<string, string> } {
  if (!apiKey && PROXY_URL) return { base: `${PROXY_URL}/gemini/v1beta`, headers: { "Content-Type": "application/json", ...proxyHeaders() } };
  return { base: BASE, headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey } };
}

async function readOrThrow(res: Response): Promise<unknown> {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const viaProxy = proxyErrorText(json);
    if (viaProxy) throw new Error(viaProxy);
    const msg = (json as any)?.error?.message ?? res.statusText;
    if (res.status === 400 && /api key/i.test(msg)) throw new Error(t("err.geminiKey"));
    // Image models have no free tier: a free key gets a 429 with a zero limit.
    if (res.status === 429 && /free tier|limit: 0/i.test(msg)) throw new Error(t("err.geminiPaid"));
    throw new Error(t("err.gemini", { status: res.status, message: msg }));
  }
  return json;
}

// The image lands in a different place depending on endpoint and SDK version,
// so walk the response and take the last base64 image we find.
function findImage(node: unknown): { mime: string; data: string } | null {
  let found: { mime: string; data: string } | null = null;
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as Record<string, unknown>;
    const mime = (o.mime_type ?? o.mimeType) as string | undefined;
    if (typeof o.data === "string" && typeof mime === "string" && mime.startsWith("image/") && o.data.length > 1000) {
      found = { mime, data: o.data };
    }
    Object.values(o).forEach(visit);
  };
  visit(node);
  return found;
}
