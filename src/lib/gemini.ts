import { splitDataUrl } from "./image";
import type { Design } from "./types";

// Gemini image editing ("Nano Banana"). Called straight from the browser with
// the user's own key.

export const DEFAULT_GEMINI_MODEL = "gemini-nano-banana-2.1";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function renderAfterImage(
  apiKey: string,
  model: string,
  photoDataUrl: string,
  design: Design,
  styleLabel: string,
): Promise<string> {
  const { mediaType, data } = splitDataUrl(photoDataUrl);
  const pieces = design.items
    .filter((i) => i.placement)
    .map((i) => `- ${i.role}: IKEA ${i.product.name}, ${i.product.typeName}${i.product.colors.length ? `, ${i.product.colors.join("/")}` : ""}${i.product.measure ? `, ${i.product.measure}` : ""}`)
    .join("\n");
  const prompt = [
    "Restyle this exact room photo. Keep the camera position, walls, windows, doors, floor and ceiling exactly as they are.",
    `Furnish it in a ${styleLabel} style with these IKEA pieces, at realistic scale:`,
    pieces,
    `Design concept: ${design.summary}`,
    "Photorealistic interior photograph, natural light, no text or labels.",
  ].join("\n");

  // Current API: Interactions endpoint.
  const res = await fetch(`${BASE}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model,
      input: [
        { type: "text", text: prompt },
        { type: "image", mime_type: mediaType, data },
      ],
    }),
  });

  let json: unknown;
  if (res.status === 404) {
    // Older image models only exist on generateContent.
    const legacy = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mediaType, data } }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    json = await readOrThrow(legacy);
  } else {
    json = await readOrThrow(res);
  }

  const image = findImage(json);
  if (!image) throw new Error("Gemini gaf geen afbeelding terug. Probeer het opnieuw of kies een ander model bij Instellingen.");
  return `data:${image.mime};base64,${image.data}`;
}

async function readOrThrow(res: Response): Promise<unknown> {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (json as any)?.error?.message ?? res.statusText;
    if (res.status === 400 && /api key/i.test(msg)) throw new Error("Je Gemini API-sleutel is ongeldig. Controleer hem bij Instellingen.");
    throw new Error(`Gemini-fout ${res.status}: ${msg}`);
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
