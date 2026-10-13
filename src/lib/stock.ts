// Stock and pick locations per IKEA store, from the same availability service
// ikea.com uses on its product pages. It is not an official public API: the
// client id below is the one embedded in ikea.com, and the response shape may
// change. Everything here degrades to "location unknown" rather than failing.

import { t } from "./i18n";
import { searchIkea } from "./ikea";
import type { CatalogLocale } from "./locale";

const AVAILABILITY_URL = "https://api.ingka.ikea.com/cia/availabilities/sto";
const CLIENT_ID = "b6c117e5-ae61-4ef5-b4cc-e0b1e37f0631";

export type Area = "markthal" | "zelfbediening" | "personeel" | "onbekend";

export interface PickLocation {
  area: Area;
  /** e.g. "Gang 12, vak 04" or "Textiel". */
  label: string;
  aisle?: string;
  bin?: string;
}

export interface PickPart {
  itemNo: string;
  name: string;
  location: PickLocation;
  stock: number | null;
}

export interface StockInfo {
  location: PickLocation;
  stock: number | null;
  /** Parts of a combination product, each with its own location. */
  parts: PickPart[];
}

const unknown = (): PickLocation => ({ area: "onbekend", label: t("loc.unknown") });

function toLocation(locs: any[] | undefined, locale: CatalogLocale): PickLocation {
  if (!Array.isArray(locs) || locs.length === 0) return unknown();
  const best = [...locs].sort((a, b) => (a.recommendationRank ?? 99) - (b.recommendationRank ?? 99))[0];
  if (best.type === "AISLE_AND_BIN" && best.aisleAndBin) {
    const { aisle, bin } = best.aisleAndBin;
    return { area: "zelfbediening", label: t("loc.aisleBin", { aisle, bin }), aisle, bin };
  }
  if (best.type === "DEPARTMENT") {
    const names: any[] = best.department?.names ?? [];
    const lang = locale.lang;
    const name = names.find((n) => n.languageCode === lang)?.name ?? names.find((n) => n.languageCode === "en")?.name ?? names[0]?.name ?? t("loc.department");
    return { area: best.division === "SELF_SERVE" ? "zelfbediening" : "markthal", label: name };
  }
  if (best.type === "CONTACT_STAFF") {
    return { area: "personeel", label: t("loc.staff") };
  }
  return unknown();
}

function quantity(av: any): number | null {
  const q = av?.buyingOption?.cashCarry?.availability?.quantity;
  return typeof q === "number" ? q : null;
}

/** Locations and stock for these articles in one store, keyed by itemNo. */
export async function fetchStock(storeId: string, itemNos: string[], locale: CatalogLocale): Promise<Record<string, StockInfo>> {
  if (itemNos.length === 0) return {};
  const url = `${AVAILABILITY_URL}/${storeId}?itemNos=${itemNos.join(",")}&expand=SalesLocations,ChildItems`;
  const res = await fetch(url, {
    headers: { "X-Client-ID": CLIENT_ID, Accept: "application/json;version=2" },
  });
  if (!res.ok) throw new Error(t("stock.error", { status: res.status }));
  const data = await res.json();

  const stockByItem = new Map<string, number | null>();
  for (const av of data.availabilities ?? []) {
    stockByItem.set(av.itemKey?.itemNo, quantity(av));
    for (const child of av.childAvailabilities ?? []) stockByItem.set(child.itemKey?.itemNo, quantity(child));
  }

  const result: Record<string, StockInfo> = {};
  const childNos = new Set<string>();
  for (const entry of data.salesLocations ?? []) {
    const itemNo = entry.itemKey?.itemNo;
    if (!itemNo) continue;
    const parts: PickPart[] = (entry.childItems ?? []).map((c: any) => {
      childNos.add(c.itemKey.itemNo);
      return {
        itemNo: c.itemKey.itemNo,
        name: c.itemKey.itemNo,
        location: toLocation(c.salesLocations, locale),
        stock: stockByItem.get(c.itemKey.itemNo) ?? null,
      };
    });
    result[itemNo] = {
      location: parts.length ? { area: "onbekend", label: t("loc.seeParts") } : toLocation(entry.salesLocations, locale),
      stock: stockByItem.get(itemNo) ?? null,
      parts,
    };
  }
  for (const itemNo of itemNos) {
    if (!result[itemNo]) result[itemNo] = { location: unknown(), stock: stockByItem.get(itemNo) ?? null, parts: [] };
  }

  // Parts only come with an article number; look up their names.
  const names = new Map<string, string>();
  await Promise.all(
    [...childNos].map(async (no) => {
      try {
        const hit = (await searchIkea(no, 3, locale)).find((p) => p.itemNo === no);
        if (hit) names.set(no, `${hit.name} ${hit.typeName}`.trim());
      } catch {
        // keep the article number as the name
      }
    }),
  );
  for (const info of Object.values(result)) {
    for (const part of info.parts) part.name = names.get(part.itemNo) ?? t("loc.article", { no: part.itemNo });
  }
  return result;
}

/** Walking order in a store: Markthal first, then the self-serve aisles. */
export function pickOrder(loc: PickLocation): number {
  switch (loc.area) {
    case "markthal": return 0;
    case "zelfbediening": return 1000 + (Number(loc.aisle) || 0) * 100 + (Number(loc.bin) || 0);
    case "personeel": return 20000;
    default: return 30000;
  }
}

export const areaLabel = (area: Area) => t(`area.${area}`);
