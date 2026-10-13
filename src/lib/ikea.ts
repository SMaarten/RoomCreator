import type { IkeaProduct } from "./types";

// IKEA's public search endpoint (the one ikea.com itself uses). It allows
// cross-origin requests, so the browser can call it directly.
const SEARCH_URL = "https://sik.search.blue.cdtapps.com/be/nl/search-result-page";

export async function searchIkea(query: string, size = 8): Promise<IkeaProduct[]> {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&size=${size}&types=PRODUCT`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IKEA-zoekopdracht mislukt (${res.status})`);
  const data = await res.json();
  const items: unknown[] = data?.searchResultPage?.products?.main?.items ?? [];
  return items
    .map((it) => toProduct((it as { product?: unknown }).product))
    .filter((p): p is IkeaProduct => p !== null);
}

function toProduct(raw: unknown): IkeaProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, any>;
  if (!p.itemNo || !p.name || typeof p.salesPrice?.numeral !== "number") return null;
  return {
    itemNo: String(p.itemNo),
    name: String(p.name),
    typeName: String(p.typeName ?? ""),
    measure: String(p.itemMeasureReferenceText ?? ""),
    price: p.salesPrice.numeral,
    currency: p.salesPrice.currencyCode ?? "EUR",
    imageUrl: String(p.mainImageUrl ?? ""),
    url: String(p.pipUrl ?? `https://www.ikea.com/be/nl/search/?q=${encodeURIComponent(p.name)}`),
    colors: Array.isArray(p.colors) ? p.colors.map((c: any) => String(c?.name ?? "")).filter(Boolean) : [],
    rating: typeof p.ratingValue === "number" ? p.ratingValue : undefined,
  };
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}
