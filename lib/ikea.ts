import type { IkeaProduct } from "./types";

/**
 * IKEA product search.
 *
 * If parse.bot credentials are configured (PARSE_BOT_API_KEY + PARSE_BOT_SCRAPER_ID),
 * this calls your parse.bot IKEA API. Otherwise it returns curated mock data so the
 * app is fully usable before you wire up a real API.
 *
 * parse.bot endpoint shape:
 *   POST https://api.parse.bot/scraper/{SCRAPER_ID}/{SEARCH_ENDPOINT}
 *   Header: X-API-Key: pmx_...
 *   Body:   { [PARSE_BOT_QUERY_PARAM]: "<search term>" }
 *
 * Because the response schema depends on how you defined the endpoint in parse.bot,
 * `normalizeProducts` tries a range of common field names. Adjust it to match your
 * endpoint's actual output.
 */

const PARSE_BOT_BASE = "https://api.parse.bot";

export function isUsingMockData(): boolean {
  return !(process.env.PARSE_BOT_API_KEY && process.env.PARSE_BOT_SCRAPER_ID);
}

export async function searchIkea(query: string): Promise<IkeaProduct[]> {
  if (isUsingMockData()) {
    return mockSearch(query);
  }

  const scraperId = process.env.PARSE_BOT_SCRAPER_ID!;
  const endpoint = process.env.PARSE_BOT_SEARCH_ENDPOINT || "search_products";
  const queryParam = process.env.PARSE_BOT_QUERY_PARAM || "query";

  const url = `${PARSE_BOT_BASE}/scraper/${scraperId}/${endpoint}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.PARSE_BOT_API_KEY!,
      },
      body: JSON.stringify({ [queryParam]: query }),
      // Product data is fine to cache briefly; tune as needed.
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`parse.bot ${res.status} for "${query}" — falling back to mock`);
      return mockSearch(query);
    }

    const data: unknown = await res.json();
    const products = normalizeProducts(data);
    return products.length > 0 ? products : mockSearch(query);
  } catch (err) {
    console.error("parse.bot request failed — falling back to mock:", err);
    return mockSearch(query);
  }
}

/** Best-effort mapping from an unknown parse.bot response to IkeaProduct[]. */
function normalizeProducts(data: unknown): IkeaProduct[] {
  const rows = extractArray(data);
  return rows
    .map((row, i): IkeaProduct | null => {
      if (typeof row !== "object" || row === null) return null;
      const r = row as Record<string, unknown>;

      const name = pickString(r, ["name", "title", "product_name", "productName"]);
      if (!name) return null;

      return {
        id: pickString(r, ["id", "sku", "product_id", "productId"]) || `pb-${i}`,
        name,
        type: pickString(r, ["type", "category", "product_type"]) || "",
        price: pickNumber(r, ["price", "amount", "current_price", "price_value"]) ?? 0,
        currency: pickString(r, ["currency", "currency_code"]) || "EUR",
        imageUrl: pickString(r, ["imageUrl", "image", "image_url", "thumbnail", "img"]) || "",
        productUrl: pickString(r, ["productUrl", "url", "link", "product_url"]) || "",
      };
    })
    .filter((p): p is IkeaProduct => p !== null);
}

function extractArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const key of ["products", "results", "items", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Mock catalog — keyed loosely by category keyword so the app feels real
// before parse.bot is connected. Prices in EUR, imagery via placeholder.
// ---------------------------------------------------------------------------

interface MockEntry {
  keywords: string[];
  products: Omit<IkeaProduct, "id">[];
}

const MOCK_CATALOG: MockEntry[] = [
  {
    keywords: ["sofa", "couch", "settee", "loveseat"],
    products: [
      { name: "SÖDERHAMN 3-seat sofa", type: "Sofa", price: 749, currency: "EUR", imageUrl: ph("SÖDERHAMN"), productUrl: ikea("soderhamn") },
      { name: "KIVIK 2-seat sofa", type: "Sofa", price: 599, currency: "EUR", imageUrl: ph("KIVIK"), productUrl: ikea("kivik") },
    ],
  },
  {
    keywords: ["armchair", "accent chair", "lounge chair", "chair"],
    products: [
      { name: "POÄNG armchair", type: "Armchair", price: 129, currency: "EUR", imageUrl: ph("POÄNG"), productUrl: ikea("poang") },
      { name: "STRANDMON wing chair", type: "Armchair", price: 279, currency: "EUR", imageUrl: ph("STRANDMON"), productUrl: ikea("strandmon") },
    ],
  },
  {
    keywords: ["coffee table", "side table", "table"],
    products: [
      { name: "LACK coffee table", type: "Coffee table", price: 39, currency: "EUR", imageUrl: ph("LACK"), productUrl: ikea("lack") },
      { name: "LISTERBY coffee table", type: "Coffee table", price: 179, currency: "EUR", imageUrl: ph("LISTERBY"), productUrl: ikea("listerby") },
    ],
  },
  {
    keywords: ["rug", "carpet", "mat"],
    products: [
      { name: "VINDUM rug, high pile", type: "Rug", price: 99, currency: "EUR", imageUrl: ph("VINDUM"), productUrl: ikea("vindum") },
      { name: "STOENSE rug, low pile", type: "Rug", price: 59, currency: "EUR", imageUrl: ph("STOENSE"), productUrl: ikea("stoense") },
    ],
  },
  {
    keywords: ["floor lamp", "lamp", "lighting", "light"],
    products: [
      { name: "HOLMÖ floor lamp", type: "Floor lamp", price: 24, currency: "EUR", imageUrl: ph("HOLMÖ"), productUrl: ikea("holmo") },
      { name: "NYMÅNE floor/reading lamp", type: "Floor lamp", price: 69, currency: "EUR", imageUrl: ph("NYMÅNE"), productUrl: ikea("nymane") },
    ],
  },
  {
    keywords: ["shelf", "bookcase", "storage", "shelving"],
    products: [
      { name: "BILLY bookcase", type: "Bookcase", price: 79, currency: "EUR", imageUrl: ph("BILLY"), productUrl: ikea("billy") },
      { name: "KALLAX shelving unit", type: "Shelving", price: 89, currency: "EUR", imageUrl: ph("KALLAX"), productUrl: ikea("kallax") },
    ],
  },
  {
    keywords: ["plant", "greenery", "pot"],
    products: [
      { name: "FEJKA artificial potted plant", type: "Plant", price: 14, currency: "EUR", imageUrl: ph("FEJKA"), productUrl: ikea("fejka") },
      { name: "CHIAFRÖN potted monstera", type: "Plant", price: 29, currency: "EUR", imageUrl: ph("CHIAFRÖN"), productUrl: ikea("chiafron") },
    ],
  },
  {
    keywords: ["curtain", "drape", "blind"],
    products: [
      { name: "MAJGULL block-out curtains", type: "Curtains", price: 35, currency: "EUR", imageUrl: ph("MAJGULL"), productUrl: ikea("majgull") },
      { name: "LENDA curtains with tie-backs", type: "Curtains", price: 25, currency: "EUR", imageUrl: ph("LENDA"), productUrl: ikea("lenda") },
    ],
  },
  {
    keywords: ["cushion", "pillow", "throw", "textile"],
    products: [
      { name: "GURLI cushion cover", type: "Cushion", price: 5, currency: "EUR", imageUrl: ph("GURLI"), productUrl: ikea("gurli") },
      { name: "INGABRITTA throw", type: "Throw", price: 19, currency: "EUR", imageUrl: ph("INGABRITTA"), productUrl: ikea("ingabritta") },
    ],
  },
  {
    keywords: ["wall art", "mirror", "frame", "decor"],
    products: [
      { name: "RÖDALM frame", type: "Frame", price: 9, currency: "EUR", imageUrl: ph("RÖDALM"), productUrl: ikea("rodalm") },
      { name: "LINDBYN mirror", type: "Mirror", price: 49, currency: "EUR", imageUrl: ph("LINDBYN"), productUrl: ikea("lindbyn") },
    ],
  },
];

const GENERIC_FALLBACK: Omit<IkeaProduct, "id">[] = [
  { name: "EKET cabinet", type: "Storage", price: 45, currency: "EUR", imageUrl: ph("EKET"), productUrl: ikea("eket") },
  { name: "FROSTA stool", type: "Stool", price: 15, currency: "EUR", imageUrl: ph("FROSTA"), productUrl: ikea("frosta") },
];

function mockSearch(query: string): IkeaProduct[] {
  const q = query.toLowerCase();
  const entry = MOCK_CATALOG.find((e) => e.keywords.some((k) => q.includes(k)));
  const base = entry ? entry.products : GENERIC_FALLBACK;
  return base.map((p, i) => ({ ...p, id: `mock-${slug(p.name)}-${i}` }));
}

function ph(label: string): string {
  // Lightweight placeholder image so the board renders without external assets.
  return `https://placehold.co/400x400/eef2f5/64748b?text=${encodeURIComponent(label)}`;
}

function ikea(slugName: string): string {
  return `https://www.ikea.com/search/?q=${encodeURIComponent(slugName)}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
