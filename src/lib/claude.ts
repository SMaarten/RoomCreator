import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { t, type Lang } from "./i18n";
import { searchIkea } from "./ikea";
import { DEFAULT_LOCALE, type CatalogLocale } from "./locale";
import { trackClaude, type UsageMeta } from "./usage";
import { buildGeometry, doorSwing, openingPoints } from "./layout";
import { splitDataUrl } from "./image";
import {
  purposeLabel,
  styleDescription,
  styleLabel,
  type Design,
  type Alternative,
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
// More alternatives mean more searches; leave room for them.
const MAX_ALTERNATIVES = 5;
const MAX_TOOL_ROUNDS = 24;

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
// Shared prompt pieces. Prompts are written in Dutch; the language Claude
// writes in and the IKEA site it searches are passed in explicitly.
// ---------------------------------------------------------------------------

const LANG_NL: Record<string, string> = { nl: "Nederlands", fr: "Frans", en: "Engels", de: "Duits" };
const COUNTRY_NL: Record<string, string> = { be: "België", nl: "Nederland", fr: "Frankrijk", de: "Duitsland" };
const OPENING_NL: Record<string, string> = { deur: "Deur", raam: "Raam", radiator: "Radiator", doorgang: "Open doorgang", anders: "Opening" };

const writeIn = (lang: Lang) =>
  `Schrijf alle tekst die de bewoner te zien krijgt in het ${LANG_NL[lang]}${lang === "nl" ? " (Vlaams mag)" : ""}.`;

const pt = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`;

export function describeRoom(room: Room): string {
  const g = buildGeometry(room);
  const rect = g.walls.length === 4 && g.walls.every((w) => Math.abs(w.ux) < 0.001 || Math.abs(w.uy) < 0.001);
  const lines = [
    rect
      ? `Rechthoekige kamer van ${g.width} × ${g.depth} cm, plafondhoogte ${room.height} cm, ${g.area.toFixed(1)} m².`
      : `Onregelmatige kamer met ${g.walls.length} wanden, buitenmaten ${g.width} × ${g.depth} cm, plafondhoogte ${room.height} cm, ${g.area.toFixed(1)} m².`,
    "Coördinaten in cm: x naar rechts, y naar beneden. De vloer is de veelhoek door deze hoekpunten:",
    g.points.map((p) => pt(p.x, p.y)).join(" → ") + " → terug naar het begin.",
    "Wanden (met de klok mee):",
    ...g.walls.map((w) => `- Wand ${w.id}: van ${pt(w.x1, w.y1)} naar ${pt(w.x2, w.y2)}, ${w.length} cm`),
  ];
  if (!rect) lines.push("Let op: niet elk punt binnen de buitenmaten ligt in de kamer. Alles moet binnen de veelhoek staan.");
  if (room.openings.length === 0) {
    lines.push("Geen deuren, ramen of radiatoren opgegeven.");
  } else {
    lines.push("Openingen en vaste elementen:");
    for (const o of room.openings) {
      const wall = g.walls.find((w) => w.id === o.wall);
      if (!wall) continue;
      const p = openingPoints(wall, o);
      let s = `- ${OPENING_NL[o.kind]} op wand ${o.wall}, ${o.size} cm breed, van ${pt(p.sx, p.sy)} tot ${pt(p.ex, p.ey)}`;
      if (o.kind === "raam" && o.sillHeight != null) s += `, vensterbank op ${o.sillHeight} cm hoogte`;
      if (o.kind === "radiator") s += ", steekt ca. 10 cm de kamer in";
      if (o.kind === "deur") {
        const swing = doorSwing(g, o);
        s += (o.swing ?? "binnen") === "binnen"
          ? `, draait naar binnen met scharnier bij ${pt(p.hx, p.hy)}; houd het vlak x ${Math.round(swing!.x)}–${Math.round(swing!.x + swing!.width)}, y ${Math.round(swing!.y)}–${Math.round(swing!.y + swing!.depth)} vrij`
          : ", draait naar buiten (geen draaicirkel in de kamer, wel de doorgang vrijhouden)";
      }
      if (o.note) s += ` (${o.note})`;
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
      text: `Foto ${i + 1}${p.facing ? ` (kijkt naar wand ${p.facing})` : ""}:`,
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
    throw new Error(t("err.refused"));
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error(t("err.tooLong"));
  }
}

function lastText(msg: BetaMessage): string {
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  if (!text) throw new Error(t("err.noAnswer"));
  return text;
}

export function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return t("err.auth");
  if (err instanceof Anthropic.PermissionDeniedError) return t("err.permission");
  if (err instanceof Anthropic.RateLimitError) return t("err.rate");
  if (err instanceof Anthropic.APIConnectionError) return t("err.connection");
  if (err instanceof Anthropic.APIError) return t("err.api", { status: err.status ?? "", message: err.message });
  return err instanceof Error ? err.message : t("err.generic");
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

export async function analyzeRoom(apiKey: string, photos: Photo[], room: Room, lang: Lang, meta?: UsageMeta): Promise<RoomAnalysis> {
  const system = [
    "Je bent een ervaren interieurarchitect. Je bekijkt foto's van één kamer en beschrijft wat er nu staat.",
    writeIn(lang),
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
  trackClaude(msg, meta);
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

function searchTool(locale: CatalogLocale): BetaTool {
  const lang = LANG_NL[locale.lang];
  return {
    name: "search_ikea",
    description: `Zoek in de actuele catalogus van IKEA ${COUNTRY_NL[locale.country]} (${lang}talige site). Geeft tot 10 producten terug met artikelnummer (itemNo), naam, type, afmetingen (breedte x diepte x hoogte in cm, soms enkel breedte of diameter), prijs in EUR en kleuren. Zoek met termen in het ${lang}, zoals je ze in een winkel zou intypen (bv. een type meubel plus een maat of kenmerk). Zoek gerust meerdere keren met andere woorden als de resultaten niet passen.`,
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: `Zoekterm in het ${lang}` },
      },
    },
  };
}

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
        required: ["itemNo", "quantity", "role", "reason", ...Object.keys(placementProps), "alternatives"],
        properties: {
          itemNo: { type: "string" },
          quantity: { type: "integer" },
          role: { type: "string" },
          reason: { type: "string" },
          ...placementProps,
          alternatives: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["itemNo", "note", "width", "depth"],
              properties: {
                itemNo: { type: "string" },
                note: { type: "string" },
                width: { type: "integer" },
                depth: { type: "integer" },
              },
            },
          },
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

const designSystem = (lang: Lang, locale: CatalogLocale) => `Je bent een interieurarchitect die kamers inricht met producten van IKEA ${COUNTRY_NL[locale.country]}. Je werkt met echte maten en een echt budget. ${writeIn(lang)} Productnamen en types neem je over zoals de catalogus ze geeft.

Werkwijze:
1. Bekijk de foto's, de kamermaten, de openingen en wat de bewoner wil houden.
2. Bepaal welke meubels en accessoires de kamer nodig heeft voor het gekozen gebruik en de stijl.
3. Zoek producten met de tool search_ikea. Je mag enkel producten voorstellen die je in zoekresultaten hebt gezien, met exact dat itemNo. Verzin nooit artikelnummers of prijzen.
4. Controleer de afmetingen uit de zoekresultaten tegen de vrije ruimte. Een meubel dat niet past, kies je niet.
5. Geef het ontwerp terug in het gevraagde JSON-formaat.

Indelingsregels:
- Coördinaten in cm zoals bij de hoekpunten van de kamer: x naar rechts, y naar beneden. Elk meubel is een rechthoek (x, y = hoek linksboven; width langs x, depth langs y). Draai je een meubel 90°, wissel dan zelf breedte en diepte om.
- De kamer kan onregelmatig zijn (L-vorm, nis, schuine wand). Elk meubel moet volledig binnen de vloerveelhoek liggen, niet enkel binnen de buitenmaten.
- Alles moet binnen de kamer vallen en meubels mogen elkaar niet overlappen (een vloerkleed onder een salontafel of bed mag wel).
- Houd bij deuren die naar binnen draaien het opgegeven vlak van de draaicirkel vrij, en een doorgang van minstens 80 cm tussen deuren.
- Hoofdlooproutes minstens 70–90 cm breed. Voor een bed minstens 60 cm vrij aan de instapzijde(n).
- Zet geen hoge kasten voor ramen; meubels onder een raam moeten lager zijn dan de vensterbank. Zet geen grote meubels vlak voor een radiator.
- Bewaarde meubels van de bewoner krijgen ook een plaats in 'kept' (existingId = het opgegeven id). Meubels die vervangen worden, komen niet terug.
- Kleine spullen zonder vaste plek (kussens, plaids, kaders, planten op een kast) krijgen onPlan=false met x, y, width en depth op 0.

Alternatieven:
- Geef bij elk item 5 alternatieven uit je zoekresultaten die ook bij de stijl passen en op dezelfde plaats passen. Minder mag enkel als er echt geen 5 geschikte producten bestaan. Zoek gerust extra om goede alternatieven te vinden.
- Zorg voor variatie: goedkoper en duurder, een andere kleur of een ander materiaal, een andere vorm of maat die nog past. Zet ze van meest naar minst passend.
- Een alternatief is een ander product (ander itemNo) dan de hoofdkeuze en elk alternatief komt maar één keer voor.
- note: één korte zin over het verschil met de hoofdkeuze (prijs, kleur, maat, materiaal).
- width en depth: de afmetingen op het plan als dit alternatief op dezelfde plek (x, y) komt, in dezelfde oriëntatie; 0 voor items met onPlan=false.

Budget:
- De som van prijs × quantity van alle hoofdkeuzes blijft onder het budget. Reken het na voor je antwoordt. Alternatieven tellen niet mee.
- Besteed het grootste deel aan wat het meeste verschil maakt; kies desnoods goedkopere alternatieven.
- Volg een opmerking van de bewoner over het budget (bv. waar meer of minder mag) zolang het totaal binnen het budget blijft.

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
  items: ({
    itemNo: string;
    quantity: number;
    role: string;
    reason: string;
    alternatives: { itemNo: string; note: string; width: number; depth: number }[];
  } & RawPlacement)[];
  kept: ({ existingId: string } & RawPlacement)[];
  tips: string[];
}

export interface DesignSession {
  messages: BetaMessageParam[];
  /** Every product Claude has seen, by itemNo. */
  catalog: Record<string, IkeaProduct>;
  /**
   * Fixed for the whole conversation: changing the system prompt or tools
   * later would invalidate the earlier turns. A later language switch is
   * passed as a note in the next feedback message instead.
   */
  lang?: Lang;
  locale?: CatalogLocale;
}

export function startDesignMessages(
  photos: Photo[],
  room: Room,
  analysis: RoomAnalysis,
  prefs: Preferences,
): BetaMessageParam[] {
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
    `Gebruik: ${purposeLabel(prefs.purpose)}`,
    `Stijl: ${styleLabel(prefs.styleId)}${styleDescription(prefs.styleId) ? ` — ${styleDescription(prefs.styleId)}` : ""}`,
    `Budget: maximaal € ${prefs.budget}`,
    prefs.budgetNote.trim() ? `Opmerking bij het budget: ${prefs.budgetNote.trim()}` : "",
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
  meta?: UsageMeta,
): Promise<{ session: DesignSession; design: Design }> {
  const api = client(apiKey);
  const messages = [...session.messages];
  const catalog = { ...session.catalog };
  const lang = session.lang ?? "nl";
  const locale = session.locale ?? DEFAULT_LOCALE;

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
        system: designSystem(lang, locale),
        tools: [searchTool(locale)],
        messages,
      })
      .finalMessage();

    trackClaude(msg, meta);
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
            const products = await searchIkea(query, 10, locale);
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
    return { session: { ...session, messages, catalog }, design: { ...toDesign(raw, catalog), locale } };
  }
  throw new Error(t("err.endless"));
}

export function addFeedback(session: DesignSession, feedback: string, current: Design, uiLang: Lang): DesignSession {
  // The user may have swapped in alternatives since the last answer.
  const kept = current.items.filter((i) => !i.removed);
  const removed = current.items.filter((i) => i.removed);
  const choices = kept.map((i) => `- ${i.role}: ${i.product.name} ${i.product.typeName} (${i.itemNo})`).join("\n");
  const switched = uiLang !== (session.lang ?? "nl") ? `\n\n${writeIn(uiLang)} Dit geldt vanaf nu.` : "";
  const skipped = removed.length
    ? `\n\nWeggelaten door de bewoner (heeft dit al of vindt het overbodig, niet opnieuw voorstellen en niet in het ontwerp opnemen):\n${removed.map((i) => `- ${i.role}: ${i.product.name} ${i.product.typeName}`).join("\n")}`
    : "";
  return {
    ...session,
    messages: [
      ...session.messages,
      {
        role: "user",
        content: `Huidige keuzes van de bewoner (eventueel met gekozen alternatieven):\n${choices}${skipped}\n\nFeedback van de bewoner: ${feedback}\n\nPas het ontwerp aan en geef het volledige ontwerp terug, met alternatieven.${switched}`,
      },
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
    const seen = new Set([it.itemNo]);
    const alternatives: Alternative[] = [];
    for (const alt of it.alternatives ?? []) {
      const altProduct = catalog[alt.itemNo];
      if (!altProduct || seen.has(alt.itemNo)) continue;
      seen.add(alt.itemNo);
      alternatives.push({ product: altProduct, note: alt.note, width: alt.width, depth: alt.depth });
    }
    items.push({
      itemNo: it.itemNo,
      quantity: Math.max(1, it.quantity),
      role: it.role,
      reason: it.reason,
      placement: toPlacement(it),
      product,
      alternatives: alternatives.slice(0, MAX_ALTERNATIVES),
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
