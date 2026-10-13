import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { searchIkea } from "./ikea";
import { splitDataUrl } from "./image";
import {
  OPENING_LABELS,
  STYLES,
  WALL_LABELS,
  type Design,
  type DesignItem,
  type ExistingItem,
  type IkeaProduct,
  type Photo,
  type Preferences,
  type Room,
  type RoomAnalysis,
} from "./types";

const MODEL = "claude-opus-5-5";
// Server-side refusal fallback: if a request is declined, the API re-runs it
// on a suitable model inside the same call.
const BETAS = ["server-side-fallback-2026-07-01"];
const MAX_TOOL_ROUNDS = 14;

export type Progress =
  | { kind: "thinking" }
  | { kind: "search"; query: string }
  | { kind: "found"; query: string; count: number };

function client(apiKey: string) {
  // The key is the user's own and stays in their browser; requests go straight
  // to api.anthropic.com. That is why browser use is allowed here.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// ---------------------------------------------------------------------------
// Shared prompt pieces
// ---------------------------------------------------------------------------

export function describeRoom(room: Room): string {
  const lines = [
    `Afmetingen: ${room.width} cm breed (x, wand A en C) × ${room.depth} cm diep (y, wand B en D), plafondhoogte ${room.height} cm.`,
    "Coördinaten: oorsprong linksboven binnenhoek, x naar rechts, y naar beneden, alles in cm.",
    "Wand A = boven (y=0), wand B = rechts (x=breedte), wand C = onder (y=diepte), wand D = links (x=0).",
    "Offsets op wand A en C lopen van links naar rechts, op wand B en D van boven naar beneden.",
  ];
  if (room.openings.length === 0) {
    lines.push("Geen deuren, ramen of radiatoren opgegeven.");
  } else {
    lines.push("Openingen en vaste elementen:");
    for (const o of room.openings) {
      let s = `- ${OPENING_LABELS[o.kind]} op ${WALL_LABELS[o.wall]}: vanaf ${o.offset} cm, ${o.size} cm breed (tot ${o.offset + o.size} cm)`;
      if (o.kind === "raam" && o.sillHeight != null) s += `, vensterbank op ${o.sillHeight} cm hoogte`;
      if (o.kind === "deur") s += ", draait naar binnen";
      if (o.note) s += ` — ${o.note}`;
      lines.push(s);
    }
  }
  return lines.join("\n");
}

function photoBlocks(photos: Photo[]): BetaContentBlockParam[] {
  const blocks: BetaContentBlockParam[] = [];
  photos.forEach((p, i) => {
    const { mediaType, data } = splitDataUrl(p.dataUrl);
    blocks.push({
      type: "text",
      text: `Foto ${i + 1}${p.facing ? ` (kijkt naar ${WALL_LABELS[p.facing]})` : ""}:`,
    });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: mediaType as "image/jpeg", data },
    });
  });
  return blocks;
}

function stopCheck(msg: BetaMessage) {
  if (msg.stop_reason === "refusal") {
    throw new Error("Claude weigerde deze aanvraag. Probeer andere foto's of formuleer je wensen anders.");
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error("Het antwoord was te lang en werd afgebroken. Probeer het opnieuw.");
  }
}

function lastText(msg: BetaMessage): string {
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  if (!text) throw new Error("Claude gaf geen antwoord terug.");
  return text;
}

export function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Je Anthropic API-sleutel is ongeldig. Controleer hem bij Instellingen.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Deze API-sleutel heeft geen toegang tot het model. Controleer je Anthropic-account.";
  if (err instanceof Anthropic.RateLimitError) return "Te veel aanvragen of tegoed op. Wacht even of controleer je tegoed op console.anthropic.com.";
  if (err instanceof Anthropic.APIConnectionError) return "Geen verbinding met Anthropic. Controleer je internetverbinding.";
  if (err instanceof Anthropic.APIError) return `Anthropic-fout ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : "Er ging iets mis.";
}

// ---------------------------------------------------------------------------
// Step 1: read the photos
// ---------------------------------------------------------------------------

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["roomType", "description", "palette", "light", "existing"],
  properties: {
    roomType: { type: "string" },
    description: { type: "string" },
    palette: { type: "array", items: { type: "string" } },
    light: { type: "string" },
    existing: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "widthCm", "depthCm"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          widthCm: { type: "integer" },
          depthCm: { type: "integer" },
        },
      },
    },
  },
};

export async function analyzeRoom(apiKey: string, photos: Photo[], room: Room): Promise<RoomAnalysis> {
  const system = [
    "Je bent een ervaren interieurarchitect. Je bekijkt foto's van één kamer en beschrijft wat er nu staat.",
    "Antwoord in het Nederlands (Vlaams mag).",
    "- roomType: wat voor kamer het lijkt te zijn.",
    "- description: twee à drie zinnen over de huidige staat, sfeer, vloer en muren.",
    "- palette: 3 tot 6 dominante kleuren als hex-code (#rrggbb).",
    "- light: één zin over het daglicht en de verlichting.",
    "- existing: de meubels en grote objecten die er nu staan (geen kleine spulletjes). Schat breedte en diepte in cm, gebruik de opgegeven kamermaten als referentie. Voeg een object dat op meerdere foto's staat maar één keer toe.",
  ].join("\n");

  const msg = await client(apiKey).beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    system,
    messages: [
      {
        role: "user",
        content: [
          ...photoBlocks(photos),
          { type: "text", text: `Kamergegevens:\n${describeRoom(room)}\n\nBeschrijf de kamer zoals ze nu is.` },
        ],
      },
    ],
  });
  stopCheck(msg);

  const parsed = JSON.parse(lastText(msg)) as Omit<RoomAnalysis, "existing"> & {
    existing: Omit<ExistingItem, "id" | "keep">[];
  };
  return {
    ...parsed,
    existing: parsed.existing.map((e, i) => ({ ...e, id: `e${i + 1}`, keep: true })),
  };
}

// ---------------------------------------------------------------------------
// Step 2: design with a live IKEA search loop
// ---------------------------------------------------------------------------

const SEARCH_TOOL: BetaTool = {
  name: "search_ikea",
  description:
    "Zoek in de actuele catalogus van IKEA België (Nederlandstalig). Geeft tot 10 producten terug met artikelnummer (itemNo), naam, type, afmetingen (breedte x diepte x hoogte in cm, soms enkel breedte of diameter), prijs in EUR en kleuren. Gebruik Nederlandse zoektermen zoals 'zitbank 3-zits', 'vloerlamp', 'boekenkast smal', 'vloerkleed 200x300'. Zoek gerust meerdere keren met andere woorden als de resultaten niet passen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", description: "Zoekterm in het Nederlands" },
    },
  },
};

const placementProps = {
  onPlan: { type: "boolean" },
  x: { type: "integer" },
  y: { type: "integer" },
  width: { type: "integer" },
  depth: { type: "integer" },
};

const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "items", "kept", "tips"],
  properties: {
    summary: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["itemNo", "quantity", "role", "reason", ...Object.keys(placementProps)],
        properties: {
          itemNo: { type: "string" },
          quantity: { type: "integer" },
          role: { type: "string" },
          reason: { type: "string" },
          ...placementProps,
        },
      },
    },
    kept: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["existingId", ...Object.keys(placementProps)],
        properties: { existingId: { type: "string" }, ...placementProps },
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
};

const DESIGN_SYSTEM = `Je bent een interieurarchitect die kamers inricht met producten van IKEA België. Je werkt met echte maten en een echt budget. Antwoord in het Nederlands.

Werkwijze:
1. Bekijk de foto's, de kamermaten, de openingen en wat de bewoner wil houden.
2. Bepaal welke meubels en accessoires de kamer nodig heeft voor het gekozen gebruik en de stijl.
3. Zoek producten met de tool search_ikea. Je mag enkel producten voorstellen die je in zoekresultaten hebt gezien, met exact dat itemNo. Verzin nooit artikelnummers of prijzen.
4. Controleer de afmetingen uit de zoekresultaten tegen de vrije ruimte. Een meubel dat niet past, kies je niet.
5. Geef het ontwerp terug in het gevraagde JSON-formaat.

Indelingsregels:
- Coördinaten in cm, oorsprong linksboven binnenhoek, x naar rechts (breedte), y naar beneden (diepte). Elk meubel is een rechthoek (x, y = hoek linksboven; width langs x, depth langs y). Draai je een meubel 90°, wissel dan zelf breedte en diepte om.
- Alles moet binnen de kamer vallen en meubels mogen elkaar niet overlappen (een vloerkleed onder een salontafel of bed mag wel).
- Houd een deur en haar draaicirkel vrij (een cirkelkwart met straal = deurbreedte aan de binnenkant), en een doorgang van minstens 80 cm tussen deuren.
- Hoofdlooproutes minstens 70–90 cm breed. Voor een bed minstens 60 cm vrij aan de instapzijde(n).
- Zet geen hoge kasten voor ramen; meubels onder een raam moeten lager zijn dan de vensterbank. Zet geen grote meubels vlak voor een radiator.
- Bewaarde meubels van de bewoner krijgen ook een plaats in 'kept' (existingId = het opgegeven id). Meubels die vervangen worden, komen niet terug.
- Kleine spullen zonder vaste plek (kussens, plaids, kaders, planten op een kast) krijgen onPlan=false met x, y, width en depth op 0.

Budget:
- De som van prijs × quantity van alle items blijft onder het budget. Reken het na voor je antwoordt.
- Besteed het grootste deel aan wat het meeste verschil maakt; kies desnoods goedkopere alternatieven.

Velden:
- summary: 3 à 5 zinnen over het concept en de indeling.
- role: korte functie, bv. "Zitbank", "Leeslamp", "Opbergkast".
- reason: één zin waarom dit product hier past (stijl, maat, plaats).
- tips: 2 tot 5 praktische tips (kleur muur, ophanghoogte, wat met oude meubels, ...).

Bij feedback van de bewoner pas je het ontwerp aan en geef je altijd het volledige, bijgewerkte ontwerp terug.`;

interface RawPlacement {
  onPlan: boolean;
  x: number;
  y: number;
  width: number;
  depth: number;
}
interface RawDesign {
  summary: string;
  items: ({ itemNo: string; quantity: number; role: string; reason: string } & RawPlacement)[];
  kept: ({ existingId: string } & RawPlacement)[];
  tips: string[];
}

export interface DesignSession {
  messages: BetaMessageParam[];
  /** Every product Claude has seen, by itemNo. */
  catalog: Record<string, IkeaProduct>;
}

export function startDesignMessages(
  photos: Photo[],
  room: Room,
  analysis: RoomAnalysis,
  prefs: Preferences,
): BetaMessageParam[] {
  const style = STYLES.find((s) => s.id === prefs.styleId);
  const keep = analysis.existing.filter((e) => e.keep);
  const replace = analysis.existing.filter((e) => !e.keep);
  const text = [
    "KAMER",
    describeRoom(room),
    "",
    "HUIDIGE STAAT",
    `${analysis.roomType}. ${analysis.description}`,
    `Licht: ${analysis.light}`,
    "",
    "BEWAREN (moet een plaats krijgen in 'kept'):",
    keep.length ? keep.map((e) => `- id ${e.id}: ${e.name}, ca. ${e.widthCm} × ${e.depthCm} cm — ${e.description}`).join("\n") : "- niets",
    "",
    "VERVANGEN / WEG:",
    replace.length ? replace.map((e) => `- ${e.name}`).join("\n") : "- niets",
    "",
    "WENSEN",
    `Gebruik: ${prefs.purpose}`,
    `Stijl: ${style ? `${style.label} — ${style.description}` : prefs.styleId}`,
    `Budget: maximaal € ${prefs.budget}`,
    prefs.wishes.trim() ? `Extra wensen: ${prefs.wishes.trim()}` : "",
    "",
    "Maak een ontwerp.",
  ].join("\n");

  return [{ role: "user", content: [...photoBlocks(photos), { type: "text", text }] }];
}

export async function runDesign(
  apiKey: string,
  session: DesignSession,
  onProgress: (p: Progress) => void,
): Promise<{ session: DesignSession; design: Design }> {
  const api = client(apiKey);
  const messages = [...session.messages];
  const catalog = { ...session.catalog };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    onProgress({ kind: "thinking" });
    const msg = await api.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        betas: BETAS,
        fallbacks: "default",
        // Photos + growing transcript are re-sent every round; cache them.
        cache_control: { type: "ephemeral" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: DESIGN_SCHEMA },
        },
        system: DESIGN_SYSTEM,
        tools: [SEARCH_TOOL],
        messages,
      })
      .finalMessage();

    stopCheck(msg);
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "tool_use") {
      const calls = msg.content.filter((b) => b.type === "tool_use");
      const results: BetaToolResultBlockParam[] = await Promise.all(
        calls.map(async (call): Promise<BetaToolResultBlockParam> => {
          const query = String((call.input as { query?: unknown })?.query ?? "").trim();
          if (!query) {
            return { type: "tool_result", tool_use_id: call.id, is_error: true, content: "Lege zoekterm." };
          }
          onProgress({ kind: "search", query });
          try {
            const products = await searchIkea(query, 10);
            products.forEach((p) => (catalog[p.itemNo] = p));
            onProgress({ kind: "found", query, count: products.length });
            const compact = products.map((p) => ({
              itemNo: p.itemNo,
              naam: p.name,
              type: p.typeName,
              afmetingen: p.measure || "onbekend",
              prijs: p.price,
              kleuren: p.colors,
            }));
            return {
              type: "tool_result",
              tool_use_id: call.id,
              content: compact.length ? JSON.stringify(compact) : "Geen producten gevonden. Probeer een andere zoekterm.",
            };
          } catch (e) {
            return {
              type: "tool_result",
              tool_use_id: call.id,
              is_error: true,
              content: e instanceof Error ? e.message : "Zoeken mislukt",
            };
          }
        }),
      );
      messages.push({ role: "user", content: results });
      continue;
    }

    const raw = JSON.parse(lastText(msg)) as RawDesign;
    return { session: { messages, catalog }, design: toDesign(raw, catalog) };
  }
  throw new Error("Het ontwerp bleef zoeken zonder af te ronden. Probeer het opnieuw.");
}

export function addFeedback(session: DesignSession, feedback: string): DesignSession {
  return {
    ...session,
    messages: [
      ...session.messages,
      { role: "user", content: `Feedback van de bewoner: ${feedback}\n\nPas het ontwerp aan en geef het volledige ontwerp terug.` },
    ],
  };
}

function toPlacement(p: RawPlacement) {
  return p.onPlan && p.width > 0 && p.depth > 0 ? { x: p.x, y: p.y, width: p.width, depth: p.depth } : null;
}

function toDesign(raw: RawDesign, catalog: Record<string, IkeaProduct>): Design {
  const items: DesignItem[] = [];
  const dropped: string[] = [];
  for (const it of raw.items) {
    const product = catalog[it.itemNo];
    if (!product) {
      dropped.push(`${it.role} (${it.itemNo})`);
      continue;
    }
    items.push({
      itemNo: it.itemNo,
      quantity: Math.max(1, it.quantity),
      role: it.role,
      reason: it.reason,
      placement: toPlacement(it),
      product,
    });
  }
  return {
    summary: raw.summary,
    items,
    kept: raw.kept
      .map((k) => ({ existingId: k.existingId, name: "", placement: toPlacement(k) }))
      .filter((k): k is Design["kept"][number] => k.placement !== null),
    tips: raw.tips,
    dropped,
  };
}
